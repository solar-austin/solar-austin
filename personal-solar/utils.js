function normalizeProfile(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    const evenWeight = values.length > 0 ? 1 / values.length : 0;
    return values.map(() => evenWeight);
  }
  return values.map((value) => value / total);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyPrecise(value, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatLookupSizeKw(value) {
  return Number.isFinite(value) ? `${formatNumber(value, 1)} kW` : '-';
}

function formatLookupProduction(value) {
  return Number.isFinite(value) ? `${formatNumber(value, 0)} kWh per kW-year` : '-';
}

function formatLookupInstallCost(value) {
  return Number.isFinite(value) ? `${formatCurrency(value)}/kW` : '-';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeStateCode(value) {
  if (!value) return null;
  const text = String(value).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : null;
}

function normalizeZipCode(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 5 ? digits.slice(0, 5) : null;
}

function parseAddressLocation(address) {
  const text = typeof address === 'string' ? address.trim() : '';
  if (!text) {
    return { stateCode: null, postalCode: null };
  }
  const match = text.match(/,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:,\s*[A-Z]+)?$/);
  return {
    stateCode: normalizeStateCode(match?.[1]),
    postalCode: normalizeZipCode(match?.[2]),
  };
}

function getInstallCostBenchmark(location) {
  const stateCode = normalizeStateCode(location?.stateCode);
  if (!installCostLookup || !stateCode) return null;

  const thresholds = installCostLookup.thresholds || {};
  const stateEntry = installCostLookup.states?.[stateCode] || null;
  if (stateEntry && (stateEntry.count || 0) >= (thresholds.stateMinSamples || 0)) {
    return {
      value: Number(stateEntry.medianCostPerKw),
      source: `${stateCode} state median`,
      count: stateEntry.count,
    };
  }

  return null;
}

function applyInstallCostBenchmark(benchmark) {
  if (!benchmark || !Number.isFinite(benchmark.value)) return false;
  if (APP_MODE === 'austin_energy') return false;
  const input = document.getElementById('installCost');
  if (!input) return false;
  const min = Number(input.min);
  const max = Number(input.max);
  const step = Number(input.step) || 50;
  const clamped = clamp(benchmark.value, min, max);
  const snapped = Math.round(clamped / step) * step;
  input.value = String(snapped);
  return true;
}

function syncInstallCostFromGoogleResult() {
  if (!googleSolarResult?.installCostBenchmark) return false;
  return applyInstallCostBenchmark(googleSolarResult.installCostBenchmark);
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + row[key], 0);
}
