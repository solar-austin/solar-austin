'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const BILL_RATE      = 0.145;   // $/kWh for bill↔usage conversion
const KWH_PER_MILE   = 0.000404; // EPA: lbs CO2/kWh → 4.04e-4 metric tons CO2/kWh
const MILES_PER_KWH  = 1 / 0.000404 * 0.000404 * 2481; // simpler: ~0.0003 tons/kWh
const CO2_PER_KWH    = 0.000386; // metric tons CO2 / kWh (EPA US avg)
const TONS_CO2_PER_CAR_MILE = 0.000404;  // metric tons CO2 / mile
const TONS_CO2_PER_TREE     = 0.021;     // metric tons CO2 / tree / year
const TONS_CO2_PER_FLIGHT   = 1.0;       // metric tons CO2 / long-haul flight

// ── State ────────────────────────────────────────────────────────────────────
let coverageChartInst = null;
let billSavingsChartInst = null;
let costChartInst = null;
let energyChartInst = null;
let phaseTwo = false;

// ── Slider fill helper ───────────────────────────────────────────────────────
function setSliderFill(el) {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const pct = ((Number(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--pct', `${pct}%`);
}

function initSlider(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  setSliderFill(el);
  el.addEventListener('input', () => { setSliderFill(el); onChange(el); });
}

// ── Format helpers ───────────────────────────────────────────────────────────
function fmt$(n)   { return n < 0 ? `-$${Math.round(-n).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`; }
function fmtK$(n)  { return n >= 1000 ? `$${(n/1000).toFixed(1)}K` : fmt$(n); }
function fmtKwh(n) { return `${Math.round(n).toLocaleString()} kWh`; }

// ── Bill ↔ usage sync ────────────────────────────────────────────────────────

// Binary search inverse of calculateAustinEnergyUsageBill — exact kWh for a given bill
function billToKwh(bill) {
  if (typeof calculateAustinEnergyUsageBill === 'function') {
    let lo = 0, hi = 5000;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (calculateAustinEnergyUsageBill(mid).total < bill) lo = mid;
      else hi = mid;
    }
    return Math.max(0, Math.round((lo + hi) / 2));
  }
  // Fallback: simple flat rate
  const kwh = Math.round(bill / BILL_RATE / 10) * 10;
  return Math.max(300, Math.min(2500, kwh));
}

function syncBillDisplay(bill) {
  const kwh = billToKwh(bill);
  const disp = document.getElementById('billDisplay');
  const kwhDisp = document.getElementById('billKwhDisplay');
  if (disp) disp.textContent = `$${bill}`;
  if (kwhDisp) kwhDisp.textContent = `${kwh.toLocaleString()} kWh`;
  document.getElementById('monthlyUsage').value = String(kwh);
}

// ── Run the model and refresh all output ─────────────────────────────────────
function runModel() {
  try {
    const inputs   = getInputs();
    const yearOne  = buildYearModel(inputs, 0);
    const fullRun  = buildTenYearModel(inputs);
    updateResults(inputs, yearOne, fullRun);
  } catch (e) {
    console.error('Model error:', e);
  }
}

// ── Update all result elements ───────────────────────────────────────────────
function updateResults(inputs, yearOne, fullRun) {
  // 30-year savings
  const savings30 = fullRun.yearlyResults
    .reduce((s, y) => s + y.savings, 0);

  const netSavings30 = savings30 - fullRun.totalInstallCost;
  const avgBillBefore = Math.round(yearOne.billWithoutSolar / 12);
  const avgBillAfter  = Math.round(yearOne.billWithSolar / 12);

  setText('stat20yrSavings', fmtK$(netSavings30));
  setText('statBillBefore',  `$${avgBillBefore}`);
  setText('statBillAfter',   `$${avgBillAfter}`);

  // Show sysCard in left panel once results are available
  const sysCard = document.getElementById('sysCard');
  if (sysCard) sysCard.hidden = false;

  // System specs
  const panels = googleSolarResult?.maxPanels
    ? Math.min(googleSolarResult.maxPanels, Math.ceil(inputs.systemSize / 0.4))
    : Math.ceil(inputs.systemSize / 0.4);

  setText('sysPayback',     fullRun.paybackYear ? `${fullRun.paybackYear} years` : '> 30 years');
  setText('sysSolarCost',   fmt$(inputs.solarInstallCost));
  setText('sysBatteryCost', inputs.batteryInstallCost > 0 ? fmt$(inputs.batteryInstallCost) : '—');
  const rebateRow = document.getElementById('sysRebateRow');
  if (rebateRow) rebateRow.hidden = inputs.rebate <= 0;
  setText('sysRebate',      inputs.rebate > 0 ? `-$${inputs.rebate.toLocaleString()}` : '—');
  setText('sysInstallCost', fmt$(inputs.installCost));

  // Energy coverage donut
  const totalUsage = yearOne.monthlyRows.reduce((s, r) => s + r.usage, 0);
  const totalSolar  = yearOne.monthlyRows.reduce((s, r) => s + r.directSolar + r.batteryDischarge, 0);
  const coveragePct = totalUsage > 0 ? Math.min(100, Math.round((totalSolar / totalUsage) * 100)) : 0;
  setText('coverageLabel', `${coveragePct}%`);

  // Charts
  renderBillSavings(yearOne);
  renderCostChart(fullRun);
  renderEnergyChart(yearOne);

  // Environmental impact (year 1 solar generation)
  const annualSolarKwh = yearOne.monthlyRows.reduce((s, r) => s + r.solar, 0);
  const co2Avoided = annualSolarKwh * CO2_PER_KWH; // metric tons
  setText('impactSub', `By going solar, your system will avoid ${co2Avoided.toFixed(1)} metric tons of CO₂e per year, equivalent to:`);
  setText('impactMiles',   Math.round(co2Avoided / TONS_CO2_PER_CAR_MILE).toLocaleString());
  setText('impactTrees',   Math.round(co2Avoided / TONS_CO2_PER_TREE).toLocaleString());
  setText('impactFlights', Math.round(co2Avoided / TONS_CO2_PER_FLIGHT).toLocaleString());
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Charts ───────────────────────────────────────────────────────────────────
const TEAL  = '#2bb5a0';
const TEAL2 = 'rgba(43,181,160,0.15)';
const GRAY  = '#d1d5db';
const GRAY2 = '#9ca3af';
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderCoverage(pct) {
  const ctx = document.getElementById('coverageChart')?.getContext('2d');
  if (!ctx) return;
  if (coverageChartInst) coverageChartInst.destroy();
  coverageChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct, 100 - pct],
        backgroundColor: [TEAL, '#e5e7eb'],
        borderWidth: 0,
        hoverOffset: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    }
  });
}

function renderBillSavings(yearOne) {
  const ctx = document.getElementById('billSavingsChart')?.getContext('2d');
  if (!ctx) return;
  if (billSavingsChartInst) billSavingsChartInst.destroy();

  const withSolarData    = yearOne.monthlyRows.map(r => Math.round(r.billWithSolar));
  const withoutSolarData = yearOne.monthlyRows.map(r => Math.round(r.billWithoutSolar));

  billSavingsChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        {
          label: 'With solar',
          data: withSolarData,
          borderColor: TEAL,
          backgroundColor: TEAL2,
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: TEAL,
          fill: true,
          tension: 0.4,
        },
        {
          label: 'Without solar',
          data: withoutSolarData,
          borderColor: GRAY2,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: GRAY2,
          fill: false,
          tension: 0.4,
        }
      ]
    },
    options: {
      ...baseChartOpts(),
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          grid: { color: '#f3f4f6' },
          ticks: { font: { size: 10 }, callback: v => `$${v}` }
        }
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: { label: c => ` ${c.dataset.label}: $${c.raw}` }
        }
      }
    }
  });
}

function renderCostChart(fullRun) {
  const ctx = document.getElementById('costChart')?.getContext('2d');
  if (!ctx) return;
  if (costChartInst) costChartInst.destroy();

  const startYear = new Date().getFullYear();
  const years = fullRun.yearlyResults;
  const labels = [startYear - 1, ...years.map((_, i) => startYear + i)];

  // Year 0 = upfront install cost paid; subsequent years accumulate bills
  const upfront = fullRun.totalInstallCost ?? 0;
  let cumWithSolar = upfront;
  let cumNoSolar   = 0;
  const withSolarData = [upfront, ...years.map(y => {
    cumWithSolar += y.billWithSolar;
    return Math.round(cumWithSolar);
  })];
  const noSolarData = [0, ...years.map(y => {
    cumNoSolar += y.billWithoutSolar;
    return Math.round(cumNoSolar);
  })];

  costChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'With solar',
          data: withSolarData,
          borderColor: TEAL,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: 'No solar',
          data: noSolarData,
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
        }
      ]
    },
    options: {
      ...baseChartOpts(),
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 10 } } },
        y: {
          grid: { color: '#f3f4f6' },
          ticks: { font: { size: 10 }, callback: v => `$${(v/1000).toFixed(0)}K` }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: { label: c => ` ${c.dataset.label}: $${c.raw.toLocaleString()}` }
        }
      }
    }
  });
}

function renderEnergyChart(yearOne) {
  const ctx = document.getElementById('energyChart')?.getContext('2d');
  if (!ctx) return;
  if (energyChartInst) energyChartInst.destroy();

  const solarData  = yearOne.monthlyRows.map(r => Math.round(r.solar));
  const usageData  = yearOne.monthlyRows.map(r => Math.round(r.usage));

  energyChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        {
          label: 'Solar production (kWh/month)',
          data: solarData,
          borderColor: TEAL,
          backgroundColor: TEAL2,
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: TEAL,
          fill: true,
          tension: 0.4,
        },
        {
          label: 'Electricity consumption (kWh/month)',
          data: usageData,
          borderColor: GRAY2,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: GRAY2,
          fill: false,
          tension: 0.4,
        }
      ]
    },
    options: {
      ...baseChartOpts(),
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          grid: { color: '#f3f4f6' },
          ticks: { font: { size: 10 }, callback: v => `${v}` }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: { label: c => ` ${c.dataset.label}: ${c.raw.toLocaleString()} kWh` }
        }
      }
    }
  });
}

function baseChartOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
  };
}

// ── Phase transition ─────────────────────────────────────────────────────────
function revealPhase2() {
  if (phaseTwo) return;
  phaseTwo = true;

  document.getElementById('heroSection').hidden       = true;
  document.getElementById('calculatorSection').hidden = false;
  document.getElementById('results').hidden           = false;
  document.getElementById('mapWrap').classList.add('fixed');
  document.getElementById('leftPanel').classList.add('sticky');

  // Show address in left panel
  const addr = document.getElementById('addressInput').value.trim();
  const calcAddr = document.getElementById('calcAddress');
  if (calcAddr && addr) calcAddr.textContent = addr;

  runModel();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  requestAnimationFrame(() => {
    requestAnimationFrame(async () => {
      // Compute map width from known layout constants (avoids unreliable mid-transition DOM reads)
      // page-wrap: max-width 1360px, padding 24px each side → content max 1312px
      // desktop (>1000px): right-col = content - left-panel(380px) - gap(18px)
      // mobile: right-col = full content width
      const vw = window.innerWidth;
      const contentW = Math.min(vw, 1360) - 48;
      window._mapContainerWidth = vw > 1000 ? Math.max(400, contentW - 398) : Math.max(300, contentW);
      initSolarMap(_pendingLat, _pendingLng, 19);
      if (window.googleSolarRawPayload) {
        await updateSolarMapFromPayload(window.googleSolarRawPayload);
      }
    });
  });
}

// ── Solar data cache (localStorage, 24 h TTL) ────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'solar_cache_';

function cacheKey(address) {
  return CACHE_PREFIX + address.toLowerCase().replace(/\s+/g, ' ').trim();
}

function cacheGet(address) {
  try {
    const raw = localStorage.getItem(cacheKey(address));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(cacheKey(address)); return null; }
    return data;
  } catch { return null; }
}

function cacheSet(address, data) {
  try { localStorage.setItem(cacheKey(address), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ── Lookup ───────────────────────────────────────────────────────────────────
async function doLookup() {
  const address = document.getElementById('addressInput').value.trim();
  const statusEl = document.getElementById('lookupStatus');

  if (!address) {
    statusEl.textContent = 'Enter an address first.';
    statusEl.className = 'status-msg error';
    return;
  }

  document.getElementById('submitBtn').disabled = true;

  const cached = cacheGet(address);
  if (cached) {
    statusEl.textContent = 'Roof lookup complete.';
    statusEl.className = 'status-msg';
    applyLookupPayload(cached);
    document.getElementById('submitBtn').disabled = false;
    return;
  }

  statusEl.textContent = 'Looking up roof data…';
  statusEl.className = 'status-msg';

  try {
    const res = await fetch(`/.netlify/functions/solar-insights?address=${encodeURIComponent(address)}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Lookup failed');
    cacheSet(address, payload);
    statusEl.textContent = 'Roof lookup complete.';
    applyLookupPayload(payload);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'status-msg error';
  } finally {
    document.getElementById('submitBtn').disabled = false;
  }
}

function applyLookupPayload(payload) {
  window.googleSolarRawPayload = payload;
  window.googleSolarResult = summarizeGoogleSolarResult(payload);

  const dataset = getGoogleSolarDataset(payload);
  if (dataset?.maxRoofCapacityKw) {
    const sysInput = document.getElementById('systemSize');
    const suggestedKw = Math.min(dataset.maxRoofCapacityKw, 16);
    sysInput.value = String(Math.round(suggestedKw * 10) / 10);
    setSliderFill(sysInput);
    document.getElementById('systemSizeSlider').value = sysInput.value;
    setSliderFill(document.getElementById('systemSizeSlider'));
    document.getElementById('systemSizeDisplay').textContent = `${sysInput.value} kW`;
  }
  if (window.googleSolarResult?.installCostBenchmark?.value) {
    const ic = document.getElementById('installCost');
    ic.value = String(Math.round(
      Math.max(Number(ic.min), Math.min(Number(ic.max), window.googleSolarResult.installCostBenchmark.value))
    ));
  }
  if (window.googleSolarResult?.suggestedProductionPerKw) {
    const pInput = document.getElementById('productionPerKw');
    pInput.value = String(Math.round(window.googleSolarResult.suggestedProductionPerKw));
  }
  revealPhase2();
}

// ── Pending map position (set on place selection, applied when map is shown) ──
let _pendingLat = 30.2672;
let _pendingLng = -97.7431;

// ── Google Maps / Places init ────────────────────────────────────────────────
function onGoogleMapsApiLoaded() {
  googleMapsApiReady = true; // set map-overlay.js's own variable so initSolarMap doesn't bail
  SOLAR_MAP_API_KEY = window._solarMapApiKey || null;

  // Do NOT call initSolarMap here — calculatorSection is still hidden (display:none)
  // and Google Maps cannot render into a hidden container. Map is initialized
  // lazily in revealPhase2() after the section becomes visible.

  // Places autocomplete — store lat/lng; lookup triggered by button/Enter only
  const input = document.getElementById('addressInput');
  if (input && google.maps.places) {
    const ac = new google.maps.places.Autocomplete(input, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'geometry'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place.formatted_address) input.value = place.formatted_address;
      if (place.geometry?.location) {
        _pendingLat = place.geometry.location.lat();
        _pendingLng = place.geometry.location.lng();
      }
    });
  }
}

// ── Wire up UI ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Bill slider (in calculator phase)
  initSlider('billSlider', el => {
    const bill = Number(el.value);
    syncBillDisplay(bill);
    if (phaseTwo) runModel();
  });
  // Set initial bill display and hidden usage value
  syncBillDisplay(150);

  // System size slider (phase 2)
  initSlider('systemSizeSlider', el => {
    document.getElementById('systemSize').value = el.value;
    document.getElementById('systemSizeDisplay').textContent = `${Number(el.value).toFixed(1)} kW`;
    if (phaseTwo) runModel();
  });

  // Battery slider (phase 2)
  initSlider('batterySlider', el => {
    document.getElementById('batteryPower').value = el.value;
    const v = Number(el.value);
    document.getElementById('batteryDisplay').textContent = v === 0 ? 'None' : `${v} kWh`;
    if (phaseTwo) runModel();
  });

  // Submit button (in hero)
  document.getElementById('submitBtn').addEventListener('click', doLookup);

  // Enter key on address field triggers lookup
  document.getElementById('addressInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
  });

  // Payment toggle
  const btnCash       = document.getElementById('btnCash');
  const btnFinancing  = document.getElementById('btnFinancing');
  const loanTermInput = document.getElementById('loanTerm');

  btnCash.addEventListener('click', () => {
    btnCash.classList.add('active');
    btnFinancing.classList.remove('active');
    loanTermInput.value = '0';
    if (phaseTwo) runModel();
  });
  btnFinancing.addEventListener('click', () => {
    btnFinancing.classList.add('active');
    btnCash.classList.remove('active');
    if (loanTermInput.value === '0') loanTermInput.value = '10';
    if (phaseTwo) runModel();
  });

  // Load install cost lookup for benchmark pricing
  fetch('/personal-solar/install-cost-lookup.json')
    .then(r => r.json())
    .then(data => { window.installCostLookup = data; })
    .catch(() => {});
});
