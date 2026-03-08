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
const CF = { wind: 0.35, solar: 0.25, distSolar: 0.2, geo: 0.9, gasBase: 0.5, gasPeak: 0.08, coal: 0.6, nuke: 0.9 };

/** Wholesale or proxy energy prices ($/MWh) for energy rows; batt is $k/MW-year for capacity. */
const PRICES = { nuke: 35, gasBase: 55, gasPeak: 95, coal: 45, ee: 25, dr: 25, exWind: 28, exSolar: 24, newWind: 48, newSolar: 36, distSolar: 40, geo: 85, gap: 120, batt: 120 };

// Cost units: vol (TWh) × price ($/MWh) → 1 TWh = 1e6 MWh, so cost ($) = vol × 1e6 × price, cost ($M) = vol × price.
const MWH_PER_TWH = 1e6;
const DOLLARS_PER_MILLION = 1e6;
const HOURS_PER_YEAR = 8760;
const DIST_SOLAR_BASELINE_MW = 188;
const DEFAULT_GRAPH_SHADE = 25;
const DEFAULT_LINE_SEPARATION = 5;
const DEFAULT_HATCH_WIDTH = 1;
const DEFAULT_HATCH_STRENGTH = 50;
const DEFAULT_PANEL_ROUNDING = 8;
const DEFAULT_PANEL_SHADOW = 50;

function blendHex(hex, targetHex, amount) {
  const a = Math.max(0, Math.min(1, amount));
  const src = hexToRgb(hex);
  const dst = hexToRgb(targetHex);
  const r = Math.round(src.r + (dst.r - src.r) * a);
  const g = Math.round(src.g + (dst.g - src.g) * a);
  const b = Math.round(src.b + (dst.b - src.b) * a);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const SHADE_OFFSETS = { borderToBlack: 0.28 };
const FAMILY_BASE_COLORS = { wind: '#4FC3F7', solar: '#E09328', distributed: '#C9852F', geo: '#9A6346', combined: '#43A047' };
const SPLIT_COLOR_FAMILIES = { exWind: 'wind', newWind: 'wind', exSolar: 'solar', newSolar: 'solar', distSolar: 'distributed', geo: 'geo' };

function getShadedFillColor(hex) {
  return blendHex(hex, '#ffffff', getGraphShadeAmount());
}

function getShadedBorderColor(hex) {
  return blendHex(hex, '#000000', SHADE_OFFSETS.borderToBlack);
}

function getGraphShadeAmount() {
  const raw = Number(document.getElementById('p_graph_shade')?.value);
  const pct = Number.isFinite(raw) ? raw : DEFAULT_GRAPH_SHADE;
  return Math.max(0, Math.min(100, pct)) / 100;
}

function getLineSeparation() {
  const raw = Number(document.getElementById('p_line_sep')?.value);
  const px = Number.isFinite(raw) ? raw : DEFAULT_LINE_SEPARATION;
  return Math.max(1, Math.min(24, px));
}

function getCrosshatchWidth() {
  const raw = Number(document.getElementById('p_hatch_width')?.value);
  const px = Number.isFinite(raw) ? raw : DEFAULT_HATCH_WIDTH;
  return Math.max(1, Math.min(12, px));
}

function getHatchStrengthScale() {
  const raw = Number(document.getElementById('p_hatch_strength')?.value);
  const pct = Number.isFinite(raw) ? raw : DEFAULT_HATCH_STRENGTH;
  return Math.max(0, Math.min(100, pct)) / 100;
}

function getFamilyShades(family) {
  const base = FAMILY_BASE_COLORS[family];
  if (!base) return null;
  return {
    fill: getShadedFillColor(base),
    border: getShadedBorderColor(base),
  };
}

function getPowerGroupStyles() {
  const combined = getFamilyShades('combined');
  return {
    existingPower: { fill: combined.fill, border: combined.border, l: 'Existing Power' },
    newGeneration: { fill: combined.fill, border: combined.border, l: 'New Generation' },
  };
}

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
  exSolar: { c: '#FFDDA0', l: 'Exist. Utility Solar' }, // light orange (same hue as New Solar)
  newSolar: { c: '#E09328', l: 'New Utility Solar' },   // dark orange (same hue)
  distSolar: { c: '#C9852F', l: 'Distributed Solar' },
  geo: { c: '#9A6346', l: 'New Geo' },
  gap: { c: '#E57373', l: 'Deficit' },
  batt: { c: '#CE93D8', l: 'Battery' },
};

/** Stack order when split-by-resource is enabled on charts. */
const MIX_SPLIT_KEYS = ['nuke', 'gasBase', 'gasPeak', 'coal', 'geo', 'exWind', 'newWind', 'exSolar', 'newSolar', 'distSolar', 'gap'];

/** Top-chart grouping when split-by-resource is disabled. */
const MIX_COMBINED_KEYS = ['existingPower', 'newGeneration', 'gap'];

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
const REL_INTERVALS_PER_HOUR = 1; // Hourly reliability resolution.
const REL_STEPS_PER_DAY = 24 * REL_INTERVALS_PER_HOUR;
const REL_DT_HOURS = 1 / REL_INTERVALS_PER_HOUR;
const SEASON_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_MONTH_HOURS = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];

/** Normalize monthly shape values so the hours-weighted annual average equals 1. */
function normalizeSeasonalProfile(profile) {
  const totalHours = SEASON_MONTH_HOURS.reduce((sum, h) => sum + h, 0);
  const weightedAvg = profile.reduce((sum, val, i) => sum + (val * SEASON_MONTH_HOURS[i]), 0) / totalHours;
  if (!Number.isFinite(weightedAvg) || weightedAvg <= 0) return profile.map(() => 0);
  return profile.map((v) => v / weightedAvg);
}

/*
 * Seasonality source data (retrieved 2026-03-07), using ERCOT-wide monthly values as a proxy for Austin:
 * 1) Load profile from monthly Net Energy for Load (GWh), averaging 2024 + 2025 actual columns:
 *    https://www.ercot.com/files/docs/2025/02/07/DemandandEnergy2025-for-Corp-Comms.xlsx
 *    (tab: data_Energy Comparisons_1)
 * 2) Solar/Wind profile from 2025 monthly generation (GWh):
 *    https://www.ercot.com/files/docs/2025/02/07/IntGenbyFuel2025.xlsx
 *    (tab: Summary, rows Solar and Wind)
 *
 * Method:
 * - Convert each month to average MW: (GWh * 1000) / hours_in_month
 * - Normalize by annual average MW to build dimensionless monthly factors.
 */
const LOAD_SEASONAL_PROFILE = normalizeSeasonalProfile([0.9751, 0.8965, 0.8295, 0.8962, 1.0063, 1.1469, 1.1453, 1.2233, 1.0884, 0.9942, 0.8879, 0.9010]);
const SOLAR_SEASONAL_PROFILE = normalizeSeasonalProfile([0.5799, 0.7092, 0.8996, 0.9526, 1.1374, 1.2510, 1.2588, 1.2890, 1.2496, 1.0730, 0.8768, 0.7057]);
const WIND_SEASONAL_PROFILE = normalizeSeasonalProfile([0.9795, 1.0178, 1.2345, 1.2922, 0.9503, 1.1227, 0.9415, 0.7283, 0.7151, 0.9221, 1.0469, 1.0566]);

/** Annual solar degradation applied to both existing and new solar output. */
const SOLAR_DEGRADATION_PCT = 0.5;
const SOLAR_DEGRADATION_FACTOR = 1 - SOLAR_DEGRADATION_PCT / 100;

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

/** Build existing-fleet MW by year from MW + contract expirations. */
function buildExistingMwByYear(fleet) {
  return Array.from({ length: YEARS }, (_, i) => {
    const year = BASE_YEAR + i;
    return fleet.reduce((sum, asset) => sum + (isAssetActiveInYear(asset, year) ? asset.mw : 0), 0);
  });
}

/** Solar output factor at a given age, with annual degradation. */
function solarOutputFactorForAge(ageYears) {
  return Math.pow(SOLAR_DEGRADATION_FACTOR, Math.max(0, ageYears));
}

/** Build years complete by a given year index (model starts adding new builds after year 1). */
function buildYearsByIndex(yearIndex) {
  return Math.max(0, yearIndex - 1);
}

/** Annual TWh from nuclear MW. */
function nukeMwToTwh(nukeMw) {
  return (nukeMw * 8760 * CF.nuke) / 1e6;
}

/** Linear interpolation helper. */
function lerp(start, end, t) {
  return start + (end - start) * t;
}

/** Existing solar TWh after degradation for each year of the horizon. */
function buildExistingSolarTwhByYear() {
  return EXISTING_SOLAR_MW.map((mw, i) => (mw * solarOutputFactorForAge(i) * 8760 * CF.solar) / 1e6);
}

/**
 * New-build annual TWh by year, with optional degradation on each build tranche.
 * Each tranche is assumed online beginning the year after it is built.
 */
function getNewBuildTwhForYearIndex(annualMw, cf, yearIndex, applyDegradation = false) {
  let twh = 0;
  for (let ageYears = 1; ageYears <= buildYearsByIndex(yearIndex); ageYears++) {
    const factor = applyDegradation ? solarOutputFactorForAge(ageYears) : 1;
    twh += (annualMw * factor * 8760 * cf) / 1e6;
  }
  return twh;
}

/** Effective MW in a given year with optional degradation for each annual build tranche. */
function getNewBuildEffectiveMwForYearIndex(annualMw, yearIndex, applyDegradation = false) {
  let mw = 0;
  for (let ageYears = 1; ageYears <= buildYearsByIndex(yearIndex); ageYears++) {
    const factor = applyDegradation ? solarOutputFactorForAge(ageYears) : 1;
    mw += annualMw * factor;
  }
  return mw;
}

/** Sum of solar degradation factors over build tranches through a given year index. */
function getSolarDegradationSumForYearIndex(yearIndex) {
  let sum = 0;
  for (let ageYears = 1; ageYears <= buildYearsByIndex(yearIndex); ageYears++) {
    sum += solarOutputFactorForAge(ageYears);
  }
  return sum;
}

/**
 * Convert 2035 target end-state MW sliders into constant annual build MW values.
 * Wind target includes existing wind; utility-solar target includes existing solar.
 * Distributed-solar annual build is computed relative to the 2025 baseline.
 */
function getBuildPlanFromTargets(windTargetMw, solarTargetMw, distSolarTargetMw, yearIndex = YEARS - 1) {
  const exWindMw2035 = (EXISTING_WIND_TWH[yearIndex] * 1e6) / (8760 * CF.wind);
  const exSolarMw2035 = (EXISTING_SOLAR_TWH[yearIndex] * 1e6) / (8760 * CF.solar);
  const newWindMw2035 = Math.max(0, windTargetMw - exWindMw2035);
  const newSolarMw2035 = Math.max(0, solarTargetMw - exSolarMw2035);
  const distSolarMw2035 = Math.max(0, distSolarTargetMw);
  const newDistSolarMw2035 = distSolarMw2035 - DIST_SOLAR_BASELINE_MW;

  const buildYears = buildYearsByIndex(yearIndex);
  const solarFactorSum = getSolarDegradationSumForYearIndex(yearIndex);

  const windAnnualMw = buildYears > 0 ? newWindMw2035 / buildYears : 0;
  const solarAnnualMw = solarFactorSum > 0 ? newSolarMw2035 / solarFactorSum : 0;
  const distSolarAnnualMw = buildYears > 0 ? newDistSolarMw2035 / buildYears : 0;

  return {
    exWindMw2035,
    exSolarMw2035,
    newWindMw2035,
    newSolarMw2035,
    distSolarMw2035,
    newDistSolarMw2035,
    windAnnualMw,
    solarAnnualMw,
    distSolarAnnualMw,
  };
}

/** Convert a 2035 MW target to constant annual additions over the build horizon. */
function getAnnualBuildFromTarget(targetMw, yearIndex = YEARS - 1) {
  const buildYears = buildYearsByIndex(yearIndex);
  return buildYears > 0 ? targetMw / buildYears : 0;
}

/** Existing wind/solar TWh by year (2025..2035), derived directly from contract expirations. */
const EXISTING_WIND_TWH = buildExistingTwhByYear(EXISTING_WIND_FLEET, CF.wind);
const EXISTING_SOLAR_MW = buildExistingMwByYear(EXISTING_SOLAR_FLEET);
const EXISTING_SOLAR_TWH = buildExistingSolarTwhByYear();
const BUILD_YRS_TOTAL = 9;

/** Build exact args for runReliability so chart and getMinMarginPct use identical inputs. */
function getReliabilityArgs(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct) {
  const plan = getBuildPlanFromTargets(windTargetMw, solarTargetMw, distSolarTargetMw, YEARS - 1);
  const exSolarMW = (EXISTING_SOLAR_TWH[YEARS - 1] * 1e6) / (8760 * CF.solar);
  const exWindMW = (EXISTING_WIND_TWH[YEARS - 1] * 1e6) / (8760 * CF.wind);
  const newSolarMW = plan.newSolarMw2035;
  const newDistSolarMW = plan.distSolarMw2035 * (CF.distSolar / CF.solar);
  return [
    nukeMW,
    exSolarMW,
    exWindMW,
    newSolarMW,
    newDistSolarMW,
    plan.newWindMw2035,
    geoTargetMw,
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
 * Reads slider values, recomputes 11-year supply/load and gap, updates KPIs and charts.
 */
function update() {
  const tx = +document.getElementById('p_tx').value;
  const growth = +document.getElementById('p_growth').value;
  const marginGoalPct = +document.getElementById('p_margin_goal').value;
  const nukeMW = +document.getElementById('p_nuke').value;
  const solarTargetMw = +document.getElementById('p_solar').value;
  const distSolarTargetMw = +document.getElementById('p_dist_solar').value;
  const windTargetMw = +document.getElementById('p_wind').value;
  const geoTargetMw = +document.getElementById('p_geo').value;
  const gasBase = +document.getElementById('p_gas_base').value;
  const gasPeak = +document.getElementById('p_gas_peak').value;
  const coal = +document.getElementById('p_coal').value;
  const ee = +document.getElementById('p_ee').value;
  const dr = +document.getElementById('p_dr').value;
  const batt = +document.getElementById('p_batt').value;
  const graphHoverEnabled = document.getElementById('p_graph_hover').checked;
  const mixShowMw = document.getElementById('mix_units_mw').checked;
  const mixIncludeSeasonal = document.getElementById('mix_include_seasonal')?.checked ?? false;
  const splitByType = document.getElementById('rel_stack_by_type').checked;
  const graphShade = +document.getElementById('p_graph_shade').value;
  const lineSep = +document.getElementById('p_line_sep').value;
  const hatchWidth = +document.getElementById('p_hatch_width').value;
  const hatchStrength = +document.getElementById('p_hatch_strength').value;
  const panelRounding = +document.getElementById('p_panel_rounding').value;
  const panelShadow = +document.getElementById('p_panel_shadow').value;

  const buildPlan = getBuildPlanFromTargets(windTargetMw, solarTargetMw, distSolarTargetMw, YEARS - 1);
  const geoAnnualMw = getAnnualBuildFromTarget(geoTargetMw, YEARS - 1);
  const solarMw2035 = buildPlan.newSolarMw2035;
  const distSolarMw2035 = buildPlan.distSolarMw2035;
  const exWindMw2035 = buildPlan.exWindMw2035;
  const exSolarMw2035 = buildPlan.exSolarMw2035;
  const geoMw2035 = geoTargetMw;
  const windMw2035 = buildPlan.newWindMw2035;
  const totalMw2035NoBattery = nukeMW + gasBase + gasPeak + coal + exWindMw2035 + exSolarMw2035 + windMw2035 + solarMw2035 + distSolarMw2035 + geoMw2035;
  const annualBuildLabel = (mwPerYear) => `${mwPerYear >= 0 ? '+' : ''}${Math.round(mwPerYear)} MW/yr`;
  const transitionYears = Math.max(1, YEARS - 1);
  const nukeAnnualDelta = (nukeMW - DEFAULT_INPUTS.p_nuke) / transitionYears;
  const gasBaseAnnualDelta = (gasBase - DEFAULT_INPUTS.p_gas_base) / transitionYears;
  const gasPeakAnnualDelta = (gasPeak - DEFAULT_INPUTS.p_gas_peak) / transitionYears;
  const coalAnnualDelta = (coal - DEFAULT_INPUTS.p_coal) / transitionYears;

  document.getElementById('v_tx').textContent = '$' + tx;
  document.getElementById('v_growth').textContent = growth + '%';
  document.getElementById('v_graph_shade').textContent = graphShade + '%';
  document.getElementById('v_line_sep').textContent = lineSep + ' px';
  document.getElementById('v_hatch_width').textContent = hatchWidth + ' px';
  document.getElementById('v_hatch_strength').textContent = hatchStrength + '%';
  document.getElementById('v_panel_rounding').textContent = panelRounding + ' px';
  document.getElementById('v_panel_shadow').textContent = panelShadow + '%';
  document.getElementById('v_margin_goal').textContent = marginGoalPct + '%';
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--panel-radius', `${Math.max(0, panelRounding)}px`);
  const clampedShadow = Math.max(0, Math.min(100, panelShadow));
  rootStyle.setProperty('--panel-shadow-y', `${((clampedShadow / 100) * 2).toFixed(2)}px`);
  rootStyle.setProperty('--panel-shadow-blur', `${((clampedShadow / 100) * 8).toFixed(2)}px`);
  rootStyle.setProperty('--panel-shadow-alpha', ((clampedShadow / 100) * 0.2).toFixed(3));
  document.getElementById('v_nuke').innerHTML = `${nukeMW} MW<span class="val-total">${annualBuildLabel(nukeAnnualDelta)}</span>`;
  document.getElementById('v_solar').innerHTML = `${solarTargetMw} MW<span class="val-total">${annualBuildLabel(buildPlan.solarAnnualMw)}</span>`;
  document.getElementById('v_dist_solar').innerHTML = `${distSolarTargetMw} MW<span class="val-total">${annualBuildLabel(buildPlan.distSolarAnnualMw)}</span>`;
  document.getElementById('v_wind').innerHTML = `${windTargetMw} MW<span class="val-total">${annualBuildLabel(buildPlan.windAnnualMw)}</span>`;
  document.getElementById('v_geo').innerHTML = `${geoTargetMw} MW<span class="val-total">${annualBuildLabel(geoAnnualMw)}</span>`;
  document.getElementById('v_gas_base').innerHTML = `${gasBase} MW<span class="val-total">${annualBuildLabel(gasBaseAnnualDelta)}</span>`;
  document.getElementById('v_gas_peak').innerHTML = `${gasPeak} MW<span class="val-total">${annualBuildLabel(gasPeakAnnualDelta)}</span>`;
  document.getElementById('v_coal').innerHTML = `${coal} MW<span class="val-total">${annualBuildLabel(coalAnnualDelta)}</span>`;
  document.getElementById('v_ee').textContent = ee + ' MW';
  document.getElementById('v_dr').textContent = dr + ' MW';
  document.getElementById('v_batt').textContent = batt + ' MW';
  document.getElementById('v_total_mw_2035').textContent = Math.round(totalMw2035NoBattery) + ' MW';

  const data = { nuke: [], gasBase: [], gasPeak: [], coal: [], exWind: [], exSolar: [], geo: [], newWind: [], newSolar: [], distSolar: [], ee: [], dr: [], gap: [], load: [] };
  const defaultBuildPlan = getBuildPlanFromTargets(DEFAULT_INPUTS.p_wind, DEFAULT_INPUTS.p_solar, DEFAULT_INPUTS.p_dist_solar, YEARS - 1);
  const defaultGeoAnnualMw = getAnnualBuildFromTarget(DEFAULT_INPUTS.p_geo, YEARS - 1);
  const startTwh = {
    nuke: nukeMwToTwh(DEFAULT_INPUTS.p_nuke),
    gasBase: (DEFAULT_INPUTS.p_gas_base * 8760 * CF.gasBase) / 1e6,
    gasPeak: (DEFAULT_INPUTS.p_gas_peak * 8760 * CF.gasPeak) / 1e6,
    coal: (DEFAULT_INPUTS.p_coal * 8760 * CF.coal) / 1e6,
    ee: (DEFAULT_INPUTS.p_ee * 0.7 * 8760 * 0.02) / 1e6,
    dr: (DEFAULT_INPUTS.p_dr * 200) / 1e6,
    geo: getNewBuildTwhForYearIndex(defaultGeoAnnualMw, CF.geo, 0, false),
    newWind: getNewBuildTwhForYearIndex(defaultBuildPlan.windAnnualMw, CF.wind, 0, false),
    newSolar: getNewBuildTwhForYearIndex(defaultBuildPlan.solarAnnualMw, CF.solar, 0, true),
    distSolar: (DIST_SOLAR_BASELINE_MW * HOURS_PER_YEAR * CF.distSolar) / 1e6,
  };
  const endTwh = {
    nuke: nukeMwToTwh(nukeMW),
    gasBase: (gasBase * 8760 * CF.gasBase) / 1e6,
    gasPeak: (gasPeak * 8760 * CF.gasPeak) / 1e6,
    coal: (coal * 8760 * CF.coal) / 1e6,
    ee: (ee * 0.7 * 8760 * 0.02) / 1e6,
    dr: (dr * 200) / 1e6,
    geo: getNewBuildTwhForYearIndex(geoAnnualMw, CF.geo, YEARS - 1, false),
    newWind: getNewBuildTwhForYearIndex(buildPlan.windAnnualMw, CF.wind, YEARS - 1, false),
    newSolar: getNewBuildTwhForYearIndex(buildPlan.solarAnnualMw, CF.solar, YEARS - 1, true),
    distSolar: (buildPlan.distSolarMw2035 * HOURS_PER_YEAR * CF.distSolar) / 1e6,
  };

  for (let i = 0; i < YEARS; i++) {
    const blend = i / (YEARS - 1);
    const yrLoadGross = 14.2 * Math.pow(1 + growth / 100, i);
    const eeTwh = lerp(startTwh.ee, endTwh.ee, blend);
    const yrLoad = Math.max(0, yrLoadGross - eeTwh);
    data.load.push(yrLoad);
    const nuke = lerp(startTwh.nuke, endTwh.nuke, blend);
    const exW = EXISTING_WIND_TWH[i];
    const exS = EXISTING_SOLAR_TWH[i];
    const geoTwh = lerp(startTwh.geo, endTwh.geo, blend);
    const winTwh = lerp(startTwh.newWind, endTwh.newWind, blend);
    const solTwh = lerp(startTwh.newSolar, endTwh.newSolar, blend);
    const distSolTwh = lerp(startTwh.distSolar, endTwh.distSolar, blend);
    const gasBaseTwh = lerp(startTwh.gasBase, endTwh.gasBase, blend);
    const gasPeakTwh = lerp(startTwh.gasPeak, endTwh.gasPeak, blend);
    const coalTwh = lerp(startTwh.coal, endTwh.coal, blend);

    data.nuke.push(nuke);
    data.gasBase.push(gasBaseTwh);
    data.gasPeak.push(gasPeakTwh);
    data.coal.push(coalTwh);
    data.exWind.push(exW);
    data.exSolar.push(exS);
    data.geo.push(geoTwh);
    data.newWind.push(winTwh);
    data.newSolar.push(solTwh);
    data.distSolar.push(distSolTwh);
    data.ee.push(eeTwh);
    data.dr.push(lerp(startTwh.dr, endTwh.dr, blend));

    const totalSup = nuke + exW + exS + geoTwh + winTwh + solTwh + distSolTwh + gasBaseTwh + gasPeakTwh + coalTwh;
    data.gap.push(Math.max(0, yrLoad - totalSup));
  }

  const lastIdx = YEARS - 1;
  const total2035 = data.load[lastIdx];

  setMixUnitsLabel(mixShowMw);
  drawMix(data, graphHoverEnabled, mixShowMw, splitByType, mixIncludeSeasonal, marginGoalPct);
  const rel = runReliability(...getReliabilityArgs(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct));
  const peakerUsageTwh35 = getAnnualizedPeakerTwhFromReliability(rel);
  // Carbon Free Calculation (Excludes Gas and Deficit). Peaker is usage-based from reliability dispatch.
  const carbonSources = data.gasBase[lastIdx] + peakerUsageTwh35 + data.coal[lastIdx] + data.gap[lastIdx];
  const carbonFreePct = total2035 > 0 ? Math.max(0, ((total2035 - carbonSources) / total2035) * 100) : 0;
  document.getElementById('k_clean').textContent = carbonFreePct.toFixed(0) + '%';
  drawRel(rel, graphHoverEnabled, splitByType, marginGoalPct);

  // Supply margin: minimum hourly (supply - load) / load as %, from reliability run
  let marginPct = 0;
  for (let h = 0; h < rel.sim.load.length; h++) {
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
    gasPeak: peakerUsageTwh35,
    coal: data.coal[lastIdx],
    ee: data.ee[lastIdx],
    dr: data.dr[lastIdx],
    exWind: data.exWind[lastIdx],
    exSolar: data.exSolar[lastIdx],
    geo: data.geo[lastIdx],
    newWind: data.newWind[lastIdx],
    newSolar: data.newSolar[lastIdx],
    distSolar: data.distSolar[lastIdx],
    gap: data.gap[lastIdx],
  };
  drawSeasonality(twh35, total2035, graphHoverEnabled, splitByType, marginGoalPct);
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
    { k: 'newSolar', n: 'New Utility Solar' },
    { k: 'distSolar', n: 'Distributed Solar' },
    { k: 'geo', n: 'Geothermal' },
    { k: 'ee', n: 'Energy Efficiency' },
    { k: 'dr', n: 'Demand Response' },
    { k: 'exWind', n: 'Exist. Wind' },
    { k: 'exSolar', n: 'Exist. Utility Solar' },
    { k: 'coal', n: 'Coal' },
    { k: 'gasBase', n: 'Gas (Baseload)' },
    { k: 'gasPeak', n: 'Gas (Peaker)' },
    { k: 'nuke', n: 'Nuclear' },
    { k: 'gap', n: 'Deficit' },
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
function getTwh2035(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, gasBase, gasPeak, coal, ee, dr, growth) {
  const i = YEARS - 1;
  const buildPlan = getBuildPlanFromTargets(windTargetMw, solarTargetMw, distSolarTargetMw, i);
  const geoAnnualMw = getAnnualBuildFromTarget(geoTargetMw, i);
  const yrLoadGross = 14.2 * Math.pow(1 + growth / 100, i);
  const eeTwh = (ee * 0.7 * 8760 * 0.02) / 1e6;
  const load2035 = Math.max(0, yrLoadGross - eeTwh);
  const nuke = nukeMwToTwh(nukeMW);
  const exW = EXISTING_WIND_TWH[i];
  const exS = EXISTING_SOLAR_TWH[i];
  const geoTwh = getNewBuildTwhForYearIndex(geoAnnualMw, CF.geo, i, false);
  const winTwh = getNewBuildTwhForYearIndex(buildPlan.windAnnualMw, CF.wind, i, false);
  const solTwh = getNewBuildTwhForYearIndex(buildPlan.solarAnnualMw, CF.solar, i, true);
  const distSolTwh = (buildPlan.distSolarMw2035 * HOURS_PER_YEAR * CF.distSolar) / 1e6;
  const gasBaseTwh = (gasBase * 8760 * CF.gasBase) / 1e6;
  const gasPeakTwh = (gasPeak * 8760 * CF.gasPeak) / 1e6;
  const coalTwh = (coal * 8760 * CF.coal) / 1e6;
  const totalSup = nuke + exW + exS + geoTwh + winTwh + solTwh + distSolTwh + gasBaseTwh + gasPeakTwh + coalTwh;
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
      distSolar: distSolTwh,
      gap: gapTwh,
    },
    load2035,
  };
}

/**
 * Runs a 24-hour August peak stress test. Supply = gas (baseload always, peaker only at peak), coal, geo, solar, wind, plus battery.
 * Battery fills deficits first (charge from surplus hours, discharge to deficit hours); peaker only covers remaining shortfall after battery.
 * Two-pass battery in hourly steps with carry-over. Power limit = batt MW, energy capacity = 4h.
 */
function runReliability(nukeMW, exSolarMW, exWindMW, newSolarMW, newDistSolarMW, newWindMW, geo, gasBase, gasPeak, coal, ee, dr, batt, growth, marginGoalPct) {
  const expandHourlyProfile = (hourlyProfile) => {
    const out = [];
    for (let h = 0; h < 24; h++) {
      for (let q = 0; q < REL_INTERVALS_PER_HOUR; q++) {
        out.push(hourlyProfile[h]);
      }
    }
    return out;
  };
  const peak = 3150 * Math.pow(1 + growth / 100, 10);
  const E_cap = batt * 4; // MWh, 4-hour duration
  const eeFirm = ee * 0.7; // 70% of EE reduces load (MW) during stress
  const marginGoal = (marginGoalPct ?? 15) / 100;
  const sol = exSolarMW + newSolarMW + newDistSolarMW;
  const win = exWindMW + newWindMW;
  const loadProfile = expandHourlyProfile(PROF.load);
  const solarProfile = expandHourlyProfile(PROF.solar);
  const windProfile = expandHourlyProfile(PROF.wind);

  // DR profile from headroom (supply − load): shift load toward hours with spare capacity (e.g. baseload at night, solar at midday).
  const grossLoadByStep = Array.from({ length: REL_STEPS_PER_DAY }, (_, s) => loadProfile[s] * peak);
  const supplyAvail = Array.from({ length: REL_STEPS_PER_DAY }, (_, s) =>
    nukeMW + gasBase + coal + geo + sol * solarProfile[s] + win * windProfile[s]
  );
  const headroom = supplyAvail.map((s, i) => s - grossLoadByStep[i]);
  const meanHeadroom = headroom.reduce((a, b) => a + b, 0) / REL_STEPS_PER_DAY;
  const drDev = headroom.map((hr) => meanHeadroom - hr);
  const maxDrDev = Math.max(...drDev);
  const drProfile = maxDrDev > 0 ? drDev.map((d) => d / maxDrDev) : Array(REL_STEPS_PER_DAY).fill(0);

  const sim = {
    load: new Array(REL_STEPS_PER_DAY),
    supply: new Array(REL_STEPS_PER_DAY),
    supplyNoBatt: new Array(REL_STEPS_PER_DAY),
    nuke: new Array(REL_STEPS_PER_DAY),
    gasBase: new Array(REL_STEPS_PER_DAY),
    coal: new Array(REL_STEPS_PER_DAY),
    geo: new Array(REL_STEPS_PER_DAY),
    exSolar: new Array(REL_STEPS_PER_DAY),
    exWind: new Array(REL_STEPS_PER_DAY),
    newSolar: new Array(REL_STEPS_PER_DAY),
    distSolar: new Array(REL_STEPS_PER_DAY),
    newWind: new Array(REL_STEPS_PER_DAY),
    peaker: new Array(REL_STEPS_PER_DAY),
    discharge: new Array(REL_STEPS_PER_DAY),
  };
  const chargeHeadroom = new Array(REL_STEPS_PER_DAY);
  const targetByStep = new Array(REL_STEPS_PER_DAY);
  const shortfallToTarget = new Array(REL_STEPS_PER_DAY);
  const requiredBattForTarget = new Array(REL_STEPS_PER_DAY);

  // Pass 1: EE/DR; compute surplus/deficit vs target using generation only (no peaker, no battery).
  // Battery charging only uses surplus above the reserve target so margin comes first.
  for (let s = 0; s < REL_STEPS_PER_DAY; s++) {
    const grossLoad = loadProfile[s] * peak;
    const netLoad = Math.max(0, grossLoad - eeFirm - dr * drProfile[s]);
    sim.load[s] = netLoad;
    const targetSupply = netLoad * (1 + marginGoal);
    targetByStep[s] = targetSupply;
    const solarMW = sol * solarProfile[s];
    const windMW = win * windProfile[s];
    sim.exSolar[s] = exSolarMW * solarProfile[s];
    sim.exWind[s] = exWindMW * windProfile[s];
    sim.newSolar[s] = newSolarMW * solarProfile[s];
    sim.distSolar[s] = newDistSolarMW * solarProfile[s];
    sim.newWind[s] = newWindMW * windProfile[s];
    const supplyNoPeaker = nukeMW + gasBase + coal + geo + solarMW + windMW;
    // Charge only from surplus above the reserve target.
    chargeHeadroom[s] = Math.max(0, supplyNoPeaker - targetSupply);
    shortfallToTarget[s] = Math.max(0, targetSupply - supplyNoPeaker);
    // Minimum battery power needed in this step to hit reserve target after max peaker use.
    requiredBattForTarget[s] = Math.max(0, shortfallToTarget[s] - gasPeak);
    sim.nuke[s] = nukeMW;
    sim.gasBase[s] = gasBase;
    sim.coal[s] = coal;
    sim.geo[s] = geo;
    sim.peaker[s] = 0; // set in pass 2 after battery
  }
  const futureRequiredMWh = new Array(REL_STEPS_PER_DAY + 1).fill(0);
  const futureChargeMWh = new Array(REL_STEPS_PER_DAY + 1).fill(0);
  for (let s = REL_STEPS_PER_DAY - 1; s >= 0; s--) {
    const stepChargeMwCap = Math.min(chargeHeadroom[s], batt);
    futureRequiredMWh[s] = futureRequiredMWh[s + 1] + requiredBattForTarget[s] * REL_DT_HOURS;
    futureChargeMWh[s] = futureChargeMWh[s + 1] + stepChargeMwCap * REL_DT_HOURS;
  }

  // Pass 2: start stress day with empty battery.
  // Dispatch policy: (1) keep enough SOC to satisfy reserve-target-critical future hours,
  // then (2) use excess SOC to reduce peaker usage.
  let soc = 0;
  let riskHours = 0;
  for (let s = 0; s < REL_STEPS_PER_DAY; s++) {
    if (chargeHeadroom[s] > 0) {
      const chargeMW = Math.min(chargeHeadroom[s], batt, (E_cap - soc) / REL_DT_HOURS);
      soc += chargeMW * REL_DT_HOURS;
    }
    const supplyNoPeakerH = nukeMW + gasBase + coal + geo + sol * solarProfile[s] + win * windProfile[s];
    const targetH = targetByStep[s];
    const requiredNowMW = Math.max(0, targetH - supplyNoPeakerH - gasPeak);
    const mandatoryDischargeMW = Math.min(requiredNowMW, batt, soc / REL_DT_HOURS);
    soc -= mandatoryDischargeMW * REL_DT_HOURS;

    const shortfallAfterMandatory = Math.max(0, targetH - supplyNoPeakerH - mandatoryDischargeMW);
    const peakerNeededWithoutOptional = Math.min(gasPeak, shortfallAfterMandatory);
    const battPowerHeadroom = Math.max(0, batt - mandatoryDischargeMW);
    const reserveMWh = Math.max(0, futureRequiredMWh[s + 1] - futureChargeMWh[s + 1]);
    const optionalEnergyMWh = Math.max(0, soc - reserveMWh);
    const optionalDischargeMW = Math.min(peakerNeededWithoutOptional, battPowerHeadroom, optionalEnergyMWh / REL_DT_HOURS);
    soc -= optionalDischargeMW * REL_DT_HOURS;

    const dischargeMW = mandatoryDischargeMW + optionalDischargeMW;
    const shortfallAfterBatt = Math.max(0, targetH - supplyNoPeakerH - dischargeMW);
    const peakerMW = Math.min(gasPeak, shortfallAfterBatt);
    sim.peaker[s] = peakerMW;
    sim.supplyNoBatt[s] = supplyNoPeakerH + peakerMW;
    sim.supply[s] = supplyNoPeakerH + peakerMW + dischargeMW;
    sim.discharge[s] = dischargeMW;
    if (sim.load[s] > sim.supply[s] + 10) riskHours += REL_DT_HOURS;
  }
  return { sim, risk: riskHours };
}

/**
 * Converts peaker dispatch from the representative reliability day into annual TWh.
 * Uses the simulated average peaker MW and scales to 8,760 hours/year.
 */
function getAnnualizedPeakerTwhFromReliability(rel) {
  const peakerSeries = rel?.sim?.peaker;
  if (!Array.isArray(peakerSeries) || peakerSeries.length === 0) return 0;
  const sumMw = peakerSeries.reduce((acc, mw) => acc + (Number.isFinite(mw) ? mw : 0), 0);
  const avgMw = sumMw / peakerSeries.length;
  return (avgMw * HOURS_PER_YEAR) / MWH_PER_TWH;
}

/** Chart.js instances (created on first draw, updated thereafter). */
let mixChartInstance = null;
let seasonChartInstance = null;
let relChartInstance = null;

/** Format hour (0–23) as time of day (12am, 1am, … 11pm). */
function hourToTimeOfDay(hour) {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? hour + 'am' : hour - 12 + 'pm';
}

function stepToTimeOfDay(stepIndex) {
  const totalMinutes = stepIndex * (60 / REL_INTERVALS_PER_HOUR);
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  if (minute === 0) return hourToTimeOfDay(hour24);
  const suffix = hour24 < 12 ? 'am' : 'pm';
  const hour12 = (hour24 % 12) || 12;
  return `${hour12}:${String(minute).padStart(2, '0')}${suffix}`;
}

/** Bright red for gap/deficit (top and bottom charts). */
const GAP_DEFICIT_BASE = '#dc2626';
const OLD_NEW_BOUNDARY_MAP = { exWind: 'newWind', exSolar: 'newSolar' };

function getGapDeficitColors() {
  const fillHex = getShadedFillColor(GAP_DEFICIT_BASE);
  return {
    fillHex,
    fill: hexToRgba(fillHex, 0.95),
    border: getShadedBorderColor(GAP_DEFICIT_BASE),
  };
}

function getHatchStripeTone(hexColor, colorKey = '') {
  const n = parseInt(hexColor.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const isGeothermal = colorKey === 'geo';
  const baseTint = isGeothermal ? 0.22 : 0.35;
  const strengthScale = getHatchStrengthScale();
  // Pivot at 50% so higher strength always increases contrast/visibility.
  const tintAdjusted = Math.max(0.04, Math.min(0.82, baseTint + (strengthScale - 0.5) * 0.35));
  const targetR = 255;
  const targetG = isGeothermal ? 232 : 255;
  const targetB = isGeothermal ? 212 : 255;
  return {
    r,
    g,
    b,
    sr: Math.round(r + (targetR - r) * tintAdjusted),
    sg: Math.round(g + (targetG - g) * tintAdjusted),
    sb: Math.round(b + (targetB - b) * tintAdjusted),
    strengthScale,
  };
}

function getHatchStripeColor(hexColor, colorKey = '') {
  const { sr, sg, sb } = getHatchStripeTone(hexColor, colorKey);
  return `rgba(${sr},${sg},${sb},0.95)`;
}

function getOldNewBoundaryColor(styleKey) {
  const newKey = OLD_NEW_BOUNDARY_MAP[styleKey];
  if (!newKey) return null;
  const newFill = getSplitSeriesColors(newKey).fill;
  return getHatchStripeColor(newFill, newKey);
}

/** Creates a repeating single-direction diagonal hatch in the given hex color. Used for new generation. */
function createCrosshatchPattern(ctx, hexColor, colorKey = '') {
  const spacing = getLineSeparation();
  // Keep tile size an exact multiple of spacing so repeated diagonals line up cleanly.
  const tileRepeats = 8;
  const size = spacing * tileRepeats;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const { r, g, b, sr, sg, sb, strengthScale } = getHatchStripeTone(hexColor, colorKey);
  c.fillStyle = `rgba(${r},${g},${b},1)`;
  c.fillRect(0, 0, size, size);
  if (strengthScale > 0) {
    // Rasterized periodic bands avoid anti-aliased seam artifacts at tile boundaries.
    const alpha = strengthScale <= 0.5
      ? (strengthScale / 0.5) * 0.95
      : 0.95 + ((strengthScale - 0.5) / 0.5) * 0.05;
    const alphaByte = Math.round(255 * Math.max(0, Math.min(1, alpha)));
    const bandWidth = Math.max(1, Math.min(spacing, getCrosshatchWidth()));
    const img = c.getImageData(0, 0, size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (((x + y) % spacing) < bandWidth) {
          const idx = (y * size + x) * 4;
          d[idx] = sr;
          d[idx + 1] = sg;
          d[idx + 2] = sb;
          d[idx + 3] = alphaByte;
        }
      }
    }
    c.putImageData(img, 0, 0);
  }
  return ctx.createPattern(canvas, 'repeat');
}

/** Creates thick vertical stripes for deficit/gap fills. */
function createVerticalStripePattern(ctx, hexColor) {
  const stripeWidth = 5;
  const stripeSpacing = stripeWidth * 2;
  const tileRepeats = 4;
  const size = stripeSpacing * tileRepeats;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const { r, g, b } = hexToRgb(hexColor);
  c.fillStyle = `rgba(${r},${g},${b},1)`;
  c.fillRect(0, 0, size, size);
  c.fillStyle = 'rgba(255,255,255,1)';
  for (let x = 0; x < size; x += stripeSpacing) {
    c.fillRect(x, 0, stripeWidth, size);
  }
  return ctx.createPattern(canvas, 'repeat');
}

/** Keys treated as "new power" for hatching and aggregated grouping. */
const NEW_GENERATION_KEYS = ['newWind', 'newSolar', 'geo'];
const SPLIT_OUTER_BORDER_KEYS = new Set(['newWind', 'newSolar', 'distSolar', 'geo']);
function getSplitSeriesColors(styleKey) {
  const family = SPLIT_COLOR_FAMILIES[styleKey];
  if (family) return getFamilyShades(family);
  const base = STYLES[styleKey].c;
  return { fill: getShadedFillColor(base), border: getShadedBorderColor(base) };
}

/**
 * Builds or updates the 11-year stacked area chart (TWh) with Chart.js. Legend and tooltips are built-in.
 *
 * @param {Object} data - Keys match STYLES; each value is an array of length YEARS (TWh per year).
 */
/** Alpha for top-chart stack fill (1 = fully opaque). */
const MIX_FILL_ALPHA = 1;
/** Line smoothing amount for top chart when seasonality mode is enabled. */
const MIX_SEASONAL_LINE_TENSION = 0.28;

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function toMixUnits(values, showMw) {
  return showMw ? values.map((v) => (v * MWH_PER_TWH) / HOURS_PER_YEAR) : values;
}

function getMixAxisMax(showMw) {
  // Keep y-axis static by unit mode for visual consistency across scenarios.
  return showMw ? 7000 : 25;
}

function setMixUnitsLabel(showMw) {
  const el = document.getElementById('mix_units_lbl');
  if (el) el.textContent = showMw ? 'Nameplate MW' : 'TWh';
}

function getMixSeasonalProfileForKey(key) {
  if (key === 'load') return LOAD_SEASONAL_PROFILE;
  if (key === 'exWind' || key === 'newWind') return WIND_SEASONAL_PROFILE;
  if (key === 'exSolar' || key === 'newSolar' || key === 'distSolar') return SOLAR_SEASONAL_PROFILE;
  return Array(SEASON_MONTHS.length).fill(1);
}

/**
 * Expands annual top-chart series into monthly points across the full planning horizon.
 * Variable resources and load get monthly seasonal factors; gap is recomputed monthly from load-supply.
 */
function buildSeasonalMixTimeline(data) {
  const labels = [];
  const seasonalSeries = {};
  const sourceKeysNoGap = MIX_SPLIT_KEYS.filter((key) => key !== 'gap');
  const expandedKeys = [...sourceKeysNoGap, 'gap', 'load'];
  expandedKeys.forEach((key) => { seasonalSeries[key] = []; });

  for (let y = 0; y < YEARS; y++) {
    const year = BASE_YEAR + y;
    for (let m = 0; m < SEASON_MONTHS.length; m++) {
      labels.push(`${SEASON_MONTHS[m]} ${year}`);
      sourceKeysNoGap.forEach((key) => {
        const annualVal = data[key]?.[y] ?? 0;
        const profile = getMixSeasonalProfileForKey(key);
        seasonalSeries[key].push(annualVal * profile[m]);
      });
      const annualLoad = data.load?.[y] ?? 0;
      seasonalSeries.load.push(annualLoad * LOAD_SEASONAL_PROFILE[m]);
    }
  }

  seasonalSeries.gap = seasonalSeries.load.map((loadVal, idx) => {
    const supplyNoGap = sourceKeysNoGap.reduce((sum, key) => sum + (seasonalSeries[key]?.[idx] ?? 0), 0);
    return Math.max(0, loadVal - supplyNoGap);
  });

  return { labels, seasonalSeries };
}

function drawMix(data, hoverEnabled, showMw, splitByType, includeSeasonalTop = false, marginGoalPct = 15) {
  const useSeasonal = Boolean(includeSeasonalTop) && !showMw;
  const lineTension = useSeasonal ? MIX_SEASONAL_LINE_TENSION : 0;
  const mixSeriesData = useSeasonal ? buildSeasonalMixTimeline(data) : null;
  const labels = useSeasonal
    ? mixSeriesData.labels
    : Array.from({ length: YEARS }, (_, i) => String(BASE_YEAR + i));
  const seriesByKey = useSeasonal ? mixSeriesData.seasonalSeries : data;
  const pointCount = labels.length;
  const unitLabel = showMw ? 'MW' : 'TWh';
  const marginGoal = Number.isFinite(marginGoalPct) ? marginGoalPct : 0;
  const yMax = getMixAxisMax(showMw);
  const gapDeficitColors = getGapDeficitColors();
  const powerGroupStyles = getPowerGroupStyles();
  const toMwByCf = (series, cf) => series.map((v) => (v * MWH_PER_TWH) / (HOURS_PER_YEAR * cf));
  const sumSeries = (seriesList) => Array.from({ length: pointCount }, (_, i) => seriesList.reduce((sum, s) => sum + (s[i] ?? 0), 0));
  const convertLoad = (series) => (showMw ? toMixUnits(series, true) : series);
  const convertSeriesForKey = (key) => {
    const series = seriesByKey[key] ?? Array(pointCount).fill(0);
    if (!showMw) return series;
    if (key === 'gap') return Array(pointCount).fill(0);
    if (key === 'exWind' || key === 'newWind') return toMwByCf(series, CF.wind);
    if (key === 'exSolar' || key === 'newSolar') return toMwByCf(series, CF.solar);
    if (key === 'distSolar') return toMwByCf(series, CF.distSolar);
    if (key === 'geo') return toMwByCf(series, CF.geo);
    if (key === 'nuke') return toMwByCf(series, CF.nuke);
    if (key === 'gasBase') return toMwByCf(series, CF.gasBase);
    if (key === 'gasPeak') return toMwByCf(series, CF.gasPeak);
    if (key === 'coal') return toMwByCf(series, CF.coal);
    return series;
  };

  const splitEntries = MIX_SPLIT_KEYS.map((key) => ({
    key,
    label: STYLES[key].l,
    fillColor: getSplitSeriesColors(key).fill,
    borderColor: getSplitSeriesColors(key).border,
    series: convertSeriesForKey(key),
    isNew: NEW_GENERATION_KEYS.includes(key),
  }));

  const combinedSeries = {
    existingPower: sumSeries([
      convertSeriesForKey('nuke'),
      convertSeriesForKey('gasBase'),
      convertSeriesForKey('gasPeak'),
      convertSeriesForKey('coal'),
      convertSeriesForKey('exWind'),
      convertSeriesForKey('exSolar'),
    ]),
    newGeneration: sumSeries([
      convertSeriesForKey('newWind'),
      convertSeriesForKey('distSolar'),
      convertSeriesForKey('newSolar'),
      convertSeriesForKey('geo'),
    ]),
    gap: convertSeriesForKey('gap'),
  };
  const combinedEntries = MIX_COMBINED_KEYS.map((key) => ({
    key,
    label: key === 'gap' ? STYLES.gap.l : powerGroupStyles[key].l,
    fillColor: key === 'gap' ? STYLES.gap.c : powerGroupStyles[key].fill,
    borderColor: key === 'gap' ? STYLES.gap.c : powerGroupStyles[key].border,
    series: combinedSeries[key],
    isNew: key === 'newGeneration',
  }));

  const entries = (splitByType ? splitEntries : combinedEntries).filter((entry) => !(showMw && entry.key === 'gap'));
  const ctx = mixChartInstance ? mixChartInstance.ctx : document.getElementById('mixChart').getContext('2d');
  const datasets = entries.map((entry) => {
    const isGap = entry.key === 'gap';
    const useHatch = entry.isNew;
    const fillColor = entry.fillColor;
    const baseBorderColor = entry.borderColor;
    const oldNewBoundaryColor = splitByType
      ? getOldNewBoundaryColor(entry.key)
      : (entry.key === 'existingPower' ? getHatchStripeColor(powerGroupStyles.newGeneration.fill, 'newGeneration') : null);
    const borderColor = oldNewBoundaryColor || baseBorderColor;
    const combinedGroupBorder = !splitByType && entry.key === 'newGeneration';
    const splitBorderWidth = splitByType && SPLIT_OUTER_BORDER_KEYS.has(entry.key) ? 1 : 0;
    const oldNewBoundaryWidth = oldNewBoundaryColor ? 1 : 0;
    return {
      label: entry.label,
      data: entry.series,
      backgroundColor: isGap
        ? createVerticalStripePattern(ctx, gapDeficitColors.fillHex)
        : useHatch
          ? createCrosshatchPattern(ctx, fillColor, entry.key)
          : hexToRgba(fillColor, MIX_FILL_ALPHA),
      borderColor: isGap
        ? gapDeficitColors.border
        : useHatch
          ? borderColor
          : borderColor,
      borderWidth: combinedGroupBorder ? 1 : Math.max(splitBorderWidth, oldNewBoundaryWidth),
      fill: true,
      stack: 'stack0',
      tension: lineTension,
      cubicInterpolationMode: useSeasonal ? 'monotone' : 'default',
      pointRadius: 0,
      hoverPointRadius: 0,
      pointHitRadius: 20,
      order: isGap ? 2 : 1,
      pointStyle: 'rect',
      hidden: showMw && isGap,
    };
  });

  if (!showMw) {
    datasets.push({
      label: 'Usage',
      data: convertLoad(seriesByKey.load ?? Array(pointCount).fill(0)),
      backgroundColor: 'transparent',
      borderColor: '#000',
      borderWidth: 2,
      fill: false,
      tension: lineTension,
      cubicInterpolationMode: useSeasonal ? 'monotone' : 'default',
      pointRadius: 0,
      hoverPointRadius: 0,
      pointHitRadius: 12,
      stack: 'usageOverlay',
      order: -100,
      pointStyle: 'line',
      hidden: false,
    });
  }
  const usageForMargin = convertLoad(seriesByKey.load ?? Array(pointCount).fill(0));
  datasets.push({
    label: `Target Supply (${Math.round(marginGoal)}% Margin)`,
    data: usageForMargin.map((v) => v * (1 + marginGoal / 100)),
    backgroundColor: 'transparent',
    borderColor: '#6b7280',
    borderWidth: 1,
    borderDash: [6, 4],
    fill: false,
    tension: lineTension,
    cubicInterpolationMode: useSeasonal ? 'monotone' : 'default',
    pointRadius: 0,
    hoverPointRadius: 0,
    pointHitRadius: 12,
    stack: 'targetOverlay',
    order: -90,
    pointStyle: 'line',
    hidden: false,
  });

  const expectedDatasets = entries.length + (showMw ? 1 : 2);
  if (mixChartInstance && mixChartInstance.data.datasets.length !== expectedDatasets) {
    mixChartInstance.destroy();
    mixChartInstance = null;
  }

  if (mixChartInstance) {
    mixChartInstance.data.labels = labels;
    mixChartInstance.data.datasets = datasets;
    mixChartInstance.options.plugins.tooltip.enabled = hoverEnabled;
    mixChartInstance.options.plugins.tooltip.callbacks.title = (items) => (items?.length ? labels[items[0].dataIndex] : '');
    mixChartInstance.options.plugins.tooltip.callbacks.label = (item) => `${item.dataset.label}: ${item.raw.toFixed(1)} ${unitLabel}`;
    const xTicks = mixChartInstance.options.scales.x.ticks;
    xTicks.maxRotation = 0;
    xTicks.minRotation = 0;
    if (useSeasonal) {
      xTicks.autoSkip = false;
      xTicks.callback = (value, index) => (index % SEASON_MONTHS.length === 0 ? String(BASE_YEAR + Math.floor(index / SEASON_MONTHS.length)) : '');
    } else {
      xTicks.autoSkip = true;
      delete xTicks.callback;
    }
    mixChartInstance.options.scales.y.max = yMax;
    mixChartInstance.options.scales.y.title.text = unitLabel;
    mixChartInstance.update('none');
    return;
  }

  mixChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        filler: { drawTime: 'beforeDatasetsDraw' },
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true },
        },
        tooltip: {
          enabled: hoverEnabled,
          callbacks: {
            title: (items) => (items?.length ? labels[items[0].dataIndex] : ''),
            label: (item) => `${item.dataset.label}: ${item.raw.toFixed(1)} ${unitLabel}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: useSeasonal
            ? {
              maxRotation: 0,
              minRotation: 0,
              autoSkip: false,
              callback: (value, index) => (index % SEASON_MONTHS.length === 0 ? String(BASE_YEAR + Math.floor(index / SEASON_MONTHS.length)) : ''),
            }
            : {
              maxRotation: 0,
              minRotation: 0,
              autoSkip: true,
            },
        },
        y: {
          stacked: true,
          min: 0,
          max: yMax,
          title: { display: true, text: unitLabel },
        },
      },
    },
  });
}

/**
 * Builds or updates the monthly 2035 seasonality chart (average MW by month).
 * Uses the same fill/hatch style logic as the other stacked charts.
 */
function drawSeasonality(twh35, loadTwh2035, hoverEnabled, splitByType, marginGoalPct = 15) {
  const toAvgMw = (twh) => (twh * MWH_PER_TWH) / HOURS_PER_YEAR;
  const marginGoal = Number.isFinite(marginGoalPct) ? marginGoalPct : 0;
  const loadAvgMw = toAvgMw(loadTwh2035);
  const usageMonthly = LOAD_SEASONAL_PROFILE.map((f) => loadAvgMw * f);
  const targetMonthly = usageMonthly.map((v) => v * (1 + marginGoal / 100));
  const monthCount = SEASON_MONTHS.length;
  const isSplitByType = typeof splitByType === 'boolean' ? splitByType : document.getElementById('rel_stack_by_type').checked;
  const gapDeficitColors = getGapDeficitColors();
  const powerGroupStyles = getPowerGroupStyles();
  const flatProfile = Array(monthCount).fill(1);
  const getProfileForKey = (key) => {
    if (key === 'exWind' || key === 'newWind') return WIND_SEASONAL_PROFILE;
    if (key === 'exSolar' || key === 'newSolar' || key === 'distSolar') return SOLAR_SEASONAL_PROFILE;
    return flatProfile;
  };

  const seasonKeysNoGap = ['nuke', 'gasBase', 'gasPeak', 'coal', 'geo', 'exWind', 'newWind', 'exSolar', 'newSolar', 'distSolar'];
  const seasonalSeries = {};
  seasonKeysNoGap.forEach((key) => {
    const annualAvgMw = toAvgMw(twh35[key] ?? 0);
    const profile = getProfileForKey(key);
    seasonalSeries[key] = profile.map((f) => annualAvgMw * f);
  });
  seasonalSeries.gap = Array.from({ length: monthCount }, (_, i) => {
    const supplyNoGap = seasonKeysNoGap.reduce((sum, key) => sum + (seasonalSeries[key][i] ?? 0), 0);
    return Math.max(0, usageMonthly[i] - supplyNoGap);
  });

  const splitEntries = MIX_SPLIT_KEYS.map((key) => ({
    key,
    label: STYLES[key].l,
    fillColor: getSplitSeriesColors(key).fill,
    borderColor: getSplitSeriesColors(key).border,
    series: seasonalSeries[key] ?? Array(monthCount).fill(0),
    isNew: NEW_GENERATION_KEYS.includes(key),
  }));
  const combinedEntries = MIX_COMBINED_KEYS.map((key) => {
    const series = key === 'existingPower'
      ? Array.from({ length: monthCount }, (_, i) =>
        (seasonalSeries.nuke[i] ?? 0) +
        (seasonalSeries.gasBase[i] ?? 0) +
        (seasonalSeries.gasPeak[i] ?? 0) +
        (seasonalSeries.coal[i] ?? 0) +
        (seasonalSeries.exWind[i] ?? 0) +
        (seasonalSeries.exSolar[i] ?? 0))
      : key === 'newGeneration'
        ? Array.from({ length: monthCount }, (_, i) =>
          (seasonalSeries.newWind[i] ?? 0) +
          (seasonalSeries.distSolar[i] ?? 0) +
          (seasonalSeries.newSolar[i] ?? 0) +
          (seasonalSeries.geo[i] ?? 0))
        : (seasonalSeries.gap ?? Array(monthCount).fill(0));
    return {
      key,
      label: key === 'gap' ? STYLES.gap.l : powerGroupStyles[key].l,
      fillColor: key === 'gap' ? STYLES.gap.c : powerGroupStyles[key].fill,
      borderColor: key === 'gap' ? STYLES.gap.c : powerGroupStyles[key].border,
      series,
      isNew: key === 'newGeneration',
    };
  });

  const entries = isSplitByType ? splitEntries : combinedEntries;

  const ctx = seasonChartInstance ? seasonChartInstance.ctx : document.getElementById('seasonChart').getContext('2d');
  const datasets = entries.map((entry) => {
    const isGap = entry.key === 'gap';
    const useHatch = entry.isNew;
    const fillColor = entry.fillColor;
    const baseBorderColor = entry.borderColor;
    const oldNewBoundaryColor = isSplitByType
      ? getOldNewBoundaryColor(entry.key)
      : (entry.key === 'existingPower' ? getHatchStripeColor(powerGroupStyles.newGeneration.fill, 'newGeneration') : null);
    const borderColor = oldNewBoundaryColor || baseBorderColor;
    const combinedGroupBorder = !isSplitByType && entry.key === 'newGeneration';
    const splitBorderWidth = isSplitByType && SPLIT_OUTER_BORDER_KEYS.has(entry.key) ? 1 : 0;
    const oldNewBoundaryWidth = oldNewBoundaryColor ? 1 : 0;
    return {
      label: entry.label,
      data: entry.series,
      backgroundColor: isGap
        ? createVerticalStripePattern(ctx, gapDeficitColors.fillHex)
        : useHatch
          ? createCrosshatchPattern(ctx, fillColor, entry.key)
          : hexToRgba(fillColor, 1),
      borderColor: isGap ? gapDeficitColors.border : borderColor,
      borderWidth: combinedGroupBorder ? 1 : Math.max(splitBorderWidth, oldNewBoundaryWidth),
      fill: true,
      stack: 'stack0',
      tension: REL_PLOT_TENSION,
      cubicInterpolationMode: 'monotone',
      pointRadius: 0,
      hoverPointRadius: 0,
      pointHitRadius: 16,
      order: isGap ? 2 : 1,
      pointStyle: 'rect',
    };
  });
  datasets.push({
    label: 'Usage (2035)',
    data: usageMonthly,
    backgroundColor: 'transparent',
    borderColor: '#111111',
    borderWidth: 2,
    fill: false,
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    hoverPointRadius: 0,
    pointHitRadius: 12,
    stack: 'usageOverlay',
    order: -100,
    pointStyle: 'line',
  });
  datasets.push({
    label: `Target Supply (${Math.round(marginGoal)}% Margin)`,
    data: targetMonthly,
    backgroundColor: 'transparent',
    borderColor: '#6b7280',
    borderWidth: 1,
    borderDash: [6, 4],
    fill: false,
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    hoverPointRadius: 0,
    pointHitRadius: 12,
    stack: 'targetOverlay',
    order: -90,
    pointStyle: 'line',
  });

  const monthlyStack = Array.from({ length: monthCount }, (_, i) => entries.reduce((sum, entry) => sum + (entry.series[i] ?? 0), 0));
  const yMaxRaw = Math.max(...usageMonthly, ...targetMonthly, ...monthlyStack);
  const yMax = Math.max(100, Math.ceil((yMaxRaw * 1.12) / 100) * 100);
  const expectedDatasets = entries.length + 2;
  if (seasonChartInstance && seasonChartInstance.data.datasets.length !== expectedDatasets) {
    seasonChartInstance.destroy();
    seasonChartInstance = null;
  }

  if (seasonChartInstance) {
    seasonChartInstance.data.labels = SEASON_MONTHS;
    seasonChartInstance.data.datasets = datasets;
    seasonChartInstance.options.plugins.tooltip.enabled = hoverEnabled;
    seasonChartInstance.options.scales.y.max = yMax;
    seasonChartInstance.update('none');
    return;
  }

  seasonChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: SEASON_MONTHS, datasets },
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
          enabled: hoverEnabled,
          callbacks: {
            label: (item) => `${item.dataset.label}: ${Math.round(item.raw)} MW`,
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
          max: yMax,
          title: { display: true, text: 'Monthly Avg MW' },
        },
      },
    },
  });
}

/** Battery color in reliability chart (matches sidebar Firm Battery swatch). */
const REL_BATT_COLOR = '#CE93D8';
const REL_PLOT_TENSION = 0.22;

/** Reliability chart stack order in split-by-resource mode. */
const REL_STACK_ORDER = [
  { simKey: 'nuke', styleKey: 'nuke' },
  { simKey: 'coal', styleKey: 'coal' },
  { simKey: 'gasBase', styleKey: 'gasBase' },
  { simKey: 'geo', styleKey: 'geo' },
  { simKey: 'exWind', styleKey: 'exWind' },
  { simKey: 'newWind', styleKey: 'newWind' },
  { simKey: 'exSolar', styleKey: 'exSolar' },
  { simKey: 'newSolar', styleKey: 'newSolar' },
  { simKey: 'distSolar', styleKey: 'distSolar' },
  { simKey: 'peaker', styleKey: 'gasPeak' },
];

/**
 * Builds or updates the 24-hour reliability chart.
 * Split mode: supply stacked by resource type (existing/new ordered together by type).
 * Combined mode: supply grouped into Existing Power + New Generation, plus battery/deficit/load overlays.
 *
 * @param {{ sim: { load, supply, supplyNoBatt, nuke, gasBase, coal, geo, exSolar, exWind, newSolar, distSolar, newWind, peaker, discharge }, risk: number }} rel - Result from runReliability().
 */
function drawRel(rel, hoverEnabled, splitByType, marginGoalPct) {
  const stepCount = rel.sim.load?.length ?? REL_STEPS_PER_DAY;
  const labels = Array.from({ length: stepCount }, (_, i) => (i % REL_INTERVALS_PER_HOUR === 0 ? hourToTimeOfDay(i / REL_INTERVALS_PER_HOUR) : ''));
  const loadSeries = rel.sim.load ?? Array(stepCount).fill(0);
  const targetSupply = loadSeries.map((l) => l * (1 + (Number.isFinite(marginGoalPct) ? marginGoalPct : 0) / 100));
  const gapDeficitColors = getGapDeficitColors();
  const batteryFill = getShadedFillColor(REL_BATT_COLOR);
  const batteryBorder = getShadedBorderColor(REL_BATT_COLOR);
  const powerGroupStyles = getPowerGroupStyles();
  const stackByType = typeof splitByType === 'boolean' ? splitByType : document.getElementById('rel_stack_by_type').checked;
  const ctx = relChartInstance ? relChartInstance.ctx : document.getElementById('relChart').getContext('2d');
  const expectedDatasets = stackByType ? REL_STACK_ORDER.length + 4 : 6;
  if (relChartInstance && relChartInstance.data.datasets.length !== expectedDatasets) {
    relChartInstance.destroy();
    relChartInstance = null;
  }

  const batteryDataset = {
    label: 'Battery',
    data: rel.sim.discharge ?? Array(stepCount).fill(0),
    backgroundColor: hexToRgba(batteryFill, 1),
    borderColor: batteryBorder,
    borderWidth: 0,
    fill: true,
    stack: 'area',
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    pointStyle: 'rect',
    order: 1,
  };
  const deficitDataset = {
    label: 'Deficit',
    data: loadSeries,
    backgroundColor: createVerticalStripePattern(ctx, gapDeficitColors.fillHex),
    borderColor: gapDeficitColors.border,
    borderWidth: 0,
    fill: true,
    stack: 'deficitBackdrop',
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    pointStyle: 'rect',
    order: 5,
  };
  const loadDataset = {
    label: 'Usage',
    data: loadSeries,
    backgroundColor: 'transparent',
    borderColor: '#000',
    borderWidth: 3,
    fill: false,
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    stack: 'usageOverlay',
    pointStyle: 'line',
    order: -100,
  };
  const targetMarginDataset = {
    label: `Target Supply (${Math.round(Number.isFinite(marginGoalPct) ? marginGoalPct : 0)}% Margin)`,
    data: targetSupply,
    backgroundColor: 'transparent',
    borderColor: '#6b7280',
    borderWidth: 1,
    borderDash: [6, 4],
    fill: false,
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    stack: 'targetOverlay',
    pointStyle: 'line',
    order: -90,
  };

  const datasets = stackByType
    ? [
      deficitDataset,
      ...REL_STACK_ORDER.map(({ simKey, styleKey }) => {
        const isNew = NEW_GENERATION_KEYS.includes(styleKey);
        const splitColors = getSplitSeriesColors(styleKey);
        const oldNewBoundaryColor = getOldNewBoundaryColor(styleKey);
        const splitBorderWidth = SPLIT_OUTER_BORDER_KEYS.has(styleKey) ? 1 : 0;
        return {
          label: STYLES[styleKey].l,
          data: rel.sim[simKey] ?? Array(stepCount).fill(0),
          backgroundColor: isNew ? createCrosshatchPattern(ctx, splitColors.fill, styleKey) : hexToRgba(splitColors.fill, 1),
          borderColor: oldNewBoundaryColor || splitColors.border,
          borderWidth: oldNewBoundaryColor ? 1 : splitBorderWidth,
          fill: true,
          stack: 'area',
          tension: REL_PLOT_TENSION,
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointStyle: 'rect',
          order: 1,
        };
      }),
      batteryDataset,
      targetMarginDataset,
      loadDataset,
    ]
    : (() => {
      const existingPower = Array.from({ length: stepCount }, (_, i) =>
        (rel.sim.nuke[i] ?? 0) +
        (rel.sim.coal[i] ?? 0) +
        (rel.sim.gasBase[i] ?? 0) +
        (rel.sim.peaker[i] ?? 0) +
        (rel.sim.exWind[i] ?? 0) +
        (rel.sim.exSolar[i] ?? 0)
      );
      const newGeneration = Array.from({ length: stepCount }, (_, i) =>
        (rel.sim.newWind[i] ?? 0) +
        (rel.sim.distSolar[i] ?? 0) +
        (rel.sim.newSolar[i] ?? 0) +
        (rel.sim.geo[i] ?? 0)
      );
      return [
        {
          label: powerGroupStyles.existingPower.l,
          data: existingPower,
          backgroundColor: hexToRgba(powerGroupStyles.existingPower.fill, 1),
          borderColor: getHatchStripeColor(powerGroupStyles.newGeneration.fill, 'newGeneration'),
          borderWidth: 1,
          fill: true,
          stack: 'area',
          tension: REL_PLOT_TENSION,
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointStyle: 'rect',
          order: 1,
        },
        {
          label: powerGroupStyles.newGeneration.l,
          data: newGeneration,
          backgroundColor: createCrosshatchPattern(ctx, powerGroupStyles.newGeneration.fill),
          borderColor: powerGroupStyles.newGeneration.border,
          borderWidth: 1,
          fill: true,
          stack: 'area',
          tension: REL_PLOT_TENSION,
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointStyle: 'rect',
          order: 1,
        },
        deficitDataset,
        batteryDataset,
        targetMarginDataset,
        loadDataset,
      ];
    })();

  if (relChartInstance) {
    relChartInstance.data.labels = labels;
    relChartInstance.data.datasets = datasets;
    relChartInstance.options.plugins.tooltip.enabled = hoverEnabled;
    relChartInstance.update('none');
  } else {
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
            enabled: hoverEnabled,
            callbacks: {
              title: (items) => (items?.length ? stepToTimeOfDay(items[0].dataIndex) : ''),
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

  document.getElementById('k_risk').textContent = Number.isInteger(rel.risk)
    ? String(rel.risk)
    : rel.risk.toFixed(2).replace(/\.?0+$/, '');
  document.getElementById('risk_card').className = rel.risk > 0 ? 'kpi warn-bg' : 'kpi good-bg';
}

/** Default slider values (used by reset). */
const DEFAULT_INPUTS = {
  p_tx: 40,
  p_nuke: 430,
  p_wind: 1631,
  p_solar: 967,
  p_dist_solar: 188,
  p_geo: 0,
  p_batt: 500,
  p_gas_base: 300,
  p_gas_peak: 200,
  p_coal: 0,
  p_ee: 0,
  p_dr: 0,
  p_growth: 1.5,
  p_graph_shade: DEFAULT_GRAPH_SHADE,
  p_line_sep: DEFAULT_LINE_SEPARATION,
  p_hatch_width: DEFAULT_HATCH_WIDTH,
  p_hatch_strength: DEFAULT_HATCH_STRENGTH,
  p_panel_rounding: DEFAULT_PANEL_ROUNDING,
  p_panel_shadow: DEFAULT_PANEL_SHADOW,
  p_margin_goal: 15,
  p_graph_hover: true,
  mix_units_mw: false,
  mix_include_seasonal: false,
};

/** Draw default-position marker ticks on slider tracks. */
function initSliderDefaultMarkers() {
  document.querySelectorAll('input[type="range"][data-default]').forEach((input) => {
    const wrap = input.closest('.slider-wrap');
    if (!wrap) return;
    const min = Number(input.min ?? 0);
    const max = Number(input.max ?? 100);
    const defaultVal = Number(input.dataset.default);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(defaultVal) || max <= min) return;
    const ratio = (defaultVal - min) / (max - min);
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    wrap.classList.add('with-default-marker');
    wrap.style.setProperty('--default-ratio', clampedRatio.toString());
  });
}

/** Snap range sliders to their default value when close. */
function maybeSnapToDefault(input) {
  if (input?.dataset?.snap === 'false') return;
  if (!input || input.type !== 'range' || !input.dataset.default) return;
  const min = Number(input.min ?? 0);
  const max = Number(input.max ?? 100);
  const currentVal = Number(input.value);
  const defaultVal = Number(input.dataset.default);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(currentVal) || !Number.isFinite(defaultVal) || max <= min) return;

  const stepRaw = Number(input.step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : (max - min) / 100;
  const snapThreshold = Math.max(step * 4, (max - min) * 0.004);
  if (Math.abs(currentVal - defaultVal) > snapThreshold || currentVal === defaultVal) return;

  input.value = String(defaultVal);
}

/** Restore all inputs to defaults and refresh. */
function resetInputs() {
  Object.entries(DEFAULT_INPUTS).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = value;
    }
  });
  update();
}

/**
 * Returns the minimum supply margin % (worst hour) for the given inputs. Used by autoSolve to find a mix that hits the margin goal.
 * Uses same getReliabilityArgs → runReliability as the chart so battery and all logic are identical.
 */
function getMinMarginPct(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct) {
  const rel = runReliability(...getReliabilityArgs(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct));
  let marginPct = 0;
  for (let h = 0; h < rel.sim.load.length; h++) {
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
function totalCostForBuild(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, tx, marginGoalPct) {
  const { twh35 } = getTwh2035(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, gasBase, gasPeak, coal, ee, dr, growth);
  const rel = runReliability(...getReliabilityArgs(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, marginGoalPct));
  const peakerUsageTwh35 = getAnnualizedPeakerTwhFromReliability(rel);
  const costTwh35 = { ...twh35, gasPeak: peakerUsageTwh35 };
  const remoteKeys = new Set(['nuke', 'coal', 'exWind', 'exSolar', 'newWind', 'newSolar', 'gap']);
  let genCostM = 0;

  Object.entries(costTwh35).forEach(([k, vol]) => {
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
  const nukeMW = +document.getElementById('p_nuke').value;
  const distSolarTargetMw = +document.getElementById('p_dist_solar').value;
  const gasBase = +document.getElementById('p_gas_base').value;
  const gasPeak = +document.getElementById('p_gas_peak').value;
  const coal = +document.getElementById('p_coal').value;
  const ee = +document.getElementById('p_ee').value;
  const dr = +document.getElementById('p_dr').value;
  const growth = +document.getElementById('p_growth').value;
  const tx = +document.getElementById('p_tx').value;
  const goal = +document.getElementById('p_margin_goal').value;
  let best = { totalCostM: Infinity, windTargetMw: DEFAULT_INPUTS.p_wind, solarTargetMw: DEFAULT_INPUTS.p_solar, geoTargetMw: DEFAULT_INPUTS.p_geo, batt: 0 };

  const exWind2035 = (EXISTING_WIND_TWH[YEARS - 1] * 1e6) / (8760 * CF.wind);
  const exSolar2035 = (EXISTING_SOLAR_TWH[YEARS - 1] * 1e6) / (8760 * CF.solar);
  const solarFactorSum2035 = getSolarDegradationSumForYearIndex(YEARS - 1);

  const WIND_ANNUAL_VALS = Array.from({ length: 11 }, (_, i) => i * 40);
  const SOLAR_ANNUAL_VALS = Array.from({ length: 11 }, (_, i) => i * 40);
  const WIND_TARGETS = WIND_ANNUAL_VALS.map((annual) => Math.round(exWind2035 + annual * BUILD_YRS_TOTAL));
  const SOLAR_TARGETS = SOLAR_ANNUAL_VALS.map((annual) => Math.round(exSolar2035 + annual * solarFactorSum2035));
  const GEO_ANNUAL_VALS = Array.from({ length: 9 }, (_, i) => i * 50);
  const GEO_TARGETS = GEO_ANNUAL_VALS.map((annual) => Math.round(annual * BUILD_YRS_TOTAL));
  const BATTERY_VALS = [...Array.from({ length: 13 }, (_, i) => i * 200), 2500];

  for (const windTargetMw of WIND_TARGETS) {
    for (const solarTargetMw of SOLAR_TARGETS) {
      for (const geoTargetMw of GEO_TARGETS) {
        for (const batt of BATTERY_VALS) {
          const minMarginPct = getMinMarginPct(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, goal);
          if (minMarginPct + 1e-9 < goal) continue;

          const totalCostM = totalCostForBuild(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, gasBase, gasPeak, coal, ee, dr, growth, tx, goal);
          if (totalCostM < best.totalCostM) best = { totalCostM, windTargetMw, solarTargetMw, geoTargetMw, batt };
        }
      }
    }
  }

  if (best.totalCostM === Infinity) best = { windTargetMw: Math.round(exWind2035), solarTargetMw: Math.round(exSolar2035), geoTargetMw: 0, batt: 0, totalCostM: 0 };

  document.getElementById('p_wind').value = best.windTargetMw;
  document.getElementById('p_solar').value = best.solarTargetMw;
  document.getElementById('p_geo').value = best.geoTargetMw;
  document.getElementById('p_batt').value = best.batt;
  update();
}
// --- Init (runs when script loads; DOM ready because script is at end of body) ---
document.querySelectorAll('input').forEach((input) => {
  input.oninput = () => {
    maybeSnapToDefault(input);
    update();
  };
});
window.addEventListener('load', () => {
  initSliderDefaultMarkers();
  update();
});

