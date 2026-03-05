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

/** Wholesale or proxy energy prices ($/MWh) for energy rows; batt is $k/MW-year for capacity. */
const PRICES = { nuke: 35, gasBase: 55, gasPeak: 95, coal: 45, ee: 25, dr: 25, exWind: 28, exSolar: 24, newWind: 48, newSolar: 36, geo: 85, gap: 120, batt: 120 };

// Cost units: vol (TWh) × price ($/MWh) → 1 TWh = 1e6 MWh, so cost ($) = vol × 1e6 × price, cost ($M) = vol × price.
const MWH_PER_TWH = 1e6;
const DOLLARS_PER_MILLION = 1e6;

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
  batt: { c: '#CE93D8', l: 'Battery' },
};

/** Stack/legend order: base first (bottom), then new resources on top. */
const MIX_CHART_ORDER = ['nuke', 'gasBase', 'gasPeak', 'coal', 'exWind', 'exSolar', 'newWind', 'newSolar', 'geo', 'gap'];

/**
 * 24-hour normalized profiles for the August peak reliability stress test.
 * Index = hour of day (0–23). Used to scale peak load and variable supply hour-by-hour.
 *
 * - load:  Relative demand by hour; 1.0 = peak (e.g. afternoon). Shapes the load curve.
 * - solar: Relative solar output by hour; peaks midday. Multiplied by solar MW to get supply.
 * - wind:  Relative wind output by hour. Multiplied by wind MW for supply (same treatment as solar).
 */
const PROF = {
  load: [0.45, 0.42, 0.40, 0.39, 0.41, 0.45, 0.52, 0.60, 0.68, 0.75, 0.82, 0.88, 0.94, 0.98, 1.00, 0.99, 0.96, 0.92, 0.85, 0.78, 0.70, 0.62, 0.55, 0.50],
  solar: [0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.45, 0.65, 0.85, 0.95, 1.0, 0.95, 0.85, 0.65, 0.40, 0.15, 0.02, 0, 0, 0, 0, 0],
  wind: [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.1, 0.15, 0.2, 0.25, 0.2, 0.15, 0.15, 0.2, 0.25, 0.35, 0.45, 0.55, 0.6, 0.6, 0.55],
};

/** Nuclear TWh (constant in mix). Used to derive baseload MW in reliability so both use same assumption. */
const NUKE_TWH = 3.4;

/** Existing solar contracts from the provided chart (MW, contract expiration year). */
const EXISTING_SOLAR_FLEET = [
  { name: 'Webberville Solar Project', mw: 30, expires: 2036 },
  { name: 'Roserock', mw: 157.5, expires: 2036 },
  { name: 'East Pecos (Bootleg)', mw: 118.5, expires: 2031 },
  { name: 'Upton County (SPTX12B1)', mw: 157.5, expires: 2042 },
  { name: 'Waymark', mw: 178.5, expires: 2043 },
  { name: 'East Blacklands', mw: 144, expires: 2036 },
  { name: 'SE Aragon', mw: 180, expires: 2036 },
];

/** Existing wind contracts from the provided chart (MW, contract expiration year). */
const EXISTING_WIND_FLEET = [
  { name: 'Whirlwind Energy Center', mw: 59.8, expires: 2027 },
  { name: 'Hackberry Wind Project', mw: 165.6, expires: 2023 },
  { name: 'Los Vientos II', mw: 201.6, expires: 2037 },
  { name: 'Whitetail', mw: 92.3, expires: 2037 },
  { name: 'Los Vientos III', mw: 200, expires: 2040 },
  { name: 'Jumbo Road', mw: 299.7, expires: 2033 },
  { name: 'Los Vientos IV', mw: 200, expires: 2041 },
  { name: 'Karankawa', mw: 206.64, expires: 2034 },
  { name: 'Raymond', mw: 200, expires: 2032 },
  { name: 'Gulf Wind', mw: 170, expires: 2041 },
];

/** Treat expiration as active through that year; unit phases out starting the next year. */
function isAssetActiveInYear(asset, year) {
  return asset.expires == null || year <= asset.expires;
}

/** Build existing-fleet annual TWh over the planning horizon from MW + contract expirations. */
function buildExistingTwhByYear(fleet, cf) {
  return Array.from({ length: YEARS }, (_, i) => {
    const year = BASE_YEAR + i;
    const activeMw = fleet.reduce((sum, asset) => sum + (isAssetActiveInYear(asset, year) ? asset.mw : 0), 0);
    return (activeMw * 8760 * cf) / 1e6;
  });
}

/** Existing wind/solar TWh by year (2025..2035), derived directly from contract expirations. */
const EXISTING_WIND_TWH = buildExistingTwhByYear(EXISTING_WIND_FLEET, CF.wind);
const EXISTING_SOLAR_TWH = buildExistingTwhByYear(EXISTING_SOLAR_FLEET, CF.solar);
const BUILD_YRS_TOTAL = 9;

/** Build exact args for runReliability so chart and getMinMarginPct use identical inputs. */
function getReliabilityArgs(nWind, nSolar, nGeo, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct) {
  const exSolarMW = (EXISTING_SOLAR_TWH[YEARS - 1] * 1e6) / (8760 * CF.solar);
  const exWindMW = (EXISTING_WIND_TWH[YEARS - 1] * 1e6) / (8760 * CF.wind);
  return [
    exSolarMW,
    exWindMW,
    nSolar * BUILD_YRS_TOTAL,
    nWind * BUILD_YRS_TOTAL,
    nGeo * BUILD_YRS_TOTAL,
    gasBase,
    gasPeak,
    coal,
    ee,
    dr,
    batt,
    growth,
    marginGoalPct,
  ];
}

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

  const buildYrsTotal = BUILD_YRS_TOTAL;
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
    const exW = EXISTING_WIND_TWH[i];
    const exS = EXISTING_SOLAR_TWH[i];

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
  const rel = runReliability(...getReliabilityArgs(nWind, nSolar, nGeo, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct));
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
  const totCostM = runFinancials(twh35, tx, total2035, batt);
  const rateCents = total2035 > 0 ? (totCostM / total2035 / 10) : 0;
  document.getElementById('k_rate').textContent = rateCents.toFixed(1) + '¢';
}

/**
 * Populates the Landed Cost Financials table (2035 snapshot). Resources with vol below 0.05 TWh are omitted.
 * Remote resources get the TCOS adder applied. Battery row: capacity (MW), base $k/MW-year, total $M. Returns total cost in $M.
 */
function runFinancials(twh, txAdder, loadTWh, battMW) {
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
    const vol = twh[d.k] ?? 0; // TWh
    const baseP = PRICES[d.k] ?? 0; // $/MWh for energy
    const rem = isRemote(d.k);
    const add = rem ? txAdder : 0;
    // cost ($) = vol_TWh × 1e6 MWh/TWh × price_$/MWh → cost ($M) = vol × price
    const costM = (vol * MWH_PER_TWH * (baseP + add)) / DOLLARS_PER_MILLION;
    tot += costM;

    if (vol < 0.05) return;

    const adderTxt = rem ? `+$${add}` : '--';
    const color = STYLES[d.k]?.c ?? '#999';

    html += `<tr>
      <td style="border-left:4px solid ${color}">${d.n}</td>
      <td>${vol.toFixed(2)} TWh</td>
      <td><input class="money-inp" type="number" value="${baseP}" min="0" step="1" onchange="window.setPrice('${d.k}', this.value)"></td>
      <td style="color:${rem ? '#d32f2f' : '#ccc'}">${adderTxt}</td>
      <td>$${costM.toFixed(0)}</td>
    </tr>`;
  });

  // Battery row: capacity (MW), base price $k/MW-year → cost $M = (batt × price_$k) / 1000
  const batt = battMW ?? 0;
  const battPrice = PRICES.batt ?? 120; // $k per MW per year
  const battCostM = (batt * battPrice) / 1000;
  tot += battCostM;
  const battColor = STYLES.batt?.c ?? '#CE93D8';
  html += `<tr>
    <td style="border-left:4px solid ${battColor}">Battery</td>
    <td>${batt} MW</td>
    <td><input class="money-inp" type="number" value="${battPrice}" min="0" step="1" onchange="window.setPrice('batt', this.value)"></td>
    <td style="color:#ccc">--</td>
    <td>$${battCostM.toFixed(0)}</td>
  </tr>`;

  const finBody = document.getElementById('finBody');
  const tVol = document.getElementById('t_vol');
  const tAvg = document.getElementById('t_avg');
  const tCost = document.getElementById('t_cost');
  if (finBody) finBody.innerHTML = html;
  if (tVol) tVol.textContent = loadTWh.toFixed(1) + ' TWh';
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
 * Returns 2035 TWh by resource and load for the given build/assumptions. Used by autoSolve to compute cost.
 */
function getTwh2035(nWind, nSolar, nGeo, gasBase, gasPeak, coal, ee, dr, growth) {
  const i = YEARS - 1;
  const yrLoadGross = 14.2 * Math.pow(1 + growth / 100, i);
  const eeTwh = (ee * 0.7 * 8760 * 0.02) / 1e6;
  const load2035 = Math.max(0, yrLoadGross - eeTwh);
  const nuke = NUKE_TWH;
  const exW = EXISTING_WIND_TWH[i];
  const exS = EXISTING_SOLAR_TWH[i];
  const buildYrs = Math.max(0, i - 1);
  const geoTwh = (nGeo * buildYrs * 8760 * CF.geo) / 1e6;
  const winTwh = (nWind * buildYrs * 8760 * CF.wind) / 1e6;
  const solTwh = (nSolar * buildYrs * 8760 * CF.solar) / 1e6;
  const gasBaseTwh = (gasBase * 8760 * CF.gasBase) / 1e6;
  const gasPeakTwh = (gasPeak * 8760 * CF.gasPeak) / 1e6;
  const coalTwh = (coal * 8760 * CF.coal) / 1e6;
  const totalSup = nuke + exW + exS + geoTwh + winTwh + solTwh + gasBaseTwh + gasPeakTwh + coalTwh;
  const gapTwh = Math.max(0, load2035 - totalSup);
  const drTwh = (dr * 200) / 1e6;
  return {
    twh35: {
      nuke,
      gasBase: gasBaseTwh,
      gasPeak: gasPeakTwh,
      coal: coalTwh,
      ee: eeTwh,
      dr: drTwh,
      exWind: exW,
      exSolar: exS,
      geo: geoTwh,
      newWind: winTwh,
      newSolar: solTwh,
      gap: gapTwh,
    },
    load2035,
  };
}

/**
 * Runs a 24-hour August peak stress test. Supply = gas (baseload always, peaker only at peak), coal, geo, solar, wind, plus battery.
 * Battery fills deficits first (charge from surplus hours, discharge to deficit hours); peaker only covers remaining shortfall after battery.
 * Two-pass battery in order 0..23 with carry-over. Power limit = batt MW, energy capacity = 4h.
 */
function runReliability(exSolarMW, exWindMW, newSolarMW, newWindMW, geo, gasBase, gasPeak, coal, ee, dr, batt, growth, marginGoalPct) {
  const peak = 3150 * Math.pow(1 + growth / 100, 10);
  const E_cap = batt * 4; // MWh, 4-hour duration
  const nukeMW = (NUKE_TWH * 1e6) / (8760 * CF.nuke); // same nuclear assumption as mix
  const eeFirm = ee * 0.7; // 70% of EE reduces load (MW) during stress
  const marginGoal = (marginGoalPct ?? 15) / 100;
  const sol = exSolarMW + newSolarMW;
  const win = exWindMW + newWindMW;

  // DR profile from headroom (supply − load): shift load toward hours with spare capacity (e.g. baseload at night, solar at midday).
  const grossLoadByHour = Array.from({ length: 24 }, (_, h) => PROF.load[h] * peak);
  const supplyAvail = Array.from({ length: 24 }, (_, h) =>
    nukeMW + gasBase + coal + geo + sol * PROF.solar[h] + win * PROF.wind[h]
  );
  const headroom = supplyAvail.map((s, h) => s - grossLoadByHour[h]);
  const meanHeadroom = headroom.reduce((a, b) => a + b, 0) / 24;
  const drDev = headroom.map((hr) => meanHeadroom - hr);
  const maxDrDev = Math.max(...drDev);
  const drProfile = maxDrDev > 0 ? drDev.map((d) => d / maxDrDev) : Array(24).fill(0);

  const sim = {
    load: new Array(24),
    supply: new Array(24),
    supplyNoBatt: new Array(24),
    nuke: new Array(24),
    gasBase: new Array(24),
    coal: new Array(24),
    geo: new Array(24),
    exSolar: new Array(24),
    exWind: new Array(24),
    newSolar: new Array(24),
    newWind: new Array(24),
    peaker: new Array(24),
    discharge: new Array(24),
  };
  const chargeHeadroom = new Array(24);
  const def = new Array(24);

  // Pass 1: EE/DR; compute surplus/deficit vs target using generation only (no peaker, no battery).
  // Battery will fill deficits first; peaker only used for what battery can't cover.
  for (let h = 0; h < 24; h++) {
    const grossLoad = PROF.load[h] * peak;
    const netLoad = Math.max(0, grossLoad - eeFirm - dr * drProfile[h]);
    sim.load[h] = netLoad;
    const targetSupply = netLoad * (1 + marginGoal);
    const solarMW = sol * PROF.solar[h];
    const windMW = win * PROF.wind[h];
    sim.exSolar[h] = exSolarMW * PROF.solar[h];
    sim.exWind[h] = exWindMW * PROF.wind[h];
    sim.newSolar[h] = newSolarMW * PROF.solar[h];
    sim.newWind[h] = newWindMW * PROF.wind[h];
    const supplyNoPeaker = nukeMW + gasBase + coal + geo + solarMW + windMW;
    // Charge from real excess above load (not above reserve target), so storage can cycle daily.
    chargeHeadroom[h] = Math.max(0, supplyNoPeaker - netLoad);
    def[h] = Math.max(0, targetSupply - supplyNoPeaker);
    sim.nuke[h] = nukeMW;
    sim.gasBase[h] = gasBase;
    sim.coal[h] = coal;
    sim.geo[h] = geo;
    sim.peaker[h] = 0; // set in pass 2 after battery
  }
  // Pass 2: start stress day with empty battery, then dispatch battery before peaker each hour.
  let soc = 0;
  let risk = 0;
  for (let h = 0; h < 24; h++) {
    if (chargeHeadroom[h] > 0) {
      const charge = Math.min(chargeHeadroom[h], batt, E_cap - soc);
      soc += charge;
    }
    let dischargeH = 0;
    if (def[h] > 0) {
      dischargeH = Math.min(def[h], batt, soc);
      soc -= dischargeH;
    }
    const supplyNoPeakerH = nukeMW + gasBase + coal + geo + sol * PROF.solar[h] + win * PROF.wind[h];
    const targetH = sim.load[h] * (1 + marginGoal);
    const shortfallAfterBatt = Math.max(0, targetH - supplyNoPeakerH - dischargeH);
    const peakerMW = Math.min(gasPeak, shortfallAfterBatt);
    sim.peaker[h] = peakerMW;
    sim.supplyNoBatt[h] = supplyNoPeakerH + peakerMW;
    sim.supply[h] = supplyNoPeakerH + peakerMW + dischargeH;
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

/** Bright red for gap/deficit (top and bottom charts). */
const GAP_DEFICIT_RED = 'rgba(220, 38, 38, 0.95)';
const GAP_DEFICIT_BORDER = '#b91c1c';

/** Spacing for new-generation diagonal hatch (single direction). */
const CROSSHATCH_SPACING = 12;

/** Creates a repeating single-direction diagonal hatch (-45°) in the given hex color. Used for new generation. */
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

/** Keys for new generation (get diagonal hatch in mix and reliability charts). */
const NEW_GENERATION_KEYS = ['newWind', 'newSolar', 'geo'];

/**
 * Builds or updates the 11-year stacked area chart (TWh) with Chart.js. Legend and tooltips are built-in.
 *
 * @param {Object} data - Keys match STYLES; each value is an array of length YEARS (TWh per year).
 */
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
    backgroundColor: k === 'gap' ? GAP_DEFICIT_RED : hexToRgba(STYLES[k].c, MIX_FILL_ALPHA),
    borderColor: k === 'gap' ? GAP_DEFICIT_BORDER : STYLES[k].c,
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

/** Battery color in reliability chart (matches sidebar Firm Battery swatch). */
const REL_BATT_COLOR = '#CE93D8';

/** Reliability chart stack order: nuke, coal, gas base, geo (firm, below variable), then all wind/solar, then peaker. Geothermal below all solar and wind. */
const REL_STACK_ORDER = [
  { simKey: 'nuke', styleKey: 'nuke' },
  { simKey: 'coal', styleKey: 'coal' },
  { simKey: 'gasBase', styleKey: 'gasBase' },
  { simKey: 'geo', styleKey: 'geo' },
  { simKey: 'exWind', styleKey: 'exWind' },
  { simKey: 'exSolar', styleKey: 'exSolar' },
  { simKey: 'newWind', styleKey: 'newWind' },
  { simKey: 'newSolar', styleKey: 'newSolar' },
  { simKey: 'peaker', styleKey: 'gasPeak' },
];

/**
 * Builds or updates the 24-hour reliability chart. If "Stack by resource type" is checked: supply stacked by type (same colors as chart 1), battery, deficit, load. Otherwise: single Generation + Peaker + Battery + Deficit + Load (legacy view).
 *
 * @param {{ sim: { load, supply, supplyNoBatt, nuke, gasBase, coal, geo, exSolar, exWind, newSolar, newWind, peaker, discharge }, risk: number }} rel - Result from runReliability().
 */
function drawRel(rel) {
  const labels = Array.from({ length: 24 }, (_, i) => hourToTimeOfDay(i));
  const deficit = rel.sim.load.map((l, i) => Math.max(0, l - rel.sim.supply[i]));
  const stackByType = document.getElementById('rel_stack_by_type').checked;
  const expectedDatasets = stackByType ? REL_STACK_ORDER.length + 3 : 5;
  if (relChartInstance && relChartInstance.data.datasets.length !== expectedDatasets) {
    relChartInstance.destroy();
    relChartInstance = null;
  }

  const batteryDataset = {
    label: 'Battery',
    data: rel.sim.discharge,
    backgroundColor: hexToRgba(REL_BATT_COLOR, 0.95),
    borderColor: REL_BATT_COLOR,
    borderWidth: 0,
    fill: true,
    stack: 'area',
    tension: 0,
    pointRadius: 0,
    pointStyle: 'rect',
    order: 1,
  };
  const deficitDataset = {
    label: 'Deficit',
    data: deficit,
    backgroundColor: GAP_DEFICIT_RED,
    borderColor: GAP_DEFICIT_BORDER,
    borderWidth: 0,
    fill: true,
    stack: 'area',
    tension: 0,
    pointRadius: 0,
    pointStyle: 'rect',
    order: 1,
  };
  const loadDataset = {
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
    order: 0,
  };

  let datasets;
  let deficitIdx;
  if (stackByType) {
    datasets = REL_STACK_ORDER.map(({ simKey, styleKey }) => ({
      label: STYLES[styleKey].l,
      data: rel.sim[simKey] ?? Array(24).fill(0),
      backgroundColor: hexToRgba(STYLES[styleKey].c, 0.95),
      borderColor: STYLES[styleKey].c,
      borderWidth: 0,
      fill: true,
      stack: 'area',
      tension: 0,
      pointRadius: 0,
      pointStyle: 'rect',
      order: 1,
    }));
    datasets.push(batteryDataset, deficitDataset, loadDataset);
    deficitIdx = REL_STACK_ORDER.length + 1;
  } else {
    const supplyNoPeaker = rel.sim.supplyNoBatt.map((s, i) => s - (rel.sim.peaker[i] ?? 0));
    datasets = [
      {
        label: 'Generation',
        data: supplyNoPeaker,
        backgroundColor: 'rgba(232, 245, 233, 1)',
        borderColor: '#2e7d32',
        borderWidth: 0,
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
        backgroundColor: hexToRgba(STYLES.gasPeak.c, 0.95),
        borderColor: STYLES.gasPeak.c,
        borderWidth: 0,
        fill: true,
        stack: 'area',
        tension: 0,
        pointRadius: 0,
        pointStyle: 'rect',
        order: 1,
      },
      batteryDataset,
      deficitDataset,
      loadDataset,
    ];
    deficitIdx = 3;
  }

  if (relChartInstance) {
    relChartInstance.data.labels = labels;
    if (stackByType) {
      REL_STACK_ORDER.forEach(({ simKey }, i) => {
        relChartInstance.data.datasets[i].data = rel.sim[simKey] ?? Array(24).fill(0);
      });
      relChartInstance.data.datasets[REL_STACK_ORDER.length].data = rel.sim.discharge;
      relChartInstance.data.datasets[REL_STACK_ORDER.length + 1].data = deficit;
      relChartInstance.data.datasets[REL_STACK_ORDER.length + 2].data = rel.sim.load;
    } else {
      const supplyNoPeaker = rel.sim.supplyNoBatt.map((s, i) => s - (rel.sim.peaker[i] ?? 0));
      relChartInstance.data.datasets[0].data = supplyNoPeaker;
      relChartInstance.data.datasets[1].data = rel.sim.peaker ?? Array(24).fill(0);
      relChartInstance.data.datasets[2].data = rel.sim.discharge;
      relChartInstance.data.datasets[3].data = deficit;
      relChartInstance.data.datasets[4].data = rel.sim.load;
    }
    relChartInstance.update('none');
  } else {
    const ctx = document.getElementById('relChart').getContext('2d');
    if (stackByType) {
      REL_STACK_ORDER.forEach(({ styleKey }, i) => {
        if (NEW_GENERATION_KEYS.includes(styleKey)) {
          datasets[i].backgroundColor = createCrosshatchPattern(ctx, STYLES[styleKey].c);
        }
      });
    }
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
 * Returns the minimum supply margin % (worst hour) for the given inputs. Used by autoSolve to find a mix that hits the margin goal.
 * Uses same getReliabilityArgs → runReliability as the chart so battery and all logic are identical.
 */
function getMinMarginPct(nWind, nSolar, nGeo, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct) {
  const rel = runReliability(...getReliabilityArgs(nWind, nSolar, nGeo, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct));
  let marginPct = 0;
  for (let h = 0; h < 24; h++) {
    const l = rel.sim.load[h];
    if (l > 0) {
      const m = ((rel.sim.supply[h] - l) / l) * 100;
      if (h === 0 || m < marginPct) marginPct = m;
    }
  }
  return marginPct;
}

/**
 * Total cost ($M) for auto-solve: same formula as UI (runFinancials with gen + battery).
 * Energy: vol (TWh) × price ($/MWh) → $M. Battery: batt (MW) × price ($k/MW-yr) / 1000 → $M.
 */
function totalCostForBuild(nWind, nSolar, nGeo, batt, gasBase, gasPeak, coal, ee, dr, growth, tx) {
  const { twh35 } = getTwh2035(nWind, nSolar, nGeo, gasBase, gasPeak, coal, ee, dr, growth);
  const remoteKeys = new Set(['nuke', 'coal', 'exWind', 'exSolar', 'newWind', 'newSolar', 'gap']);
  let genCostM = 0;

  Object.entries(twh35).forEach(([k, vol]) => {
    const baseP = PRICES[k] ?? 0;
    const add = remoteKeys.has(k) ? tx : 0;
    genCostM += (vol * MWH_PER_TWH * (baseP + add)) / DOLLARS_PER_MILLION;
  });

  const battPrice = PRICES.batt ?? 120;
  const battCostM = (batt * battPrice) / 1000;
  return genCostM + battCostM;
}
/**
 * Auto-solve: grid over (wind, solar, geo, battery); pick the feasible combo with lowest total cost.
 */
function autoSolve() {
  const gasBase = +document.getElementById('p_gas_base').value;
  const gasPeak = +document.getElementById('p_gas_peak').value;
  const coal = +document.getElementById('p_coal').value;
  const ee = +document.getElementById('p_ee').value;
  const dr = +document.getElementById('p_dr').value;
  const growth = +document.getElementById('p_growth').value;
  const tx = +document.getElementById('p_tx').value;
  const goal = +document.getElementById('p_margin_goal').value;
  let best = { totalCostM: Infinity, nWind: 0, nSolar: 0, nGeo: 0, batt: 0 };

  const WIND_VALS = Array.from({ length: 11 }, (_, i) => i * 40);
  const SOLAR_VALS = Array.from({ length: 11 }, (_, i) => i * 40);
  const GEO_VALS = Array.from({ length: 9 }, (_, i) => i * 50);
  const BATTERY_VALS = [...Array.from({ length: 13 }, (_, i) => i * 200), 2500];

  for (const nWind of WIND_VALS) {
    for (const nSolar of SOLAR_VALS) {
      for (const nGeo of GEO_VALS) {
        for (const batt of BATTERY_VALS) {
          const minMarginPct = getMinMarginPct(nWind, nSolar, nGeo, batt, gasBase, gasPeak, coal, ee, dr, growth, goal);
          if (minMarginPct + 1e-9 < goal) continue;

          const totalCostM = totalCostForBuild(nWind, nSolar, nGeo, batt, gasBase, gasPeak, coal, ee, dr, growth, tx);
          if (totalCostM < best.totalCostM) best = { totalCostM, nWind, nSolar, nGeo, batt };
        }
      }
    }
  }

  if (best.totalCostM === Infinity) best = { nWind: 0, nSolar: 0, nGeo: 0, batt: 0, totalCostM: 0 };

  document.getElementById('p_wind').value = best.nWind;
  document.getElementById('p_solar').value = best.nSolar;
  document.getElementById('p_geo').value = best.nGeo;
  document.getElementById('p_batt').value = best.batt;
  update();
}
// --- Init (runs when script loads; DOM ready because script is at end of body) ---
document.querySelectorAll('input').forEach((i) => (i.oninput = update));
window.addEventListener('load', update);

