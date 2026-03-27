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

function buildIntervalSolarProfile(monthIndex, intervalsPerHour = DAY_CHART_INTERVALS_PER_HOUR) {
  const hourlyProfile = buildMonthlySolarHourlyProfile(monthIndex);
  const rawProfile = Array.from({ length: 24 * intervalsPerHour }, (_, index) => (
    interpolateCyclicSeries(hourlyProfile, index, intervalsPerHour)
  ));
  return normalizeProfile(rawProfile);
}

function getInputs() {
  const systemSize = Number(document.getElementById('systemSize').value);
  const installCostPerKw = Number(document.getElementById('installCost').value);
  const batteryPower = Number(document.getElementById('batteryPower').value);
  const batteryCostPerKwh = Number(document.getElementById('batteryCost').value);
  const loanTermYears = Number(document.getElementById('loanTerm').value);
  const loanInterestRate = Number(document.getElementById('loanInterest').value) / 100;
  const dayMonth = Number(document.getElementById('dayMonth').value);
  const batteryCapacityKwh = batteryPower * 4;
  const solarInstallCost = systemSize * installCostPerKw;
  const batteryInstallCost = batteryCapacityKwh * batteryCostPerKwh;
  return {
    annualUsage: Number(document.getElementById('monthlyUsage').value) * 12,
    dayMonth,
    systemSize,
    installCostPerKw,
    batteryPower,
    batteryCostPerKwh,
    batteryCapacityKwh,
    solarInstallCost,
    batteryInstallCost,
    installCost: solarInstallCost + batteryInstallCost,
    loanTermYears,
    loanInterestRate,
    planType: APP_MODE === 'austin_energy' ? 'value_of_solar' : document.getElementById('planType').value,
    fixedCharge: DEFAULT_FIXED_UTILITY_CHARGE,
    retailRate: APP_MODE === 'austin_energy' ? AUSTIN_ENERGY_DEFAULTS.retailRate / 100 : Number(document.getElementById('retailRate').value) / 100,
    buybackRate: APP_MODE === 'austin_energy' ? AUSTIN_ENERGY_RATES.vosRate : Number(document.getElementById('buybackRate').value) / 100,
    rateEscalation: APP_MODE === 'austin_energy' ? 0 : Number(document.getElementById('rateEscalation').value) / 100,
    productionPerKw: Number(document.getElementById('productionPerKw').value),
  };
}

function getInputsForSystemSize(systemSize) {
  const inputs = getInputs();
  const roundedSystemSize = Math.max(0, Number(systemSize));
  const solarInstallCost = roundedSystemSize * inputs.installCostPerKw;
  return {
    ...inputs,
    systemSize: roundedSystemSize,
    solarInstallCost,
    installCost: solarInstallCost + inputs.batteryInstallCost,
  };
}

function getInputsForSystemAndBattery(systemSize, batteryPower) {
  const inputs = getInputs();
  const roundedSystemSize = Math.max(0, Number(systemSize));
  const roundedBatteryPower = Math.max(0, Number(batteryPower));
  const batteryCapacityKwh = roundedBatteryPower * 4;
  const solarInstallCost = roundedSystemSize * inputs.installCostPerKw;
  const batteryInstallCost = batteryCapacityKwh * inputs.batteryCostPerKwh;
  return {
    ...inputs,
    systemSize: roundedSystemSize,
    batteryPower: roundedBatteryPower,
    batteryCapacityKwh,
    solarInstallCost,
    batteryInstallCost,
    installCost: solarInstallCost + batteryInstallCost,
  };
}

function calculateAnnualLoanPayment(principal, annualRate, termYears) {
  if (principal <= 0 || termYears <= 0) return 0;
  if (annualRate <= 0) return principal / termYears;
  const monthlyRate = annualRate / 12;
  const numberOfPayments = termYears * 12;
  const monthlyPayment = principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -numberOfPayments));
  return monthlyPayment * 12;
}

function calculateAustinEnergyUsageBill(usageKwh, vosSolarCredit = 0) {
  const safeUsage = Math.max(0, usageKwh);
  let remainingUsage = safeUsage;
  let previousTierMax = 0;
  let tierEnergyCharge = 0;

  AUSTIN_ENERGY_RATES.tierRates.forEach((tier) => {
    if (remainingUsage <= 0) return;
    const tierSpan = Number.isFinite(tier.maxKwh) ? Math.max(0, tier.maxKwh - previousTierMax) : remainingUsage;
    const billedKwh = Math.min(remainingUsage, tierSpan);
    tierEnergyCharge += billedKwh * tier.rate;
    remainingUsage -= billedKwh;
    previousTierMax = tier.maxKwh;
  });

  const usageChargesPerKwh = Object.values(AUSTIN_ENERGY_RATES.perKwhCharges).reduce((sum, rate) => sum + rate, 0);
  const usageCharges = safeUsage * usageChargesPerKwh;
  // VOS credit is subtracted from the pre-tax subtotal so that city sales tax
  // is only applied to the net amount owed, not to the credited solar value.
  const subtotalBeforeTax = AUSTIN_ENERGY_RATES.customerCharge + tierEnergyCharge + usageCharges - Math.max(0, vosSolarCredit);
  const citySalesTax = subtotalBeforeTax * AUSTIN_ENERGY_RATES.citySalesTaxRate;

  return {
    subtotalBeforeTax,
    citySalesTax,
    total: subtotalBeforeTax + citySalesTax,
  };
}

function buildYearModel(inputs, yearIndex = 0, startingCreditBalance = 0) {
  const solarModel = buildSolarModel(inputs);
  const solarDegradationFactor = Math.pow(1 - 0.005, yearIndex);
  const annualUsage = inputs.annualUsage;
  const annualSolar = solarModel.annualSolarBase * solarDegradationFactor;
  const rateFactor = Math.pow(1 + inputs.rateEscalation, yearIndex);
  const retailRate = inputs.retailRate * rateFactor;
  const buybackRate = inputs.buybackRate * rateFactor;
  let creditBalance = Math.max(0, startingCreditBalance);
  const monthlyRows = MONTHS.map((month, monthIndex) => {
    const usage = annualUsage * MONTHLY_USAGE_PROFILE[monthIndex];
    const solar = annualSolar * solarModel.monthlyProfile[monthIndex];
    const flow = simulateMonthlyFlow(
      usage,
      solar,
      monthIndex,
      MONTH_DAYS[monthIndex],
      inputs.batteryPower,
      solarModel.hourlyProfiles[monthIndex]
      );
      const isAustinEnergyMode = APP_MODE === 'austin_energy';
      let grossBillWithSolar = 0;
      let exportCredits = 0;
      let billWithoutSolar = 0;
      if (isAustinEnergyMode) {
        // Bill all usage at Austin Energy tiered rates with no solar credit.
        billWithoutSolar = calculateAustinEnergyUsageBill(usage).total;
        // VOS credits all solar generation at the published VOS rate. The credit
        // is applied to the pre-tax subtotal so that city sales tax is only
        // assessed on the net amount owed, matching Austin Energy's billing
        // practice.
        exportCredits = solar * AUSTIN_ENERGY_RATES.vosRate;
        grossBillWithSolar = calculateAustinEnergyUsageBill(usage, exportCredits).total;
      } else {
        billWithoutSolar = (usage * retailRate) + inputs.fixedCharge;
        switch (inputs.planType) {
          case 'net_metering':
            exportCredits = flow.exported * retailRate;
            grossBillWithSolar = (flow.imported * retailRate) + inputs.fixedCharge - exportCredits;
            break;
          case 'no_export_credit':
            exportCredits = 0;
            grossBillWithSolar = (flow.imported * retailRate) + inputs.fixedCharge;
            break;
          case 'value_of_solar':
            exportCredits = solar * buybackRate;
            grossBillWithSolar = (usage * retailRate) + inputs.fixedCharge - exportCredits;
            break;
          case 'net_billing':
          default:
            exportCredits = flow.exported * buybackRate;
            grossBillWithSolar = (flow.imported * retailRate) + inputs.fixedCharge - exportCredits;
            break;
        }
      }
      const creditApplied = Math.min(creditBalance, Math.max(0, grossBillWithSolar));
      const billWithSolar = Math.max(0, grossBillWithSolar - creditApplied);
      creditBalance = Math.max(0, creditBalance - creditApplied + Math.max(0, -grossBillWithSolar));
      const avoidedUsageCost = flow.directSolar * retailRate;

      return {
      month,
      usage,
      solar,
      imported: flow.imported,
      exported: flow.exported,
      directSolar: flow.directSolar,
      batteryDischarge: flow.batteryDischarge,
      billWithoutSolar,
      billWithSolar,
      grossBillWithSolar,
      avoidedUsageCost,
      exportCredits,
      creditApplied,
      creditBalance,
      billSavings: billWithoutSolar - billWithSolar,
    };
  });

  const usageTotal = sumBy(monthlyRows, 'usage');
  const solarTotal = sumBy(monthlyRows, 'solar');
  const importTotal = sumBy(monthlyRows, 'imported');
  const exportTotal = sumBy(monthlyRows, 'exported');
  const directSolarTotal = sumBy(monthlyRows, 'directSolar');
  const batteryDischargeTotal = sumBy(monthlyRows, 'batteryDischarge');
  const billWithoutSolar = sumBy(monthlyRows, 'billWithoutSolar');
  const billWithSolar = sumBy(monthlyRows, 'billWithSolar');
  const savings = billWithoutSolar - billWithSolar;

  return {
    monthlyRows,
    usageTotal,
    solarTotal,
    importTotal,
    exportTotal,
    directSolarTotal,
    batteryDischargeTotal,
    billWithoutSolar,
    billWithSolar,
    savings,
    retailRate,
    buybackRate,
    endingCreditBalance: creditBalance,
  };
}

function buildMonthlySolarHourlyProfile(monthIndex) {
  const daylightHours = DAYLIGHT_HOURS_BY_MONTH[monthIndex] ?? 12;
  const sunrise = 12 - (daylightHours / 2);
  const sunset = 12 + (daylightHours / 2);

  const rawProfile = Array.from({ length: 24 }, (_, hour) => {
    const solarHour = hour + 0.5;
    if (solarHour <= sunrise || solarHour >= sunset) return 0;
    const progress = (solarHour - sunrise) / Math.max(0.01, sunset - sunrise);
    return Math.pow(Math.sin(Math.PI * progress), FALLBACK_SOLAR_PROFILE_EXPONENT);
  });

  return normalizeProfile(rawProfile);
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function getSolarDeclination(dayOfYear) {
  return toRadians(23.44) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
}

function getSolarPosition(latitudeDegrees, dayOfYear, solarHour) {
  const latitude = toRadians(latitudeDegrees);
  const declination = getSolarDeclination(dayOfYear);
  const hourAngle = toRadians(15 * (solarHour - 12));
  const sinAltitude = (Math.sin(latitude) * Math.sin(declination))
    + (Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  const altitude = Math.asin(clamp(sinAltitude, -1, 1));
  const cosAltitude = Math.max(1e-6, Math.cos(altitude));
  const sinAzimuth = -(Math.cos(declination) * Math.sin(hourAngle)) / cosAltitude;
  const cosAzimuth = (
    (Math.sin(declination) - (Math.sin(altitude) * Math.sin(latitude)))
    / (cosAltitude * Math.cos(latitude))
  );
  const azimuth = (toDegrees(Math.atan2(sinAzimuth, cosAzimuth)) + 360) % 360;
  return { altitude, azimuth };
}

function getPlaneOfArrayIrradiance(latitudeDegrees, dayOfYear, solarHour, roofAzimuthDegrees, roofTiltDegrees) {
  const { altitude, azimuth } = getSolarPosition(latitudeDegrees, dayOfYear, solarHour);
  if (altitude <= 0) return 0;

  const zenith = (Math.PI / 2) - altitude;
  const roofTilt = toRadians(roofTiltDegrees);
  const azimuthDifference = toRadians(azimuth - roofAzimuthDegrees);
  const cosIncidence = (
    (Math.cos(zenith) * Math.cos(roofTilt))
    + (Math.sin(zenith) * Math.sin(roofTilt) * Math.cos(azimuthDifference))
  );
  const directNormal = Math.pow(Math.max(0, Math.sin(altitude)), 1.15);
  const directPlane = directNormal * Math.max(0, cosIncidence);
  const diffusePlane = directNormal * 0.18 * ((1 + Math.cos(roofTilt)) / 2);
  const groundReflected = directNormal * 0.06 * ((1 - Math.cos(roofTilt)) / 2);
  return Math.max(0, directPlane + diffusePlane + groundReflected);
}

function buildRoofSegmentSolarShape(segment, latitudeDegrees, monthIndex, intervalsPerHour) {
  const intervalsPerDay = 24 * intervalsPerHour;
  const azimuth = Number(segment.azimuthDegrees) || 180;
  const pitch = Number(segment.pitchDegrees) || 25;
  const dayOfYear = REPRESENTATIVE_DAY_OF_YEAR[monthIndex] ?? 172;

  return Array.from({ length: intervalsPerDay }, (_, index) => {
    const hour = (index + 0.5) / intervalsPerHour;
    return getPlaneOfArrayIrradiance(latitudeDegrees, dayOfYear, hour, azimuth, pitch);
  });
}

function getGoogleSolarDataset(rawPayload) {
  const raw = rawPayload?.raw;
  const solarPotential = raw?.solarPotential;
  if (!solarPotential) return null;
  if (GOOGLE_SOLAR_DATASET_CACHE.has(rawPayload)) {
    return GOOGLE_SOLAR_DATASET_CACHE.get(rawPayload);
  }

  const roofSegments = Array.isArray(solarPotential.roofSegmentStats) ? solarPotential.roofSegmentStats : [];
  const solarPanels = Array.isArray(solarPotential.solarPanels) ? solarPotential.solarPanels : [];
  const panelCapacityWatts = Number(solarPotential.panelCapacityWatts) || 400;
  const wholeRoofMedianSun = Number(solarPotential.wholeRoofStats?.sunshineQuantiles?.[5]) || 1500;
  const latitudeDegrees = Number(raw?.center?.latitude ?? rawPayload?.request?.latitude ?? 30.2672);
  const segmentEntries = roofSegments.map((segment, segmentIndex) => {
    const sunshineStrength = clamp(
      (Number(segment.stats?.sunshineQuantiles?.[5]) || wholeRoofMedianSun) / Math.max(1, wholeRoofMedianSun),
      0.25,
      1.4
    );
    const monthlyWeights = [];
    const hourlyByMonth = MONTHS.map((_, monthIndex) => {
      const rawShape = buildRoofSegmentSolarShape(segment, latitudeDegrees, monthIndex, 1)
        .map((value) => value * sunshineStrength);
      const total = rawShape.reduce((sum, value) => sum + value, 0);
      monthlyWeights[monthIndex] = total;
      return normalizeProfile(rawShape.every((value) => value === 0) ? buildMonthlySolarHourlyProfile(monthIndex) : rawShape);
    });
    const dailyByMonth = MONTHS.map((_, monthIndex) => {
      const rawShape = buildRoofSegmentSolarShape(segment, latitudeDegrees, monthIndex, DAY_CHART_INTERVALS_PER_HOUR)
        .map((value) => value * sunshineStrength);
      return normalizeProfile(rawShape.every((value) => value === 0) ? buildIntervalSolarProfile(monthIndex) : rawShape);
    });
    return {
      segmentIndex,
      hourlyByMonth,
      dailyByMonth,
      monthlyWeights: normalizeProfile(monthlyWeights.every((value) => value === 0) ? MONTHLY_SOLAR_PROFILE : monthlyWeights),
    };
  });
  const segmentsByIndex = new Map(segmentEntries.map((entry) => [entry.segmentIndex, entry]));
  const sortedPanels = solarPanels
    .map((panel) => ({
      segmentIndex: Number(panel.segmentIndex),
      yearlyEnergyDcKwh: Number(panel.yearlyEnergyDcKwh) || 0,
    }))
    .filter((panel) => Number.isFinite(panel.segmentIndex))
    .sort((a, b) => b.yearlyEnergyDcKwh - a.yearlyEnergyDcKwh);
  const segmentSummaries = roofSegments.map((segment, segmentIndex) => {
    const segmentPanels = solarPanels.filter((panel) => Number(panel.segmentIndex) === segmentIndex);
    const panelCount = segmentPanels.length;
    const annualKwh = segmentPanels.reduce((sum, panel) => sum + (Number(panel.yearlyEnergyDcKwh) || 0), 0);
    const avgPanelKwh = panelCount > 0 ? annualKwh / panelCount : 0;
    const kwPerPanel = panelCapacityWatts / 1000;
    return {
      segmentIndex,
      azimuthDegrees: Number(segment.azimuthDegrees) || 0,
      pitchDegrees: Number(segment.pitchDegrees) || 0,
      panelCount,
      avgPanelKwh,
      kwhPerKw: kwPerPanel > 0 ? avgPanelKwh / kwPerPanel : 0,
    };
  }).filter((row) => row.panelCount > 0).sort((a, b) => b.kwhPerKw - a.kwhPerKw);

  const dataset = {
    panelCapacityWatts,
    maxRoofCapacityKw: (sortedPanels.length * panelCapacityWatts) / 1000,
    sortedPanels,
    segmentsByIndex,
    segmentSummaries,
  };
  GOOGLE_SOLAR_DATASET_CACHE.set(rawPayload, dataset);
  return dataset;
}

function allocateGooglePanels(dataset, systemSizeKw) {
  if (!dataset || !dataset.sortedPanels.length) {
    return {
      panelFractionsBySegment: new Map(),
      annualEnergyBySegment: new Map(),
      annualSolarBase: 0,
      exactPanels: 0,
    };
  }

  const requestedPanels = clamp((systemSizeKw * 1000) / dataset.panelCapacityWatts, 0, dataset.sortedPanels.length);
  const fullPanels = Math.floor(requestedPanels);
  const fractionalPanel = requestedPanels - fullPanels;
  const panelFractionsBySegment = new Map();
  const annualEnergyBySegment = new Map();
  let annualSolarBase = 0;

  for (let index = 0; index < fullPanels; index += 1) {
    const panel = dataset.sortedPanels[index];
    annualSolarBase += panel.yearlyEnergyDcKwh;
    panelFractionsBySegment.set(panel.segmentIndex, (panelFractionsBySegment.get(panel.segmentIndex) || 0) + 1);
    annualEnergyBySegment.set(panel.segmentIndex, (annualEnergyBySegment.get(panel.segmentIndex) || 0) + panel.yearlyEnergyDcKwh);
  }

  if (fractionalPanel > 1e-6 && dataset.sortedPanels[fullPanels]) {
    const panel = dataset.sortedPanels[fullPanels];
    annualSolarBase += panel.yearlyEnergyDcKwh * fractionalPanel;
    panelFractionsBySegment.set(panel.segmentIndex, (panelFractionsBySegment.get(panel.segmentIndex) || 0) + fractionalPanel);
    annualEnergyBySegment.set(
      panel.segmentIndex,
      (annualEnergyBySegment.get(panel.segmentIndex) || 0) + (panel.yearlyEnergyDcKwh * fractionalPanel)
    );
  }

  return {
    panelFractionsBySegment,
    annualEnergyBySegment,
    annualSolarBase,
    exactPanels: requestedPanels,
  };
}

function combineSegmentProfiles(annualEnergyBySegment, segmentsByIndex, monthProfilesKey) {
  const monthlyTotals = MONTHS.map(() => 0);
  const monthlyProfiles = MONTHS.map((_, monthIndex) => {
    const firstSegment = segmentsByIndex.values().next().value;
    const length = firstSegment?.[monthProfilesKey]?.[monthIndex]?.length || (monthProfilesKey === 'dailyByMonth' ? 96 : 24);
    return Array.from({ length }, () => 0);
  });

  annualEnergyBySegment.forEach((annualEnergy, segmentIndex) => {
    const segment = segmentsByIndex.get(segmentIndex);
    if (!segment) return;
    MONTHS.forEach((_, monthIndex) => {
      const segmentProfile = segment[monthProfilesKey][monthIndex];
      const contributionScale = annualEnergy * (segment.monthlyWeights?.[monthIndex] ?? (MONTHLY_SOLAR_PROFILE[monthIndex] ?? (1 / 12)));
      segmentProfile.forEach((value, profileIndex) => {
        monthlyProfiles[monthIndex][profileIndex] += value * contributionScale;
        monthlyTotals[monthIndex] += value * contributionScale;
      });
    });
  });

  return {
    monthlyTotals,
    monthlyProfiles: monthlyProfiles.map((profile, monthIndex) => {
      const total = monthlyTotals[monthIndex];
      if (total <= 0) {
        return monthProfilesKey === 'dailyByMonth'
          ? buildIntervalSolarProfile(monthIndex)
          : buildMonthlySolarHourlyProfile(monthIndex);
      }
      return profile.map((value) => value / total);
    }),
  };
}

function buildSolarModel(inputs) {
  const googleDataset = getGoogleSolarDataset(googleSolarRawPayload);
  if (!googleDataset) {
    return {
      annualSolarBase: inputs.systemSize * inputs.productionPerKw,
      monthlyProfile: MONTHLY_SOLAR_PROFILE,
      hourlyProfiles: MONTHS.map((_, monthIndex) => buildMonthlySolarHourlyProfile(monthIndex)),
      dailyProfiles: MONTHS.map((_, monthIndex) => buildIntervalSolarProfile(monthIndex)),
      maxRoofCapacityKw: null,
    };
  }

  const allocation = allocateGooglePanels(googleDataset, inputs.systemSize);
  const hourlyCombined = combineSegmentProfiles(allocation.annualEnergyBySegment, googleDataset.segmentsByIndex, 'hourlyByMonth');
  const dailyCombined = combineSegmentProfiles(allocation.annualEnergyBySegment, googleDataset.segmentsByIndex, 'dailyByMonth');
  const monthlyProfile = normalizeProfile(
    hourlyCombined.monthlyTotals.every((value) => value === 0)
      ? MONTHLY_SOLAR_PROFILE
      : hourlyCombined.monthlyTotals
  );

  return {
    annualSolarBase: allocation.annualSolarBase,
    monthlyProfile,
    hourlyProfiles: hourlyCombined.monthlyProfiles,
    dailyProfiles: dailyCombined.monthlyProfiles,
    maxRoofCapacityKw: googleDataset.maxRoofCapacityKw,
  };
}

function simulateMonthlyFlow(monthlyUsage, monthlySolar, monthIndex, daysInMonth, batteryPowerKw = 0, solarHourlyProfileOverride = null) {
  let imported = 0;
  let exported = 0;
  let directSolar = 0;
  let batteryDischarge = 0;
  const solarHourlyProfile = solarHourlyProfileOverride || buildMonthlySolarHourlyProfile(monthIndex);
  const batteryPower = Math.max(0, batteryPowerKw);
  const batteryCapacity = batteryPower * 4;

  for (let dayIndex = 0; dayIndex < daysInMonth; dayIndex += 1) {
    let soc = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      const load = (monthlyUsage * HOURLY_LOAD_PROFILE[hour]) / daysInMonth;
      const solar = (monthlySolar * solarHourlyProfile[hour]) / daysInMonth;
      const matchedSolar = Math.min(load, solar);
      directSolar += matchedSolar;
      const netAfterSolar = solar - load;

      if (netAfterSolar >= 0) {
        const charge = Math.min(netAfterSolar, batteryPower, batteryCapacity - soc);
        soc += charge;
        exported += Math.max(0, netAfterSolar - charge);
        continue;
      }

      const deficit = Math.max(0, load - solar);
      const discharge = Math.min(deficit, batteryPower, soc);
      soc -= discharge;
      batteryDischarge += discharge;
      imported += Math.max(0, deficit - discharge);
    }
  }

  return { imported, exported, directSolar, batteryDischarge };
}

function buildTenYearModel(inputs) {
  let creditBalance = 0;
  const yearlyResults = Array.from({ length: FINANCIAL_HORIZON_YEARS }, (_, yearIndex) => {
    const result = buildYearModel(inputs, yearIndex, creditBalance);
    creditBalance = result.endingCreditBalance;
    return result;
  });
  const totalInstallCost = inputs.installCost;
  const totalPanelInstallCost = inputs.solarInstallCost;
  const totalBatteryInstallCost = inputs.batteryInstallCost;
  const hasLoan = inputs.loanTermYears > 0;
  const annualLoanPayment = hasLoan
    ? calculateAnnualLoanPayment(totalInstallCost, inputs.loanInterestRate, inputs.loanTermYears)
    : 0;
  const totalLoanPaid = hasLoan ? (annualLoanPayment * inputs.loanTermYears) : totalInstallCost;
  const totalInterestPaid = Math.max(0, totalLoanPaid - totalInstallCost);

  let cumulativeCashAdvantage = -totalInstallCost;
  let paybackYear = null;

  yearlyResults.forEach((result, index) => {
    const yearlyLoanPayment = index < inputs.loanTermYears ? annualLoanPayment : 0;
    cumulativeCashAdvantage += result.savings - yearlyLoanPayment;
    if (paybackYear === null && cumulativeCashAdvantage >= 0) {
      paybackYear = index + 1;
    }
  });

  return {
    yearlyResults,
    hasLoan,
    loanTermYears: inputs.loanTermYears,
    totalPanelInstallCost,
    totalInstallCost,
    totalBatteryInstallCost,
    annualLoanPayment,
      totalLoanPaid,
      totalInterestPaid,
      endingCreditBalance: creditBalance,
      totalSavings: yearlyResults.reduce((sum, result) => sum + result.savings, 0),
      averageSavings: yearlyResults.reduce((sum, result) => sum + result.savings, 0) / yearlyResults.length,
      paybackYear,
  };
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + row[key], 0);
}

function updateValueLabels() {
  Object.entries(FIELD_FORMATTERS).forEach(([fieldId, formatter]) => {
    const input = document.getElementById(fieldId);
    const label = document.getElementById(`${fieldId}Value`);
    if (input && label) {
      label.textContent = formatter(Number(input.value));
    }
  });
  const planTypeLabel = document.getElementById('planTypeValue');
  if (planTypeLabel) {
    const planType = document.getElementById('planType')?.value || DEFAULTS.planType;
    planTypeLabel.textContent = (PLAN_TYPE_DEFINITIONS[planType] || PLAN_TYPE_DEFINITIONS.net_billing).label;
  }

  const inputs = getInputs();
  const panelInline = document.getElementById('panelCostInline');
  const batteryInline = document.getElementById('batteryCostInline');
  const totalCostInline = document.getElementById('totalCostInline');
  if (panelInline) panelInline.textContent = formatCurrency(inputs.solarInstallCost);
  if (batteryInline) batteryInline.textContent = formatCurrency(inputs.batteryInstallCost);
  if (totalCostInline) {
    const rawTotal = inputs.solarInstallCost + inputs.batteryInstallCost;
    const total = APP_MODE === 'austin_energy' ? rawTotal - 2500 : rawTotal;
    totalCostInline.textContent = formatCurrency(total);
  }

  const loanTermLabel = document.getElementById('loanTermValue');
  const loanTermValue = Number(document.getElementById('loanTerm').value);
  if (loanTermLabel) {
    loanTermLabel.textContent = loanTermValue > 0 ? `${loanTermValue} years` : 'No loan';
  }

  const loanInterestField = document.getElementById('loanInterestField');
  if (loanInterestField) {
    loanInterestField.hidden = loanTermValue === 0;
  }
}

function syncPowerPlanUi() {
  const planTypeField = document.getElementById('planTypeField');
  const retailRateField = document.getElementById('retailRateField');
  const buybackField = document.getElementById('buybackRateField');
  const rateEscalationField = document.getElementById('rateEscalationField');
  const planTypeSelect = document.getElementById('planType');
  const planType = document.getElementById('planType')?.value || DEFAULTS.planType;
  let definition = PLAN_TYPE_DEFINITIONS[planType] || PLAN_TYPE_DEFINITIONS.net_billing;
  const retailRateInput = document.getElementById('retailRate');
  const buybackRateInput = document.getElementById('buybackRate');
  const buybackLabel = document.getElementById('buybackRateLabel');
  const planTypeDescription = document.getElementById('planTypeDescription');

  if (APP_MODE === 'austin_energy') {
    if (planTypeSelect) {
      planTypeSelect.value = AUSTIN_ENERGY_DEFAULTS.planType;
    }
    if (buybackRateInput) {
      buybackRateInput.value = String(AUSTIN_ENERGY_DEFAULTS.vosRate);
    }
    definition = PLAN_TYPE_DEFINITIONS.value_of_solar;
    if (planTypeField) {
      planTypeField.hidden = true;
      planTypeField.style.display = 'none';
    }
    if (retailRateField) {
      retailRateField.hidden = true;
      retailRateField.style.display = 'none';
    }
    if (buybackField) {
      buybackField.hidden = true;
      buybackField.style.display = 'none';
    }
    if (rateEscalationField) {
      rateEscalationField.hidden = true;
      rateEscalationField.style.display = 'none';
    }
    const austinRebateRow = document.getElementById('austinRebateRow');
    if (austinRebateRow) {
      austinRebateRow.hidden = false;
    }
    const austinRebateInline = document.getElementById('austinRebateInline');
    if (austinRebateInline) {
      austinRebateInline.textContent = '-$2,500';
    }
    document.querySelectorAll('.benchmark-row').forEach((row) => {
      row.hidden = true;
      row.style.display = 'none';
    });
  } else {
    if (planTypeField) {
      planTypeField.hidden = false;
      planTypeField.style.display = '';
    }
    if (retailRateField) {
      retailRateField.hidden = false;
      retailRateField.style.display = '';
    }
    if (buybackField) {
      buybackField.hidden = false;
      buybackField.style.display = '';
    }
    if (rateEscalationField) {
      rateEscalationField.hidden = false;
      rateEscalationField.style.display = '';
    }
    const austinRebateRow = document.getElementById('austinRebateRow');
    if (austinRebateRow) {
      austinRebateRow.hidden = true;
    }
    document.querySelectorAll('.benchmark-row').forEach((row) => {
      row.hidden = false;
      row.style.display = '';
    });
  }

  if (definition.lockBuybackToRetail && retailRateInput && buybackRateInput) {
    buybackRateInput.value = retailRateInput.value;
  }
  if (definition.forceBuybackRate !== null && buybackRateInput) {
    buybackRateInput.value = String(definition.forceBuybackRate);
  }
  if (buybackRateInput) {
    buybackRateInput.disabled = APP_MODE === 'austin_energy' || definition.lockBuybackToRetail || definition.forceBuybackRate !== null;
  }
  if (buybackLabel) {
    buybackLabel.textContent = definition.buybackLabel;
  }
  if (planTypeDescription) {
    if (APP_MODE === 'austin_energy') {
      planTypeDescription.textContent = 'Using Austin Energy configuration. All home usage is billed normally and all solar generation is credited at the Value of Solar rate. See docs for more info.';
    } else {
      planTypeDescription.textContent = definition.description;
    }
  }
}

function applyAppModeDefaults() {
  if (APP_MODE !== 'austin_energy') return;
  const retailRateInput = document.getElementById('retailRate');
  const buybackRateInput = document.getElementById('buybackRate');
  const planTypeSelect = document.getElementById('planType');
  const installCostInput = document.getElementById('installCost');
  if (retailRateInput) {
    retailRateInput.value = String(AUSTIN_ENERGY_DEFAULTS.retailRate);
  }
  if (buybackRateInput) {
    buybackRateInput.value = String(AUSTIN_ENERGY_DEFAULTS.vosRate);
  }
  if (planTypeSelect) {
    planTypeSelect.value = AUSTIN_ENERGY_DEFAULTS.planType;
  }
  if (installCostInput) {
    installCostInput.value = String(AUSTIN_ENERGY_DEFAULTS.installCost);
  }
  const rateEscalationInput = document.getElementById('rateEscalation');
  if (rateEscalationInput) {
    rateEscalationInput.value = '0';
  }
  const heroEyebrow = document.getElementById('heroEyebrow');
  if (heroEyebrow) {
    heroEyebrow.textContent = 'Austin Energy Solar';
  }
  const heroTitle = document.getElementById('heroTitle');
  if (heroTitle) {
    heroTitle.textContent = 'Personal Solar Calculator';
  }
  const heroDescription = document.getElementById('heroDescription');
  if (heroDescription) {
    heroDescription.textContent = "Model your home solar system using Austin Energy\u2019s Value of Solar tariff and published rate schedule. See your estimated monthly bills, credits, and 30-year financial outlook based on real Austin Energy pricing.";
  }
}

function syncAustinDocs() {
  const wrap = document.getElementById('austinDocsWrap');
  if (!wrap) return;
  const isAustinEnergyMode = APP_MODE === 'austin_energy';
  wrap.hidden = !isAustinEnergyMode;
  wrap.style.display = isAustinEnergyMode ? '' : 'none';
  if (!isAustinEnergyMode) return;

  const values = {
    austinDocVosRate: formatNumber(AUSTIN_ENERGY_RATES.vosRate * 100, 2),
    austinDocCustomerCharge: formatCurrencyPrecise(AUSTIN_ENERGY_RATES.customerCharge),
    austinDocTier1: formatNumber(AUSTIN_ENERGY_RATES.tierRates[0].rate * 100, 3),
    austinDocTier2: formatNumber(AUSTIN_ENERGY_RATES.tierRates[1].rate * 100, 3),
    austinDocTier3: formatNumber(AUSTIN_ENERGY_RATES.tierRates[2].rate * 100, 3),
    austinDocTier4: formatNumber(AUSTIN_ENERGY_RATES.tierRates[3].rate * 100, 3),
    austinDocPsa: formatNumber(AUSTIN_ENERGY_RATES.perKwhCharges.powerSupplyAdjustment * 100, 3),
    austinDocPsaAdmin: formatNumber(AUSTIN_ENERGY_RATES.perKwhCharges.psaAdminAdjustment * 100, 3),
    austinDocRegulatory: formatNumber(AUSTIN_ENERGY_RATES.perKwhCharges.regulatoryCharge * 100, 3),
    austinDocCommunity: formatNumber(AUSTIN_ENERGY_RATES.perKwhCharges.communityBenefitCharge * 100, 3),
    austinDocTax: formatNumber(AUSTIN_ENERGY_RATES.citySalesTaxRate * 100, 1),
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  });
}

function updateKpis(yearOne, tenYear) {
  const averageMonthlySavings = yearOne.savings / 12;
  const averageMonthlyBillWithSolar = yearOne.billWithSolar / 12;
  const averageMonthlyBillWithoutSolar = yearOne.billWithoutSolar / 12;
  const billReductionPct = yearOne.billWithoutSolar > 0
    ? (yearOne.savings / yearOne.billWithoutSolar) * 100
    : 0;
  const tenYearNet = tenYear.totalSavings - tenYear.totalInstallCost;

  document.getElementById('kpiYearOneSavings').textContent = formatCurrency(averageMonthlySavings);
  document.getElementById('kpiOffset').textContent = `${formatNumber(billReductionPct, 1)}% bill reduction`;
  document.getElementById('kpiBillWithSolar').textContent = formatCurrency(averageMonthlyBillWithSolar);
  document.getElementById('kpiBillWithoutSolar').textContent = `${formatCurrency(averageMonthlyBillWithoutSolar)} without solar`;
  document.getElementById('kpiTenYearValue').textContent = formatCurrency(tenYearNet);
  document.getElementById('kpiPayback').textContent = tenYear.paybackYear ? `Estimated payback in year ${tenYear.paybackYear}` : 'Payback not reached';
}

function updateTables(yearOne, tenYear) {
  const finalYear = tenYear.yearlyResults[FINANCIAL_HORIZON_YEARS - 1];
  const tenYearNet = tenYear.totalSavings - tenYear.totalInstallCost;
  document.getElementById('panelInstallCostCell').textContent = formatCurrency(tenYear.totalPanelInstallCost);
  document.getElementById('batteryInstallCostCell').textContent = formatCurrency(tenYear.totalBatteryInstallCost);
  document.getElementById('totalInstallCostCell').textContent = formatCurrency(tenYear.totalInstallCost);
  document.getElementById('annualLoanPaymentCell').textContent = formatCurrency(tenYear.annualLoanPayment);
  document.getElementById('totalInterestPaidCell').textContent = formatCurrency(tenYear.totalInterestPaid);
  document.getElementById('totalLoanPaidCell').textContent = formatCurrency(tenYear.totalLoanPaid);

  document.getElementById('tenYearSavingsCell').textContent = formatCurrency(tenYear.totalSavings);
  document.getElementById('tenYearNetCell').textContent = formatCurrency(tenYearNet);
  document.getElementById('avgAnnualSavingsCell').textContent = formatCurrency(tenYear.averageSavings);
  document.getElementById('yearTenSavingsCell').textContent = formatCurrency(finalYear.savings);
  document.getElementById('paybackCell').textContent = tenYear.paybackYear ? `Year ${tenYear.paybackYear}` : `Not in ${FINANCIAL_HORIZON_YEARS} years`;
  document.getElementById('yearTenSolarCell').textContent = `${formatNumber(finalYear.solarTotal, 0)} kWh`;

  const monthlyBillsTable = document.getElementById('monthlyBillsTable');
  if (monthlyBillsTable) {
    const billRows = yearOne.monthlyRows;
    const withoutCells = billRows.map(r => `<td>${formatCurrency(r.billWithoutSolar)}</td>`).join('');
    const withCells    = billRows.map(r => `<td class="cell-with-solar">${formatCurrency(r.billWithSolar)}</td>`).join('');
    const diffCells    = billRows.map(r => {
      const cls = r.billSavings > 0 ? 'cell-diff diff-savings' : r.billSavings < 0 ? 'cell-diff diff-cost' : 'cell-diff';
      return `<td class="${cls}">${formatCurrency(r.billSavings)}</td>`;
    }).join('');
    monthlyBillsTable.querySelector('tbody').innerHTML =
      `<tr><th>Without solar</th>${withoutCells}</tr>` +
      `<tr><th>With solar</th>${withCells}</tr>` +
      `<tr><th>Difference</th>${diffCells}</tr>`;
  }

  const monthlyFlowTable = document.getElementById('monthlyFlowTable');
  if (monthlyFlowTable) {
    const flowRows = yearOne.monthlyRows;
    const usageCells   = flowRows.map(r => `<td>${formatNumber(r.usage, 0)} kWh</td>`).join('');
    const importCells  = flowRows.map(r => `<td>${formatNumber(r.imported, 0)} kWh</td>`).join('');
    const exportCells  = flowRows.map(r => `<td>${formatNumber(r.exported, 0)} kWh</td>`).join('');
    const solarCells   = flowRows.map(r => `<td>${formatNumber(r.usage > 0 ? (((r.directSolar + r.batteryDischarge) / r.usage) * 100) : 0, 1)}%</td>`).join('');
    monthlyFlowTable.querySelector('tbody').innerHTML =
      `<tr><th>Usage</th>${usageCells}</tr>` +
      `<tr><th>Import</th>${importCells}</tr>` +
      `<tr><th>Export</th>${exportCells}</tr>` +
      `<tr><th>Solar used</th>${solarCells}</tr>`;
  }
}

function updateDayMonthLabel() {
  const monthIndex = Number(document.getElementById('dayMonth').value);
  const label = document.getElementById('dayMonthValue');
  if (label) label.textContent = MONTHS[monthIndex] ?? MONTHS[0];
}

function getGoogleLookupElements() {
  return {
    addressInput: document.getElementById('googleAddress'),
    lookupButton: document.getElementById('googleLookupButton'),
    applyButton: document.getElementById('googleApplyButton'),
    status: document.getElementById('googleLookupStatus'),
    results: document.getElementById('googleLookupResults'),
    resultAddress: document.getElementById('googleResultAddress'),
    resultPanels: document.getElementById('googleResultPanels'),
    resultSize: document.getElementById('googleResultSize'),
    resultProduction: document.getElementById('googleResultProduction'),
    resultInstallCost: document.getElementById('googleResultInstallCost'),
    resultInstallCostSource: document.getElementById('googleResultInstallCostSource'),
    mapFrame: document.getElementById('googleLookupMap'),
    segmentTableWrap: document.getElementById('googleSegmentTableWrap'),
    segmentTableMeta: document.getElementById('googleSegmentTableMeta'),
    segmentTable: document.getElementById('googleSegmentTable'),
    error: document.getElementById('googleLookupError'),
  };
}

function setUiError(message = '') {
  const errorEl = document.getElementById('googleLookupError');
  if (!errorEl) return;
  errorEl.hidden = !message;
  errorEl.textContent = message;
}

function syncProductionFieldVisibility() {
  const productionField = document.getElementById('productionPerKwField');
  if (!productionField) return;
  const hasRoofData = Boolean(googleSolarRawPayload?.raw?.solarPotential);
  productionField.hidden = hasRoofData;
  productionField.style.display = hasRoofData ? 'none' : '';
}

function getLookupMapZoom(payload) {
  const solarPotential = payload?.raw?.solarPotential;
  const roofArea =
    Number(solarPotential?.wholeRoofStats?.areaMeters2)
    || Number(solarPotential?.maxArrayAreaMeters2)
    || 0;
  if (roofArea >= 4000) return 18;
  if (roofArea >= 2000) return 19;
  if (roofArea >= 1000) return 20;
  return 21;
}

function buildLookupMapUrl(payload, result) {
  const zoom = getLookupMapZoom(payload);
  // Prefer the building center from the Solar API response (always present on success),
  // then fall back to the geocoded coordinates stored on the request object.
  const latitude = payload?.raw?.center?.latitude ?? payload?.request?.latitude;
  const longitude = payload?.raw?.center?.longitude ?? payload?.request?.longitude;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}&t=k&z=${zoom}&output=embed`;
  }
  const address = result?.address || payload?.summary?.formattedAddress || payload?.request?.address || '';
  if (address) {
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&t=k&z=${zoom}&output=embed`;
  }
  return 'https://www.google.com/maps?q=Austin%2C%20TX&output=embed';
}

function syncSystemSizeSliderMax() {
  const systemSizeInput = document.getElementById('systemSize');
  if (!systemSizeInput) return;
  const dataset = getGoogleSolarDataset(googleSolarRawPayload);
  const fallbackMax = 32;
  const nextMax = dataset?.maxRoofCapacityKw
    ? Math.max(0.5, Number(dataset.maxRoofCapacityKw.toFixed(1)))
    : fallbackMax;
  systemSizeInput.max = String(nextMax);
  if (Number(systemSizeInput.value) > nextMax) {
    systemSizeInput.value = String(nextMax);
  }
}

function getBestSolarConfig(rawPayload) {
  const configs = Array.isArray(rawPayload?.raw?.solarPotential?.solarPanelConfigs)
    ? rawPayload.raw.solarPotential.solarPanelConfigs
    : [];
  return configs.reduce((best, current) => {
    if (!best) return current;
    return (current.yearlyEnergyDcKwh || 0) > (best.yearlyEnergyDcKwh || 0) ? current : best;
  }, null);
}

function pickPanelsForConfig(rawPayload, config) {
  const allPanels = Array.isArray(rawPayload?.raw?.solarPotential?.solarPanels)
    ? rawPayload.raw.solarPotential.solarPanels
    : [];
  const summaries = Array.isArray(config?.roofSegmentSummaries) ? config.roofSegmentSummaries : [];
  const selectedPanels = [];

  summaries.forEach((summary) => {
    const count = Number(summary.panelsCount) || 0;
    const segmentIndex = Number(summary.segmentIndex);
    const candidates = allPanels
      .filter((panel) => Number(panel.segmentIndex) === segmentIndex)
      .sort((a, b) => (b.yearlyEnergyDcKwh || 0) - (a.yearlyEnergyDcKwh || 0))
      .slice(0, count);
    selectedPanels.push(...candidates);
  });

  return selectedPanels;
}

function renderGoogleSegmentTable(systemSizeKw = null) {
  const els = getGoogleLookupElements();
  const dataset = getGoogleSolarDataset(googleSolarRawPayload);
  const rows = dataset?.segmentSummaries || [];
  const allocation = dataset && Number.isFinite(systemSizeKw)
    ? allocateGooglePanels(dataset, systemSizeKw)
    : null;
  const allocatedPanelsBySegment = allocation?.panelFractionsBySegment || new Map();

    if (!rows.length) {
      els.segmentTableWrap.hidden = true;
      if (els.segmentTableMeta) els.segmentTableMeta.textContent = 'Waiting for lookup';
      if (els.segmentTable) {
        els.segmentTable.querySelector('tbody').innerHTML = '<tr><td colspan="4">No roof data loaded.</td></tr>';
      }
      return;
    }

  els.segmentTableWrap.hidden = false;
    els.segmentTableMeta.textContent = `${formatNumber(rows.length, 0)} segments sorted best to worst`;
    els.segmentTable.querySelector('tbody').innerHTML = rows.map((row) => `
      <tr class="${(allocatedPanelsBySegment.get(row.segmentIndex) || 0) > 0 ? '' : 'is-inactive'}">
        <td>${formatNumber(row.azimuthDegrees, 0)} deg</td>
        <td>${formatNumber(row.pitchDegrees, 1)} deg</td>
        <td>${formatNumber(Math.round(allocatedPanelsBySegment.get(row.segmentIndex) || 0), 0)}/${formatNumber(row.panelCount, 0)}</td>
        <td>${formatNumber(row.avgPanelKwh, 1)}</td>
      </tr>
    `).join('');
  }

function summarizeGoogleSolarResult(payload) {
  const summary = payload?.summary || {};
  const bestConfig = summary.bestConfig || {};
  const panelCapacityWatts = Number(summary.panelCapacityWatts);
  const maxPanels = Number(summary.maxArrayPanelsCount);
  const bestConfigPanels = Number(bestConfig.panelsCount);
  const suggestedPanels = Number.isFinite(bestConfigPanels) && bestConfigPanels > 0
    ? bestConfigPanels
    : maxPanels;
  const suggestedSystemSizeKw = Number.isFinite(suggestedPanels) && Number.isFinite(panelCapacityWatts)
    ? (suggestedPanels * panelCapacityWatts) / 1000
    : null;
  const bestConfigEnergy = Number(bestConfig.yearlyEnergyDcKwh);
  const suggestedProductionPerKw = Number.isFinite(bestConfigEnergy) && Number.isFinite(suggestedSystemSizeKw) && suggestedSystemSizeKw > 0
    ? bestConfigEnergy / suggestedSystemSizeKw
    : null;
  const parsedAddress = parseAddressLocation(summary.formattedAddress || payload?.request?.address);
  const stateCode = normalizeStateCode(payload?.request?.stateCode) || parsedAddress.stateCode;
  const postalCode = normalizeZipCode(payload?.request?.postalCode) || parsedAddress.postalCode;
  const installCostBenchmark = getInstallCostBenchmark({ stateCode, postalCode });

  return {
    address: summary.formattedAddress || payload?.request?.address || 'Address not available',
    stateCode,
    postalCode,
    maxPanels: Number.isFinite(maxPanels) ? maxPanels : null,
    suggestedSystemSizeKw,
    suggestedProductionPerKw,
    installCostBenchmark,
  };
}

function renderGoogleLookupResult() {
  const els = getGoogleLookupElements();
  const hasResult = Boolean(googleSolarResult);
  syncSystemSizeSliderMax();
  syncProductionFieldVisibility();
  els.results.hidden = !hasResult;
  els.applyButton.disabled = !hasResult;
  if (!hasResult) {
    els.resultAddress.textContent = '-';
    els.resultPanels.textContent = '-';
    els.resultSize.textContent = '-';
      els.resultProduction.textContent = '-';
      els.resultInstallCost.textContent = '-';
      els.resultInstallCostSource.textContent = '-';
      if (els.mapFrame) els.mapFrame.src = buildLookupMapUrl(null, null);
      renderGoogleSegmentTable(null);
      return;
    }

  els.resultAddress.textContent = googleSolarResult.address;
  els.resultPanels.textContent = googleSolarResult.maxPanels !== null
    ? `${formatNumber(googleSolarResult.maxPanels, 0)} panels`
    : '-';
  els.resultSize.textContent = formatLookupSizeKw(googleSolarResult.suggestedSystemSizeKw);
    els.resultProduction.textContent = formatLookupProduction(googleSolarResult.suggestedProductionPerKw);
    els.resultInstallCost.textContent = formatLookupInstallCost(googleSolarResult.installCostBenchmark?.value);
    els.resultInstallCostSource.textContent = googleSolarResult.installCostBenchmark
      ? `${googleSolarResult.installCostBenchmark.source} (${formatNumber(googleSolarResult.installCostBenchmark.count, 0)} samples)`
      : 'No benchmark for this address';
    if (els.mapFrame) els.mapFrame.src = buildLookupMapUrl(googleSolarRawPayload, googleSolarResult);
    renderGoogleSegmentTable(Number(document.getElementById('systemSize')?.value));
  }

async function lookupGoogleRoof() {
  const els = getGoogleLookupElements();
  const address = els.addressInput.value.trim();
  if (!address) {
    els.status.textContent = 'Enter an address to look up a roof.';
    els.results.hidden = true;
    els.applyButton.disabled = true;
    googleSolarResult = null;
    googleSolarRawPayload = null;
    renderGoogleLookupResult();
    return;
  }

  els.lookupButton.disabled = true;
  els.applyButton.disabled = true;
  els.status.textContent = 'Looking up roof data from Google Solar...';

  try {
    const response = await fetch(`/.netlify/functions/solar-insights?address=${encodeURIComponent(address)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Google roof lookup failed.');
    }

      googleSolarRawPayload = payload;
      googleSolarResult = summarizeGoogleSolarResult(payload);
      syncInstallCostFromGoogleResult();
      setUiError('');
      renderGoogleLookupResult();
      els.status.textContent = 'Roof lookup complete. You can apply the suggested size and production now.';
  } catch (error) {
    googleSolarResult = null;
    googleSolarRawPayload = { error: error.message || 'Unknown Google roof lookup error.' };
    setUiError(error.message || 'Unknown Google roof lookup error.');
    renderGoogleLookupResult();
    els.status.textContent = `${error.message} Run this through Netlify locally so the function is available.`;
  } finally {
    els.lookupButton.disabled = false;
    els.applyButton.disabled = !googleSolarResult;
  }
}

function applyGoogleRoofResult() {
  if (!googleSolarResult) return;

  const systemSizeInput = document.getElementById('systemSize');
  const productionInput = document.getElementById('productionPerKw');
  const suggestedSize = googleSolarResult.suggestedSystemSizeKw;
  const suggestedProduction = googleSolarResult.suggestedProductionPerKw;

  if (Number.isFinite(suggestedSize)) {
    const clampedSize = Math.min(Number(systemSizeInput.max), Math.max(Number(systemSizeInput.min), suggestedSize));
    systemSizeInput.value = String(Number(clampedSize.toFixed(1)));
  }

  if (Number.isFinite(suggestedProduction)) {
    const clampedProduction = Math.min(Number(productionInput.max), Math.max(Number(productionInput.min), suggestedProduction));
    productionInput.value = String(Math.round(clampedProduction / 10) * 10);
  }

  applyInstallCostBenchmark(googleSolarResult.installCostBenchmark);

  const status = document.getElementById('googleLookupStatus');
  status.textContent = googleSolarResult.installCostBenchmark
    ? 'Applied Google roof size, production, and install cost benchmark.'
    : 'Applied Google roof size and production.';
  updateCalculator();
}

async function loadInstallCostLookup() {
  try {
    const response = await fetch('install-cost-lookup.json');
    if (!response.ok) {
      throw new Error(`Install cost lookup request failed with ${response.status}`);
    }
    installCostLookup = await response.json();
    if (googleSolarRawPayload) {
      googleSolarResult = summarizeGoogleSolarResult(googleSolarRawPayload);
      renderGoogleLookupResult();
    }
  } catch (error) {
    installCostLookup = null;
  }
}

async function loadSampleGoogleRoofData() {
  try {
    const response = await fetch('sampledata.json');
    if (!response.ok) {
      throw new Error(`Sample roof data request failed with ${response.status}`);
    }
    const payload = await response.json();
    googleSolarRawPayload = payload;
    googleSolarResult = summarizeGoogleSolarResult(payload);
    syncInstallCostFromGoogleResult();
    const elements = getGoogleLookupElements();
    if (elements.addressInput && !elements.addressInput.value) {
      elements.addressInput.value = payload?.summary?.formattedAddress || payload?.request?.address || '';
    }
    setUiError('');
    renderGoogleLookupResult();
  } catch (error) {
    const elements = getGoogleLookupElements();
    setUiError(error.message || 'Sample roof data could not be loaded.');
  }
}

function interpolateCyclicSeries(hourlySeries, index, intervalsPerHour) {
  const baseIndex = Math.floor(index / intervalsPerHour);
  const nextIndex = (baseIndex + 1) % hourlySeries.length;
  const fraction = (index % intervalsPerHour) / intervalsPerHour;
  const start = hourlySeries[baseIndex];
  const end = hourlySeries[nextIndex];
  return start + ((end - start) * fraction);
}

function interpolateLinearSeries(series, subdivisionsPerStep) {
  return series.flatMap((value, index) => {
    const nextValue = series[Math.min(series.length - 1, index + 1)];
    return Array.from({ length: subdivisionsPerStep }, (_, subIndex) => {
      const fraction = subIndex / subdivisionsPerStep;
      return value + ((nextValue - value) * fraction);
    });
  });
}

function smoothSeries(series, windowRadius = 2) {
  return series.map((_, index) => {
    let total = 0;
    let weightTotal = 0;

    for (let offset = -windowRadius; offset <= windowRadius; offset += 1) {
      const sampleIndex = Math.min(series.length - 1, Math.max(0, index + offset));
      const weight = windowRadius + 1 - Math.abs(offset);
      total += series[sampleIndex] * weight;
      weightTotal += weight;
    }

    return weightTotal > 0 ? total / weightTotal : series[index];
  });
}

function buildDailySeries(inputs) {
  const solarModel = buildSolarModel(inputs);
  const selectedMonthIndex = inputs.dayMonth ?? 6;
  const annualAverageDailyUsage = inputs.annualUsage / 365;
  const monthlyUsageFactor = (MONTHLY_USAGE_PROFILE[selectedMonthIndex] ?? 0) * 12;
  const dailyUsage = annualAverageDailyUsage * monthlyUsageFactor;
  const dailySolar = (solarModel.annualSolarBase * solarModel.monthlyProfile[selectedMonthIndex]) / MONTH_DAYS[selectedMonthIndex];
  const solarProfile = solarModel.dailyProfiles[selectedMonthIndex];
  const batteryPower = Math.max(0, inputs.batteryPower);
  const batteryCapacity = batteryPower * 4;
  const intervalsPerDay = 24 * DAY_CHART_INTERVALS_PER_HOUR;
  const loadShape = Array.from({ length: intervalsPerDay }, (_, index) => (
    interpolateCyclicSeries(HOURLY_LOAD_PROFILE, index, DAY_CHART_INTERVALS_PER_HOUR)
  ));
  const solarShape = Array.from({ length: intervalsPerDay }, (_, index) => solarProfile[index] ?? 0);
  const load = normalizeProfile(loadShape).map((factor) => dailyUsage * factor * DAY_CHART_INTERVALS_PER_HOUR);
  const solar = normalizeProfile(solarShape).map((factor) => dailySolar * factor * DAY_CHART_INTERVALS_PER_HOUR);
  const batteryChargeBars = [];
  const batteryDischargeBars = [];
  let soc = 0;

  for (let interval = 0; interval < intervalsPerDay; interval += 1) {
    const netAfterSolar = solar[interval] - load[interval];
    if (netAfterSolar >= 0) {
      const charge = Math.min(netAfterSolar, batteryPower * DAY_CHART_DT_HOURS, batteryCapacity - soc);
      soc += charge;
      batteryChargeBars.push(charge > 1e-6 ? [load[interval], load[interval] + charge] : null);
      batteryDischargeBars.push(null);
      continue;
    }

    const deficit = Math.max(0, load[interval] - solar[interval]);
    const discharge = Math.min(deficit, batteryPower * DAY_CHART_DT_HOURS, soc);
    soc -= discharge;
    batteryChargeBars.push(null);
    batteryDischargeBars.push(discharge > 1e-6 ? [solar[interval], solar[interval] + discharge] : null);
  }

  const labels = Array.from({ length: intervalsPerDay }, (_, index) => {
    const totalMinutes = index * 15;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${hour}:${String(minute).padStart(2, '0')}`;
  });

  return { labels, load, solar, batteryChargeBars, batteryDischargeBars };
}

function renderMonthlyChart(yearOne) {
  const ctx = document.getElementById('monthlyChart');
  const interpolatedUsage = smoothSeries(interpolateLinearSeries(yearOne.monthlyRows.map((row) => row.usage), 4));
  const interpolatedSolar = smoothSeries(interpolateLinearSeries(yearOne.monthlyRows.map((row) => row.solar), 4));
  const monthlySlices = interpolatedUsage.map((usage, index) => ({
    label: `${MONTHS[Math.min(MONTHS.length - 1, Math.floor(index / 4))]} ${((index % 4) + 1)}`,
    usage,
    solar: interpolatedSolar[index],
  }));
  const data = {
    labels: monthlySlices.map((slice) => slice.label),
    datasets: [
      {
        type: 'bar',
        label: 'Home usage',
        data: monthlySlices.map((slice) => slice.usage),
        borderColor: 'rgba(37, 99, 166, 0)',
        backgroundColor: 'rgba(37, 99, 166, 0.42)',
        borderSkipped: false,
        borderRadius: 0,
        grouped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        order: 2,
      },
      {
        type: 'bar',
        label: 'Solar production',
        data: monthlySlices.map((slice) => slice.solar),
        borderColor: 'rgba(244, 161, 26, 0)',
        backgroundColor: 'rgba(244, 161, 26, 0.44)',
        borderSkipped: false,
        borderRadius: 0,
        grouped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        order: 3,
      },
    ],
  };

  const options = {
    ...CHART_BASE_OPTIONS,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: {
        title: { display: true, text: 'kWh' },
        grid: { color: 'rgba(45, 38, 31, 0.08)' },
      },
      x: {
        ticks: {
          autoSkip: true,
          maxTicksLimit: 12,
        },
        grid: { color: 'rgba(45, 38, 31, 0.05)' },
      },
    },
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  if (monthlyChart) {
    monthlyChart.data = data;
    monthlyChart.options = options;
    monthlyChart.update('none');
    return;
  }

  monthlyChart = new Chart(ctx, { type: 'bar', data, options });
}

function renderSizeMappingChart(inputs) {
  const ctx = document.getElementById('sizeMappingChart');
  const systemSizeInput = document.getElementById('systemSize');
  const sliderMinSize = Number(systemSizeInput.min);
  const solarModel = buildSolarModel(inputs);
  const googleDataset = getGoogleSolarDataset(googleSolarRawPayload);
  const panelStepKw = googleDataset ? (googleDataset.panelCapacityWatts / 1000) : 0.4;
  const sortedPanels = googleDataset?.sortedPanels || [];
  let runningAnnual = 0;
  const points = [{ x: sliderMinSize, y: 0 }];
  const marginalPoints = [{ x: sliderMinSize, y: 0 }];

  if (sortedPanels.length) {
    sortedPanels.forEach((panel, index) => {
      runningAnnual += panel.yearlyEnergyDcKwh;
      const sizeKw = Number(((index + 1) * panelStepKw).toFixed(1));
      points.push({
        x: sizeKw,
        y: runningAnnual,
      });
      marginalPoints.push({
        x: sizeKw,
        y: panel.yearlyEnergyDcKwh / panelStepKw,
      });
    });
  } else {
    const maxSize = Number(systemSizeInput.max);
    const sampleCount = Math.max(21, Math.ceil(maxSize / 0.5) + 1);
    for (let index = 0; index < sampleCount; index += 1) {
      const systemSize = sliderMinSize + (((maxSize - sliderMinSize) * index) / Math.max(1, sampleCount - 1));
      const pointInputs = { ...inputs, systemSize };
      const pointSolarModel = buildSolarModel(pointInputs);
      points.push({
        x: Number(systemSize.toFixed(1)),
        y: pointSolarModel.annualSolarBase,
      });
      if (index > 0) {
        const previous = points[points.length - 2];
        const deltaKw = systemSize - previous.x;
        const deltaKwh = pointSolarModel.annualSolarBase - previous.y;
        marginalPoints.push({
          x: Number(systemSize.toFixed(1)),
          y: deltaKw > 0 ? deltaKwh / deltaKw : 0,
        });
      }
    }
  }

  const maxSize = Math.max(Number(systemSizeInput.max), solarModel.maxRoofCapacityKw || 0);
  const currentPoint = {
    x: inputs.systemSize,
    y: solarModel.annualSolarBase,
  };

  const data = {
    datasets: [
      {
        label: 'Annual solar production',
        data: points,
        borderColor: '#2e7d58',
        backgroundColor: 'rgba(46, 125, 88, 0.14)',
        borderWidth: 3,
        stepped: true,
        pointRadius: 2,
        fill: false,
        yAxisID: 'y',
      },
      {
        label: 'Marginal kWh per added kW',
        data: marginalPoints,
        borderColor: '#cc6d1c',
        backgroundColor: 'rgba(204, 109, 28, 0.12)',
        borderWidth: 3,
        stepped: true,
        pointRadius: 0,
        fill: false,
        yAxisID: 'y1',
      },
      {
        label: 'Current size',
        data: [currentPoint],
        type: 'scatter',
        borderColor: '#cc6d1c',
        backgroundColor: '#cc6d1c',
        pointRadius: 5,
        pointHoverRadius: 6,
      },
    ],
  };

  const options = {
    ...CHART_BASE_OPTIONS,
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'System size (kW)' },
        max: Number(maxSize.toFixed(1)),
        grid: { color: 'rgba(45, 38, 31, 0.05)' },
      },
      y: {
        title: { display: true, text: 'Year 1 kWh' },
        grid: { color: 'rgba(45, 38, 31, 0.08)' },
      },
      y1: {
        position: 'right',
        title: { display: true, text: 'Marginal kWh per kW' },
        grid: { drawOnChartArea: false },
      },
    },
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  if (sizeMappingChart) {
    sizeMappingChart.data = data;
    sizeMappingChart.options = options;
    sizeMappingChart.update('none');
    return;
  }

  sizeMappingChart = new Chart(ctx, { type: 'line', data, options });
}

function renderBillChart(yearOne) {
  const ctx = document.getElementById('billChart');
  const data = {
    labels: MONTHS,
    datasets: [
      {
        type: 'line',
        label: 'Bill without solar',
        data: yearOne.monthlyRows.map((row) => row.billWithoutSolar),
        borderColor: '#2563a6',
        backgroundColor: 'rgba(37, 99, 166, 0.12)',
        tension: 0.32,
        borderWidth: 3,
        pointRadius: 3,
        fill: false,
      },
      {
        type: 'line',
        label: 'Bill with solar',
        data: yearOne.monthlyRows.map((row) => row.billWithSolar),
        borderColor: '#2e7d58',
        backgroundColor: 'rgba(46, 125, 88, 0.16)',
        tension: 0.32,
        borderWidth: 3,
        pointRadius: 3,
        fill: false,
      },
      {
        type: 'line',
        label: 'Bill savings',
        data: yearOne.monthlyRows.map((row) => row.billSavings),
        borderColor: '#cc6d1c',
        backgroundColor: 'rgba(204, 109, 28, 0.16)',
        tension: 0.32,
        borderWidth: 3,
        pointRadius: 3,
        fill: false,
      },
    ],
  };

  const options = {
    ...CHART_BASE_OPTIONS,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: {
        title: { display: true, text: 'USD' },
        grid: { color: 'rgba(45, 38, 31, 0.08)' },
      },
    },
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  if (billChart) {
    billChart.data = data;
    billChart.options = options;
    billChart.update('none');
    return;
  }

  billChart = new Chart(ctx, { type: 'line', data, options });
}

function renderGridFlowChart(yearOne) {
  const ctx = document.getElementById('gridFlowChart');
  const data = {
    labels: MONTHS,
    datasets: [
      {
        type: 'line',
        label: 'Usage',
        data: yearOne.monthlyRows.map((row) => row.usage),
        borderColor: '#2563a6',
        backgroundColor: 'rgba(37, 99, 166, 0.12)',
        tension: 0.32,
        borderWidth: 3,
        pointRadius: 3,
        fill: false,
      },
      {
        type: 'line',
        label: 'Import',
        data: yearOne.monthlyRows.map((row) => row.imported),
        borderColor: '#8b5e34',
        backgroundColor: 'rgba(139, 94, 52, 0.12)',
        tension: 0.32,
        borderWidth: 3,
        pointRadius: 3,
        fill: false,
      },
      {
        type: 'line',
        label: 'Export',
        data: yearOne.monthlyRows.map((row) => row.exported),
        borderColor: '#2e7d58',
        backgroundColor: 'rgba(46, 125, 88, 0.12)',
        tension: 0.32,
        borderWidth: 3,
        pointRadius: 3,
        fill: false,
      },
    ],
  };

  const options = {
    ...CHART_BASE_OPTIONS,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: {
        title: { display: true, text: 'kWh' },
        grid: { color: 'rgba(45, 38, 31, 0.08)' },
      },
    },
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  if (gridFlowChart) {
    gridFlowChart.data = data;
    gridFlowChart.options = options;
    gridFlowChart.update('none');
    return;
  }

  gridFlowChart = new Chart(ctx, { type: 'line', data, options });
}

function renderPaybackChart(tenYear) {
  const ctx = document.getElementById('paybackChart');
  const cumulativeWithoutSolar = [0];
  const cumulativeWithSolar = [tenYear.hasLoan ? 0 : tenYear.totalInstallCost];
  let runningWithoutSolar = 0;
  let runningWithSolar = tenYear.hasLoan ? 0 : tenYear.totalInstallCost;

  tenYear.yearlyResults.forEach((result, index) => {
    runningWithoutSolar += result.billWithoutSolar;
    runningWithSolar += result.billWithSolar + (index < tenYear.loanTermYears ? tenYear.annualLoanPayment : 0);
    cumulativeWithoutSolar.push(runningWithoutSolar);
    cumulativeWithSolar.push(runningWithSolar);
  });

  const data = {
    labels: ['Install', ...tenYear.yearlyResults.map((_, index) => `Year ${index + 1}`)],
    datasets: [
      {
        label: 'Without solar',
        data: cumulativeWithoutSolar,
        borderColor: '#2563a6',
        backgroundColor: 'rgba(37, 99, 166, 0.08)',
        fill: false,
        tension: 0.22,
        borderWidth: 3,
        pointRadius: 3,
      },
      {
        label: 'Loan + bill with solar',
        data: cumulativeWithSolar,
        borderColor: '#2e7d58',
        backgroundColor: 'rgba(46, 125, 88, 0.14)',
        fill: false,
        tension: 0.22,
        borderWidth: 3,
        pointRadius: 3,
      },
    ],
  };

  const options = {
    ...CHART_BASE_OPTIONS,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: {
        title: { display: true, text: 'USD' },
        grid: { color: 'rgba(45, 38, 31, 0.08)' },
      },
      x: {
        grid: { color: 'rgba(45, 38, 31, 0.05)' },
      },
    },
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  if (paybackChart) {
    paybackChart.data = data;
    paybackChart.options = options;
    paybackChart.update('none');
    return;
  }

  paybackChart = new Chart(ctx, { type: 'line', data, options });
}

function getRepresentativeDayAxisMax(inputs) {
  let peak = 0;

  MONTHS.forEach((_, monthIndex) => {
    const dailySeries = buildDailySeries({ ...inputs, dayMonth: monthIndex });
    const batteryChargePeaks = dailySeries.batteryChargeBars.map((bar) => (Array.isArray(bar) ? bar[1] : 0));
    const batteryDischargePeaks = dailySeries.batteryDischargeBars.map((bar) => (Array.isArray(bar) ? bar[1] : 0));
    peak = Math.max(
      peak,
      ...dailySeries.load,
      ...dailySeries.solar,
      ...batteryChargePeaks,
      ...batteryDischargePeaks,
      0
    );
  });

  return Math.max(2, Math.ceil((peak * 1.2) / 2) * 2);
}

function renderDailyChart(inputs) {
  const ctx = document.getElementById('dailyChart');
  const dailySeries = buildDailySeries(inputs);
  const yAxisMax = getRepresentativeDayAxisMax(inputs);
  const data = {
    labels: dailySeries.labels,
    datasets: [
      {
        label: 'Home load',
        type: 'bar',
        data: dailySeries.load,
        borderColor: 'rgba(37, 99, 166, 0)',
        backgroundColor: 'rgba(37, 99, 166, 0.42)',
        borderSkipped: false,
        borderRadius: 0,
        grouped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        order: 3,
      },
      {
        label: 'Battery charging',
        type: 'bar',
        data: dailySeries.batteryChargeBars,
        borderColor: 'rgba(46, 125, 88, 0)',
        backgroundColor: 'rgba(46, 125, 88, 0.24)',
        borderSkipped: false,
        borderRadius: 0,
        grouped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        order: 1,
      },
      {
        label: 'Solar output',
        type: 'bar',
        data: dailySeries.solar,
        borderColor: 'rgba(244, 161, 26, 0)',
        backgroundColor: 'rgba(244, 161, 26, 0.44)',
        borderSkipped: false,
        borderRadius: 0,
        grouped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        order: 4,
      },
      {
        label: 'Solar + battery',
        type: 'bar',
        data: dailySeries.batteryDischargeBars,
        borderColor: '#2e7d58',
        backgroundColor: 'rgba(46, 125, 88, 0.18)',
        borderSkipped: false,
        borderRadius: 0,
        grouped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        order: 2,
      },
    ],
  };

  const options = {
    ...CHART_BASE_OPTIONS,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: {
        title: { display: true, text: 'kWh per hour' },
        grid: { color: 'rgba(45, 38, 31, 0.08)' },
        max: yAxisMax,
        ticks: {
          stepSize: 2,
        },
      },
      x: {
        ticks: {
          autoSkip: true,
          maxTicksLimit: 16,
        },
        grid: { color: 'rgba(45, 38, 31, 0.05)' },
      },
    },
    plugins: {
      legend: { position: 'bottom' },
    },
  };

  if (dailyChart) {
    dailyChart.data = data;
    dailyChart.options = options;
    dailyChart.update('none');
    return;
  }

  dailyChart = new Chart(ctx, { type: 'line', data, options });
}

function updateCalculator() {
  try {
    setUiError('');
    syncPowerPlanUi();
    syncAustinDocs();
    updateValueLabels();
    updateDayMonthLabel();

    const inputs = getInputs();
    const yearOne = buildYearModel(inputs, 0);
    const tenYear = buildTenYearModel(inputs);

    updateKpis(yearOne, tenYear);
      updateTables(yearOne, tenYear);
      renderGoogleSegmentTable(inputs.systemSize);
      renderMonthlyChart(yearOne);
      renderGridFlowChart(yearOne);
      renderSizeMappingChart(inputs);
      renderBillChart(yearOne);
    renderDailyChart(inputs);
    renderPaybackChart(tenYear);
  } catch (error) {
    setUiError(`Calculator error: ${error.message}`);
    console.error(error);
  }
}

function buildCandidateValues(min, max, step) {
  const values = [];
  for (let value = min; value <= max + (step / 2); value += step) {
    values.push(Number(value.toFixed(4)));
  }
  return values;
}

function evaluateNetValue(systemSize, batteryPower) {
  const inputs = getInputsForSystemAndBattery(systemSize, batteryPower);
  const tenYear = buildTenYearModel(inputs);
  return tenYear.totalSavings - tenYear.totalInstallCost;
}

function solveBestSystemSize() {
  const systemSizeInput = document.getElementById('systemSize');
  const batteryPowerInput = document.getElementById('batteryPower');
  const min = Number(systemSizeInput.min);
  const max = Number(systemSizeInput.max);
  const step = Number(systemSizeInput.step) || 0.1;
  const batteryMin = Number(batteryPowerInput.min);
  const batteryMax = Number(batteryPowerInput.max);
  const batteryStep = Number(batteryPowerInput.step) || 0.5;

  let bestSize = min;
  let bestBatteryPower = batteryMin;
  let bestNetValue = Number.NEGATIVE_INFINITY;
  const coarseSolarStep = Math.max(step, 1);
  const coarseBatteryStep = Math.max(batteryStep, 2);
  const coarseSolarValues = buildCandidateValues(min, max, coarseSolarStep);
  const coarseBatteryValues = buildCandidateValues(batteryMin, batteryMax, coarseBatteryStep);

  coarseSolarValues.forEach((candidateSize) => {
    coarseBatteryValues.forEach((candidateBatteryPower) => {
      const netValue = evaluateNetValue(candidateSize, candidateBatteryPower);
      if (netValue > bestNetValue) {
        bestNetValue = netValue;
        bestSize = candidateSize;
        bestBatteryPower = candidateBatteryPower;
      }
    });
  });

  const fineSolarMin = Math.max(min, bestSize - coarseSolarStep);
  const fineSolarMax = Math.min(max, bestSize + coarseSolarStep);
  const fineBatteryMin = Math.max(batteryMin, bestBatteryPower - coarseBatteryStep);
  const fineBatteryMax = Math.min(batteryMax, bestBatteryPower + coarseBatteryStep);
  const fineSolarValues = buildCandidateValues(fineSolarMin, fineSolarMax, step);
  const fineBatteryValues = buildCandidateValues(fineBatteryMin, fineBatteryMax, batteryStep);

  fineSolarValues.forEach((candidateSize) => {
    fineBatteryValues.forEach((candidateBatteryPower) => {
      const netValue = evaluateNetValue(candidateSize, candidateBatteryPower);
      if (netValue > bestNetValue) {
        bestNetValue = netValue;
        bestSize = candidateSize;
        bestBatteryPower = candidateBatteryPower;
      }
    });
  });

  systemSizeInput.value = String(Number(bestSize.toFixed(1)));
  batteryPowerInput.value = String(Number(bestBatteryPower.toFixed(1)));
  updateCalculator();
}

function resetInputs() {
  Object.entries(DEFAULTS).forEach(([fieldId, value]) => {
    const input = document.getElementById(fieldId);
    if (input) input.value = value;
  });
  applyAppModeDefaults();
  updateCalculator();
}

window.addEventListener('DOMContentLoaded', async () => {
  // Force-collapse all .doc-details elements on load, overriding browser
  // state-restoration which can re-open them across page loads.
  document.querySelectorAll('.doc-details').forEach((el) => {
    el.open = false;
  });

  document.querySelectorAll('input[type="range"], select').forEach((input) => {
    input.addEventListener('input', updateCalculator);
    input.addEventListener('change', updateCalculator);
  });
  document.getElementById('solveButton').addEventListener('click', solveBestSystemSize);
  document.getElementById('resetButton').addEventListener('click', resetInputs);
  document.getElementById('googleLookupButton').addEventListener('click', lookupGoogleRoof);
  document.getElementById('googleApplyButton').addEventListener('click', applyGoogleRoofResult);
  document.getElementById('googleAddress').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      lookupGoogleRoof();
    }
  });
  // Chart / Table view toggles for "Year 1 bills" and "Monthly grid flow".
  // Each toggle button carries data-chart and data-table attributes that identify
  // the wrapper element IDs (chartId + "Wrap" and tableId + "Wrap").
  document.querySelectorAll('.view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const chartWrap = document.getElementById(btn.dataset.chart + 'Wrap');
      const tableWrap = document.getElementById(btn.dataset.table + 'Wrap');
      if (!chartWrap || !tableWrap) return;
      const showingChart = !chartWrap.hidden;
      chartWrap.hidden = showingChart;
      tableWrap.hidden = !showingChart;
      btn.setAttribute('aria-pressed', showingChart ? 'false' : 'true');
      btn.classList.toggle('view-toggle-btn--active', !showingChart);
    });
  });

  applyAppModeDefaults();
  await loadInstallCostLookup();
  await loadSampleGoogleRoofData();
  renderGoogleLookupResult();
  updateCalculator();
});
