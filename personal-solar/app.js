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

const BILL_RATE_DEFAULT = 0.145; // $/kWh for bill ↔ usage conversion

function updateRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value);
  const pct = ((val - min) / (max - min)) * 100;
  input.style.setProperty('--range-fill', `${pct}%`);
}

function syncAllRangeFills() {
  document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
}

function syncBillToUsage(billValue) {
  const kWh = Math.round(billValue / BILL_RATE_DEFAULT / 10) * 10;
  const usageInput = document.getElementById('monthlyUsage');
  if (usageInput) {
    usageInput.value = String(Math.max(Number(usageInput.min), Math.min(Number(usageInput.max), kWh)));
    updateRangeFill(usageInput);
  }
}

function syncUsageToBill(kWhValue) {
  const bill = Math.round(kWhValue * BILL_RATE_DEFAULT / 10) * 10;
  const billInput = document.getElementById('entryMonthlyBill');
  const billLabel = document.getElementById('entryBillValue');
  if (billInput) {
    billInput.value = String(Math.max(Number(billInput.min), Math.min(Number(billInput.max), bill)));
    updateRangeFill(billInput);
  }
  if (billLabel) billLabel.textContent = `$${Math.max(50, Math.min(600, bill))}`;
}

window.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.doc-details').forEach((el) => {
    el.open = false;
  });

  document.querySelectorAll('input[type="range"], select').forEach((input) => {
    input.addEventListener('input', () => { updateRangeFill(input); updateCalculator(); });
    input.addEventListener('change', () => { updateRangeFill(input); updateCalculator(); });
  });

  // Bill slider ↔ monthly usage sync
  const entryBillInput = document.getElementById('entryMonthlyBill');
  const entryBillLabel = document.getElementById('entryBillValue');
  const monthlyUsageInput = document.getElementById('monthlyUsage');
  if (entryBillInput) {
    entryBillInput.addEventListener('input', () => {
      const v = Number(entryBillInput.value);
      if (entryBillLabel) entryBillLabel.textContent = `$${v}`;
      updateRangeFill(entryBillInput);
      syncBillToUsage(v);
      updateCalculator();
    });
  }
  if (monthlyUsageInput) {
    monthlyUsageInput.addEventListener('input', () => {
      syncUsageToBill(Number(monthlyUsageInput.value));
    });
  }

  // Payment toggle — Cash / Financing
  const paymentCash = document.getElementById('paymentCash');
  const paymentFinancing = document.getElementById('paymentFinancing');
  const loanTermSelect = document.getElementById('loanTerm');
  if (paymentCash && paymentFinancing && loanTermSelect) {
    paymentCash.addEventListener('click', () => {
      paymentCash.classList.add('payment-btn--active');
      paymentFinancing.classList.remove('payment-btn--active');
      loanTermSelect.value = '0';
      updateCalculator();
    });
    paymentFinancing.addEventListener('click', () => {
      paymentFinancing.classList.add('payment-btn--active');
      paymentCash.classList.remove('payment-btn--active');
      if (loanTermSelect.value === '0') loanTermSelect.value = '10';
      updateCalculator();
    });
  }
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
  syncAllRangeFills();
  // Sync bill display to match initial monthly usage default
  if (monthlyUsageInput) syncUsageToBill(Number(monthlyUsageInput.value));
});
