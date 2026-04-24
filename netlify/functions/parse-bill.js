'use strict';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_BILL_MODEL || 'gpt-4o';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB base64-decoded limit

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'OpenAI API key not configured on the server.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const { file, filename } = body;
  if (!file || typeof file !== 'string') {
    return json(400, { error: 'Provide a base64-encoded PDF in the "file" field.' });
  }

  // Rough size check on the base64 string (~75% efficiency)
  if (file.length > MAX_FILE_BYTES * 1.4) {
    return json(413, { error: 'File too large. Maximum supported size is 5 MB.' });
  }

  const fileData = file.startsWith('data:')
    ? file
    : `data:application/pdf;base64,${file}`;

  const prompt = [
    'This is a residential electricity bill PDF. Extract every monthly electricity usage value in kWh that appears anywhere in the document.',
    '',
    'PRIORITY ORDER for finding usage data:',
    '1. Printed tables or text listing kWh by month — most reliable, use these first.',
    '2. Bar charts or line graphs showing monthly usage history — read bar heights or data points against the axis scale if no printed values are present.',
    '',
    'Extract every month you can find, going as far back as the document shows. Include the month and year for each entry.',
    '',
    'Return ONLY a valid JSON object — no prose, no markdown — in exactly this shape:',
    '{',
    '  "months": [{"label": "MMM YYYY", "kwh": number}, ...],',
    '  "source": "table" | "graph" | "mixed",',
    '  "note": "one-sentence description of what you found and how far back the data goes"',
    '}',
    '',
    'Rules:',
    '- "months" must be sorted oldest-first.',
    '- Each "kwh" must be a plain number, never a string.',
    '- "label" should be like "Jan 2024".',
    '- If you read values from a graph, still include them — note this in "source" and "note".',
    '- If you truly cannot find any usage data, return {"months": [], "source": "none", "note": "explanation"}.',
  ].join('\n');

  let oaiResponse;
  try {
    oaiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: MODEL,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: filename || 'bill.pdf',
              file_data: fileData,
            },
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        }],
        max_output_tokens: 800,
      }),
    });
  } catch (err) {
    return json(502, { error: `OpenAI request failed: ${err.message}` });
  }

  const payload = await oaiResponse.json();
  if (!oaiResponse.ok) {
    return json(502, { error: payload.error?.message || 'OpenAI request failed.' });
  }

  const outputText = payload.output?.[0]?.content?.[0]?.text ?? '';

  let parsed;
  try {
    parsed = parseJsonLoose(outputText);
  } catch (_) {
    return json(502, { error: 'Could not parse the model response as JSON.', raw: outputText });
  }

  if (!parsed || !Array.isArray(parsed.months)) {
    return json(502, { error: 'Unexpected response format from model.', raw: outputText });
  }

  const validMonths = parsed.months
    .filter((m) => m && typeof m.kwh === 'number' && Number.isFinite(m.kwh) && m.kwh >= 0)
    .map((m) => ({ label: String(m.label || ''), kwh: Math.round(m.kwh) }));

  if (validMonths.length === 0) {
    return json(422, { error: 'No monthly usage data found in the bill.', note: String(parsed.note || '') });
  }

  const average_monthly_kwh = Math.round(
    validMonths.reduce((s, m) => s + m.kwh, 0) / validMonths.length,
  );

  return json(200, {
    months: validMonths,
    average_monthly_kwh,
    source: String(parsed.source || 'unknown'),
    note: String(parsed.note || ''),
  });
};
