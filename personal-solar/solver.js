function evaluateNetValueFast(systemSize, batteryPower) {
  // Year-1 projection — fast enough for the coarse grid sweep.
  const inputs = getInputsForSystemAndBattery(systemSize, batteryPower);
  const yearOne = buildYearModel(inputs, 0);
  return yearOne.savings * FINANCIAL_HORIZON_YEARS - inputs.installCost;
}

function evaluateNetValue(systemSize, batteryPower) {
  // Full multi-year model — accurate ranking for the fine pass.
  const inputs = getInputsForSystemAndBattery(systemSize, batteryPower);
  const tenYear = buildTenYearModel(inputs);
  return tenYear.totalSavings - tenYear.totalInstallCost;
}

function evaluatePayback(systemSize, batteryPower) {
  // Estimate payback as installCost / annualSavings (linear, sufficient for ranking).
  const inputs = getInputsForSystemAndBattery(systemSize, batteryPower);
  const yearOne = buildYearModel(inputs, 0);
  if (yearOne.savings <= 0) return -9999;
  return -inputs.installCost / yearOne.savings; // negate: shorter payback → higher score
}

function buildCandidateValues(min, max, step) {
  const values = [];
  for (let value = min; value <= max + (step / 2); value += step) {
    values.push(Number(value.toFixed(4)));
  }
  return values;
}

function runSolver(coarseScoreFn, fineScoreFn) {
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
  let bestScore = Number.NEGATIVE_INFINITY;
  const coarseSolarStep = Math.max(step, 1);
  const coarseBatteryStep = Math.max(batteryStep, 2);
  const coarseSolarValues = buildCandidateValues(min, max, coarseSolarStep);
  const coarseBatteryValues = buildCandidateValues(batteryMin, batteryMax, coarseBatteryStep);

  coarseSolarValues.forEach((candidateSize) => {
    coarseBatteryValues.forEach((candidateBatteryPower) => {
      const score = coarseScoreFn(candidateSize, candidateBatteryPower);
      if (score > bestScore) {
        bestScore = score;
        bestSize = candidateSize;
        bestBatteryPower = candidateBatteryPower;
      }
    });
  });

  const fineSolarMin = Math.max(min, bestSize - coarseSolarStep * 2);
  const fineSolarMax = Math.min(max, bestSize + coarseSolarStep * 2);
  const fineBatteryMin = Math.max(batteryMin, bestBatteryPower - coarseBatteryStep * 2);
  const fineBatteryMax = Math.min(batteryMax, bestBatteryPower + coarseBatteryStep * 2);
  const fineSolarValues = buildCandidateValues(fineSolarMin, fineSolarMax, step);
  const fineBatteryValues = buildCandidateValues(fineBatteryMin, fineBatteryMax, batteryStep);

  bestScore = Number.NEGATIVE_INFINITY;
  fineSolarValues.forEach((candidateSize) => {
    fineBatteryValues.forEach((candidateBatteryPower) => {
      const score = fineScoreFn(candidateSize, candidateBatteryPower);
      if (score > bestScore) {
        bestScore = score;
        bestSize = candidateSize;
        bestBatteryPower = candidateBatteryPower;
      }
    });
  });

  systemSizeInput.value = String(Number(bestSize.toFixed(1)));
  batteryPowerInput.value = String(Number(bestBatteryPower.toFixed(1)));
  updateCalculator();
}

function startSolver(coarseScoreFn, fineScoreFn) {
  document.body.classList.add('solving');
  // Yield one frame so the browser can apply the cursor before the blocking loop.
  setTimeout(() => {
    try {
      runSolver(coarseScoreFn, fineScoreFn);
    } finally {
      document.body.classList.remove('solving');
    }
  }, 0);
}

function solveBestSystemSize() {
  startSolver(evaluateNetValueFast, evaluateNetValue);
}

function solveFastestPayback() {
  startSolver(evaluatePayback, evaluatePayback);
}
