/**
 * Austin Energy Dashboard — model and charts for generation mix, reliability, and cost.
 * Reads slider inputs, builds 11-year supply/load data, and draws the mix stack and 24h reliability chart.
 */

/** Number of years in the planning horizon (year 0 through year 10). */
const YEARS = 11;

/** First year of the planning horizon (year index 0). */
const BASE_YEAR = 2025;

/**
 * Capacity factors: average fraction of nameplate capacity that each resource produces over a year.
 * Used to convert MW or MW/year build into TWh (e.g. MW * 8760 * CF / 1e6).
 */
const CF = { wind: 0.35, solar: 0.25, geo: 0.9, gas: 0.05, nuke: 0.9 };

/** Wholesale or proxy energy prices ($/MWh) used for the estimated generation rate (¢/kWh). */
const PRICES = { nuke: 35, gas: 75, exWind: 28, exSolar: 24, newWind: 48, newSolar: 36, geo: 85, gap: 120 };

/**
 * Chart colors (c) and legend labels (l). Wind and solar are single-hue pairs: same color, light then dark (same shade step).
 */
const STYLES = {
  nuke: { c: '#B0BEC5', l: 'Nuclear' },
  gas: { c: '#90A4AE', l: 'Local Gas' },
  exWind: { c: '#B3E5FC', l: 'Exist. Wind' },   // light blue
  newWind: { c: '#4FC3F7', l: 'New Wind' },     // dark blue (same hue)
  exSolar: { c: '#FFDDA0', l: 'Exist. Solar' }, // light orange (same hue as New Solar)
  newSolar: { c: '#E09328', l: 'New Solar' },   // dark orange (same hue)
  geo: { c: '#A1887F', l: 'New Geo' },
  gap: { c: '#E57373', l: 'Market Gap' },
};

/** Stack/legend order: pairs Exist. Wind + New Wind, then Exist. Solar + New Solar. */
const MIX_CHART_ORDER = ['nuke', 'gas', 'exWind', 'newWind', 'exSolar', 'newSolar', 'geo', 'gap'];

/**
 * 24-hour normalized profiles for the August peak reliability stress test.
 * Index = hour of day (0–23). Used to scale peak load and variable supply hour-by-hour.
 *
 * - load:  Relative demand by hour; 1.0 = peak (e.g. afternoon). Shapes the load curve.
 * - solar: Relative solar output by hour; peaks midday. Multiplied by solar MW to get supply.
 * - wind:  Relative wind output by hour. Multiplied by wind MW (and 0.2 factor) for supply.
 */
const PROF = {
  load: [0.45, 0.42, 0.40, 0.39, 0.41, 0.45, 0.52, 0.60, 0.68, 0.75, 0.82, 0.88, 0.94, 0.98, 1.00, 0.99, 0.96, 0.92, 0.85, 0.78, 0.70, 0.62, 0.55, 0.50],
  solar: [0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.45, 0.65, 0.85, 0.95, 1.0, 0.95, 0.85, 0.65, 0.40, 0.15, 0.02, 0, 0, 0, 0, 0],
  wind: [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.1, 0.15, 0.2, 0.25, 0.2, 0.15, 0.15, 0.2, 0.25, 0.35, 0.45, 0.55, 0.6, 0.6, 0.55],
};

/**
 * Reads slider values, recomputes 11-year supply/load and gap, updates KPIs and both charts.
 */
function update() {
  const tx = +document.getElementById('p_tx').value;
  const growth = +document.getElementById('p_growth').value;
  const nSolar = +document.getElementById('p_solar').value;
  const nWind = +document.getElementById('p_wind').value;
  const nGeo = +document.getElementById('p_geo').value;
  const gas = +document.getElementById('p_gas').value;
  const batt = +document.getElementById('p_batt').value;

  document.getElementById('v_tx').textContent = '$' + tx;
  document.getElementById('v_growth').textContent = growth + '%';
  document.getElementById('v_solar').textContent = nSolar + ' MW/yr';
  document.getElementById('v_wind').textContent = nWind + ' MW/yr';
  document.getElementById('v_geo').textContent = nGeo + ' MW/yr';
  document.getElementById('v_gas').textContent = gas + ' MW';
  document.getElementById('v_batt').textContent = batt + ' MW';

  const data = { nuke: [], gas: [], exWind: [], exSolar: [], geo: [], newWind: [], newSolar: [], gap: [], load: [] };

  for (let i = 0; i < YEARS; i++) {
    const yrLoad = 14.2 * Math.pow(1 + growth / 100, i);
    data.load.push(yrLoad);
    const nuke = 3.4;
    // Existing wind TWh by year (year index 0..10); reflects retirements/curtailment over time.
    const exW = [5.3, 5.3, 4.5, 4.5, 4.5, 4.5, 3.9, 3.8, 3.7, 3.7, 3.7][i];
    // Existing solar TWh by year (year index 0..10); declines slightly in later years.
    const exS = [2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.3, 2.3, 2.3, 2.3, 2.0][i];

    const buildYrs = Math.max(0, i - 1);
    const geoTwh = (nGeo * buildYrs * 8760 * CF.geo) / 1e6;
    const winTwh = (nWind * buildYrs * 8760 * CF.wind) / 1e6;
    const solTwh = (nSolar * buildYrs * 8760 * CF.solar) / 1e6;
    const gasTwh = (gas * 8760 * CF.gas) / 1e6;

    data.nuke.push(nuke);
    data.gas.push(gasTwh);
    data.exWind.push(exW);
    data.exSolar.push(exS);
    data.geo.push(geoTwh);
    data.newWind.push(winTwh);
    data.newSolar.push(solTwh);

    const totalSup = nuke + exW + exS + geoTwh + winTwh + solTwh + gasTwh;
    data.gap.push(Math.max(0, yrLoad - totalSup));
  }

  // Carbon Free Calculation (Excludes Gas and Market Gap)
  const lastIdx = YEARS - 1;
  const total2035 = data.load[lastIdx];
  const carbonSources = data.gas[lastIdx] + data.gap[lastIdx];
  const carbonFreePct = Math.max(0, ((total2035 - carbonSources) / total2035) * 100);
  document.getElementById('k_clean').textContent = carbonFreePct.toFixed(0) + '%';

  drawMix(data);
  const rel = runReliability(nSolar * 9, nWind * 9, nGeo * 9, gas, batt, growth);
  drawRel(rel);

  // Financial Summary
  const totCost =
    3.4 * (35 + tx) +
    data.gas[lastIdx] * 75 +
    3.7 * (28 + tx) +
    2.0 * (24 + tx) +
    data.geo[lastIdx] * 85 +
    data.newWind[lastIdx] * (48 + tx) +
    data.newSolar[lastIdx] * (36 + tx) +
    data.gap[lastIdx] * 120;
  document.getElementById('k_rate').textContent = (totCost / total2035 / 10).toFixed(1) + '¢';
}

/**
 * Runs a 24-hour August peak stress test. Supply = gas, geo, solar, wind (by hour), plus a stateful
 * battery that charges on surplus and discharges to fill deficits, smoothing the supply curve.
 * Battery: power limit = batt MW, energy capacity = 4h (batt * 4 MWh), starts at 50% SoC.
 *
 * @param {number} sol - Solar capacity (MW) in stress test
 * @param {number} win - Wind capacity (MW)
 * @param {number} geo - Geothermal (MW)
 * @param {number} gas - Local gas (MW)
 * @param {number} batt - Firm battery power (MW), 4h duration
 * @param {number} growth - Annual load growth (%)
 * @returns {{ sim: { load: number[], supply: number[] }, risk: number }}
 */
function runReliability(sol, win, geo, gas, batt, growth) {
  const peak = 3150 * Math.pow(1 + growth / 100, 10);
  const sim = { load: [], supply: [] };
  let risk = 0;
  const E_cap = batt * 4; // MWh, 4-hour duration
  let soc = E_cap * 0.5;  // start at 50% state of charge

  for (let h = 0; h < 24; h++) {
    const l = PROF.load[h] * peak;
    const supplyNoBatt = 400 + gas + geo + sol * PROF.solar[h] + win * PROF.wind[h] * 0.2;
    const deficit = Math.max(0, l - supplyNoBatt);
    const surplus = Math.max(0, supplyNoBatt - l);

    const discharge = Math.min(deficit, batt, soc);
    soc -= discharge;
    const charge = Math.min(surplus, batt, E_cap - soc);
    soc += charge;

    const s = supplyNoBatt + discharge;
    sim.load.push(l);
    sim.supply.push(s);
    if (l > s + 10) risk++;
  }
  return { sim, risk };
}

/** Chart.js instances (created on first draw, updated thereafter). */
let mixChartInstance = null;
let relChartInstance = null;

/** Format hour (0–23) as time of day (12am, 1am, … 11pm). */
function hourToTimeOfDay(hour) {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? hour + 'am' : hour - 12 + 'pm';
}

/** Spacing between diagonal hatch lines (larger = lines further apart). Tile size must be a multiple. */
const HATCH_SPACING = 14;

/** Creates a repeating diagonal-line (hatch) pattern for deficit/gap fill. Lines align across tiles. */
function createDeficitHatchPattern(ctx) {
  // Use a tile size that is a multiple of spacing, and draw full-length diagonals so the pattern
  // doesn't look "dashed" where it crosses tile boundaries.
  const size = HATCH_SPACING * 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  c.setLineDash([]);
  c.lineCap = 'butt';
  // Align 1px strokes to the pixel grid for crisper, consistent lines.
  c.translate(0.5, 0.5);
  c.strokeStyle = 'rgba(229, 115, 115, 1)';
  c.lineWidth = 1;
  c.beginPath();
  // 45° lines (y = x - offset). Offsets are spaced evenly and tile cleanly.
  for (let offset = -size; offset <= size; offset += HATCH_SPACING) {
    c.moveTo(offset, 0);
    c.lineTo(offset + size, size);
  }
  c.stroke();
  return ctx.createPattern(canvas, 'repeat');
}

/**
 * Builds or updates the 11-year stacked area chart (TWh) with Chart.js. Legend and tooltips are built-in.
 *
 * @param {Object} data - Keys match STYLES; each value is an array of length YEARS (TWh per year).
 */
/** Washed red for deficit/gap (matches reliability chart and mix chart). */
const DEFICIT_RED = 'rgba(229, 115, 115, 0.5)';

/** Alpha for top-chart stack fill (1 = fully opaque). */
const MIX_FILL_ALPHA = 1;

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawMix(data) {
  const labels = Array.from({ length: YEARS }, (_, i) => String(BASE_YEAR + i));
  const keys = MIX_CHART_ORDER;
  const datasets = keys.map((k) => ({
    label: STYLES[k].l,
    data: data[k],
    backgroundColor: k === 'gap' ? null : hexToRgba(STYLES[k].c, MIX_FILL_ALPHA),
    borderColor: k === 'gap' ? 'rgba(229, 115, 115, 0.8)' : STYLES[k].c,
    borderWidth: 0,
    fill: true,
    stack: 'stack0',
    tension: 0,
    pointRadius: 0,
    hoverPointRadius: 0,
    pointHitRadius: 20,
    // Ensure the hatched gap is drawn on top of other semi-transparent fills.
    order: k === 'gap' ? 2 : 1,
  }));

  datasets.push({
    label: 'Usage',
    data: data.load,
    backgroundColor: 'transparent',
    borderColor: '#000',
    borderWidth: 3,
    fill: false,
    tension: 0,
    pointRadius: 0,
    hoverPointRadius: 0,
    pointHitRadius: 12,
    order: 10,
  });

  if (mixChartInstance) {
    mixChartInstance.data.labels = labels;
    mixChartInstance.data.datasets.forEach((ds, i) => {
      ds.data = i < keys.length ? data[keys[i]] : data.load;
    });
    mixChartInstance.update('none');
    return;
  }

  const ctx = document.getElementById('mixChart').getContext('2d');
  const gapIdx = keys.indexOf('gap');
  if (gapIdx !== -1) datasets[gapIdx].backgroundColor = createDeficitHatchPattern(ctx);
  mixChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'point', intersect: true },
      plugins: {
        // Draw all area fills before strokes so the black Usage line stays visible on top.
        filler: { drawTime: 'beforeDatasetsDraw' },
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${item.raw.toFixed(1)} TWh`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0 },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: 'TWh' },
        },
      },
    },
  });
}

/**
 * Builds or updates the 24-hour reliability chart with Chart.js: supply (green area), deficit (red area), load (line).
 * Time-of-day on x-axis. Updates k_risk and risk_card.
 *
 * @param {{ sim: { load: number[], supply: number[] }, risk: number }} rel - Result from runReliability().
 */
function drawRel(rel) {
  const labels = Array.from({ length: 24 }, (_, i) => hourToTimeOfDay(i));
  const deficit = rel.sim.load.map((l, i) => Math.max(0, l - rel.sim.supply[i]));

  const datasets = [
    {
      label: 'Supply',
      data: rel.sim.supply,
      backgroundColor: 'rgba(232, 245, 233, 1)',
      borderColor: '#81c784',
      borderWidth: 1,
      fill: true,
      stack: 'area',
      tension: 0,
    },
    {
      label: 'Deficit',
      data: deficit,
      backgroundColor: null, // set to hatch pattern when creating chart
      borderColor: 'rgba(229, 115, 115, 0.9)',
      borderWidth: 0,
      fill: true,
      stack: 'area',
      tension: 0,
      pointRadius: 0,
    },
    {
      label: 'Load',
      data: rel.sim.load,
      backgroundColor: 'transparent',
      borderColor: '#000',
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      stack: undefined, // do not stack; draw as line over the area
    },
  ];

  if (relChartInstance) {
    relChartInstance.data.labels = labels;
    relChartInstance.data.datasets[0].data = rel.sim.supply;
    relChartInstance.data.datasets[1].data = deficit;
    relChartInstance.data.datasets[2].data = rel.sim.load;
    relChartInstance.update('none');
  } else {
    const ctx = document.getElementById('relChart').getContext('2d');
    datasets[1].backgroundColor = createDeficitHatchPattern(ctx);
    relChartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${Math.round(item.raw)} MW`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 45, maxTicksLimit: 12 },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: 'MW' },
          },
        },
      },
    });
  }

  document.getElementById('k_risk').textContent = rel.risk;
  document.getElementById('risk_card').className = rel.risk > 0 ? 'kpi warn-bg' : 'kpi good-bg';
}

/** Default slider values (used by reset). */
const DEFAULT_INPUTS = {
  p_tx: 40,
  p_wind: 100,
  p_solar: 150,
  p_geo: 50,
  p_batt: 500,
  p_gas: 500,
  p_growth: 1.5,
};

/** Restore all inputs to defaults and refresh. */
function resetInputs() {
  Object.entries(DEFAULT_INPUTS).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  update();
}

/**
 * One-click preset: set Geothermal to 180 MW/yr and Firm Battery to 1400 MW, then refresh. Reduces reliability risk with clean firm + storage.
 */
function autoSolve() {
  document.getElementById('p_geo').value = 180;
  document.getElementById('p_batt').value = 1400;
  update();
}

// --- Init (runs when script loads; DOM ready because script is at end of body) ---
document.querySelectorAll('input').forEach((i) => (i.oninput = update));
window.addEventListener('load', update);
