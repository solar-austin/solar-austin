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
const CF = { wind: 0.35, solar: 0.25, geo: 0.9, gasBase: 0.5, gasPeak: 0.08, coal: 0.6, nuke: 0.9 };

/** Wholesale or proxy energy prices ($/MWh) used for the estimated generation rate (¢/kWh). */
const PRICES = { nuke: 35, gasBase: 55, gasPeak: 95, coal: 45, ee: 25, dr: 25, exWind: 28, exSolar: 24, newWind: 48, newSolar: 36, geo: 85, gap: 120 };

/**
 * Chart colors (c) and legend labels (l). Wind and solar are single-hue pairs: same color, light then dark (same shade step).
 */
const STYLES = {
  nuke: { c: '#B0BEC5', l: 'Nuclear' },
  gasBase: { c: '#90A4AE', l: 'Gas (Baseload)' },
  gasPeak: { c: '#607D8B', l: 'Gas (Peaker)' },
  coal: { c: '#5D4037', l: 'Coal' },
  ee: { c: '#2dd4bf', l: 'Energy Efficiency' },
  dr: { c: '#14b8a6', l: 'Demand Response' },
  exWind: { c: '#B3E5FC', l: 'Exist. Wind' },   // light blue
  newWind: { c: '#4FC3F7', l: 'New Wind' },     // dark blue (same hue)
  exSolar: { c: '#FFDDA0', l: 'Exist. Solar' }, // light orange (same hue as New Solar)
  newSolar: { c: '#E09328', l: 'New Solar' },   // dark orange (same hue)
  geo: { c: '#A1887F', l: 'New Geo' },
  gap: { c: '#E57373', l: 'Market Gap' },
};

/** Stack/legend order: base first (bottom), then new resources on top. */
const MIX_CHART_ORDER = ['nuke', 'gasBase', 'gasPeak', 'coal', 'exWind', 'exSolar', 'newWind', 'newSolar', 'geo', 'gap'];

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

/** DR shift profile (24h): positive = reduce load in that hour, negative = add load back. Sum = 0 so total MWh unchanged (load is shifted, not reduced). Peak hours 12–17 (noon–6pm) get +1; off-peak get -6/18 so sum is 0. */
const DR_PROF = Array.from({ length: 24 }, (_, h) => (h >= 12 && h <= 17 ? 1 : -6 / 18));

/** Nuclear TWh (constant in mix). Used to derive baseload MW in reliability so both use same assumption. */
const NUKE_TWH = 3.4;

/**
 * Reads slider values, recomputes 11-year supply/load and gap, updates KPIs and both charts.
 */
function update() {
  const tx = +document.getElementById('p_tx').value;
  const growth = +document.getElementById('p_growth').value;
  const marginGoalPct = +document.getElementById('p_margin_goal').value;
  const nSolar = +document.getElementById('p_solar').value;
  const nWind = +document.getElementById('p_wind').value;
  const nGeo = +document.getElementById('p_geo').value;
  const gasBase = +document.getElementById('p_gas_base').value;
  const gasPeak = +document.getElementById('p_gas_peak').value;
  const coal = +document.getElementById('p_coal').value;
  const ee = +document.getElementById('p_ee').value;
  const dr = +document.getElementById('p_dr').value;
  const batt = +document.getElementById('p_batt').value;

  const buildYrsTotal = 9; // years of new build by end of horizon
  document.getElementById('v_tx').textContent = '$' + tx;
  document.getElementById('v_growth').textContent = growth + '%';
  document.getElementById('v_margin_goal').textContent = marginGoalPct + '%';
  document.getElementById('v_solar').innerHTML = nSolar + ' MW/yr<span class="val-total">' + (nSolar * buildYrsTotal) + ' MW total</span>';
  document.getElementById('v_wind').innerHTML = nWind + ' MW/yr<span class="val-total">' + (nWind * buildYrsTotal) + ' MW total</span>';
  document.getElementById('v_geo').innerHTML = nGeo + ' MW/yr<span class="val-total">' + (nGeo * buildYrsTotal) + ' MW total</span>';
  document.getElementById('v_gas_base').textContent = gasBase + ' MW';
  document.getElementById('v_gas_peak').textContent = gasPeak + ' MW';
  document.getElementById('v_coal').textContent = coal + ' MW';
  document.getElementById('v_ee').textContent = ee + ' MW';
  document.getElementById('v_dr').textContent = dr + ' MW';
  document.getElementById('v_batt').textContent = batt + ' MW';

  const data = { nuke: [], gasBase: [], gasPeak: [], coal: [], exWind: [], exSolar: [], geo: [], newWind: [], newSolar: [], ee: [], dr: [], gap: [], load: [] };

  for (let i = 0; i < YEARS; i++) {
    const yrLoadGross = 14.2 * Math.pow(1 + growth / 100, i);
    // EE/DR: effective energy savings (70% availability, ~2% equivalent CF for demand reduction)
    const eeTwh = (ee * 0.7 * 8760 * 0.02) / 1e6;
    const yrLoad = Math.max(0, yrLoadGross - eeTwh);
    data.load.push(yrLoad);
    const nuke = NUKE_TWH;
    // Existing wind TWh by year (year index 0..10); reflects retirements/curtailment over time.
    const exW = [5.3, 5.3, 4.5, 4.5, 4.5, 4.5, 3.9, 3.8, 3.7, 3.7, 3.7][i];
    // Existing solar TWh by year (year index 0..10); declines slightly in later years.
    const exS = [2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.3, 2.3, 2.3, 2.3, 2.0][i];

    const buildYrs = Math.max(0, i - 1);
    const geoTwh = (nGeo * buildYrs * 8760 * CF.geo) / 1e6;
    const winTwh = (nWind * buildYrs * 8760 * CF.wind) / 1e6;
    const solTwh = (nSolar * buildYrs * 8760 * CF.solar) / 1e6;
    const gasBaseTwh = (gasBase * 8760 * CF.gasBase) / 1e6;
    const gasPeakTwh = (gasPeak * 8760 * CF.gasPeak) / 1e6;
    const coalTwh = (coal * 8760 * CF.coal) / 1e6;

    data.nuke.push(nuke);
    data.gasBase.push(gasBaseTwh);
    data.gasPeak.push(gasPeakTwh);
    data.coal.push(coalTwh);
    data.exWind.push(exW);
    data.exSolar.push(exS);
    data.geo.push(geoTwh);
    data.newWind.push(winTwh);
    data.newSolar.push(solTwh);
    data.ee.push(eeTwh);
    // DR volume for financials: MWh shifted per year (e.g. 200 hours of DR events) → TWh
    data.dr.push((dr * 200) / 1e6);

    const totalSup = nuke + exW + exS + geoTwh + winTwh + solTwh + gasBaseTwh + gasPeakTwh + coalTwh;
    data.gap.push(Math.max(0, yrLoad - totalSup));
  }

  // Carbon Free Calculation (Excludes Gas and Market Gap)
  const lastIdx = YEARS - 1;
  const total2035 = data.load[lastIdx];
  const carbonSources = data.gasBase[lastIdx] + data.gasPeak[lastIdx] + data.coal[lastIdx] + data.gap[lastIdx];
  const carbonFreePct = Math.max(0, ((total2035 - carbonSources) / total2035) * 100);
  document.getElementById('k_clean').textContent = carbonFreePct.toFixed(0) + '%';

  drawMix(data);
  // Existing wind/solar in MW (2035) so the reliability chart has time-of-day shape when new build is zero
  const exSolarMW = (data.exSolar[lastIdx] * 1e6) / (8760 * CF.solar);
  const exWindMW = (data.exWind[lastIdx] * 1e6) / (8760 * CF.wind);
  const rel = runReliability(
    exSolarMW + nSolar * 9,
    exWindMW + nWind * 9,
    nGeo * 9,
    gasBase,
    gasPeak,
    coal,
    ee,
    dr,
    batt,
    growth,
    marginGoalPct
  );
  drawRel(rel);

  // Supply margin: minimum hourly (supply - load) / load as %, from reliability run
  let marginPct = 0;
  for (let h = 0; h < 24; h++) {
    const l = rel.sim.load[h];
    if (l > 0) {
      const m = ((rel.sim.supply[h] - l) / l) * 100;
      if (h === 0 || m < marginPct) marginPct = m;
    }
  }
  document.getElementById('k_margin').textContent = Math.round(marginPct) + '%';
  const marginCard = document.getElementById('margin_card');
  if (marginCard) {
    const greenThreshold = marginGoalPct - 0.1; // green when at or above goal (safe for rounding)
    marginCard.className = marginPct < 0 ? 'kpi warn-bg' : marginPct < greenThreshold ? 'kpi caution-bg' : 'kpi good-bg';
  }

  // Financial Summary
  const twh35 = {
    nuke: data.nuke[lastIdx],
    gasBase: data.gasBase[lastIdx],
    gasPeak: data.gasPeak[lastIdx],
    coal: data.coal[lastIdx],
    ee: data.ee[lastIdx],
    dr: data.dr[lastIdx],
    exWind: data.exWind[lastIdx],
    exSolar: data.exSolar[lastIdx],
    geo: data.geo[lastIdx],
    newWind: data.newWind[lastIdx],
    newSolar: data.newSolar[lastIdx],
    gap: data.gap[lastIdx],
  };
  const totCostM = runFinancials(twh35, tx, total2035);
  const rateCents = total2035 > 0 ? (totCostM / total2035 / 10) : 0;
  document.getElementById('k_rate').textContent = rateCents.toFixed(1) + '¢';
}

/**
 * Populates the Landed Cost Financials table (2035 snapshot). Resources with vol below 0.05 TWh are omitted.
 * Remote resources get the TCOS adder applied. Returns total cost in $M.
 */
function runFinancials(twh, txAdder, loadTWh) {
  const isRemote = (k) => ['nuke', 'coal', 'exWind', 'exSolar', 'newWind', 'newSolar', 'gap'].includes(k);
  const rows = [
    { k: 'newWind', n: 'New Wind' },
    { k: 'newSolar', n: 'New Solar' },
    { k: 'geo', n: 'Geothermal' },
    { k: 'ee', n: 'Energy Efficiency' },
    { k: 'dr', n: 'Demand Response' },
    { k: 'exWind', n: 'Exist. Wind' },
    { k: 'exSolar', n: 'Exist. Solar' },
    { k: 'coal', n: 'Coal' },
    { k: 'gasBase', n: 'Gas (Baseload)' },
    { k: 'gasPeak', n: 'Gas (Peaker)' },
    { k: 'nuke', n: 'Nuclear' },
    { k: 'gap', n: 'Market Gap' },
  ];

  let html = '';
  let tot = 0;

  rows.forEach((d) => {
    const vol = twh[d.k] ?? 0;
    const baseP = PRICES[d.k] ?? 0;
    const rem = isRemote(d.k);
    const add = rem ? txAdder : 0;
    const costM = vol * (baseP + add);
    tot += costM; // include all resources in total so rate and footer are correct

    if (vol < 0.05) return; // hide small rows from table

    const adderTxt = rem ? `+$${add}` : '--';
    const color = STYLES[d.k]?.c ?? '#999';

    html += `<tr>
      <td style="border-left:4px solid ${color}">${d.n}</td>
      <td>${vol.toFixed(2)}</td>
      <td><input class="money-inp" type="number" value="${baseP}" min="0" step="1" onchange="window.setPrice('${d.k}', this.value)"></td>
      <td style="color:${rem ? '#d32f2f' : '#ccc'}">${adderTxt}</td>
      <td>$${costM.toFixed(0)}</td>
    </tr>`;
  });

  const finBody = document.getElementById('finBody');
  const tVol = document.getElementById('t_vol');
  const tAvg = document.getElementById('t_avg');
  const tCost = document.getElementById('t_cost');
  if (finBody) finBody.innerHTML = html;
  if (tVol) tVol.textContent = loadTWh.toFixed(1);
  if (tCost) tCost.textContent = '$' + tot.toFixed(0) + ' M';
  const avgPerMwh = loadTWh > 0 ? tot / loadTWh : 0;
  if (tAvg) tAvg.textContent = '$' + avgPerMwh.toFixed(0);

  return tot;
}

/** Called from financial table inputs to update a resource's base price and refresh. */
window.setPrice = function (key, value) {
  const v = parseFloat(value);
  if (!Number.isNaN(v) && PRICES[key] !== undefined) PRICES[key] = v;
  update();
};

/**
 * Runs a 24-hour August peak stress test. Supply = gas (baseload always, peaker only at peak), coal, geo, solar, wind, plus battery.
 * Peaker runs only when supply (without peaker) is below the margin goal; it fills the shortfall up to peaker capacity. Battery targets margin goal.
 * Two-pass battery in order 0..23 with carry-over. Power limit = batt MW, energy capacity = 4h.
 */
function runReliability(sol, win, geo, gasBase, gasPeak, coal, ee, dr, batt, growth, marginGoalPct) {
  const peak = 3150 * Math.pow(1 + growth / 100, 10);
  const E_cap = batt * 4; // MWh, 4-hour duration
  const nukeMW = (NUKE_TWH * 1e6) / (8760 * CF.nuke); // same nuclear assumption as mix
  const eeFirm = ee * 0.7; // 70% of EE reduces load (MW) during stress
  const marginGoal = (marginGoalPct ?? 15) / 100;

  const sim = { load: new Array(24), supply: new Array(24), supplyNoBatt: new Array(24), peaker: new Array(24), discharge: new Array(24) };
  const surplus = new Array(24);
  const def = new Array(24);

  // Pass 1: EE reduces load; DR shifts it (peak → off-peak via DR_PROF, sum=0). Net load = gross - EE - dr×DR_PROF. Target supply = net load × (1 + marginGoal).
  for (let h = 0; h < 24; h++) {
    const grossLoad = PROF.load[h] * peak;
    const netLoad = Math.max(0, grossLoad - eeFirm - dr * DR_PROF[h]);
    sim.load[h] = netLoad;
    const targetSupply = netLoad * (1 + marginGoal);
    const supplyNoPeaker = nukeMW + gasBase + coal + geo + sol * PROF.solar[h] + win * PROF.wind[h] * 0.2;
    const shortfall = Math.max(0, targetSupply - supplyNoPeaker);
    const peakerMW = Math.min(gasPeak, shortfall);
    sim.peaker[h] = peakerMW;
    const supplyNoBatt = supplyNoPeaker + peakerMW;
    sim.supplyNoBatt[h] = supplyNoBatt;
    surplus[h] = Math.max(0, supplyNoBatt - targetSupply);
    def[h] = Math.max(0, targetSupply - supplyNoBatt);
  }

  // Pass 2a: run battery 0..23 with SoC starting at 0 to get end-of-day SoC (carry-over)
  let soc = 0;
  for (let h = 0; h < 24; h++) {
    if (surplus[h] > 0) {
      const charge = Math.min(surplus[h], batt, E_cap - soc);
      soc += charge;
    }
    if (def[h] > 0) {
      const dischargeH = Math.min(def[h], batt, soc);
      soc -= dischargeH;
    }
  }
  const socCarryOver = soc;

  // Pass 2b: run battery 0..23 again with initial SoC = carry-over; use this for supply/discharge and risk
  soc = socCarryOver;
  let risk = 0;
  for (let h = 0; h < 24; h++) {
    if (surplus[h] > 0) {
      const charge = Math.min(surplus[h], batt, E_cap - soc);
      soc += charge;
    }
    let dischargeH = 0;
    if (def[h] > 0) {
      dischargeH = Math.min(def[h], batt, soc);
      soc -= dischargeH;
    }
    sim.supply[h] = sim.supplyNoBatt[h] + dischargeH;
    sim.discharge[h] = dischargeH;
    if (sim.load[h] > sim.supply[h] + 10) risk++;
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

/** Spacing for new-generation diagonal hatch (single direction). */
const CROSSHATCH_SPACING = 12;

/** Creates a repeating single-direction diagonal hatch (-45°) in the given hex color. Used for new generation (opposite direction to deficit hatch). */
function createCrosshatchPattern(ctx, hexColor) {
  const size = CROSSHATCH_SPACING * 3;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const n = parseInt(hexColor.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  c.fillStyle = `rgba(${r},${g},${b},1)`;
  c.fillRect(0, 0, size, size);
  c.strokeStyle = `rgba(255,255,255,0.25)`;
  c.lineWidth = 1;
  c.setLineDash([]);
  c.lineCap = 'butt';
  c.translate(0.5, 0.5);
  for (let offset = -size; offset <= size * 2; offset += CROSSHATCH_SPACING) {
    c.beginPath();
    c.moveTo(offset, size);
    c.lineTo(offset + size, 0);
    c.stroke();
  }
  return ctx.createPattern(canvas, 'repeat');
}

/** Keys for new generation (get crosshatch pattern in mix chart). */
const NEW_GENERATION_KEYS = ['newWind', 'newSolar', 'geo'];

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
    order: k === 'gap' ? 2 : 1,
    pointStyle: 'rect',
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
    pointStyle: 'line',
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
  keys.forEach((k, i) => {
    if (NEW_GENERATION_KEYS.includes(k)) datasets[i].backgroundColor = createCrosshatchPattern(ctx, STYLES[k].c);
  });
  mixChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        // Draw all area fills before strokes so the black Usage line stays visible on top.
        filler: { drawTime: 'beforeDatasetsDraw' },
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true },
        },
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
          min: 0,
          max: 25,
          title: { display: true, text: 'TWh' },
        },
      },
    },
  });
}

/**
 * Builds or updates the 24-hour reliability chart: generation (green), battery (blue stack), deficit (red hatch), load (line).
 *
 * @param {{ sim: { load, supply, supplyNoBatt, peaker, discharge }, risk: number }} rel - Result from runReliability().
 */
function drawRel(rel) {
  const labels = Array.from({ length: 24 }, (_, i) => hourToTimeOfDay(i));
  const deficit = rel.sim.load.map((l, i) => Math.max(0, l - rel.sim.supply[i]));
  const supplyNoPeaker = rel.sim.supplyNoBatt.map((s, i) => s - (rel.sim.peaker[i] ?? 0));

  const datasets = [
    {
      label: 'Generation',
      data: supplyNoPeaker,
      backgroundColor: 'rgba(232, 245, 233, 1)',
      borderColor: '#2e7d32',
      borderWidth: 1,
      fill: true,
      stack: 'area',
      tension: 0,
      pointRadius: 0,
      pointStyle: 'rect',
      order: 1,
    },
    {
      label: 'Peaker',
      data: rel.sim.peaker ?? Array(24).fill(0),
      backgroundColor: 'rgba(96, 125, 139, 0.85)',
      borderColor: '#37474f',
      borderWidth: 0,
      fill: true,
      stack: 'area',
      tension: 0,
      pointRadius: 0,
      pointStyle: 'rect',
      order: 1,
    },
    {
      label: 'Battery',
      data: rel.sim.discharge,
      backgroundColor: 'rgba(227, 242, 253, 1)',
      borderColor: '#0d47a1',
      borderWidth: 1,
      fill: true,
      stack: 'area',
      tension: 0,
      pointRadius: 0,
      pointStyle: 'rect',
      order: 1,
    },
    {
      label: 'Deficit',
      data: deficit,
      backgroundColor: null, // set to hatch pattern when creating chart
      borderColor: '#b71c1c',
      borderWidth: 0,
      fill: true,
      stack: 'area',
      tension: 0,
      pointRadius: 0,
      pointStyle: 'rect',
      order: 1,
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
      stack: undefined,
      pointStyle: 'line',
      order: 0, // lower order = drawn last = on top (areas use order: 1 so they draw underneath)
    },
  ];

  if (relChartInstance) {
    relChartInstance.data.labels = labels;
    relChartInstance.data.datasets[0].data = supplyNoPeaker;
    relChartInstance.data.datasets[1].data = rel.sim.peaker ?? Array(24).fill(0);
    relChartInstance.data.datasets[2].data = rel.sim.discharge;
    relChartInstance.data.datasets[3].data = deficit;
    relChartInstance.data.datasets[4].data = rel.sim.load;
    relChartInstance.update('none');
  } else {
    const ctx = document.getElementById('relChart').getContext('2d');
    datasets[3].backgroundColor = createDeficitHatchPattern(ctx);
    relChartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true },
          },
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
            min: 0,
            max: 6500,
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
  p_gas_base: 300,
  p_gas_peak: 200,
  p_coal: 0,
  p_ee: 0,
  p_dr: 0,
  p_growth: 1.5,
  p_margin_goal: 15,
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
