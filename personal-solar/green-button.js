// Imported Green Button data: absolute monthly kWh [jan..dec], or null
let importedMonthlyKwh = null;
// Imported hourly load profiles: 12 arrays of 24 normalized values, or null
let importedMonthlyHourlyProfiles = null;

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
  return monthly;
}

async function parseGreenButtonFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.xml') || text.trimStart().startsWith('<')) {
    return parseGreenButtonXml(text);
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
