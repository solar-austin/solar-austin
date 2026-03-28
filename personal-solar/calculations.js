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

function evaluateNetValue(systemSize, batteryPower) {
  const inputs = getInputsForSystemAndBattery(systemSize, batteryPower);
  const tenYear = buildTenYearModel(inputs);
  return tenYear.totalSavings - tenYear.totalInstallCost;
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
