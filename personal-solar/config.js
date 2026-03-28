const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const FINANCIAL_HORIZON_YEARS = 30;
const DEFAULT_FIXED_UTILITY_CHARGE = 15;
const DAY_CHART_INTERVALS_PER_HOUR = 4;
const DAY_CHART_DT_HOURS = 1 / DAY_CHART_INTERVALS_PER_HOUR;
const MONTHLY_USAGE_PROFILE = normalizeProfile([1.08, 0.97, 0.9, 0.86, 0.94, 1.08, 1.17, 1.2, 1.01, 0.89, 0.91, 0.99]);
const MONTHLY_SOLAR_PROFILE = normalizeProfile([0.78, 0.86, 0.99, 1.06, 1.11, 1.1, 1.07, 1.01, 0.96, 0.91, 0.82, 0.74]);
const HOURLY_LOAD_PROFILE = normalizeProfile([0.62, 0.56, 0.53, 0.51, 0.52, 0.58, 0.71, 0.82, 0.85, 0.81, 0.77, 0.75, 0.76, 0.79, 0.84, 0.92, 1, 0.98, 0.94, 0.9, 0.88, 0.83, 0.76, 0.68]);
const DAYLIGHT_HOURS_BY_MONTH = [10.2, 10.8, 11.8, 12.8, 13.6, 14.1, 13.8, 13.1, 12.2, 11.3, 10.5, 10.0];
const FALLBACK_SOLAR_PROFILE_EXPONENT = 1.35;
const REPRESENTATIVE_DAY_OF_YEAR = [15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

const DEFAULTS = {
  monthlyUsage: 1167,
  systemSize: 9,
  dayMonth: 6,
  installCost: 2700,
  batteryPower: 0,
  batteryCost: 250,
  loanTerm: 0,
  loanInterest: 6,
  planType: 'net_billing',
  retailRate: 14.5,
  buybackRate: 6,
  rateEscalation: 2.5,
  productionPerKw: 1500,
};

const FIELD_FORMATTERS = {
  monthlyUsage: (value) => `${formatNumber(value, 0)} kWh`,
  systemSize: (value) => `${formatNumber(value, 1)} kW`,
  installCost: (value) => `${formatCurrency(value)}/kW`,
  batteryPower: (value) => `${formatNumber(value, 1)} kW`,
  batteryCost: (value) => `${formatCurrency(value)}/kWh`,
  loanInterest: (value) => `${formatNumber(value, 1)}%`,
  retailRate: (value) => `${formatNumber(value, 1)} cents/kWh`,
  buybackRate: (value) => `${formatNumber(value, 1)} cents/kWh`,
  rateEscalation: (value) => `${formatNumber(value, 1)}%`,
  productionPerKw: (value) => `${formatNumber(value, 0)} kWh per kW-year`,
};

const APP_MODE = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const mode = (params.get('mode') || '').trim().toLowerCase();
    const utility = (params.get('utility') || '').trim().toLowerCase();
    if (['austin', 'austin-energy', 'austin_energy'].includes(mode) || ['austin', 'austin-energy', 'austin_energy'].includes(utility)) {
      return 'austin_energy';
    }
  } catch (error) {
    // Ignore URL parsing errors and fall back to default mode.
  }
  return 'default';
})();

const AUSTIN_ENERGY_DEFAULTS = {
  retailRate: 11.6,
  vosRate: 9.91,
  planType: 'value_of_solar',
  installCost: 2950,
};

const AUSTIN_ENERGY_RATES = {
  customerCharge: 16.5,
  vosRate: 0.0991,
  citySalesTaxRate: 0.01,
  tierRates: [
    { maxKwh: 300, rate: 0.04640 },
    { maxKwh: 900, rate: 0.05138 },
    { maxKwh: 2000, rate: 0.07525 },
    { maxKwh: Infinity, rate: 0.10884 },
  ],
  perKwhCharges: {
    powerSupplyAdjustment: 0.04118,
    psaAdminAdjustment: -0.00206,
    regulatoryCharge: 0.01338,
    communityBenefitCharge: 0.01275,
  },
};

const PLAN_TYPE_DEFINITIONS = {
  net_billing: {
    label: 'Net billing',
    description: 'Imports are charged at retail and exports are credited at a separate export rate.',
    buybackLabel: 'Export credit rate',
    lockBuybackToRetail: false,
    forceBuybackRate: null,
  },
  net_metering: {
    label: '1:1 net metering',
    description: 'Imports and exports offset each other at the same energy rate over the billing period.',
    buybackLabel: 'Net metering credit rate',
    lockBuybackToRetail: true,
    forceBuybackRate: null,
  },
  no_export_credit: {
    label: 'No export credit',
    description: 'Only self-consumed solar creates savings. Exported power gets no bill credit.',
    buybackLabel: 'Export credit rate',
    lockBuybackToRetail: false,
    forceBuybackRate: 0,
  },
  value_of_solar: {
    label: 'Value of solar',
    description: 'All home usage, including power served directly by your own solar, is billed normally. All solar generation is credited separately at a value-of-solar rate.',
    buybackLabel: 'Value of solar credit rate',
    lockBuybackToRetail: false,
    forceBuybackRate: null,
  },
};

let monthlyChart;
let billChart;
let gridFlowChart;
let dailyChart;
let paybackChart;
let sizeMappingChart;
let googleSolarResult = null;
let googleSolarRawPayload = null;
let installCostLookup = null;
const GOOGLE_SOLAR_DATASET_CACHE = new WeakMap();
const CHART_BASE_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  transitions: {
    active: {
      animation: {
        duration: 0,
      },
    },
    resize: {
      animation: {
        duration: 0,
      },
    },
    show: {
      animation: {
        duration: 0,
      },
    },
    hide: {
      animation: {
        duration: 0,
      },
    },
  },
};
