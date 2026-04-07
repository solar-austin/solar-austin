/**
 * Austin Energy Dashboard — model and charts for generation mix, reliability, and cost.
 * Reads slider inputs, builds 11-year supply/load data, and draws the mix stack and 24h reliability chart.
 */

/** Number of years in the planning horizon (year 0 through year 10). */
const YEARS = 11;

/** First year of the planning horizon (year index 0). */
const BASE_YEAR = 2025;

/**
 * Annual MW-to-TWh scaling assumptions.
 * Wind value is sourced from NREL's 2024b ATB land-based wind page using the 2022 market-average
 * net capacity factor reference (37%) as a generic onshore-wind annual scaling anchor.
 * Remaining thermal and nuclear values are anchored to EIA 2024 annual capacity-factor tables:
 * - Coal: EIA Electric Power Monthly Table 6.07.A annual 2024 coal capacity factor -> 42.6%
 * - Gas baseload: EIA Electric Power Monthly Table 6.07.A annual 2024 natural-gas combined-cycle -> 60.5%
 * - Gas peaker: EIA Electric Power Monthly Table 6.07.A annual 2024 natural-gas gas-turbine -> 13.9%
 * - Nuclear: EIA Electric Power Annual Table 4.08.B annual 2024 nuclear -> 90.8%
 * - Geothermal: EIA Electric Power Annual Table 4.08.B annual 2024 geothermal -> 64.6%
 * - Biomass: recent Nacogdoches output proxy (~251 GWh over 105 MW in 2024) -> ~27.3%
 * Solar values are sourced from NREL PVWatts v8 for Austin, TX (queried 2026-03-21):
 * - Utility solar: one-axis tracking, NSRDB TMY 2020, losses 14%, DC/AC ratio 1.2, inverter efficiency 96%
 *   -> annual AC capacity factor 19.55%
 * - Local solar: fixed roof-mount proxy, tilt 20 deg, azimuth 180 deg, NSRDB TMY 2020, losses 14%,
 *   DC/AC ratio 1.2, inverter efficiency 96% -> annual AC capacity factor 16.85%
 */
const CF = { wind: 0.37, solar: 0.1955, distSolar: 0.1685, geo: 0.646, biomass: 0.273, gasBase: 0.605, gasPeak: 0.139, coal: 0.426, nuke: 0.908 };

/**
 * Default cost assumptions.
 * Generation defaults are mapped to midpoint values from Lazard's June 2025 LCOE+ v18.0 where the model has a close technology match.
 * Battery defaults are mapped to Lazard's June 2025 LCOS v10.0 utility-scale standalone 4-hour $/kW-year range midpoint.
 * EE / DR / gap remain explicit model assumptions rather than Lazard LCOE rows.
 */
const PRICES = { nuke: 34, biomass: 85, gasBase: 32, gasPeak: 109, coal: 73, ee: 25, dr: 25, exWind: 62, exSolar: 58, newWind: 62, newSolar: 58, distSolar: 99.1, geo: 100, batt: 238, distBatt: 0 };
const TCOS_OVERRIDES = {};
const DEFAULT_TCOS = 40;

// Cost units: vol (TWh) × price ($/MWh) → 1 TWh = 1e6 MWh, so cost ($) = vol × 1e6 × price, cost ($M) = vol × price.
const MWH_PER_TWH = 1e6;
const DOLLARS_PER_MILLION = 1e6;
const HOURS_PER_YEAR = 8760;
const AUSTIN_ENERGY_BASE_SUMMER_PEAK_MW = 3135;
const DIST_SOLAR_BASELINE_MW = 188;
const DEFAULT_GRAPH_SHADE = 10;
const DEFAULT_LINE_SEPARATION = 5;
const DEFAULT_HATCH_WIDTH = 1;
const DEFAULT_HATCH_STRENGTH = 50;
const DEFAULT_DEFICIT_STRIPE_WIDTH = 5;
const DEFAULT_PANEL_ROUNDING = 8;
const DEFAULT_PANEL_SHADOW = 50;
const FINANCIAL_TABLE_ZERO_CUTOFF_TWH = 0.000001;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHtml(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function setClassName(id, value) {
  const el = document.getElementById(id);
  if (el) el.className = value;
}

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

function getDeficitStripeWidth() {
  const raw = Number(document.getElementById('p_deficit_width')?.value);
  const px = Number.isFinite(raw) ? raw : DEFAULT_DEFICIT_STRIPE_WIDTH;
  return Math.max(1, Math.min(16, px));
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
  biomass: { c: '#6B8E23', l: 'Biomass' },
  gasBase: { c: '#90A4AE', l: 'Gas (Baseload)' },
  gasPeak: { c: '#607D8B', l: 'Gas (Peaker)' },
  imports: { c: '#E8C547', l: 'Import Allowance' },
  coal: { c: '#5D4037', l: 'Coal' },
  ee: { c: '#2dd4bf', l: 'Energy Efficiency' },
  dr: { c: '#14b8a6', l: 'Demand Response' },
  exWind: { c: '#B3E5FC', l: 'Existing Utility Wind' },   // light blue
  newWind: { c: '#4FC3F7', l: 'New Utility Wind' },     // dark blue (same hue)
  exSolar: { c: '#FFDDA0', l: 'Exist. Utility Solar' }, // light orange (same hue as New Solar)
  newSolar: { c: '#E09328', l: 'New Utility Solar' },   // strong orange (same hue)
  distSolar: { c: '#C9852F', l: 'Local Solar' },
  geo: { c: '#9A6346', l: 'New Geo' },
  gap: { c: '#E57373', l: 'Deficit' },
  surplus: { c: '#22c55e', l: 'Surplus Sales' },
  batt: { c: '#CE93D8', l: 'Utility-Scale Battery' },
  distBatt: { c: '#F3B6D9', l: 'Local Battery' },
};

function getResourceTcos(resourceKey, fallbackTcos = 0) {
  const input = document.getElementById(`tcos_${resourceKey}`);
  const parsed = input ? parseFloat(input.value) : Number.NaN;
  if (!Number.isNaN(parsed)) return parsed;
  if (TCOS_OVERRIDES[resourceKey] !== undefined) return TCOS_OVERRIDES[resourceKey];
  return fallbackTcos;
}

/** Stack order when split-by-resource is enabled on charts. */
const MIX_SPLIT_KEYS = ['nuke', 'biomass', 'gasBase', 'gasPeak', 'coal', 'geo', 'exWind', 'newWind', 'exSolar', 'newSolar', 'distSolar', 'imports', 'gap'];
const MIX_SPLIT_KEYS_NEW_ON_TOP = ['nuke', 'biomass', 'gasBase', 'gasPeak', 'coal', 'exWind', 'exSolar', 'geo', 'newWind', 'newSolar', 'distSolar', 'imports', 'gap'];

/** Top-chart grouping when split-by-resource is disabled. */
const MIX_COMBINED_KEYS = ['existingPower', 'newGeneration', 'gap'];

/**
 * 24-hour normalized profiles for the August peak reliability stress test.
 * Index = hour of day (0–23). Used to scale peak load and variable supply hour-by-hour.
 *
 * - load:  Relative demand by hour; 1.0 = peak (e.g. afternoon). Shapes the load curve.
 * - solar: Average August hourly solar availability as a fraction of nameplate MW.
 * - wind:  Average August hourly wind availability as a fraction of nameplate MW.
 */
/*
 * Source method (retrieved 2026-03-21):
 * - Load profile from ERCOT 2025 hourly native load archive:
 *   https://www.ercot.com/files/docs/2025/02/11/Native_Load_2025.zip
 * - Wind profile from ERCOT operational/planned wind profile workbook:
 *   https://www.ercot.com/files/docs/2022/12/19/ERCOT-OperationalPlanned-WindProfiles-2020-2021-CST-CDT.xlsx
 *   with site capacities from:
 *   https://www.ercot.com/files/docs/2022/12/19/ERCOT-WindProfiles-1980-2021-Key-public.xlsx
 * - Solar profile from ERCOT operational/planned solar profile workbook:
 *   https://www.ercot.com/files/docs/2022/12/19/ERCOT-OperationalPlanned-SolarPVProfiles-2020-2021-CST-CDT.xlsx
 *
 * Construction:
 * - Identify the top 10 August 2025 ERCOT peak-load days from the hourly load archive.
 * - Average each hour across those days for ERCOT load and normalize so its maximum equals 1.0.
 * - For wind, compute a weighted August average hourly availability fraction across ERCOT
 *   operational/planned wind sites for 2020-2021 by dividing hourly MW by modeled site capacity.
 * - For solar, compute a weighted August average hourly availability fraction across ERCOT
 *   operational/planned utility-scale solar sites for 2020-2021 by dividing hourly MW by modeled site capacity.
 *
 * Top 10 August 2025 peak-load days used:
 * 2025-08-18, 2025-08-28, 2025-08-14, 2025-08-08, 2025-08-25,
 * 2025-08-07, 2025-08-09, 2025-08-11, 2025-08-19, 2025-08-17
 */
const AUSTIN_LATITUDE_DEG = 30.2672;
const AUSTIN_LONGITUDE_DEG = -97.7431;
const SOLAR_PROFILE_EXPONENT = 0.62;
const REPRESENTATIVE_MONTH_DAY_OF_YEAR = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

function getSolarShapeFactor(dayOfYear, hourOfDay, latitudeDeg = AUSTIN_LATITUDE_DEG, longitudeDeg = AUSTIN_LONGITUDE_DEG, referenceLongitudeDeg = AUSTIN_LONGITUDE_DEG) {
  const latRad = (latitudeDeg * Math.PI) / 180;
  const dayAngle = (2 * Math.PI * (dayOfYear - 1)) / 365;
  const declinationRad = 0.006918
    - (0.399912 * Math.cos(dayAngle))
    + (0.070257 * Math.sin(dayAngle))
    - (0.006758 * Math.cos(2 * dayAngle))
    + (0.000907 * Math.sin(2 * dayAngle))
    - (0.002697 * Math.cos(3 * dayAngle))
    + (0.00148 * Math.sin(3 * dayAngle));
  // Shift solar noon by site longitude so the fleet curve broadens realistically across Texas.
  const solarTimeHour = hourOfDay + 0.5 + ((longitudeDeg - referenceLongitudeDeg) / 15);
  const hourAngleRad = ((solarTimeHour - 12) * Math.PI) / 12;
  const sinElevation = (
    (Math.sin(latRad) * Math.sin(declinationRad))
    + (Math.cos(latRad) * Math.cos(declinationRad) * Math.cos(hourAngleRad))
  );
  const clampedElevation = Math.max(0, sinElevation);
  return clampedElevation > 0 ? Math.pow(clampedElevation, SOLAR_PROFILE_EXPONENT) : 0;
}

function getAustinSolarShapeFactor(dayOfYear, hourOfDay) {
  return getSolarShapeFactor(dayOfYear, hourOfDay, AUSTIN_LATITUDE_DEG, AUSTIN_LONGITUDE_DEG, AUSTIN_LONGITUDE_DEG);
}

// Approximate site coordinates for Austin Energy's utility-scale solar assets.
// These are used only to capture clock-time spread across the portfolio in the 24-hour reliability curve.
const AE_UTILITY_SOLAR_SITES = [
  { name: 'Webberville Solar Project', mw: 30, lat: 30.23, lon: -97.51 },
  { name: 'Roserock', mw: 157.5, lat: 30.89, lon: -102.88 },
  { name: 'East Pecos (Bootleg)', mw: 118.5, lat: 31.10, lon: -102.28 },
  { name: 'Upton County (SPTX12B1)', mw: 157.5, lat: 31.10, lon: -102.06 },
  { name: 'Waymark', mw: 178.5, lat: 31.03, lon: -103.01 },
  { name: 'East Blacklands', mw: 144, lat: 30.47, lon: -97.55 },
  // Public project list does not expose a simple site coordinate here; use an Austin-centered fallback.
  { name: 'SE Aragon', mw: 180, lat: AUSTIN_LATITUDE_DEG, lon: AUSTIN_LONGITUDE_DEG },
];

function buildCapacityWeightedSolarProfile(dayOfYear, sites, referenceLongitudeDeg = AUSTIN_LONGITUDE_DEG) {
  const totalMw = sites.reduce((sum, site) => sum + Math.max(0, site.mw ?? 0), 0);
  if (!Number.isFinite(totalMw) || totalMw <= 0) return Array(24).fill(0);
  return Array.from({ length: 24 }, (_, h) => {
    const weighted = sites.reduce((sum, site) => (
      sum + (Math.max(0, site.mw ?? 0) * getSolarShapeFactor(dayOfYear, h, site.lat, site.lon, referenceLongitudeDeg))
    ), 0);
    return weighted / totalMw;
  });
}

const AUGUST_REPRESENTATIVE_DAY_OF_YEAR = REPRESENTATIVE_MONTH_DAY_OF_YEAR[7];
const AE_UTILITY_SOLAR_HOURLY_PROFILE = buildCapacityWeightedSolarProfile(AUGUST_REPRESENTATIVE_DAY_OF_YEAR, AE_UTILITY_SOLAR_SITES);

function buildAustinMonthlySolarProfile() {
  const monthEnergyProxy = REPRESENTATIVE_MONTH_DAY_OF_YEAR.map((dayOfYear) => (
    Array.from({ length: 24 }, (_, h) => getAustinSolarShapeFactor(dayOfYear, h))
      .reduce((sum, value) => sum + value, 0)
  ));
  return normalizeSeasonalProfile(monthEnergyProxy.map((value) => Number(value.toFixed(4))));
}

const PROF = {
  load: [0.7496, 0.7150, 0.6891, 0.6727, 0.6671, 0.6734, 0.6870, 0.6914, 0.7227, 0.7730, 0.8275, 0.8825, 0.9325, 0.9720, 0.9914, 0.9983, 1.0000, 0.9949, 0.9826, 0.9570, 0.9292, 0.8957, 0.8479, 0.7995],
  solar: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0903, 0.3815, 0.6666, 0.7824, 0.8196, 0.8145, 0.7978, 0.7811, 0.7575, 0.7125, 0.6360, 0.5121, 0.1125, 0.0, 0.0, 0.0],
  wind: [0.4462, 0.4253, 0.4031, 0.3841, 0.3633, 0.3442, 0.3280, 0.3055, 0.2576, 0.2605, 0.2718, 0.2487, 0.2330, 0.2375, 0.2448, 0.2514, 0.2572, 0.2804, 0.3078, 0.3311, 0.3579, 0.4048, 0.4423, 0.4577],
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
 * 2) Wind profile from 2025 monthly generation (GWh):
 *    https://www.ercot.com/files/docs/2025/02/07/IntGenbyFuel2025.xlsx
 *    (tab: Summary, rows Solar and Wind)
 * 3) Solar profile from the same Austin solar-geometry method used in the reliability chart:
 *    representative mid-month day for each month, summed over 24 hours, then normalized
 *    so the hours-weighted annual average equals 1.0.
 *
 * Method:
 * - Convert each month to average MW: (GWh * 1000) / hours_in_month
 * - Normalize by annual average MW to build dimensionless monthly factors.
 * - For solar, use Austin latitude plus representative monthly solar geometry instead of ERCOT
 *   actual generation, so the monthly and daily solar shapes are internally consistent.
 */
const LOAD_SEASONAL_PROFILE = normalizeSeasonalProfile([0.9751, 0.8965, 0.8295, 0.8962, 1.0063, 1.1469, 1.1453, 1.2233, 1.0884, 0.9942, 0.8879, 0.9010]);
const SOLAR_SEASONAL_PROFILE = buildAustinMonthlySolarProfile();
const WIND_SEASONAL_PROFILE = normalizeSeasonalProfile([0.9795, 1.0178, 1.2345, 1.2922, 0.9503, 1.1227, 0.9415, 0.7283, 0.7151, 0.9221, 1.0469, 1.0566]);
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function normalizeHourlyProfileToAverage(profile) {
  const avg = profile.reduce((sum, value) => sum + value, 0) / Math.max(1, profile.length);
  if (!Number.isFinite(avg) || avg <= 0) return profile.map(() => 0);
  return profile.map((value) => value / avg);
}

const LOAD_HOURLY_RESHAPE_PROFILE = normalizeHourlyProfileToAverage(PROF.load);
const WIND_HOURLY_RESHAPE_PROFILE = normalizeHourlyProfileToAverage(PROF.wind);
const SOLAR_HOURLY_RESHAPE_PROFILE = normalizeHourlyProfileToAverage(PROF.solar);
const ERCOT_LZ_AEN_DAM_2025_MONTH_HOUR_PRICES = [
  [27.11, 25.64, 25.61, 26.62, 28.32, 37.08, 53.83, 61.52, 41.77, 31.05, 26.46, 22.72, 20.99, 19.54, 18.29, 19.13, 26.31, 44.85, 48.88, 41.48, 37.72, 32.69, 29.42, 27.37],
  [28.06, 25.88, 25.57, 25.85, 28.69, 41.00, 72.23, 74.72, 45.12, 28.45, 23.42, 21.34, 19.42, 18.79, 18.07, 17.95, 21.20, 36.01, 48.35, 43.28, 41.58, 34.04, 31.37, 29.07],
  [29.95, 27.45, 26.46, 26.19, 27.98, 33.59, 41.04, 43.39, 31.31, 20.72, 17.48, 16.89, 17.06, 18.47, 20.33, 23.11, 25.86, 33.58, 50.47, 75.15, 62.37, 46.39, 37.17, 32.50],
  [29.41, 26.49, 24.96, 24.51, 25.89, 30.75, 36.24, 35.67, 24.47, 18.70, 16.70, 16.59, 17.87, 20.23, 24.53, 30.88, 38.21, 46.47, 58.52, 87.01, 83.08, 57.73, 43.88, 33.11],
  [29.89, 27.17, 25.54, 24.81, 25.25, 27.28, 30.83, 26.86, 20.92, 17.89, 17.83, 19.86, 23.54, 31.38, 38.86, 49.87, 58.43, 59.45, 70.00, 106.38, 100.77, 63.29, 43.18, 32.17],
  [27.96, 25.32, 23.78, 23.36, 23.98, 26.14, 27.21, 23.90, 19.03, 17.71, 18.75, 20.88, 24.17, 28.82, 32.55, 36.25, 39.67, 40.45, 46.46, 71.98, 75.97, 57.13, 40.54, 31.62],
  [29.41, 27.02, 25.25, 24.30, 24.60, 26.11, 27.52, 24.54, 20.42, 19.60, 20.89, 23.50, 27.57, 31.28, 35.09, 38.78, 42.43, 43.75, 53.78, 88.06, 92.69, 68.54, 43.43, 33.49],
  [30.13, 27.57, 26.20, 25.28, 25.65, 27.56, 30.74, 28.33, 21.86, 20.52, 22.60, 28.36, 40.10, 49.22, 57.12, 64.12, 68.62, 73.30, 89.60, 104.87, 94.42, 68.38, 46.13, 35.29],
  [26.74, 24.78, 23.58, 23.01, 23.37, 24.67, 27.25, 26.83, 20.62, 17.66, 18.40, 20.59, 26.26, 32.97, 39.57, 47.08, 52.16, 58.57, 76.45, 76.22, 57.97, 43.42, 33.96, 28.44],
  [28.87, 26.99, 25.96, 25.64, 25.81, 28.08, 32.16, 34.83, 25.06, 19.09, 19.38, 22.84, 29.05, 38.28, 46.56, 56.29, 61.07, 72.78, 86.89, 74.18, 53.47, 40.67, 33.66, 28.54],
  [31.35, 29.56, 29.03, 29.24, 30.70, 35.53, 39.22, 36.90, 25.61, 23.21, 23.44, 25.74, 29.50, 35.22, 40.09, 45.65, 73.64, 90.26, 72.24, 61.84, 50.00, 44.02, 40.50, 34.87],
  [34.78, 34.20, 33.29, 33.54, 36.21, 43.99, 52.07, 53.02, 39.66, 30.06, 27.09, 24.90, 22.80, 21.94, 21.59, 23.70, 38.11, 54.83, 52.45, 48.81, 45.21, 41.46, 38.81, 33.65],
];
const ERCOT_LZ_AEN_DAM_2025_AVG_PRICE = Math.round(
  ERCOT_LZ_AEN_DAM_2025_MONTH_HOUR_PRICES.reduce((sum, month) => sum + month.reduce((monthSum, price) => monthSum + price, 0), 0)
  / (ERCOT_LZ_AEN_DAM_2025_MONTH_HOUR_PRICES.length * ERCOT_LZ_AEN_DAM_2025_MONTH_HOUR_PRICES[0].length)
);
const MARKET_SHAPE_CELLS = DAYS_PER_MONTH.flatMap((days, monthIndex) => (
  Array.from({ length: 24 }, (_, hourIndex) => ({
    hours: days,
    loadFactor: (LOAD_SEASONAL_PROFILE[monthIndex] ?? 0) * (LOAD_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0),
    windFactor: (WIND_SEASONAL_PROFILE[monthIndex] ?? 0) * (WIND_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0),
    solarFactor: (SOLAR_SEASONAL_PROFILE[monthIndex] ?? 0) * (SOLAR_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0),
    marketPrice: ERCOT_LZ_AEN_DAM_2025_MONTH_HOUR_PRICES[monthIndex]?.[hourIndex] ?? 0,
  }))
));

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
function getReliabilityArgs(nukeMW, biomassMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, distBatt, gasBase, gasPeak, coal, ee, dr, importAllowance, growth, yearIndex, marginGoalPct) {
  const clampedYearIndex = Math.max(0, Math.min(YEARS - 1, yearIndex));
  const plan = getBuildPlanFromTargets(windTargetMw, solarTargetMw, distSolarTargetMw, YEARS - 1);
  const completedBuildYears = buildYearsByIndex(clampedYearIndex);
  const exSolarMW = (EXISTING_SOLAR_TWH[clampedYearIndex] * 1e6) / (8760 * CF.solar);
  const exWindMW = (EXISTING_WIND_TWH[clampedYearIndex] * 1e6) / (8760 * CF.wind);
  const newSolarMW = plan.solarAnnualMw * completedBuildYears;
  const newDistSolarMW = DIST_SOLAR_BASELINE_MW + (plan.distSolarAnnualMw * completedBuildYears);
  const newWindMW = plan.windAnnualMw * completedBuildYears;
  const geoMW = getAnnualBuildFromTarget(geoTargetMw, YEARS - 1) * completedBuildYears;
  const battAnnualMw = Math.max(0, batt - DEFAULT_INPUTS.p_batt) / BUILD_YRS_TOTAL;
  const distBattAnnualMw = Math.max(0, distBatt - DEFAULT_INPUTS.p_dist_batt) / BUILD_YRS_TOTAL;
  const battMW = DEFAULT_INPUTS.p_batt + (battAnnualMw * completedBuildYears);
  const distBattMW = DEFAULT_INPUTS.p_dist_batt + (distBattAnnualMw * completedBuildYears);
  return [
    nukeMW,
    biomassMW,
    exSolarMW,
    exWindMW,
    newSolarMW,
    newDistSolarMW,
    newWindMW,
    geoMW,
    gasBase,
    gasPeak,
    coal,
    ee,
    dr,
    importAllowance,
    battMW,
    distBattMW,
    growth,
    clampedYearIndex,
    marginGoalPct,
  ];
}

/**
 * Reads slider values, recomputes 11-year supply/load and gap, updates KPIs and charts.
 */
function update() {
  const tx = DEFAULT_TCOS;
  const growth = +document.getElementById('p_growth').value;
  const marginGoalPct = +document.getElementById('p_margin_goal').value;
  const relYear = +(document.getElementById('p_rel_year')?.value ?? (BASE_YEAR + YEARS - 1));
  const relYearIndex = Math.max(0, Math.min(YEARS - 1, relYear - BASE_YEAR));
  const nukeMW = +document.getElementById('p_nuke').value;
  const biomassMW = +document.getElementById('p_biomass').value;
  const solarTargetMw = +document.getElementById('p_solar').value;
  const distSolarTargetMw = +document.getElementById('p_dist_solar').value;
  const windTargetMw = +document.getElementById('p_wind').value;
  const geoTargetMw = +document.getElementById('p_geo').value;
  const gasBase = +document.getElementById('p_gas_base').value;
  const gasPeak = +document.getElementById('p_gas_peak').value;
  const coal = +document.getElementById('p_coal').value;
  const ee = +document.getElementById('p_ee').value;
  const dr = +document.getElementById('p_dr').value;
  const importAllowance = +document.getElementById('p_import_allowance').value;
  const batt = +document.getElementById('p_batt').value;
  const distBatt = +document.getElementById('p_dist_batt').value;
  const graphHoverEnabled = document.getElementById('p_graph_hover').checked;
  const mixShowMw = document.getElementById('mix_units_mw').checked;
  const mixIncludeSeasonal = document.getElementById('mix_include_seasonal')?.checked ?? false;
  const showRiskHourBands = document.getElementById('p_show_risk_hours')?.checked ?? true;
  const splitByType = document.getElementById('rel_stack_by_type').checked;
  const showNewPowerTogether = document.getElementById('show_new_power_together')?.checked ?? false;
  const graphShade = +document.getElementById('p_graph_shade').value;
  const lineSep = +document.getElementById('p_line_sep').value;
  const hatchWidth = +document.getElementById('p_hatch_width').value;
  const hatchStrength = +document.getElementById('p_hatch_strength').value;
  const deficitWidth = +document.getElementById('p_deficit_width').value;
  const panelRounding = +document.getElementById('p_panel_rounding').value;
  const panelShadow = +document.getElementById('p_panel_shadow').value;
  const scenarioAction = document.getElementById('p_scenario_action')?.value ?? 'reliability-gap';
  const queueMarkerRefresh = () => {
    refreshSliderDefaultMarkers();
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(refreshSliderDefaultMarkers);
    }
  };
  document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);

  const buildPlan = getBuildPlanFromTargets(windTargetMw, solarTargetMw, distSolarTargetMw, YEARS - 1);
  const geoAnnualMw = getAnnualBuildFromTarget(geoTargetMw, YEARS - 1);
  const solarMw2035 = buildPlan.newSolarMw2035;
  const distSolarMw2035 = buildPlan.distSolarMw2035;
  const exWindMw2035 = buildPlan.exWindMw2035;
  const exSolarMw2035 = buildPlan.exSolarMw2035;
  const geoMw2035 = geoTargetMw;
  const totalBuildLabel = (mwTotal) => `${mwTotal >= 0 ? '+' : ''}${Math.round(mwTotal)} MW total`;
  const annualBuildLabel = (mwPerYear) => `${mwPerYear >= 0 ? '+' : ''}${Math.round(mwPerYear)} MW/yr`;
  const nukeTotalDelta = nukeMW - DEFAULT_INPUTS.p_nuke;
  const biomassTotalDelta = biomassMW - DEFAULT_INPUTS.p_biomass;
  const gasBaseTotalDelta = gasBase - DEFAULT_INPUTS.p_gas_base;
  const gasPeakTotalDelta = gasPeak - DEFAULT_INPUTS.p_gas_peak;
  const coalTotalDelta = coal - DEFAULT_INPUTS.p_coal;

  setText('v_growth', growth + '%');
  setText('v_market_sale', '$' + ERCOT_LZ_AEN_DAM_2025_AVG_PRICE);
  setText('v_graph_shade', graphShade + '%');
  setText('v_line_sep', lineSep + ' px');
  setText('v_hatch_width', hatchWidth + ' px');
  setText('v_hatch_strength', hatchStrength + '%');
  setText('v_deficit_width', deficitWidth + ' px');
  setText('v_panel_rounding', panelRounding + ' px');
  setText('v_panel_shadow', panelShadow + '%');
  setText('v_margin_goal', marginGoalPct + '%');
  const relYearLabel = document.getElementById('rel_year_lbl');
  if (relYearLabel) relYearLabel.textContent = String(BASE_YEAR + relYearIndex);
  const seasonYearLabel = document.getElementById('season_year_lbl');
  if (seasonYearLabel) seasonYearLabel.textContent = String(BASE_YEAR + relYearIndex);
  const scenarioDesc = document.getElementById('scenario_action_desc');
  if (scenarioDesc) scenarioDesc.textContent = SCENARIO_DESCRIPTIONS[scenarioAction] ?? '';
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--panel-radius', `${Math.max(0, panelRounding)}px`);
  const clampedShadow = Math.max(0, Math.min(100, panelShadow));
  rootStyle.setProperty('--panel-shadow-y', `${((clampedShadow / 100) * 2).toFixed(2)}px`);
  rootStyle.setProperty('--panel-shadow-blur', `${((clampedShadow / 100) * 8).toFixed(2)}px`);
  rootStyle.setProperty('--panel-shadow-alpha', ((clampedShadow / 100) * 0.2).toFixed(3));
  setHtml('v_nuke', `${nukeMW} MW<span class="val-total">${totalBuildLabel(nukeTotalDelta)}</span>`);
  setHtml('v_biomass', `${biomassMW} MW<span class="val-total">${totalBuildLabel(biomassTotalDelta)}</span>`);
  setHtml('v_solar', `${solarTargetMw} MW<span class="val-total">${annualBuildLabel(buildPlan.solarAnnualMw)}</span>`);
  setHtml('v_dist_solar', `${distSolarTargetMw} MW<span class="val-total">${annualBuildLabel(buildPlan.distSolarAnnualMw)}</span>`);
  setHtml('v_wind', `${windTargetMw} MW<span class="val-total">${annualBuildLabel(buildPlan.windAnnualMw)}</span>`);
  setHtml('v_geo', `${geoTargetMw} MW<span class="val-total">${annualBuildLabel(geoAnnualMw)}</span>`);
  setHtml('v_gas_base', `${gasBase} MW<span class="val-total">${totalBuildLabel(gasBaseTotalDelta)}</span>`);
  setHtml('v_gas_peak', `${gasPeak} MW<span class="val-total">${totalBuildLabel(gasPeakTotalDelta)}</span>`);
  setHtml('v_coal', `${coal} MW<span class="val-total">${totalBuildLabel(coalTotalDelta)}</span>`);
  setText('v_ee', ee + ' MW');
  setText('v_dr', dr + ' MW');
  setText('v_import_allowance', importAllowance + ' MW');
  setHtml('v_batt', `${batt} MW<span class="val-total">${annualBuildLabel(Math.max(0, batt - DEFAULT_INPUTS.p_batt) / BUILD_YRS_TOTAL)}</span>`);
  setHtml('v_dist_batt', `${distBatt} MW<span class="val-total">${annualBuildLabel(Math.max(0, distBatt - DEFAULT_INPUTS.p_dist_batt) / BUILD_YRS_TOTAL)}</span>`);
  const data = { nuke: [], biomass: [], gasBase: [], gasPeak: [], coal: [], exWind: [], exSolar: [], geo: [], newWind: [], newSolar: [], distSolar: [], ee: [], dr: [], imports: [], gap: [], surplus: [], load: [] };
  const importAllowanceTwhCap = (Math.max(0, importAllowance) * HOURS_PER_YEAR) / MWH_PER_TWH;
  const defaultBuildPlan = getBuildPlanFromTargets(DEFAULT_INPUTS.p_wind, DEFAULT_INPUTS.p_solar, DEFAULT_INPUTS.p_dist_solar, YEARS - 1);
  const defaultGeoAnnualMw = getAnnualBuildFromTarget(DEFAULT_INPUTS.p_geo, YEARS - 1);
  const startTwh = {
    nuke: nukeMwToTwh(DEFAULT_INPUTS.p_nuke),
    biomass: (DEFAULT_INPUTS.p_biomass * HOURS_PER_YEAR * CF.biomass) / 1e6,
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
    biomass: (biomassMW * HOURS_PER_YEAR * CF.biomass) / 1e6,
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
    const biomassTwh = lerp(startTwh.biomass, endTwh.biomass, blend);
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
    data.biomass.push(biomassTwh);
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

    const totalSup = nuke + biomassTwh + exW + exS + geoTwh + winTwh + solTwh + distSolTwh + gasBaseTwh + gasPeakTwh + coalTwh;
    const grossGapTwh = Math.max(0, yrLoad - totalSup);
    const importTwh = Math.min(grossGapTwh, importAllowanceTwhCap);
    data.imports.push(importTwh);
    data.gap.push(Math.max(0, grossGapTwh - importTwh));
    data.surplus.push(Math.max(0, totalSup - yrLoad));
  }

  const lastIdx = YEARS - 1;
  const total2035 = data.load[lastIdx];
  const totalSelectedYear = data.load[relYearIndex];

  setMixUnitsLabel(mixShowMw);
  drawMix(data, graphHoverEnabled, mixShowMw, splitByType, mixIncludeSeasonal, marginGoalPct, showNewPowerTogether);
  const reliabilityArgs = getReliabilityArgs(nukeMW, biomassMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, distBatt, gasBase, gasPeak, coal, ee, dr, importAllowance, growth, relYearIndex, marginGoalPct);
  const rel = runReliability(...reliabilityArgs);
  const peakerUsageTwh35 = getAnnualizedPeakerTwhFromReliability(rel);
  // Carbon Free Calculation (Excludes Gas and Deficit). Peaker is usage-based from reliability dispatch.
  const carbonSources = data.gasBase[lastIdx] + peakerUsageTwh35 + data.coal[lastIdx] + data.gap[lastIdx];
  const carbonFreePct = total2035 > 0 ? Math.max(0, ((total2035 - carbonSources) / total2035) * 100) : 0;
  setText('k_clean', carbonFreePct.toFixed(0) + '%');
  drawRel(rel, graphHoverEnabled, splitByType, marginGoalPct, showRiskHourBands, showNewPowerTogether);

  // Supply margin: minimum hourly (supply - load) / load as %, from reliability run
  let marginPct = 0;
  for (let h = 0; h < rel.sim.load.length; h++) {
    const l = rel.sim.load[h];
    if (l > 0) {
      const m = ((rel.sim.supply[h] - l) / l) * 100;
      if (h === 0 || m < marginPct) marginPct = m;
    }
  }
  setText('k_margin', Math.round(marginPct) + '%');
  const marginCard = document.getElementById('margin_card');
  if (marginCard) {
    const greenThreshold = marginGoalPct - 0.1; // green when at or above goal (safe for rounding)
    marginCard.className = marginPct < 0 ? 'kpi warn-bg' : marginPct < greenThreshold ? 'kpi caution-bg' : 'kpi good-bg';
  }

  // Financial Summary
  const twh35 = {
    nuke: data.nuke[lastIdx],
    biomass: data.biomass[lastIdx],
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
    surplus: data.surplus[lastIdx],
  };
  const yearTwh = {
    nuke: data.nuke[relYearIndex],
    biomass: data.biomass[relYearIndex],
    gasBase: data.gasBase[relYearIndex],
    gasPeak: getAnnualizedPeakerTwhFromReliability(rel),
    coal: data.coal[relYearIndex],
    ee: data.ee[relYearIndex],
    dr: data.dr[relYearIndex],
    exWind: data.exWind[relYearIndex],
    exSolar: data.exSolar[relYearIndex],
    geo: data.geo[relYearIndex],
    newWind: data.newWind[relYearIndex],
    newSolar: data.newSolar[relYearIndex],
    distSolar: data.distSolar[relYearIndex],
    gap: data.gap[relYearIndex],
    surplus: data.surplus[relYearIndex],
  };
  drawSeasonality(yearTwh, totalSelectedYear, graphHoverEnabled, splitByType, marginGoalPct, showNewPowerTogether);
  const marketShape2035 = estimateMarketShapeData(twh35, total2035);
  const totCostM = runFinancials(twh35, tx, total2035, batt, distBatt, marketShape2035);
  const buildoutRows = [];
  const buildoutTotals = { windMw: 0, solarMw: 0, distSolarMw: 0, geoMw: 0, battMw: 0, distBattMw: 0, newMw: 0, totalMw: 0 };
  const battAnnualMw = Math.max(0, batt - DEFAULT_INPUTS.p_batt) / BUILD_YRS_TOTAL;
  const distBattAnnualMw = Math.max(0, distBatt - DEFAULT_INPUTS.p_dist_batt) / BUILD_YRS_TOTAL;

  for (let i = 1; i < YEARS; i++) {
    const year = BASE_YEAR + i;
    const buildActive = i <= BUILD_YRS_TOTAL;
    const windAdd = buildActive ? buildPlan.windAnnualMw : 0;
    const solarAdd = buildActive ? buildPlan.solarAnnualMw : 0;
    const distSolarAdd = buildActive ? buildPlan.distSolarAnnualMw : 0;
    const geoAdd = buildActive ? geoAnnualMw : 0;
    const battAdd = buildActive ? battAnnualMw : 0;
    const distBattAdd = buildActive ? distBattAnnualMw : 0;
    const completedBuildYears = Math.max(0, i - 1);
    const priorWindMw = Math.max(0, completedBuildYears * buildPlan.windAnnualMw);
    const priorSolarMw = Math.max(0, completedBuildYears * buildPlan.solarAnnualMw);
    const priorDistSolarMw = Math.max(0, completedBuildYears * buildPlan.distSolarAnnualMw);
    const priorGeoMw = Math.max(0, completedBuildYears * geoAnnualMw);
    const priorBattMw = Math.max(0, battAnnualMw * completedBuildYears);
    const priorDistBattMw = Math.max(0, distBattAnnualMw * completedBuildYears);
    const priorMw = priorWindMw + priorSolarMw + priorDistSolarMw + priorGeoMw + priorBattMw + priorDistBattMw;
    const newMw = windAdd + solarAdd + distSolarAdd + geoAdd + battAdd + distBattAdd;
    const totalMw = priorMw + newMw;

    buildoutRows.push({
      year,
      windMw: windAdd,
      solarMw: solarAdd,
      distSolarMw: distSolarAdd,
      geoMw: geoAdd,
      battMw: battAdd,
      distBattMw: distBattAdd,
      newMw,
      totalMw,
    });

    buildoutTotals.windMw += windAdd;
    buildoutTotals.solarMw += solarAdd;
    buildoutTotals.distSolarMw += distSolarAdd;
    buildoutTotals.geoMw += geoAdd;
    buildoutTotals.battMw += battAdd;
    buildoutTotals.distBattMw += distBattAdd;
    buildoutTotals.newMw += newMw;
    buildoutTotals.totalMw = totalMw;
  }
  renderBuildoutTable(buildoutRows, buildoutTotals);
  const rateCents = total2035 > 0 ? (totCostM / total2035 / 10) : 0;
  setText('k_rate', rateCents.toFixed(1) + '¢');
  queueMarkerRefresh();
}

/**
 * Populates the Landed Cost Financials table (2035 snapshot). Resources with vol below the zero cutoff are omitted.
 * Remote resources get per-resource TCOS applied. Battery row: capacity (MW), base $k/MW-year, total $M. Returns total cost in $M.
 */
function runFinancials(twh, txAdder, loadTWh, battMW, distBattMW, marketShapeData = null) {
  const hasTcos = (k) => !['biomass', 'distSolar', 'batt', 'distBatt', 'surplus'].includes(k);
  const rows = [
    { k: 'newWind', n: 'New Utility Wind' },
    { k: 'newSolar', n: 'New Utility Solar' },
    { k: 'distSolar', n: 'Local Solar' },
    { k: 'geo', n: 'Geothermal' },
    { k: 'biomass', n: 'Biomass' },
    { k: 'ee', n: 'Energy Efficiency' },
    { k: 'dr', n: 'Demand Response' },
    { k: 'exWind', n: 'Existing Utility Wind' },
    { k: 'exSolar', n: 'Exist. Utility Solar' },
    { k: 'coal', n: 'Coal' },
    { k: 'gasBase', n: 'Gas (Baseload)' },
    { k: 'gasPeak', n: 'Gas (Peaker)' },
    { k: 'nuke', n: 'Nuclear' },
  ];
  const marketRows = [
    { k: 'gap', n: 'Deficit' },
    { k: 'surplus', n: 'Surplus Sales' },
  ];

  let html = '';
  let tot = 0;

  const appendFinancialRow = (d, hideIfZero = false) => {
    const vol = d.k === 'gap'
      ? (marketShapeData?.gapTwh ?? twh[d.k] ?? 0)
      : d.k === 'surplus'
        ? (marketShapeData?.surplusTwh ?? twh[d.k] ?? 0)
        : (twh[d.k] ?? 0); // TWh
    const inputBaseP = d.k === 'surplus'
      ? null
      : d.k === 'gap'
        ? null
        : (PRICES[d.k] ?? 0);
    const effectiveBaseP = d.k === 'surplus'
      ? -(marketShapeData?.exportPrice ?? 0)
      : d.k === 'gap'
        ? (marketShapeData?.importPrice ?? 0)
        : (PRICES[d.k] ?? 0); // $/MWh for energy
    const rem = hasTcos(d.k);
    const add = rem && d.k !== 'surplus' ? getResourceTcos(d.k, txAdder) : 0;
    // cost ($) = vol_TWh × 1e6 MWh/TWh × price_$/MWh → cost ($M) = vol × price
    const landedP = effectiveBaseP + add;
    const costM = (vol * MWH_PER_TWH * landedP) / DOLLARS_PER_MILLION;
    tot += costM;

    if (hideIfZero && vol < FINANCIAL_TABLE_ZERO_CUTOFF_TWH) return;

    const color = STYLES[d.k]?.c ?? '#999';
    const zeroRow = vol < FINANCIAL_TABLE_ZERO_CUTOFF_TWH ? ' style="opacity:0.45"' : '';

    html += `<tr${zeroRow}>
      <td style="border-left:4px solid ${color}">${d.n}</td>
      <td>${vol.toFixed(2)} TWh</td>
      <td>${d.k === 'surplus' || d.k === 'gap'
        ? '<span style="color:#ccc">ERCOT Avg</span>'
        : `<input class="money-inp" type="number" value="${inputBaseP}" min="0" step="1" onchange="window.setPrice('${d.k}', this.value)">`}</td>
      <td>${rem ? `<input class="money-inp" id="tcos_${d.k}" type="number" value="${add}" min="0" step="1" onchange="window.setTcos('${d.k}', this.value)">` : '<span style="color:#ccc">--</span>'}</td>
      <td>$${landedP.toFixed(0)}</td>
      <td>${formatCostCell(costM)}</td>
    </tr>`;
  };

  rows.forEach((d) => appendFinancialRow(d, false));

  // Battery row: capacity (MW), base price $k/MW-year → cost $M = (batt × price_$k) / 1000
  [
    { key: 'batt', label: 'Utility-Scale Battery', mw: battMW ?? 0 },
    { key: 'distBatt', label: 'Local Battery', mw: distBattMW ?? 0 },
  ].forEach(({ key, label, mw }) => {
    const battPrice = PRICES[key] ?? 120;
    const battCostM = (mw * battPrice) / 1000;
    tot += battCostM;
    const battColor = STYLES[key]?.c ?? '#CE93D8';
    html += `<tr>
      <td style="border-left:4px solid ${battColor}">${label}</td>
      <td>${mw} MW</td>
      <td><input class="money-inp" type="number" value="${battPrice}" min="0" step="1" onchange="window.setPrice('${key}', this.value)"></td>
      <td style="color:#ccc">--</td>
      <td>$${battPrice.toFixed(0)}</td>
      <td>${formatCostCell(battCostM)}</td>
    </tr>`;
  });

  if (marketRows.some(({ k }) => {
    const vol = k === 'gap'
      ? (marketShapeData?.gapTwh ?? twh[k] ?? 0)
      : k === 'surplus'
        ? (marketShapeData?.surplusTwh ?? twh[k] ?? 0)
        : (twh[k] ?? 0);
    return vol >= FINANCIAL_TABLE_ZERO_CUTOFF_TWH;
  })) {
    html += '<tr class="fin-section-divider"><td colspan="6"></td></tr>';
  }

  marketRows.forEach((d) => appendFinancialRow(d, true));

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

function totalAnnualScenarioCost(twh, txAdder, battMW, distBattMW, loadTwh, marketShapeData = null) {
  const tcosKeys = new Set(['nuke', 'gasBase', 'gasPeak', 'coal', 'biomass', 'ee', 'dr', 'exWind', 'exSolar', 'geo', 'newWind', 'newSolar', 'gap']);
  let totalCostM = 0;
  const shapedMarket = marketShapeData ?? estimateMarketShapeData(twh, loadTwh);

  Object.entries(twh).forEach(([key, vol]) => {
    if (key === 'surplus') return;
    const effectiveVol = key === 'gap' ? (shapedMarket?.gapTwh ?? vol ?? 0) : (vol ?? 0);
    const baseP = key === 'gap' ? (shapedMarket?.importPrice ?? 0) : (PRICES[key] ?? 0);
    const add = tcosKeys.has(key) ? getResourceTcos(key, txAdder) : 0;
    totalCostM += (effectiveVol * MWH_PER_TWH * (baseP + add)) / DOLLARS_PER_MILLION;
  });

  totalCostM -= ((shapedMarket?.surplusTwh ?? 0) * MWH_PER_TWH * (shapedMarket?.exportPrice ?? 0)) / DOLLARS_PER_MILLION;

  totalCostM += ((battMW ?? 0) * (PRICES.batt ?? 120)) / 1000;
  totalCostM += ((distBattMW ?? 0) * (PRICES.distBatt ?? 120)) / 1000;
  return totalCostM;
}

function getBuildoutCostTwh(mw, priceKey, yearIndex, options = {}) {
  const { cf, applySolarDegradation = false, isBattery = false } = options;
  if (isBattery) return (mw * (PRICES[priceKey] ?? 120)) / 1000;
  const effectiveFactor = applySolarDegradation ? solarOutputFactorForAge(Math.max(1, yearIndex)) : 1;
  const annualTwh = ((mw ?? 0) * effectiveFactor * HOURS_PER_YEAR * (cf ?? 0)) / MWH_PER_TWH;
  const add = ['distSolar', 'batt', 'distBatt'].includes(priceKey) ? 0 : getResourceTcos(priceKey, DEFAULT_TCOS);
  const landedP = (PRICES[priceKey] ?? 0) + add;
  return (annualTwh * MWH_PER_TWH * landedP) / DOLLARS_PER_MILLION;
}

function formatBuildMw(value) {
  return `${Math.round(value)} MW`;
}

function formatCostCell(costM) {
  const cls = costM < 0 ? 'fin-negative' : '';
  return `<span class="${cls}">$${costM.toFixed(0)} M</span>`;
}

function renderBuildoutTable(rows, totals) {
  const body = document.getElementById('buildoutBody');
  if (body) {
    body.innerHTML = rows.map((row) => `<tr>
      <td>${row.year}</td>
      <td>${formatBuildMw(row.windMw)}</td>
      <td>${formatBuildMw(row.solarMw)}</td>
      <td>${formatBuildMw(row.distSolarMw)}</td>
      <td>${formatBuildMw(row.geoMw)}</td>
      <td>${formatBuildMw(row.battMw)}</td>
      <td>${formatBuildMw(row.distBattMw)}</td>
      <td>${formatBuildMw(row.newMw)}</td>
      <td>${formatBuildMw(row.totalMw)}</td>
    </tr>`).join('');
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const setHtml = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  };

  setHtml('b_wind_total', formatBuildMw(totals.windMw));
  setHtml('b_solar_total', formatBuildMw(totals.solarMw));
  setHtml('b_dist_solar_total', formatBuildMw(totals.distSolarMw));
  setHtml('b_geo_total', formatBuildMw(totals.geoMw));
  setHtml('b_batt_total', formatBuildMw(totals.battMw));
  setHtml('b_dist_batt_total', formatBuildMw(totals.distBattMw));
  setHtml('b_new_cost_total', formatBuildMw(totals.newMw));
  setHtml('b_cost_total', formatBuildMw(totals.totalMw));
}

function estimateMarketShapeData(yearTwh, loadTwh) {
  const loadAvgMw = ((loadTwh ?? 0) * MWH_PER_TWH) / HOURS_PER_YEAR;
  const avgMwForKey = (key) => (((yearTwh?.[key] ?? 0) * MWH_PER_TWH) / HOURS_PER_YEAR);
  const flatAvgMw = ['nuke', 'biomass', 'gasBase', 'gasPeak', 'coal', 'geo', 'dr'].reduce((sum, key) => sum + avgMwForKey(key), 0);
  const windAnnualAvgMw = avgMwForKey('exWind') + avgMwForKey('newWind');
  const solarAnnualAvgMw = avgMwForKey('exSolar') + avgMwForKey('newSolar') + avgMwForKey('distSolar');

  let gapMWh = 0;
  let surplusMWh = 0;
  let importCostDollars = 0;
  let exportRevenueDollars = 0;

  MARKET_SHAPE_CELLS.forEach((cell) => {
    const loadMw = loadAvgMw * cell.loadFactor;
    const supplyMw = flatAvgMw + (windAnnualAvgMw * cell.windFactor) + (solarAnnualAvgMw * cell.solarFactor);
    const gapMw = Math.max(0, loadMw - supplyMw);
    const surplusMw = Math.max(0, supplyMw - loadMw);
    const gapMWhCell = gapMw * cell.hours;
    const surplusMWhCell = surplusMw * cell.hours;
    gapMWh += gapMWhCell;
    surplusMWh += surplusMWhCell;
    importCostDollars += gapMWhCell * cell.marketPrice;
    exportRevenueDollars += surplusMWhCell * cell.marketPrice;
  });

  const importPrice = gapMWh > 0 ? importCostDollars / gapMWh : 0;
  const exportPrice = surplusMWh > 0 ? exportRevenueDollars / surplusMWh : 0;
  return {
    gapTwh: gapMWh / MWH_PER_TWH,
    surplusTwh: surplusMWh / MWH_PER_TWH,
    importPrice,
    exportPrice,
    importMultiplier: 1,
    exportMultiplier: 1,
  };
}

/** Called from financial table inputs to update a resource's base price and refresh. */
window.setPrice = function (key, value) {
  const v = parseFloat(value);
  if (!Number.isNaN(v) && PRICES[key] !== undefined) PRICES[key] = v;
  update();
};

window.setTcos = function (key, value) {
  const v = parseFloat(value);
  if (!Number.isNaN(v)) TCOS_OVERRIDES[key] = v;
  update();
};

/**
 * Returns 2035 TWh by resource and load for the given build/assumptions. Used by autoSolve to compute cost.
 */
function getTwh2035(nukeMW, biomassMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, gasBase, gasPeak, coal, ee, dr, growth) {
  const i = YEARS - 1;
  const buildPlan = getBuildPlanFromTargets(windTargetMw, solarTargetMw, distSolarTargetMw, i);
  const geoAnnualMw = getAnnualBuildFromTarget(geoTargetMw, i);
  const yrLoadGross = 14.2 * Math.pow(1 + growth / 100, i);
  const eeTwh = (ee * 0.7 * 8760 * 0.02) / 1e6;
  const load2035 = Math.max(0, yrLoadGross - eeTwh);
  const nuke = nukeMwToTwh(nukeMW);
  const biomass = (biomassMW * HOURS_PER_YEAR * CF.biomass) / 1e6;
  const exW = EXISTING_WIND_TWH[i];
  const exS = EXISTING_SOLAR_TWH[i];
  const geoTwh = getNewBuildTwhForYearIndex(geoAnnualMw, CF.geo, i, false);
  const winTwh = getNewBuildTwhForYearIndex(buildPlan.windAnnualMw, CF.wind, i, false);
  const solTwh = getNewBuildTwhForYearIndex(buildPlan.solarAnnualMw, CF.solar, i, true);
  const distSolTwh = (buildPlan.distSolarMw2035 * HOURS_PER_YEAR * CF.distSolar) / 1e6;
  const gasBaseTwh = (gasBase * 8760 * CF.gasBase) / 1e6;
  const gasPeakTwh = (gasPeak * 8760 * CF.gasPeak) / 1e6;
  const coalTwh = (coal * 8760 * CF.coal) / 1e6;
  const totalSup = nuke + biomass + exW + exS + geoTwh + winTwh + solTwh + distSolTwh + gasBaseTwh + gasPeakTwh + coalTwh;
  const gapTwh = Math.max(0, load2035 - totalSup);
  const drTwh = (dr * 200) / 1e6;
  return {
    twh35: {
      nuke,
      biomass,
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
function runReliability(nukeMW, biomassMW, exSolarMW, exWindMW, newSolarMW, newDistSolarMW, newWindMW, geo, gasBase, gasPeak, coal, ee, dr, importAllowance, batt, distBatt, growth, yearIndex, marginGoalPct) {
  const expandHourlyProfile = (hourlyProfile) => {
    const out = [];
    for (let h = 0; h < 24; h++) {
      for (let q = 0; q < REL_INTERVALS_PER_HOUR; q++) {
        out.push(hourlyProfile[h]);
      }
    }
    return out;
  };
  const normalizeToPeak = (profile) => {
    const maxVal = Math.max(...profile, 0);
    if (!Number.isFinite(maxVal) || maxVal <= 0) return profile.map(() => 0);
    return profile.map((value) => value / maxVal);
  };
  const totalBatt = Math.max(0, batt + distBatt);
  const firmBatteryShare = totalBatt > 0 ? Math.max(0, batt) / totalBatt : 0;
  const distBatteryShare = totalBatt > 0 ? Math.max(0, distBatt) / totalBatt : 0;
  const clampedYearIndex = Math.max(0, Math.min(YEARS - 1, yearIndex));
  const peak = AUSTIN_ENERGY_BASE_SUMMER_PEAK_MW * Math.pow(1 + growth / 100, clampedYearIndex);
  const E_cap = totalBatt * 4; // MWh, 4-hour duration
  const eeFirm = ee * 0.7; // 70% of EE reduces load (MW) during stress
  const marginGoal = (marginGoalPct ?? 15) / 100;
  const sol = exSolarMW + newSolarMW + newDistSolarMW;
  const win = exWindMW + newWindMW;
  const SIM_DAYS = 3;
  const DISPLAY_DAY_START = REL_STEPS_PER_DAY;
  const DISPLAY_DAY_END = REL_STEPS_PER_DAY * 2;
  const totalSteps = REL_STEPS_PER_DAY * SIM_DAYS;
  // Treat Austin Energy's reported summer peak as the peak hour and use ERCOT only for shape.
  const dayLoadProfile = normalizeToPeak(expandHourlyProfile(PROF.load));
    const dayUtilitySolarProfile = expandHourlyProfile(AE_UTILITY_SOLAR_HOURLY_PROFILE);
    const dayLocalSolarProfile = expandHourlyProfile(Array.from({ length: 24 }, (_, h) => getAustinSolarShapeFactor(AUGUST_REPRESENTATIVE_DAY_OF_YEAR, h)));
    const dayWindProfile = expandHourlyProfile(PROF.wind);
    const loadProfile = Array.from({ length: totalSteps }, (_, s) => dayLoadProfile[s % REL_STEPS_PER_DAY]);
    const utilitySolarProfile = Array.from({ length: totalSteps }, (_, s) => dayUtilitySolarProfile[s % REL_STEPS_PER_DAY]);
    const localSolarProfile = Array.from({ length: totalSteps }, (_, s) => dayLocalSolarProfile[s % REL_STEPS_PER_DAY]);
    const windProfile = Array.from({ length: totalSteps }, (_, s) => dayWindProfile[s % REL_STEPS_PER_DAY]);

  // DR profile from headroom (supply − load): shift load toward hours with spare capacity (e.g. baseload at night, solar at midday).
  const grossLoadByStep = Array.from({ length: totalSteps }, (_, s) => loadProfile[s] * peak);
  const supplyAvail = Array.from({ length: totalSteps }, (_, s) =>
      nukeMW + biomassMW + gasBase + coal + geo
        + ((exSolarMW + newSolarMW) * utilitySolarProfile[s])
        + (newDistSolarMW * localSolarProfile[s])
        + (win * windProfile[s])
    );
  const headroom = supplyAvail.map((s, i) => s - grossLoadByStep[i]);
  const meanHeadroom = headroom.reduce((a, b) => a + b, 0) / totalSteps;
  const drDev = headroom.map((hr) => meanHeadroom - hr);
  const maxDrDev = Math.max(...drDev);
  const drProfile = maxDrDev > 0 ? drDev.map((d) => d / maxDrDev) : Array(totalSteps).fill(0);

  const simFull = {
    load: new Array(totalSteps),
    supply: new Array(totalSteps),
    supplyNoBatt: new Array(totalSteps),
    nuke: new Array(totalSteps),
    biomass: new Array(totalSteps),
    gasBase: new Array(totalSteps),
    coal: new Array(totalSteps),
    geo: new Array(totalSteps),
    exSolar: new Array(totalSteps),
    exWind: new Array(totalSteps),
    newSolar: new Array(totalSteps),
    distSolar: new Array(totalSteps),
    newWind: new Array(totalSteps),
    peaker: new Array(totalSteps),
    imports: new Array(totalSteps),
    discharge: new Array(totalSteps),
    dischargeFirm: new Array(totalSteps),
    dischargeDist: new Array(totalSteps),
  };
  const chargeHeadroom = new Array(totalSteps);
  const targetByStep = new Array(totalSteps);
  const shortfallToTarget = new Array(totalSteps);
  const requiredBattForTarget = new Array(totalSteps);

  // Pass 1: EE/DR; compute surplus/deficit vs target using generation only (no peaker, no battery).
  // Battery charging only uses surplus above the reserve target so margin comes first.
  for (let s = 0; s < totalSteps; s++) {
    const grossLoad = loadProfile[s] * peak;
    const netLoad = Math.max(0, grossLoad - eeFirm - dr * drProfile[s]);
    simFull.load[s] = netLoad;
    const targetSupply = netLoad * (1 + marginGoal);
    targetByStep[s] = targetSupply;
      const exSolarMwStep = exSolarMW * utilitySolarProfile[s];
      const newSolarMwStep = newSolarMW * utilitySolarProfile[s];
      const distSolarMwStep = newDistSolarMW * localSolarProfile[s];
    const exWindMwStep = exWindMW * windProfile[s];
    const newWindMwStep = newWindMW * windProfile[s];
    const solarMW = exSolarMwStep + newSolarMwStep + distSolarMwStep;
    const windMW = exWindMwStep + newWindMwStep;
    simFull.exSolar[s] = exSolarMwStep;
    simFull.exWind[s] = exWindMwStep;
    simFull.newSolar[s] = newSolarMwStep;
    simFull.distSolar[s] = distSolarMwStep;
    simFull.newWind[s] = newWindMwStep;
    const supplyNoPeaker = nukeMW + biomassMW + gasBase + coal + geo + solarMW + windMW;
    // Charge only from surplus above the reserve target.
    chargeHeadroom[s] = Math.max(0, supplyNoPeaker - targetSupply);
    shortfallToTarget[s] = Math.max(0, targetSupply - supplyNoPeaker);
    // Minimum battery power needed in this step to hit reserve target after max peaker use.
    requiredBattForTarget[s] = Math.max(0, shortfallToTarget[s] - gasPeak);
    simFull.nuke[s] = nukeMW;
    simFull.biomass[s] = biomassMW;
    simFull.gasBase[s] = gasBase;
    simFull.coal[s] = coal;
    simFull.geo[s] = geo;
    simFull.peaker[s] = 0; // set in pass 2 after battery
    simFull.imports[s] = 0; // set in pass 2 after battery/gas
  }
  const futureRequiredMWh = new Array(totalSteps + 1).fill(0);
  const futureChargeMWh = new Array(totalSteps + 1).fill(0);
  for (let s = totalSteps - 1; s >= 0; s--) {
    const stepChargeMwCap = Math.min(chargeHeadroom[s], totalBatt);
    futureRequiredMWh[s] = futureRequiredMWh[s + 1] + requiredBattForTarget[s] * REL_DT_HOURS;
    futureChargeMWh[s] = futureChargeMWh[s + 1] + stepChargeMwCap * REL_DT_HOURS;
  }

  // Pass 2: start stress day with empty battery.
  // Dispatch policy: (1) keep enough SOC to satisfy reserve-target-critical future hours,
  // then (2) use excess SOC to reduce peaker usage.
  let soc = 0;
  let riskHours = 0;
  for (let s = 0; s < totalSteps; s++) {
    if (chargeHeadroom[s] > 0) {
      const chargeMW = Math.min(chargeHeadroom[s], totalBatt, (E_cap - soc) / REL_DT_HOURS);
      soc += chargeMW * REL_DT_HOURS;
    }
      const supplyNoPeakerH = nukeMW + biomassMW + gasBase + coal + geo
        + ((exSolarMW + newSolarMW) * utilitySolarProfile[s])
        + (newDistSolarMW * localSolarProfile[s])
        + (win * windProfile[s]);
    const targetH = targetByStep[s];
    const requiredNowMW = Math.max(0, targetH - supplyNoPeakerH - gasPeak);
    const mandatoryDischargeMW = Math.min(requiredNowMW, totalBatt, soc / REL_DT_HOURS);
    soc -= mandatoryDischargeMW * REL_DT_HOURS;

    const shortfallAfterMandatory = Math.max(0, targetH - supplyNoPeakerH - mandatoryDischargeMW);
    const peakerNeededWithoutOptional = Math.min(gasPeak, shortfallAfterMandatory);
    const battPowerHeadroom = Math.max(0, totalBatt - mandatoryDischargeMW);
    const reserveMWh = Math.max(0, futureRequiredMWh[s + 1] - futureChargeMWh[s + 1]);
    const optionalEnergyMWh = Math.max(0, soc - reserveMWh);
    const optionalDischargeMW = Math.min(peakerNeededWithoutOptional, battPowerHeadroom, optionalEnergyMWh / REL_DT_HOURS);
    soc -= optionalDischargeMW * REL_DT_HOURS;

    const dischargeMW = mandatoryDischargeMW + optionalDischargeMW;
    const shortfallAfterBatt = Math.max(0, targetH - supplyNoPeakerH - dischargeMW);
    const peakerMW = Math.min(gasPeak, shortfallAfterBatt);
    const shortfallAfterPeaker = Math.max(0, targetH - supplyNoPeakerH - dischargeMW - peakerMW);
    const importMW = Math.min(Math.max(0, importAllowance), shortfallAfterPeaker);
    simFull.peaker[s] = peakerMW;
    simFull.imports[s] = importMW;
    simFull.supplyNoBatt[s] = supplyNoPeakerH + peakerMW + importMW;
    simFull.supply[s] = supplyNoPeakerH + peakerMW + importMW + dischargeMW;
    simFull.discharge[s] = dischargeMW;
    simFull.dischargeFirm[s] = dischargeMW * firmBatteryShare;
    simFull.dischargeDist[s] = dischargeMW * distBatteryShare;
    if (s >= DISPLAY_DAY_START && s < DISPLAY_DAY_END && simFull.load[s] > simFull.supply[s] + 10) riskHours += REL_DT_HOURS;
  }
  const sim = Object.fromEntries(
    Object.entries(simFull).map(([key, series]) => [key, series.slice(DISPLAY_DAY_START, DISPLAY_DAY_END)])
  );
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

function runAnnualRiskSimulation(loadTwh, nukeMW, biomassMW, exSolarMW, exWindMW, newSolarMW, newDistSolarMW, newWindMW, geo, gasBase, gasPeak, coal, dr, batt, distBatt, marginGoalPct) {
  const annualLoadAvgMw = ((loadTwh ?? 0) * MWH_PER_TWH) / HOURS_PER_YEAR;
  const totalBatt = Math.max(0, batt + distBatt);
  const batteryEnergyMWh = totalBatt * 4;
  const marginGoal = (marginGoalPct ?? 15) / 100;

  const exSolarAvgMw = exSolarMW * CF.solar;
  const newSolarAvgMw = newSolarMW * CF.solar;
  const distSolarAvgMw = newDistSolarMW * CF.distSolar;
  const exWindAvgMw = exWindMW * CF.wind;
  const newWindAvgMw = newWindMW * CF.wind;

  const hourlyCells = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const loadByHour = Array.from({ length: 24 }, (_, hourIndex) =>
      annualLoadAvgMw
      * (LOAD_SEASONAL_PROFILE[monthIndex] ?? 0)
      * (LOAD_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0)
    );
    const supplyByHour = Array.from({ length: 24 }, (_, hourIndex) =>
      nukeMW + biomassMW + gasBase + coal + geo
      + ((exSolarAvgMw + newSolarAvgMw) * (SOLAR_SEASONAL_PROFILE[monthIndex] ?? 0) * (SOLAR_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0))
      + (distSolarAvgMw * (SOLAR_SEASONAL_PROFILE[monthIndex] ?? 0) * (SOLAR_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0))
      + ((exWindAvgMw + newWindAvgMw) * (WIND_SEASONAL_PROFILE[monthIndex] ?? 0) * (WIND_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0))
    );
    const headroomByHour = supplyByHour.map((supplyMw, hourIndex) => supplyMw - loadByHour[hourIndex]);
    const meanHeadroom = headroomByHour.reduce((sum, value) => sum + value, 0) / 24;
    const drDev = headroomByHour.map((value) => meanHeadroom - value);
    const maxDrDev = Math.max(...drDev, 0);
    const drProfile = maxDrDev > 0 ? drDev.map((value) => value / maxDrDev) : Array(24).fill(0);

    for (let day = 0; day < DAYS_PER_MONTH[monthIndex]; day++) {
      for (let hourIndex = 0; hourIndex < 24; hourIndex++) {
        const loadMw = Math.max(0, loadByHour[hourIndex] - (dr * drProfile[hourIndex]));
        const supplyNoPeaker =
          nukeMW + biomassMW + gasBase + coal + geo
          + ((exSolarAvgMw + newSolarAvgMw) * (SOLAR_SEASONAL_PROFILE[monthIndex] ?? 0) * (SOLAR_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0))
          + (distSolarAvgMw * (SOLAR_SEASONAL_PROFILE[monthIndex] ?? 0) * (SOLAR_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0))
          + ((exWindAvgMw + newWindAvgMw) * (WIND_SEASONAL_PROFILE[monthIndex] ?? 0) * (WIND_HOURLY_RESHAPE_PROFILE[hourIndex] ?? 0));
        const targetSupply = loadMw * (1 + marginGoal);
        hourlyCells.push({
          loadMw,
          supplyNoPeaker,
          targetSupply,
          chargeHeadroom: Math.max(0, supplyNoPeaker - targetSupply),
          requiredBattForTarget: Math.max(0, targetSupply - supplyNoPeaker - gasPeak),
        });
      }
    }
  }

  const yearSteps = hourlyCells.length;
  const simYears = 3;
  const totalSteps = yearSteps * simYears;
  const futureRequiredMWh = new Array(totalSteps + 1).fill(0);
  const futureChargeMWh = new Array(totalSteps + 1).fill(0);

  for (let step = totalSteps - 1; step >= 0; step--) {
    const cell = hourlyCells[step % yearSteps];
    futureRequiredMWh[step] = futureRequiredMWh[step + 1] + (cell.requiredBattForTarget ?? 0);
    futureChargeMWh[step] = futureChargeMWh[step + 1] + Math.min(cell.chargeHeadroom ?? 0, totalBatt);
  }

  let soc = 0;
  let riskHours = 0;
  let riskEvents = 0;
  let riskEvents4h = 0;
  let currentEventHours = 0;
  let maxShortfallMw = 0;

  for (let step = 0; step < totalSteps; step++) {
    const cell = hourlyCells[step % yearSteps];
    if ((cell.chargeHeadroom ?? 0) > 0) {
      const chargeMw = Math.min(cell.chargeHeadroom, totalBatt, batteryEnergyMWh - soc);
      soc += chargeMw;
    }

    const requiredNowMw = Math.max(0, (cell.targetSupply ?? 0) - (cell.supplyNoPeaker ?? 0) - gasPeak);
    const mandatoryDischargeMw = Math.min(requiredNowMw, totalBatt, soc);
    soc -= mandatoryDischargeMw;

    const shortfallAfterMandatory = Math.max(0, (cell.targetSupply ?? 0) - (cell.supplyNoPeaker ?? 0) - mandatoryDischargeMw);
    const peakerNeededWithoutOptional = Math.min(gasPeak, shortfallAfterMandatory);
    const battPowerHeadroom = Math.max(0, totalBatt - mandatoryDischargeMw);
    const reserveMWh = Math.max(0, futureRequiredMWh[step + 1] - futureChargeMWh[step + 1]);
    const optionalEnergyMWh = Math.max(0, soc - reserveMWh);
    const optionalDischargeMw = Math.min(peakerNeededWithoutOptional, battPowerHeadroom, optionalEnergyMWh);
    soc -= optionalDischargeMw;

    const dischargeMw = mandatoryDischargeMw + optionalDischargeMw;
    const peakerMw = Math.min(gasPeak, Math.max(0, (cell.targetSupply ?? 0) - (cell.supplyNoPeaker ?? 0) - dischargeMw));
    const totalSupplyMw = (cell.supplyNoPeaker ?? 0) + peakerMw + dischargeMw;

    if (step >= yearSteps && step < (yearSteps * 2)) {
      const shortfallMw = Math.max(0, (cell.loadMw ?? 0) - totalSupplyMw);
      maxShortfallMw = Math.max(maxShortfallMw, shortfallMw);
      const isRiskHour = shortfallMw > 10;
      if (isRiskHour) {
        riskHours += 1;
        currentEventHours += 1;
      } else if (currentEventHours > 0) {
        riskEvents += 1;
        if (currentEventHours >= 4) riskEvents4h += 1;
        currentEventHours = 0;
      }
    }
  }

  if (currentEventHours > 0) {
    riskEvents += 1;
    if (currentEventHours >= 4) riskEvents4h += 1;
  }

  return { riskHours, riskEvents, riskEvents4h, maxShortfallMw };
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

function getRiskHourMask(rel) {
  const load = rel?.sim?.load ?? [];
  const supply = rel?.sim?.supply ?? [];
  return Array.from({ length: Math.max(load.length, supply.length) }, (_, i) => (load[i] ?? 0) > ((supply[i] ?? 0) + 10));
}

const relRiskHourBandsPlugin = {
  id: 'relRiskHourBands',
  beforeDatasetsDraw(chart, _args, pluginOptions) {
    if (!pluginOptions?.enabled) return;
    const indices = pluginOptions?.indices;
    if (!Array.isArray(indices) || indices.length === 0) return;
    const xScale = chart.scales?.x;
    const chartArea = chart.chartArea;
    if (!xScale || !chartArea) return;

    const { ctx } = chart;
    const stepCount = indices.length;
    ctx.save();
    ctx.lineWidth = 1;

    for (let i = 0; i < stepCount; i++) {
      const center = xScale.getPixelForValue(i);
      const prevCenter = i > 0 ? xScale.getPixelForValue(i - 1) : null;
      const nextCenter = i < stepCount - 1 ? xScale.getPixelForValue(i + 1) : null;
      const left = prevCenter == null ? chartArea.left : (prevCenter + center) / 2;
      const right = nextCenter == null ? chartArea.right : (center + nextCenter) / 2;
      const isRiskHour = Boolean(indices[i]);
      ctx.fillStyle = isRiskHour ? 'rgba(220, 38, 38, 0.08)' : 'rgba(34, 197, 94, 0.06)';
      ctx.strokeStyle = isRiskHour ? 'rgba(185, 28, 28, 0.20)' : 'rgba(22, 163, 74, 0.16)';
      ctx.fillRect(left, chartArea.top, Math.max(0, right - left), chartArea.bottom - chartArea.top);
      ctx.beginPath();
      ctx.moveTo(left, chartArea.top);
      ctx.lineTo(left, chartArea.bottom);
      ctx.moveTo(right, chartArea.top);
      ctx.lineTo(right, chartArea.bottom);
      ctx.stroke();
    }

    ctx.restore();
  },
};

const mixGapBackdropPlugin = {
  id: 'mixGapBackdrop',
  afterDatasetsDraw(chart) {
    if (chart.canvas?.id !== 'mixChart') return;
    const usageIndex = chart.data.datasets.findIndex((dataset) => dataset.label === 'Usage');
    const deficitIndex = chart.data.datasets.findIndex((dataset) => dataset.label === STYLES.gap.l);
    if (usageIndex < 0 || deficitIndex < 0) return;
    if (!chart.isDatasetVisible(deficitIndex)) return;

    const usageMeta = chart.getDatasetMeta(usageIndex);
    const usagePoints = usageMeta?.data ?? [];
    const chartArea = chart.chartArea;
    if (!usagePoints.length || !chartArea) return;

    const gapDeficitColors = getGapDeficitColors();
    const { ctx } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = createVerticalStripePattern(ctx, gapDeficitColors.fillHex);
    ctx.beginPath();
    ctx.moveTo(usagePoints[0].x, chartArea.bottom);
    usagePoints.forEach((point) => {
      ctx.lineTo(point.x, point.y);
    });
    ctx.lineTo(usagePoints[usagePoints.length - 1].x, chartArea.bottom);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
};

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
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Keep hatch lines lighter than fill; for very light fills, push further toward white for visibility.
  const baseTint = isGeothermal ? 0.22 : (luminance > 175 ? 0.58 : 0.35);
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
  const stripeWidth = getDeficitStripeWidth();
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

function getSnappedAxisMax(rawMax, { min = 0, padding = 0.12, step = 100 } = {}) {
  const padded = Math.max(min, rawMax * (1 + padding));
  return Math.max(min, Math.ceil(padded / step) * step);
}

function getMixAxisMax(rawMax, showMw) {
  return showMw
    ? getSnappedAxisMax(rawMax, { min: 1000, padding: 0.1, step: 4000 })
    : getSnappedAxisMax(rawMax, { min: 5, padding: 0.1, step: 10 });
}

function setMixUnitsLabel(showMw) {
  const el = document.getElementById('mix_units_lbl');
  if (el) el.textContent = showMw ? 'Nameplate MW' : 'TWh';
}

function getMixSeasonalProfileForKey(key) {
  if (key === 'load') return LOAD_SEASONAL_PROFILE;
  if (key === 'exWind' || key === 'newWind') return WIND_SEASONAL_PROFILE;
  if (key === 'exSolar' || key === 'newSolar' || key === 'distSolar') return SOLAR_SEASONAL_PROFILE;
  if (key === 'imports') return Array(SEASON_MONTHS.length).fill(1);
  return Array(SEASON_MONTHS.length).fill(1);
}

/**
 * Expands annual top-chart series into monthly points across the full planning horizon.
 * Variable resources and load get monthly seasonal factors; gap is recomputed monthly from load-supply.
 */
function buildSeasonalMixTimeline(data) {
  const labels = [];
  const seasonalSeries = {};
  const sourceKeysNoGap = MIX_SPLIT_KEYS.filter((key) => key !== 'gap' && key !== 'imports');
  const expandedKeys = [...sourceKeysNoGap, 'imports', 'gap', 'load'];
  expandedKeys.forEach((key) => { seasonalSeries[key] = []; });
  const importAllowanceMw = Math.max(0, Number(document.getElementById('p_import_allowance')?.value ?? 0));

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
      const monthHours = DAYS_PER_MONTH[m] * 24;
      const loadTwh = seasonalSeries.load[seasonalSeries.load.length - 1];
      const loadAvgMw = monthHours > 0 ? (loadTwh * MWH_PER_TWH) / monthHours : 0;
      const supplyNoImportTwh = sourceKeysNoGap.reduce((sum, key) => sum + (seasonalSeries[key]?.[seasonalSeries[key].length - 1] ?? 0), 0);
      const supplyNoImportAvgMw = monthHours > 0 ? (supplyNoImportTwh * MWH_PER_TWH) / monthHours : 0;
      const grossGapMw = Math.max(0, loadAvgMw - supplyNoImportAvgMw);
      const importMw = Math.min(grossGapMw, importAllowanceMw);
      seasonalSeries.imports.push((importMw * monthHours) / MWH_PER_TWH);
      seasonalSeries.gap.push(((grossGapMw - importMw) * monthHours) / MWH_PER_TWH);
    }
  }

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
  const gapDeficitColors = getGapDeficitColors();
  const powerGroupStyles = getPowerGroupStyles();
  const toMwByCf = (series, cf) => series.map((v) => (v * MWH_PER_TWH) / (HOURS_PER_YEAR * cf));
  const sumSeries = (seriesList) => Array.from({ length: pointCount }, (_, i) => seriesList.reduce((sum, s) => sum + (s[i] ?? 0), 0));
  const convertLoad = (series) => (showMw ? toMixUnits(series, true) : series);
  const convertSeriesForKey = (key) => {
    const series = seriesByKey[key] ?? Array(pointCount).fill(0);
    if (!showMw) return series;
    if (key === 'gap') return Array(pointCount).fill(0);
    if (key === 'imports') return toMixUnits(series, true);
    if (key === 'exWind' || key === 'newWind') return toMwByCf(series, CF.wind);
    if (key === 'exSolar' || key === 'newSolar') return toMwByCf(series, CF.solar);
    if (key === 'distSolar') return toMwByCf(series, CF.distSolar);
    if (key === 'biomass') return toMwByCf(series, CF.biomass);
    if (key === 'geo') return toMwByCf(series, CF.geo);
    if (key === 'nuke') return toMwByCf(series, CF.nuke);
    if (key === 'gasBase') return toMwByCf(series, CF.gasBase);
    if (key === 'gasPeak') return toMwByCf(series, CF.gasPeak);
    if (key === 'coal') return toMwByCf(series, CF.coal);
    return series;
  };

  const showNewPowerTogether = document.getElementById('show_new_power_together')?.checked ?? false;
  const splitEntries = getMixSplitKeys(showNewPowerTogether).map((key) => ({
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
      convertSeriesForKey('biomass'),
      convertSeriesForKey('gasBase'),
      convertSeriesForKey('gasPeak'),
      convertSeriesForKey('imports'),
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
  const usageForMargin = convertLoad(seriesByKey.load ?? Array(pointCount).fill(0));
  const stackedMax = Array.from({ length: pointCount }, (_, i) => entries.reduce((sum, entry) => sum + (entry.series[i] ?? 0), 0));
  const yMaxRaw = showMw
    ? Math.max(...stackedMax, 0)
    : Math.max(...stackedMax, ...usageForMargin, ...usageForMargin.map((v) => v * (1 + marginGoal / 100)), 0);
  const yMax = getMixAxisMax(yMaxRaw, showMw);
  const datasets = entries.map((entry) => {
    const isGap = entry.key === 'gap';
    const isImports = entry.key === 'imports';
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
        : isImports
          ? createVerticalStripePattern(ctx, getShadedFillColor(STYLES.imports.c))
        : useHatch
          ? createCrosshatchPattern(ctx, fillColor, entry.key)
          : hexToRgba(fillColor, MIX_FILL_ALPHA),
      borderColor: isGap
        ? gapDeficitColors.border
        : isImports
          ? getShadedBorderColor(STYLES.imports.c)
        : useHatch
          ? borderColor
          : borderColor,
      borderWidth: isImports ? 1 : (combinedGroupBorder ? 1 : Math.max(splitBorderWidth, oldNewBoundaryWidth)),
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
  datasets.push({
    label: 'Supply Margin',
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
    plugins: [mixGapBackdropPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        filler: { drawTime: 'beforeDatasetsDraw' },
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            generateLabels(chart) {
              const base = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              return base.map((item) => item.text === 'Supply Margin'
                ? {
                  ...item,
                  fillStyle: 'transparent',
                  strokeStyle: '#6b7280',
                  lineWidth: 2,
                  lineDash: [6, 4],
                  pointStyle: 'line',
                }
                : item);
            },
          },
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
 * Builds or updates the selected-year seasonality chart (average MW by month).
 * Uses the same fill/hatch style logic as the other stacked charts.
 */
function drawSeasonality(yearTwh, loadTwh, hoverEnabled, splitByType, marginGoalPct = 15) {
  const toAvgMw = (twh) => (twh * MWH_PER_TWH) / HOURS_PER_YEAR;
  const getSeasonalityAvgMwForKey = (key) => {
    // Keep baseload aligned with reliability logic (available every hour as entered MW).
    if (key === 'gasBase') {
      const gasBaseMw = Number(document.getElementById('p_gas_base')?.value);
      return Number.isFinite(gasBaseMw) ? Math.max(0, gasBaseMw) : 0;
    }
    if (key === 'biomass') {
      const biomassMw = Number(document.getElementById('p_biomass')?.value);
      return Number.isFinite(biomassMw) ? Math.max(0, biomassMw) : 0;
    }
    return toAvgMw(yearTwh[key] ?? 0);
  };
  const marginGoal = Number.isFinite(marginGoalPct) ? marginGoalPct : 0;
  const loadAvgMw = toAvgMw(loadTwh);
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

  const seasonKeysNoGap = ['nuke', 'biomass', 'gasBase', 'gasPeak', 'coal', 'geo', 'exWind', 'newWind', 'exSolar', 'newSolar', 'distSolar'];
  const importAllowanceMw = Math.max(0, Number(document.getElementById('p_import_allowance')?.value ?? 0));
  const seasonalSeries = {};
  seasonKeysNoGap.forEach((key) => {
    const annualAvgMw = getSeasonalityAvgMwForKey(key);
    const profile = getProfileForKey(key);
    seasonalSeries[key] = profile.map((f) => annualAvgMw * f);
  });
  seasonalSeries.imports = Array.from({ length: monthCount }, (_, i) => {
    const supplyNoImport = seasonKeysNoGap.reduce((sum, key) => sum + (seasonalSeries[key][i] ?? 0), 0);
    const grossGap = Math.max(0, usageMonthly[i] - supplyNoImport);
    return Math.min(grossGap, importAllowanceMw);
  });
  seasonalSeries.gap = Array.from({ length: monthCount }, (_, i) => {
    const supplyNoImport = seasonKeysNoGap.reduce((sum, key) => sum + (seasonalSeries[key][i] ?? 0), 0);
    const grossGap = Math.max(0, usageMonthly[i] - supplyNoImport);
    return Math.max(0, grossGap - (seasonalSeries.imports[i] ?? 0));
  });

  const showNewPowerTogether = document.getElementById('show_new_power_together')?.checked ?? false;
  const splitEntries = getMixSplitKeys(showNewPowerTogether).map((key) => ({
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
        (seasonalSeries.biomass[i] ?? 0) +
        (seasonalSeries.gasBase[i] ?? 0) +
        (seasonalSeries.gasPeak[i] ?? 0) +
        (seasonalSeries.imports[i] ?? 0) +
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
    const isImports = entry.key === 'imports';
    const useHatch = entry.isNew;
    const fillColor = entry.fillColor;
    const baseBorderColor = entry.borderColor;
    const oldNewBoundaryColor = isSplitByType ? getOldNewBoundaryColor(entry.key) : null;
    const borderColor = oldNewBoundaryColor || baseBorderColor;
    const combinedGroupBorder = !isSplitByType && entry.key === 'newGeneration';
    const splitBorderWidth = isSplitByType && SPLIT_OUTER_BORDER_KEYS.has(entry.key) ? 1 : 0;
    const oldNewBoundaryWidth = oldNewBoundaryColor ? 1 : 0;
    return {
      label: entry.label,
      data: entry.series,
      backgroundColor: isGap
        ? createVerticalStripePattern(ctx, gapDeficitColors.fillHex)
        : isImports
          ? createVerticalStripePattern(ctx, getShadedFillColor(STYLES.imports.c))
        : useHatch
          ? createCrosshatchPattern(ctx, fillColor, entry.key)
          : hexToRgba(fillColor, 1),
      borderColor: isGap
        ? gapDeficitColors.border
        : isImports
          ? getShadedBorderColor(STYLES.imports.c)
          : borderColor,
      borderWidth: isImports ? 1 : (combinedGroupBorder ? 1 : Math.max(splitBorderWidth, oldNewBoundaryWidth)),
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
    label: 'Supply Margin',
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
  const yMax = getSnappedAxisMax(yMaxRaw, { min: 500, padding: 0.12, step: 500 });
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
            labels: {
              usePointStyle: true,
              generateLabels(chart) {
                const base = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                return base.map((item) => item.text === 'Supply Margin'
                  ? {
                    ...item,
                    fillStyle: 'transparent',
                    strokeStyle: '#6b7280',
                    lineWidth: 2,
                    lineDash: [6, 4],
                    pointStyle: 'line',
                  }
                  : item);
              },
            },
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

/** Battery colors in reliability chart (match sidebar swatches). */
const REL_BATT_COLOR = '#CE93D8';
const REL_DIST_BATT_COLOR = '#F3B6D9';
const REL_PLOT_TENSION = 0.22;

/** Reliability chart stack order in split-by-resource mode. */
const REL_STACK_ORDER = [
  { simKey: 'nuke', styleKey: 'nuke' },
  { simKey: 'biomass', styleKey: 'biomass' },
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
const REL_STACK_ORDER_NEW_ON_TOP = [
  { simKey: 'nuke', styleKey: 'nuke' },
  { simKey: 'biomass', styleKey: 'biomass' },
  { simKey: 'coal', styleKey: 'coal' },
  { simKey: 'gasBase', styleKey: 'gasBase' },
  { simKey: 'exWind', styleKey: 'exWind' },
  { simKey: 'exSolar', styleKey: 'exSolar' },
  { simKey: 'peaker', styleKey: 'gasPeak' },
  { simKey: 'geo', styleKey: 'geo' },
  { simKey: 'newWind', styleKey: 'newWind' },
  { simKey: 'newSolar', styleKey: 'newSolar' },
  { simKey: 'distSolar', styleKey: 'distSolar' },
];

function getMixSplitKeys(showNewPowerTogether = false) {
  return showNewPowerTogether ? MIX_SPLIT_KEYS_NEW_ON_TOP : MIX_SPLIT_KEYS;
}

function getRelStackOrder(showNewPowerTogether = false) {
  return showNewPowerTogether ? REL_STACK_ORDER_NEW_ON_TOP : REL_STACK_ORDER;
}

/**
 * Builds or updates the 24-hour reliability chart.
 * Split mode: supply stacked by resource type (existing/new ordered together by type).
 * Combined mode: supply grouped into Existing Power + New Generation, plus battery/deficit/load overlays.
 *
 * @param {{ sim: { load, supply, supplyNoBatt, nuke, biomass, gasBase, coal, geo, exSolar, exWind, newSolar, distSolar, newWind, peaker, imports, discharge, dischargeFirm, dischargeDist }, risk: number }} rel - Result from runReliability().
 */
function drawRel(rel, hoverEnabled, splitByType, marginGoalPct, showRiskHourBands = true) {
  const stepCount = rel.sim.load?.length ?? REL_STEPS_PER_DAY;
  const labels = Array.from({ length: stepCount }, (_, i) => (i % REL_INTERVALS_PER_HOUR === 0 ? hourToTimeOfDay(i / REL_INTERVALS_PER_HOUR) : ''));
  const loadSeries = rel.sim.load ?? Array(stepCount).fill(0);
  const riskHourMask = showRiskHourBands ? getRiskHourMask(rel) : [];
  const targetSupply = loadSeries.map((l) => l * (1 + (Number.isFinite(marginGoalPct) ? marginGoalPct : 0) / 100));
  const gapDeficitColors = getGapDeficitColors();
  const batteryFill = getShadedFillColor(REL_BATT_COLOR);
  const batteryBorder = getShadedBorderColor(REL_BATT_COLOR);
  const distBatteryFill = getShadedFillColor(REL_DIST_BATT_COLOR);
  const distBatteryBorder = getShadedBorderColor(REL_DIST_BATT_COLOR);
  const powerGroupStyles = getPowerGroupStyles();
  const stackByType = typeof splitByType === 'boolean' ? splitByType : document.getElementById('rel_stack_by_type').checked;
  const ctx = relChartInstance ? relChartInstance.ctx : document.getElementById('relChart').getContext('2d');
  const showNewPowerTogether = document.getElementById('show_new_power_together')?.checked ?? false;
  const relStackOrder = getRelStackOrder(showNewPowerTogether);
  const expectedDatasets = stackByType ? relStackOrder.length + 5 : 7;
  if (relChartInstance && relChartInstance.data.datasets.length !== expectedDatasets) {
    relChartInstance.destroy();
    relChartInstance = null;
  }

  const batteryDataset = {
    label: 'Utility-Scale Battery',
    data: rel.sim.dischargeFirm ?? Array(stepCount).fill(0),
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
  const distBatteryDataset = {
    label: 'Local Battery',
    data: rel.sim.dischargeDist ?? Array(stepCount).fill(0),
    backgroundColor: hexToRgba(distBatteryFill, 1),
    borderColor: distBatteryBorder,
    borderWidth: 0,
    fill: true,
    stack: 'area',
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    pointStyle: 'rect',
    order: 1,
  };
  const importsDataset = {
    label: STYLES.imports.l,
    data: rel.sim.imports ?? Array(stepCount).fill(0),
    backgroundColor: createVerticalStripePattern(ctx, getShadedFillColor(STYLES.imports.c)),
    borderColor: getShadedBorderColor(STYLES.imports.c),
    borderWidth: 1,
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
    borderWidth: 2,
    fill: false,
    tension: REL_PLOT_TENSION,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
    stack: 'usageOverlay',
    pointStyle: 'line',
    order: -100,
  };
  const targetMarginDataset = {
    label: 'Supply Margin',
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
      ...relStackOrder.map(({ simKey, styleKey }) => {
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
      distBatteryDataset,
      importsDataset,
      deficitDataset,
      targetMarginDataset,
      loadDataset,
    ]
    : (() => {
      const existingPower = Array.from({ length: stepCount }, (_, i) =>
        (rel.sim.nuke[i] ?? 0) +
        (rel.sim.biomass[i] ?? 0) +
        (rel.sim.coal[i] ?? 0) +
        (rel.sim.gasBase[i] ?? 0) +
        (rel.sim.peaker[i] ?? 0) +
        (rel.sim.imports[i] ?? 0) +
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
        batteryDataset,
        distBatteryDataset,
        deficitDataset,
        targetMarginDataset,
        loadDataset,
      ];
    })();

  const stackDatasets = datasets.filter((dataset) => dataset.fill && dataset.stack === 'area');
  const stackedMax = Array.from({ length: stepCount }, (_, i) => stackDatasets.reduce((sum, dataset) => sum + (dataset.data[i] ?? 0), 0));
  const yMaxRaw = Math.max(...loadSeries, ...targetSupply, ...stackedMax, 0);
  const yMax = getSnappedAxisMax(yMaxRaw, { min: 2000, padding: 0.08, step: 1000 });

  if (relChartInstance) {
    relChartInstance.data.labels = labels;
    relChartInstance.data.datasets = datasets;
    relChartInstance.options.plugins.tooltip.enabled = hoverEnabled;
    relChartInstance.options.plugins.relRiskHourBands = { enabled: showRiskHourBands, indices: riskHourMask };
    relChartInstance.options.scales.y.max = yMax;
    relChartInstance.update('none');
  } else {
    relChartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      plugins: [relRiskHourBandsPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        animations: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          relRiskHourBands: { enabled: showRiskHourBands, indices: riskHourMask },
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              generateLabels(chart) {
                const base = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                return base.map((item) => {
                  if (item.text === 'Supply Margin') {
                    return {
                      ...item,
                      fillStyle: 'transparent',
                      strokeStyle: '#6b7280',
                      lineWidth: 2,
                      lineDash: [6, 4],
                      pointStyle: 'line',
                    };
                  }
                  if (item.hidden) {
                    return {
                      ...item,
                      fillStyle: '#d1d5db',
                      strokeStyle: '#9ca3af',
                    };
                  }
                  return item;
                });
              },
            },
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
          max: yMax,
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
  p_nuke: 430,
  p_biomass: 105,
  p_wind: 864,
  p_solar: 806,
  p_dist_solar: 189,
  p_geo: 0,
  p_batt: 500,
  p_dist_batt: 0,
  p_import_allowance: 700,
  p_gas_base: 595,
  p_gas_peak: 205,
  p_coal: 605,
  p_ee: 0,
  p_dr: 0,
  p_growth: 1.5,
  p_market_sale: ERCOT_LZ_AEN_DAM_2025_AVG_PRICE,
  p_graph_shade: DEFAULT_GRAPH_SHADE,
  p_line_sep: DEFAULT_LINE_SEPARATION,
  p_hatch_width: DEFAULT_HATCH_WIDTH,
  p_hatch_strength: DEFAULT_HATCH_STRENGTH,
  p_deficit_width: DEFAULT_DEFICIT_STRIPE_WIDTH,
  p_panel_rounding: DEFAULT_PANEL_ROUNDING,
  p_panel_shadow: DEFAULT_PANEL_SHADOW,
  p_margin_goal: 13.75,
  p_rel_year: 2035,
  p_graph_hover: true,
  p_show_risk_hours: false,
  mix_units_mw: false,
  mix_include_seasonal: false,
  show_new_power_together: false,
  p_allow_geo_solver: false,
};

const STARTING_FLEET_INPUTS = {
  p_nuke: 430,
  p_biomass: 105,
  p_wind: 1796,
  p_solar: 806,
  p_dist_solar: 189,
  p_geo: 0,
  p_batt: 500,
  p_dist_batt: 0,
  p_import_allowance: 700,
  p_gas_base: 595,
  p_gas_peak: 205,
  p_coal: 605,
  p_ee: 0,
  p_dr: 0,
};

const SCENARIO_DESCRIPTIONS = {
  'reliability-gap': 'Auto-scales new clean resources and storage to meet the selected peak reliability target.',
  'zero-emissions': 'Zeros all fossil generation, then auto-scales clean resources and storage to meet the selected peak reliability target.',
  'portfolio-12': 'Approximate translation of Austin Energy Portfolio 12: 2,500 MW of added wind/solar PPAs split across utility wind and utility solar using the current Austin Energy mix, plus 700 MW local solar, 525 MW utility battery, 300 MW demand response, with coal and Decker/Sand Hill gas retired by the 2035 end state.',
  'portfolio-15': 'Approximate translation of Austin Energy Portfolio 15: 2,500 MW of added wind/solar PPAs split across utility wind and utility solar using the current Austin Energy mix, plus 960 MW local solar, 625 MW utility battery, 325 MW demand response, gas and coal retired by 2035, and a +250 MW import-allowance increase.',
  'ascend-a': 'Approximate translation of the 2024 Ascend Portfolio A summary: 1,885 MW of added wind PPAs plus 630 MW of added local gas peakers, with existing gas retained and hydrogen-capable generation represented as gas.',
  'ascend-b': 'Approximate translation of the 2024 Ascend Portfolio B summary: 1,885 MW of added wind PPAs plus 2,800 MW of community solar and 2,750 MW of local storage, with all gas retired by 2035.',
  'ascend-c': 'Approximate translation of the 2024 Ascend Portfolio C summary: 400 MW of added wind PPAs, 400 MW of added local gas peakers, and 200 MW of added local gas combined cycle, with existing gas retained. Fayette-specific treatment is not modeled separately.',
  'scale-with-growth': 'Scales the starting resource mix by load growth so the end-state system grows with demand.',
  'scale-with-growth-zero-emissions': 'Scales the clean starting system with load growth, keeps nuclear flat, and reallocates removed fossil energy into wind and solar.',
};

function setInputValue(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  const min = Number(input.min);
  const max = Number(input.max);
  const stepRaw = Number(input.step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
  let next = Number(value);
  if (!Number.isFinite(next)) return;
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);
  next = Math.round(next / step) * step;
  input.value = String(next);
}

function applyAscendApproxScenario(key) {
  const ppaTotalMw = 2500;
  const utilityRenewableBase = STARTING_FLEET_INPUTS.p_wind + STARTING_FLEET_INPUTS.p_solar;
  const windShare = utilityRenewableBase > 0 ? (STARTING_FLEET_INPUTS.p_wind / utilityRenewableBase) : 0.5;
  const solarShare = 1 - windShare;
  const base = {
    p_nuke: STARTING_FLEET_INPUTS.p_nuke,
    p_biomass: STARTING_FLEET_INPUTS.p_biomass,
    p_wind: STARTING_FLEET_INPUTS.p_wind,
    p_solar: STARTING_FLEET_INPUTS.p_solar,
    p_dist_solar: STARTING_FLEET_INPUTS.p_dist_solar,
    p_geo: 0,
    p_batt: STARTING_FLEET_INPUTS.p_batt,
    p_dist_batt: STARTING_FLEET_INPUTS.p_dist_batt,
    p_gas_base: STARTING_FLEET_INPUTS.p_gas_base,
    p_gas_peak: STARTING_FLEET_INPUTS.p_gas_peak,
  p_coal: 605,
  };

  const presets = {
    'portfolio-12': {
      p_wind: STARTING_FLEET_INPUTS.p_wind + Math.round(ppaTotalMw * windShare),
      p_solar: STARTING_FLEET_INPUTS.p_solar + Math.round(ppaTotalMw * solarShare),
      p_dist_solar: 700,
      p_batt: 525,
      p_dr: 300,
      p_geo: 0,
      p_gas_base: 0,
      p_gas_peak: 0,
      p_coal: 0,
    },
    'portfolio-15': {
      p_wind: STARTING_FLEET_INPUTS.p_wind + Math.round(ppaTotalMw * windShare),
      p_solar: STARTING_FLEET_INPUTS.p_solar + Math.round(ppaTotalMw * solarShare),
      p_dist_solar: 960,
      p_batt: 625,
      p_dr: 325,
      p_geo: 0,
      p_gas_base: 0,
      p_gas_peak: 0,
      p_coal: 0,
      p_import_allowance: STARTING_FLEET_INPUTS.p_import_allowance + 250,
    },
    'ascend-a': {
      p_wind: STARTING_FLEET_INPUTS.p_wind + 1885,
      p_gas_base: STARTING_FLEET_INPUTS.p_gas_base,
      p_gas_peak: STARTING_FLEET_INPUTS.p_gas_peak + 630,
      p_coal: 0,
    },
    'ascend-b': {
      p_wind: STARTING_FLEET_INPUTS.p_wind + 1885,
      p_dist_solar: 2800,
      p_batt: 2750,
      p_gas_base: 0,
      p_gas_peak: 0,
      p_coal: 0,
    },
    'ascend-c': {
      p_wind: STARTING_FLEET_INPUTS.p_wind + 400,
      p_gas_base: STARTING_FLEET_INPUTS.p_gas_base + 200,
      p_gas_peak: STARTING_FLEET_INPUTS.p_gas_peak + 400,
      p_coal: 0,
    },
  };

  const selected = presets[key];
  if (!selected) return;
  Object.entries({ ...base, ...selected }).forEach(([id, value]) => setInputValue(id, value));
  update();
}

DEFAULT_INPUTS.p_batt = 100;
STARTING_FLEET_INPUTS.p_batt = 100;

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
    if (!wrap.querySelector('.slider-default-marker')) {
      const marker = document.createElement('span');
      marker.className = 'slider-default-marker';
      marker.setAttribute('aria-hidden', 'true');
      wrap.appendChild(marker);
    }
    positionSliderDefaultMarker(input, clampedRatio);
  });
}

function getSliderThumbWidth(wrap) {
  const fallbackWidth = Number.parseFloat(getComputedStyle(wrap).getPropertyValue('--slider-thumb-size'));
  return Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : 0;
}

function getSliderMarkerNudge(wrap) {
  const nudge = Number.parseFloat(getComputedStyle(wrap).getPropertyValue('--slider-marker-nudge'));
  return Number.isFinite(nudge) ? nudge : 0;
}

function positionSliderDefaultMarker(input, ratioOverride) {
  const wrap = input?.closest('.slider-wrap');
  if (!wrap) return;
  const marker = wrap.querySelector('.slider-default-marker');
  if (!marker) return;

  const min = Number(input.min ?? 0);
  const max = Number(input.max ?? 100);
  const defaultVal = Number(input.dataset.default);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(defaultVal) || max <= min) return;

  const rawRatio = ratioOverride ?? ((defaultVal - min) / (max - min));
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const thumbWidth = getSliderThumbWidth(wrap);
  const markerNudge = getSliderMarkerNudge(wrap);
  const usableWidth = Math.max(0, input.clientWidth - thumbWidth);
  const markerLeft = (usableWidth * ratio) + (thumbWidth / 2) + markerNudge;
  marker.style.left = `${markerLeft}px`;
}

function refreshSliderDefaultMarkers() {
  document.querySelectorAll('input[type="range"][data-default]').forEach((input) => {
    positionSliderDefaultMarker(input);
  });
}

function updateRangeFill(input) {
  if (!input || input.type !== 'range') return;
  const min = Number(input.min ?? 0);
  const max = Number(input.max ?? 100);
  const value = Number(input.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(value) || max <= min) return;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  input.style.setProperty('--range-fill-ratio', `${(ratio * 100).toFixed(4)}%`);
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
  Object.keys(TCOS_OVERRIDES).forEach((key) => delete TCOS_OVERRIDES[key]);
  Object.entries(DEFAULT_INPUTS).forEach(([id, value]) => {
    if (id === 'p_allow_geo_solver') return;
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
function getMinMarginPct(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, distBatt, gasBase, gasPeak, coal, ee, dr, growth, yearIndex, marginGoalPct) {
  const biomassMW = +document.getElementById('p_biomass').value;
  const importAllowance = +document.getElementById('p_import_allowance').value;
  const rel = runReliability(...getReliabilityArgs(
    nukeMW,
    biomassMW,
    windTargetMw,
    solarTargetMw,
    distSolarTargetMw,
    geoTargetMw,
    batt,
    distBatt,
    gasBase,
    gasPeak,
    coal,
    ee,
    dr,
    importAllowance,
    growth,
    yearIndex,
    marginGoalPct,
  ));
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
function totalCostForBuild(nukeMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, batt, distBatt, gasBase, gasPeak, coal, ee, dr, growth, tx, yearIndex, marginGoalPct) {
  const biomassMW = +document.getElementById('p_biomass').value;
  const importAllowance = +document.getElementById('p_import_allowance').value;
  const { twh35 } = getTwh2035(nukeMW, biomassMW, windTargetMw, solarTargetMw, distSolarTargetMw, geoTargetMw, gasBase, gasPeak, coal, ee, dr, growth);
  const rel = runReliability(...getReliabilityArgs(
    nukeMW,
    biomassMW,
    windTargetMw,
    solarTargetMw,
    distSolarTargetMw,
    geoTargetMw,
    batt,
    distBatt,
    gasBase,
    gasPeak,
    coal,
    ee,
    dr,
    importAllowance,
    growth,
    yearIndex,
    marginGoalPct,
  ));
  const peakerUsageTwh35 = getAnnualizedPeakerTwhFromReliability(rel);
  const costTwh35 = { ...twh35, gasPeak: peakerUsageTwh35 };
  const tcosKeys = new Set(['nuke', 'biomass', 'gasBase', 'gasPeak', 'coal', 'ee', 'dr', 'exWind', 'exSolar', 'geo', 'newWind', 'newSolar', 'gap']);
  let genCostM = 0;

  Object.entries(costTwh35).forEach(([k, vol]) => {
    if (k === 'surplus') return;
    const baseP = PRICES[k] ?? 0;
    const add = tcosKeys.has(k) ? getResourceTcos(k, tx) : 0;
    genCostM += ((vol ?? 0) * MWH_PER_TWH * (baseP + add)) / DOLLARS_PER_MILLION;
  });

  const battPrice = PRICES.batt ?? 120;
  const battCostM = (batt * battPrice) / 1000;
  const distBattPrice = PRICES.distBatt ?? 120;
  const distBattCostM = (distBatt * distBattPrice) / 1000;
  return genCostM + battCostM + distBattCostM;
}

function getSliderMeta(id, fallbackMin = 0, fallbackMax = 0, fallbackStep = 1) {
  const input = document.getElementById(id);
  if (!input) return { min: fallbackMin, max: fallbackMax, step: fallbackStep };
  const min = Number.isFinite(Number(input.min)) ? Number(input.min) : fallbackMin;
  const max = Number.isFinite(Number(input.max)) ? Number(input.max) : fallbackMax;
  const stepRaw = Number(input.step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : fallbackStep;
  return { min, max, step };
}

function uniqueSortedValues(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function getSliderSearchValues(id, sampleCount, fallbackMin = 0, fallbackMax = 0, fallbackStep = 1) {
  const { min, max, step } = getSliderMeta(id, fallbackMin, fallbackMax, fallbackStep);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];

  const totalDiscreteValues = Math.floor((max - min) / step) + 1;
  if (totalDiscreteValues <= sampleCount) {
    return Array.from({ length: totalDiscreteValues }, (_, i) => min + (i * step));
  }

  const span = max - min;
  const values = Array.from({ length: sampleCount }, (_, i) => {
    const ratio = i / (sampleCount - 1);
    const raw = min + (span * ratio);
    return min + (Math.round((raw - min) / step) * step);
  });
  values.push(min, max);
  return uniqueSortedValues(values.map((value) => Math.max(min, Math.min(max, value))));
}

function getDenseRangeValues(min, max, step) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0 || max < min) {
    return [];
  }
  const values = [];
  for (let value = min; value <= max + (step / 2); value += step) {
    values.push(Math.min(max, value));
  }
  return uniqueSortedValues(values);
}

function mergeCandidateValues(...groups) {
  return uniqueSortedValues(groups.flat());
}
/**
 * Auto-solve: grid over (wind, solar, geo, battery); pick the feasible combo with lowest total cost.
 */
function autoSolveScenario({ zeroEmissions = false } = {}) {
  const nukeMW = +document.getElementById('p_nuke').value;
  const biomassMW = +document.getElementById('p_biomass').value;
  const distSolarTargetMw = +document.getElementById('p_dist_solar').value;
  const importAllowance = +document.getElementById('p_import_allowance').value;
  const allowGeo = document.getElementById('p_allow_geo_solver')?.checked ?? false;
  const gasBase = zeroEmissions ? 0 : +document.getElementById('p_gas_base').value;
  const gasPeak = zeroEmissions ? 0 : +document.getElementById('p_gas_peak').value;
  const coal = 0;
  const ee = +document.getElementById('p_ee').value;
  const dr = +document.getElementById('p_dr').value;
  const distBatt = +document.getElementById('p_dist_batt').value;
  const growth = +document.getElementById('p_growth').value;
  const tx = DEFAULT_TCOS;
  const goal = +document.getElementById('p_margin_goal').value;
  const relYear = +(document.getElementById('p_rel_year')?.value ?? (BASE_YEAR + YEARS - 1));
  const relYearIndex = Math.max(0, Math.min(YEARS - 1, relYear - BASE_YEAR));
  let best = { totalCostM: Infinity, windTargetMw: DEFAULT_INPUTS.p_wind, solarTargetMw: DEFAULT_INPUTS.p_solar, geoTargetMw: DEFAULT_INPUTS.p_geo, batt: 0 };
  let bestFallback = null;
  const costTcosKeys = new Set(['nuke', 'biomass', 'gasBase', 'gasPeak', 'coal', 'ee', 'dr', 'exWind', 'exSolar', 'geo', 'newWind', 'newSolar', 'gap']);
  const candidateCache = new Map();

  const exWind2035 = (EXISTING_WIND_TWH[YEARS - 1] * 1e6) / (8760 * CF.wind);
  const exSolar2035 = (EXISTING_SOLAR_TWH[YEARS - 1] * 1e6) / (8760 * CF.solar);
  const windMeta = getSliderMeta('p_wind', DEFAULT_INPUTS.p_wind, DEFAULT_INPUTS.p_wind, 1);
  const solarMeta = getSliderMeta('p_solar', DEFAULT_INPUTS.p_solar, DEFAULT_INPUTS.p_solar, 1);
  const geoMeta = getSliderMeta('p_geo', DEFAULT_INPUTS.p_geo, DEFAULT_INPUTS.p_geo, 1);
  const battMeta = getSliderMeta('p_batt', DEFAULT_INPUTS.p_batt, DEFAULT_INPUTS.p_batt, 1);
  const windMin = Math.max(Math.round(exWind2035), windMeta.min);
  const solarMin = Math.max(Math.round(exSolar2035), solarMeta.min);
  const WIND_TARGETS_COARSE = getSliderSearchValues('p_wind', 17, windMin, windMeta.max, 1).filter((value) => value >= windMin);
  const SOLAR_TARGETS_COARSE = getSliderSearchValues('p_solar', 17, solarMin, solarMeta.max, 1).filter((value) => value >= solarMin);
  const GEO_TARGETS_COARSE = allowGeo ? getSliderSearchValues('p_geo', 11, geoMeta.min, geoMeta.max, 1) : [0];
  const BATTERY_VALS_COARSE = getSliderSearchValues('p_batt', 11, battMeta.min, battMeta.max, 1);

  function evaluateCandidate(windTargetMw, solarTargetMw, geoTargetMw, batt) {
    const cacheKey = [windTargetMw, solarTargetMw, geoTargetMw, batt].join('|');
    const cached = candidateCache.get(cacheKey);
    if (cached) return cached;

    const rel = runReliability(...getReliabilityArgs(
      nukeMW,
      biomassMW,
      windTargetMw,
      solarTargetMw,
      distSolarTargetMw,
      geoTargetMw,
      batt,
      distBatt,
      gasBase,
      gasPeak,
      coal,
      ee,
      dr,
      importAllowance,
      growth,
      relYearIndex,
      goal,
    ));

    let minMarginPct = 0;
    for (let h = 0; h < rel.sim.load.length; h++) {
      const l = rel.sim.load[h];
      if (l > 0) {
        const m = ((rel.sim.supply[h] - l) / l) * 100;
        if (h === 0 || m < minMarginPct) minMarginPct = m;
      }
    }

    let totalCostM = Infinity;
    if (minMarginPct + 1e-9 >= goal) {
      const { twh35 } = getTwh2035(
        nukeMW,
        biomassMW,
        windTargetMw,
        solarTargetMw,
        distSolarTargetMw,
        geoTargetMw,
        gasBase,
        gasPeak,
        coal,
        ee,
        dr,
        growth,
      );
      const peakerUsageTwh35 = getAnnualizedPeakerTwhFromReliability(rel);
      const costTwh35 = { ...twh35, gasPeak: peakerUsageTwh35 };
      totalCostM = 0;
      Object.entries(costTwh35).forEach(([k, vol]) => {
        if (k === 'surplus') return;
        const baseP = PRICES[k] ?? 0;
        const add = costTcosKeys.has(k) ? getResourceTcos(k, tx) : 0;
        totalCostM += ((vol ?? 0) * MWH_PER_TWH * (baseP + add)) / DOLLARS_PER_MILLION;
      });
      totalCostM += (batt * (PRICES.batt ?? 120)) / 1000;
      totalCostM += (distBatt * (PRICES.distBatt ?? 120)) / 1000;
    }

    const result = { windTargetMw, solarTargetMw, geoTargetMw, batt, minMarginPct, totalCostM };
    candidateCache.set(cacheKey, result);
    return result;
  }

  function recordFallback(candidate) {
    if (
      !bestFallback
      || candidate.minMarginPct > bestFallback.minMarginPct
      || (Math.abs(candidate.minMarginPct - bestFallback.minMarginPct) < 1e-9 && candidate.batt < bestFallback.batt)
    ) {
      bestFallback = candidate;
    }
  }

  function evaluateGrid(windValues, solarValues, geoValues, batteryValues) {
    const sortedBatteryValues = uniqueSortedValues(batteryValues);
    for (const windTargetMw of windValues) {
      for (const solarTargetMw of solarValues) {
        for (const geoTargetMw of geoValues) {
          let lo = 0;
          let hi = sortedBatteryValues.length - 1;
          let bestFeasibleCandidate = null;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const batt = sortedBatteryValues[mid];
            const candidate = evaluateCandidate(windTargetMw, solarTargetMw, geoTargetMw, batt);
            recordFallback(candidate);
            if (candidate.minMarginPct + 1e-9 >= goal) {
              bestFeasibleCandidate = candidate;
              hi = mid - 1;
            } else {
              lo = mid + 1;
            }
          }
          if (bestFeasibleCandidate && bestFeasibleCandidate.totalCostM < best.totalCostM) {
            best = bestFeasibleCandidate;
          }
        }
      }
    }
  }

  evaluateGrid(WIND_TARGETS_COARSE, SOLAR_TARGETS_COARSE, GEO_TARGETS_COARSE, BATTERY_VALS_COARSE);

  const windFineStep = 25;
  const solarFineStep = 25;
  const geoFineStep = 25;
  const battFineStep = 50;
  const WIND_TARGETS_FINE = getDenseRangeValues(
    Math.max(windMin, best.windTargetMw - 250),
    Math.min(windMeta.max, best.windTargetMw + 250),
    windFineStep,
  ).filter((value) => value >= windMin);
  const SOLAR_TARGETS_FINE = getDenseRangeValues(
    Math.max(solarMin, best.solarTargetMw - 250),
    Math.min(solarMeta.max, best.solarTargetMw + 250),
    solarFineStep,
  ).filter((value) => value >= solarMin);
  const GEO_TARGETS_FINE = allowGeo
    ? getDenseRangeValues(
      Math.max(geoMeta.min, best.geoTargetMw - 150),
      Math.min(geoMeta.max, best.geoTargetMw + 150),
      geoFineStep,
    )
    : [0];
  const BATTERY_VALS_FINE = getDenseRangeValues(
    Math.max(battMeta.min, best.batt - 250),
    Math.min(battMeta.max, best.batt + 250),
    battFineStep,
  );

  evaluateGrid(WIND_TARGETS_FINE, SOLAR_TARGETS_FINE, GEO_TARGETS_FINE, BATTERY_VALS_FINE);

  let solverMessage = '';
  if (best.totalCostM === Infinity) {
    if (bestFallback) {
      best = { ...bestFallback, totalCostM: 0 };
    } else {
      best = { windTargetMw: Math.round(exWind2035), solarTargetMw: Math.round(exSolar2035), geoTargetMw: 0, batt: 0, totalCostM: 0 };
      solverMessage = 'Auto-solve could not find a candidate to evaluate.';
    }
  }

  document.getElementById('p_wind').value = best.windTargetMw;
  document.getElementById('p_solar').value = best.solarTargetMw;
  document.getElementById('p_geo').value = best.geoTargetMw;
  document.getElementById('p_batt').value = best.batt;
  if (zeroEmissions) {
    document.getElementById('p_gas_base').value = 0;
    document.getElementById('p_gas_peak').value = 0;
    document.getElementById('p_coal').value = 0;
  }
  update();
  if (solverMessage) window.alert?.(solverMessage);
}

function autoSolve() {
  autoSolveScenario();
}

function autoSolveZeroEmissions() {
  autoSolveScenario({ zeroEmissions: true });
}

const SCALABLE_SCENARIO_KEYS = [
  'p_nuke',
  'p_biomass',
  'p_wind',
  'p_solar',
  'p_dist_solar',
  'p_geo',
  'p_batt',
  'p_dist_batt',
  'p_gas_base',
  'p_gas_peak',
  'p_coal',
];

function scaleInputByFactor(id, factor) {
  const input = document.getElementById(id);
  if (!input) return;
  const current = Number(input.value);
  const min = Number(input.min);
  const max = Number(input.max);
  const stepRaw = Number(input.step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
  if (!Number.isFinite(current) || !Number.isFinite(factor)) return;
  let next = current * factor;
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);
  next = Math.round(next / step) * step;
  input.value = String(next);
}

function setInputFromBaselineScaled(id, factor, baselineMap = DEFAULT_INPUTS) {
  const input = document.getElementById(id);
  const baseline = baselineMap[id];
  if (!input || !Number.isFinite(baseline) || !Number.isFinite(factor)) return;
  const min = Number(input.min);
  const max = Number(input.max);
  const stepRaw = Number(input.step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
  let next = baseline * factor;
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);
  next = Math.round(next / step) * step;
  input.value = String(next);
}

function zeroFossilInputs() {
  const gasBaseInput = document.getElementById('p_gas_base');
  const gasPeakInput = document.getElementById('p_gas_peak');
  const coalInput = document.getElementById('p_coal');
  if (gasBaseInput) gasBaseInput.value = '0';
  if (gasPeakInput) gasPeakInput.value = '0';
  if (coalInput) coalInput.value = '0';
}

function applyScaleWithGrowthScenario() {
  const growth = +document.getElementById('p_growth').value;
  const growthFactor = Math.pow(1 + (growth / 100), YEARS - 1);
  SCALABLE_SCENARIO_KEYS.forEach((id) => setInputFromBaselineScaled(id, growthFactor, STARTING_FLEET_INPUTS));
  update();
}

function applyScaleWithGrowthZeroEmissionsScenario() {
  const growth = +document.getElementById('p_growth').value;
  const growthFactor = Math.pow(1 + (growth / 100), YEARS - 1);
  const cleanScalableIds = [
    'p_biomass',
    'p_wind',
    'p_solar',
    'p_dist_solar',
    'p_geo',
    'p_batt',
    'p_dist_batt',
    'p_ee',
    'p_dr',
  ];
  cleanScalableIds.forEach((id) => setInputFromBaselineScaled(id, growthFactor, STARTING_FLEET_INPUTS));
  const nukeInput = document.getElementById('p_nuke');
  if (nukeInput) nukeInput.value = String(STARTING_FLEET_INPUTS.p_nuke);

  const displacedFossilTwh = growthFactor * (
    (((STARTING_FLEET_INPUTS.p_gas_base ?? 0) * HOURS_PER_YEAR * CF.gasBase) / MWH_PER_TWH)
    + (((STARTING_FLEET_INPUTS.p_gas_peak ?? 0) * HOURS_PER_YEAR * CF.gasPeak) / MWH_PER_TWH)
    + (((STARTING_FLEET_INPUTS.p_coal ?? 0) * HOURS_PER_YEAR * CF.coal) / MWH_PER_TWH)
  );
  const renewableReplacementIds = ['p_wind', 'p_solar', 'p_dist_solar'];
  const renewableCfById = { p_wind: CF.wind, p_solar: CF.solar, p_dist_solar: CF.distSolar };
  const renewableBaselineTwh = renewableReplacementIds.reduce((sum, id) => {
    const mw = STARTING_FLEET_INPUTS[id] ?? 0;
    const cf = renewableCfById[id] ?? 0;
    return sum + ((mw * HOURS_PER_YEAR * cf) / MWH_PER_TWH);
  }, 0);
  renewableReplacementIds.forEach((id) => {
    const baselineMw = STARTING_FLEET_INPUTS[id] ?? 0;
    const cf = renewableCfById[id] ?? 0;
    const baselineTwh = (baselineMw * HOURS_PER_YEAR * cf) / MWH_PER_TWH;
    const baselineShare = renewableBaselineTwh > 0 ? baselineTwh / renewableBaselineTwh : 0;
    const input = document.getElementById(id);
    if (!input) return;
    const current = Number(input.value);
    if (!Number.isFinite(current) || cf <= 0) return;
    const min = Number(input.min);
    const max = Number(input.max);
    const stepRaw = Number(input.step);
    const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
    const addedTwh = displacedFossilTwh * baselineShare;
    const addedMw = (addedTwh * MWH_PER_TWH) / (HOURS_PER_YEAR * cf);
    let next = current + addedMw;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    next = Math.round(next / step) * step;
    input.value = String(next);
  });
  zeroFossilInputs();
  update();
}

function applyScenarioAction() {
  const scenario = document.getElementById('p_scenario_action')?.value ?? 'reliability-gap';
  if (scenario === 'zero-emissions') {
    zeroFossilInputs();
    autoSolveScenario({ zeroEmissions: true });
    return;
  }
  if (scenario === 'portfolio-12' || scenario === 'portfolio-15' || scenario === 'ascend-a' || scenario === 'ascend-b' || scenario === 'ascend-c') {
    applyAscendApproxScenario(scenario);
    return;
  }
  if (scenario === 'scale-with-growth') {
    applyScaleWithGrowthScenario();
    return;
  }
  if (scenario === 'scale-with-growth-zero-emissions') {
    applyScaleWithGrowthZeroEmissionsScenario();
    return;
  }
  autoSolveScenario();
}
// --- Init (runs when script loads; DOM ready because script is at end of body) ---
document.querySelectorAll('input').forEach((input) => {
  input.oninput = () => {
    maybeSnapToDefault(input);
    updateRangeFill(input);
    update();
  };
});
window.addEventListener('load', () => {
  initSliderDefaultMarkers();
  document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
  initTooltips();
  update();
});

function initTooltips() {
  const popup = document.getElementById('tooltip-popup');
  if (!popup) return;

  // Move title → data-tooltip to suppress native browser tooltips, then use custom popup.
  document.querySelectorAll('.has-tooltip[title]').forEach((el) => {
    el.dataset.tooltip = el.title;
    el.removeAttribute('title');
  });

  let hideTimer = null;

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) return;
    clearTimeout(hideTimer);
    popup.textContent = el.dataset.tooltip;
    popup.style.display = 'block';
    positionTooltip(e, popup);
  });

  document.addEventListener('mousemove', (e) => {
    if (popup.style.display === 'block') positionTooltip(e, popup);
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) return;
    hideTimer = setTimeout(() => { popup.style.display = 'none'; }, 80);
  });
}

function positionTooltip(e, popup) {
  const pad = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  // Prevent clipping on right/bottom edge
  if (x + popup.offsetWidth > vw - pad) x = e.clientX - popup.offsetWidth - pad;
  if (y + popup.offsetHeight > vh - pad) y = e.clientY - popup.offsetHeight - pad;
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
}

window.addEventListener('resize', refreshSliderDefaultMarkers);

