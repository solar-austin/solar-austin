// Imported Green Button data: absolute monthly kWh [jan..dec], or null
let importedMonthlyKwh = null;
// Imported hourly load profiles: 12 arrays of 24 normalized values, or null
let importedMonthlyHourlyProfiles = null;
// Metadata about the imported data: { isComplete, dateRange } or null
let importedDataMeta = null;

function parseGreenButtonCsv(text) {
  const lines = text.split(/\r?\n/);
  const monthly = new Array(12).fill(0);
  // hourlyBuckets[month][hour] = total kWh across all days
  const hourlyBuckets = Array.from({ length: 12 }, () => new Array(24).fill(0));
  let found = 0;
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const cols = line.split(',');
    const datePart = cols[0]?.trim();
    const startTimePart = cols[1]?.trim();
    const usagePart = cols[3]?.trim();
    if (!datePart || !usagePart) continue;
    const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const monthIndex = parseInt(match[2], 10) - 1;
    if (monthIndex < 0 || monthIndex > 11) continue;
    const kwh = parseFloat(usagePart);
    if (!Number.isFinite(kwh) || kwh < 0) continue;
    monthly[monthIndex] += kwh;
    if (startTimePart) {
      const hourMatch = startTimePart.match(/^(\d{1,2}):/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1], 10);
        if (hour >= 0 && hour < 24) hourlyBuckets[monthIndex][hour] += kwh;
      }
    }
    found++;
  }
  if (found === 0) throw new Error('No valid usage rows found in CSV.');
  const zeroes = monthly.filter((v) => v === 0).length;
  if (zeroes > 2) throw new Error(`Only ${12 - zeroes} months of data found — need at least 10.`);
  importedMonthlyHourlyProfiles = hourlyBuckets.map((hours) => normalizeProfile(hours));
  importedDataMeta = { isComplete: true };
  return monthly;
}

function parseGreenButtonXml(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error — file may be malformed.');
  const monthly = new Array(12).fill(0);
  let found = 0;
  doc.querySelectorAll('IntervalReading').forEach((reading) => {
    const startEl = reading.querySelector('timePeriod > start');
    const valueEl = reading.querySelector('value');
    if (!startEl || !valueEl) return;
    const epochSec = parseInt(startEl.textContent, 10);
    const wh = parseFloat(valueEl.textContent);
    if (!Number.isFinite(epochSec) || !Number.isFinite(wh) || wh < 0) return;
    const monthIndex = new Date(epochSec * 1000).getMonth();
    monthly[monthIndex] += wh / 1000;
    found++;
  });
  if (found === 0) throw new Error('No IntervalReading elements found in XML.');
  const zeroes = monthly.filter((v) => v === 0).length;
  if (zeroes > 2) throw new Error(`Only ${12 - zeroes} months of data found — need at least 10.`);
  importedDataMeta = { isComplete: true };
  return monthly;
}

function parseCOABillingCsv(text) {
  const lines = text.split(/\r?\n/);
  // Find the header row (contains TYPE, START DATE, END DATE, USAGE)
  let headerIdx = -1;
  let typeCol = -1, startDateCol = -1, endDateCol = -1, usageCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().toUpperCase());
    if (cols.includes('TYPE') && cols.includes('START DATE') && cols.includes('END DATE')) {
      headerIdx = i;
      typeCol = cols.indexOf('TYPE');
      startDateCol = cols.indexOf('START DATE');
      endDateCol = cols.indexOf('END DATE');
      usageCol = cols.findIndex((c) => c.startsWith('USAGE'));
      break;
    }
  }
  if (headerIdx === -1) throw new Error('Could not find billing data header row.');
  if (usageCol === -1) throw new Error('Could not find USAGE column.');

  const monthly = new Array(12).fill(null); // null = not yet seen
  let found = 0;
  let minStartDate = null;
  let maxEndDate = null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(',').map((c) => c.trim());
    if (cols[typeCol]?.toLowerCase() !== 'electric billing') continue;
    const startDate = cols[startDateCol];
    const endDate = cols[endDateCol];
    const match = endDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) continue;
    const monthIndex = parseInt(match[2], 10) - 1;
    if (monthIndex < 0 || monthIndex > 11) continue;
    const usageStr = (cols[usageCol] || '').replace(/[$,]/g, '');
    const kwh = parseFloat(usageStr);
    if (!Number.isFinite(kwh)) continue;
    monthly[monthIndex] = Math.max(0, kwh); // floor negatives (net export) at 0
    if (startDate && (!minStartDate || startDate < minStartDate)) minStartDate = startDate;
    if (endDate && (!maxEndDate || endDate > maxEndDate)) maxEndDate = endDate;
    found++;
  }
  if (found === 0) throw new Error('No Electric billing rows found in CSV.');

  // Fill missing months using seasonal profile scaled to the known non-zero months.
  // MONTHLY_USAGE_PROFILE is normalized (sums to 1), so value[m] = annual * profile[m].
  const nonZeroIndices = monthly.map((v, i) => (v !== null && v > 0 ? i : -1)).filter((i) => i >= 0);
  let annualEstimate;
  if (nonZeroIndices.length > 0) {
    const ratios = nonZeroIndices.map((i) => monthly[i] / MONTHLY_USAGE_PROFILE[i]);
    annualEstimate = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  } else {
    // All known months are net-export zero — use a conservative 100 kWh/month baseline
    annualEstimate = 1200;
  }
  for (let m = 0; m < 12; m++) {
    if (monthly[m] === null) {
      monthly[m] = annualEstimate * MONTHLY_USAGE_PROFILE[m];
    }
  }

  const formatBillingDate = (iso) => {
    const m = iso?.match(/^(\d{4})-(\d{2})/);
    return m ? `${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}` : iso;
  };
  importedDataMeta = {
    isComplete: false,
    dateRange: (minStartDate && maxEndDate)
      ? `${formatBillingDate(minStartDate)} – ${formatBillingDate(maxEndDate)}`
      : null,
    knownMonths: found,
  };
  return monthly;
}

async function parseGreenButtonFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.xml') || text.trimStart().startsWith('<')) {
    return parseGreenButtonXml(text);
  }
  // Detect City of Austin billing CSV format (has "Electric billing" data rows)
  if (text.includes('Electric billing') && text.includes('START DATE')) {
    return parseCOABillingCsv(text);
  }
  return parseGreenButtonCsv(text);
}

function syncGreenButtonUi() {
  const hasImport = importedMonthlyKwh !== null;
  const importTabActive = !document.getElementById('usageEstimatedWrap') ||
    document.getElementById('usageImportWrap')?.hidden === false;

  const dropZone = document.getElementById('greenButtonDropZone');
  if (dropZone) dropZone.classList.toggle('has-import', hasImport);
  document.getElementById('importedDataBanner').hidden = !hasImport;
  document.getElementById('greenButtonClear').hidden = !hasImport;

  const statusEl = document.getElementById('greenButtonStatus');
  if (!hasImport) {
    statusEl.textContent = '';
    statusEl.hidden = true;
  }

  const noteEl = document.getElementById('importedDataNote');
  if (noteEl) {
    const meta = importedDataMeta;
    const showNote = hasImport && meta && !meta.isComplete && meta.dateRange;
    noteEl.hidden = !showNote;
    if (showNote) {
      noteEl.textContent = `Partial data (${meta.dateRange}) — missing months estimated from seasonal profile.`;
    }
  }

  // Austin-specific hint and nudge
  const austinHint = document.getElementById('greenButtonHintAustin');
  if (austinHint) austinHint.hidden = APP_MODE !== 'austin_energy';
  const nudge = document.getElementById('greenButtonNudge');
  if (nudge) nudge.hidden = APP_MODE !== 'austin_energy';

  // If a file was just imported, auto-switch to import tab
  if (hasImport) setUsageTab('import');
}

function setUsageTab(tab) {
  const estimatedWrap = document.getElementById('usageEstimatedWrap');
  const importWrap = document.getElementById('usageImportWrap');
  const btnEstimated = document.getElementById('btnUsageEstimated');
  const btnImport = document.getElementById('btnUsageImport');
  const isImport = tab === 'import';
  if (estimatedWrap) estimatedWrap.hidden = isImport;
  if (importWrap) importWrap.hidden = !isImport;
  if (btnEstimated) {
    btnEstimated.classList.toggle('cost-mode-btn--active', !isImport);
  }
  if (btnImport) {
    btnImport.classList.toggle('cost-mode-btn--active', isImport);
  }
}
