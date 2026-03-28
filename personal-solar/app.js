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
