function applyGoogleRoofResult() {
  if (!googleSolarResult) return;

  const productionInput = document.getElementById('productionPerKw');
  const suggestedProduction = googleSolarResult.suggestedProductionPerKw;
  if (productionInput && Number.isFinite(suggestedProduction)) {
    const clampedProduction = Math.min(Number(productionInput.max), Math.max(Number(productionInput.min), suggestedProduction));
    productionInput.value = String(Math.round(clampedProduction / 10) * 10);
  }

  applyInstallCostBenchmark(googleSolarResult.installCostBenchmark);
  updateCalculator();
}

function updateCalculator() {
  try {
    setUiError('');
    syncPowerPlanUi();
    syncAustinDocs();
    syncGreenButtonUi();
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
      renderBillChart(yearOne, tenYear);
    renderDailyChart(inputs);
    renderPaybackChart(tenYear);
  } catch (error) {
    setUiError(`Calculator error: ${error.message}`);
    console.error(error);
  }
}

function resetInputs() {
  Object.entries(DEFAULTS).forEach(([fieldId, value]) => {
    const input = document.getElementById(fieldId);
    if (input) input.value = value;
  });
  const heatingType = document.getElementById('heatingType');
  if (heatingType) heatingType.value = 'gas';
  const backupCheckbox = document.getElementById('backupGatewayEnabled');
  if (backupCheckbox) backupCheckbox.checked = false;
  syncGreenButtonUi();
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
  document.getElementById('backupGatewayEnabled').addEventListener('change', updateCalculator);
  document.getElementById('solveButton').addEventListener('click', solveBestSystemSize);
  document.getElementById('solvePaybackButton').addEventListener('click', solveFastestPayback);
  document.getElementById('resetButton').addEventListener('click', resetInputs);
  document.getElementById('btnUsageEstimated').addEventListener('click', () => {
    importedMonthlyKwh = null;
    importedMonthlyHourlyProfiles = null;
    importedDataMeta = null;
    document.getElementById('greenButtonFile').value = '';
    document.getElementById('greenButtonDropZone').classList.remove('has-error');
    setUsageTab('estimated');
    syncGreenButtonUi();
    updateCalculator();
  });
  document.getElementById('btnUsageImport').addEventListener('click', () => setUsageTab('import'));
  document.getElementById('googleLookupButton').addEventListener('click', lookupGoogleRoof);

  async function handleGreenButtonFile(file) {
    const status = document.getElementById('greenButtonStatus');
    const dropZone = document.getElementById('greenButtonDropZone');
    try {
      importedMonthlyKwh = await parseGreenButtonFile(file);
      const totalKwh = Math.round(importedMonthlyKwh.reduce((s, v) => s + v, 0));
      const dataLabel = importedMonthlyHourlyProfiles ? 'Green Button data' : 'Billing data';
      document.getElementById('importedDataSummary').textContent = `${dataLabel} · ${totalKwh.toLocaleString()} kWh/year`;
      if (status) {
        status.textContent = `Imported — ${totalKwh.toLocaleString()} kWh/year`;
        status.classList.remove('is-error');
        status.hidden = false;
      }
      dropZone.classList.remove('has-error');
      syncGreenButtonUi();
      updateCalculator();
    } catch (err) {
      importedMonthlyKwh = null;
      importedMonthlyHourlyProfiles = null;
      importedDataMeta = null;
      if (status) {
        status.textContent = `Not recognized: ${err.message}`;
        status.classList.add('is-error');
        status.hidden = false;
      }
      dropZone.classList.add('has-error');
      syncGreenButtonUi();
    }
  }

  document.getElementById('greenButtonFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleGreenButtonFile(file);
  });

  const dropZone = document.getElementById('greenButtonDropZone');
  const fileInput = document.getElementById('greenButtonFile');
  dropZone.addEventListener('click', (e) => {
    if (e.target.closest('#greenButtonClear')) return;
    fileInput.click();
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await handleGreenButtonFile(file);
  });

  document.getElementById('greenButtonClear').addEventListener('click', () => {
    importedMonthlyKwh = null;
    importedMonthlyHourlyProfiles = null;
    importedDataMeta = null;
    document.getElementById('greenButtonFile').value = '';
    document.getElementById('greenButtonDropZone').classList.remove('has-error');
    syncGreenButtonUi(); // stays on import tab
    updateCalculator();
  });
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
