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
  const batteryInline = document.getElementById('batteryCostInline');
  const totalCostInline = document.getElementById('totalCostInline');
  const flatCostRow = document.getElementById('flatCostRow');
  const perKwCostRow = document.getElementById('perKwCostRow');
  const flatCostInline = document.getElementById('flatCostInline');
  const perKwCostInline = document.getElementById('perKwCostInline');
  const batteryCostRow = document.getElementById('batteryCostRow');
  const batteryCostLabel = document.getElementById('batteryCostLabel');
  const hasPanels = inputs.systemSize > 0;
  const quoted = isQuotedCostMode();
  if (batteryCostLabel) batteryCostLabel.textContent = quoted ? 'System total' : 'Battery cost';
  if (batteryInline) batteryInline.textContent = quoted ? formatCurrency(inputs.installCost + inputs.rebate) : formatCurrency(inputs.batteryInstallCost);
  const hasBattery = inputs.batteryCapacityKwh > 0;
  const backupEnabled = document.getElementById('backupGatewayEnabled')?.checked ?? false;
  const backupGatewayField = document.getElementById('backupGatewayField');
  if (backupGatewayField) backupGatewayField.hidden = !hasBattery;
  const backupGatewayCostWrap = document.getElementById('backupGatewayCostWrap');
  if (backupGatewayCostWrap) backupGatewayCostWrap.hidden = !backupEnabled;
  const backupGatewayCostValue = document.getElementById('backupGatewayCostValue');
  if (backupGatewayCostValue) backupGatewayCostValue.textContent = formatCurrency(Number(document.getElementById('backupGatewayCost')?.value) || 0);
  const backupGatewayCostRow = document.getElementById('backupGatewayCostRow');
  if (backupGatewayCostRow) backupGatewayCostRow.hidden = !hasBattery || inputs.backupGatewayCost === 0;
  const backupGatewayCostInline = document.getElementById('backupGatewayCostInline');
  if (backupGatewayCostInline) backupGatewayCostInline.textContent = formatCurrency(inputs.backupGatewayCost);
  const austinRebateRow = document.getElementById('austinRebateRow');
  if (austinRebateRow) austinRebateRow.hidden = !(inputs.rebate > 0);
  const austinRebateInline = document.getElementById('austinRebateInline');
  if (austinRebateInline && inputs.rebate > 0) austinRebateInline.textContent = `-${formatCurrency(inputs.rebate)}`;
  if (totalCostInline) totalCostInline.textContent = formatCurrency(inputs.installCost);
  const showBreakdown = !isQuotedCostMode() && hasPanels;
  if (flatCostRow) flatCostRow.hidden = !showBreakdown || inputs.solarFlatCost === 0;
  if (perKwCostRow) perKwCostRow.hidden = !showBreakdown;
  if (showBreakdown) {
    if (flatCostInline) flatCostInline.textContent = formatCurrency(inputs.solarFlatCost);
    if (perKwCostInline) perKwCostInline.textContent = formatCurrency(inputs.solarPerKwCost);
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

  const monthlyPaymentRow = document.getElementById('monthlyPaymentRow');
  const monthlyPaymentInline = document.getElementById('monthlyPaymentInline');
  if (monthlyPaymentRow) {
    const hasLoanActive = loanTermValue > 0;
    monthlyPaymentRow.hidden = !hasLoanActive;
    if (hasLoanActive && monthlyPaymentInline) {
      const inputs = getInputs();
      const annual = calculateAnnualLoanPayment(inputs.installCost, inputs.loanInterestRate, inputs.loanTermYears);
      monthlyPaymentInline.textContent = `${formatCurrency(annual / 12)}/mo`;
    }
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
      planTypeDescription.innerHTML = 'Austin Energy bills all power you consume at normal tiered rates — even power your panels generated. In return, every kWh your system produces earns a 9.91¢ Value of Solar credit, regardless of whether you used it yourself or exported it. <a href="https://austinenergy.com/en/rates/residential-rates" target="_blank" rel="noreferrer">See rates.</a>';
    } else {
      planTypeDescription.textContent = definition.description;
    }
  }
}

function applyAppModeDefaults() {
  const austinHint = document.getElementById('greenButtonHintAustin');
  if (austinHint) austinHint.hidden = APP_MODE !== 'austin_energy';
  if (APP_MODE !== 'austin_energy') return;
  const retailRateInput = document.getElementById('retailRate');
  const buybackRateInput = document.getElementById('buybackRate');
  const planTypeSelect = document.getElementById('planType');
  if (retailRateInput) {
    retailRateInput.value = String(AUSTIN_ENERGY_DEFAULTS.retailRate);
  }
  if (buybackRateInput) {
    buybackRateInput.value = String(AUSTIN_ENERGY_DEFAULTS.vosRate);
  }
  if (planTypeSelect) {
    planTypeSelect.value = AUSTIN_ENERGY_DEFAULTS.planType;
  }

  // Show Austin cost controls and set regression defaults
  const austinCostWrap = document.getElementById('austinCostWrap');
  if (austinCostWrap) austinCostWrap.hidden = false;
  const baseInstallCostInput = document.getElementById('baseInstallCost');
  if (baseInstallCostInput) baseInstallCostInput.value = String(AUSTIN_ENERGY_DEFAULTS.baseInstallCost);
  const installCostInput = document.getElementById('installCost');
  if (installCostInput) installCostInput.value = String(AUSTIN_ENERGY_DEFAULTS.installCost);
  const batteryCostInput = document.getElementById('batteryCost');
  if (batteryCostInput) batteryCostInput.value = String(AUSTIN_ENERGY_DEFAULTS.batteryCost);

  // Wire cost mode toggle buttons (guard against double-binding)
  const btnEstimated = document.getElementById('btnCostEstimated');
  const btnQuoted = document.getElementById('btnCostQuoted');
  const quotedCostField = document.getElementById('quotedCostField');
  const quotedInput = document.getElementById('quotedSolarCost');
  if (btnEstimated && !btnEstimated._bound) {
    btnEstimated._bound = true;
    const costSliderFields = () => [
      document.getElementById('baseInstallCostField'),
      document.getElementById('installCostField'),
      document.getElementById('batteryCostField'),
    ];

    btnEstimated.addEventListener('click', () => {
      btnEstimated.classList.add('cost-mode-btn--active');
      btnQuoted.classList.remove('cost-mode-btn--active');
      if (quotedCostField) quotedCostField.hidden = true;
      costSliderFields().forEach((f) => { if (f) f.hidden = false; });
      updateCalculator();
    });
    btnQuoted.addEventListener('click', () => {
      btnQuoted.classList.add('cost-mode-btn--active');
      btnEstimated.classList.remove('cost-mode-btn--active');
      if (quotedCostField) quotedCostField.hidden = false;
      costSliderFields().forEach((f) => { if (f) f.hidden = true; });
      // Pre-fill quoted input with current estimated total solar cost
      if (quotedInput) {
        const systemSizeKw = Number(document.getElementById('systemSize')?.value) || 0;
        quotedInput.value = String(Math.round(computeSolarInstallCost(systemSizeKw) / 100) * 100);
      }
      updateCalculator();
    });
    if (quotedInput) {
      quotedInput.addEventListener('input', updateCalculator);
      quotedInput.addEventListener('change', updateCalculator);
    }
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
  const tenYearNet = tenYear.totalSavings - tenYear.totalLoanPaid;

  document.getElementById('kpiYearOneSavings').textContent = formatCurrency(averageMonthlySavings);
  document.getElementById('kpiOffset').textContent = `${formatNumber(billReductionPct, 1)}% bill reduction`;
  document.getElementById('kpiBillWithSolar').textContent = formatCurrency(averageMonthlyBillWithSolar);
  document.getElementById('kpiBillWithoutSolar').textContent = `${formatCurrency(averageMonthlyBillWithoutSolar)} without solar`;
  document.getElementById('kpiTenYearValue').textContent = formatCurrency(tenYearNet);
  document.getElementById('kpiPayback').textContent = tenYear.paybackYear ? `Estimated payback in year ${tenYear.paybackYear}` : 'Payback not reached';
}

function updateTables(yearOne, tenYear) {
  const monthlyBillsTable = document.getElementById('monthlyBillsTable');
  if (monthlyBillsTable) {
    const billRows = yearOne.monthlyRows;
    const withoutCells = billRows.map(r => `<td>${formatCurrency(r.billWithoutSolar)}</td>`).join('');
    const withCells    = billRows.map(r => `<td class="cell-with-solar">${formatCurrency(r.billWithSolar)}</td>`).join('');
    const diffCells    = billRows.map(r => {
      const reduction = -r.billSavings; // negative = savings shown as cost reduction
      const cls = r.billSavings > 0 ? 'cell-diff diff-savings' : r.billSavings < 0 ? 'cell-diff diff-cost' : 'cell-diff';
      return `<td class="${cls}">${formatCurrency(reduction)}</td>`;
    }).join('');
    const hasLoan = tenYear.annualLoanPayment > 0;
    const monthlyLoanPayment = tenYear.annualLoanPayment / 12;
    const loanCells = MONTHS.map(() =>
      `<td class="cell-loan">${formatCurrency(monthlyLoanPayment)}</td>`
    ).join('');
    const netCells = hasLoan ? billRows.map(r =>
      `<td class="cell-with-solar">${formatCurrency(r.billWithSolar + monthlyLoanPayment)}</td>`
    ).join('') : '';
    monthlyBillsTable.querySelector('tbody').innerHTML =
      `<tr><th>Current bill</th>${withoutCells}</tr>` +
      `<tr><th>Solar reduction</th>${diffCells}</tr>` +
      (hasLoan ? `<tr><th>Monthly payment</th>${loanCells}</tr>` : '') +
      (hasLoan ? `<tr class="bills-row-total"><th>Net monthly cost</th>${netCells}</tr>` : '');
  }

  const monthlyFlowTable = document.getElementById('monthlyFlowTable');
  if (monthlyFlowTable) {
    const flowRows = yearOne.monthlyRows;
    const usageCells   = flowRows.map(r => `<td>${formatNumber(r.usage, 0)}</td>`).join('');
    const importCells  = flowRows.map(r => `<td>${formatNumber(r.imported, 0)}</td>`).join('');
    const exportCells  = flowRows.map(r => `<td>${formatNumber(r.exported, 0)}</td>`).join('');
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

function syncProductionFieldVisibility() {
  const productionField = document.getElementById('productionPerKwField');
  if (!productionField) return;
  const hasRoofData = Boolean(googleSolarRawPayload?.raw?.solarPotential);
  productionField.hidden = hasRoofData;
  productionField.style.display = hasRoofData ? 'none' : '';
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

function renderGoogleLookupResult() {
  const els = getGoogleLookupElements();
  const hasResult = Boolean(googleSolarResult);
  syncSystemSizeSliderMax();
  syncProductionFieldVisibility();
  // Always keep the lookup results div hidden — values are written by JS but never displayed
  els.results.hidden = true;

  // Only trigger phase 2 when the user explicitly submitted an address
  if (hasResult && window._userLookupDone) {
    const resultsSection = document.getElementById('resultsSection');
    const phase2Inputs = document.getElementById('phase2Inputs');
    const ctaBtn = document.getElementById('googleLookupButton');

    if (phase2Inputs) phase2Inputs.hidden = false;
    if (ctaBtn) ctaBtn.hidden = true;

    if (resultsSection && resultsSection.hidden) {
      resultsSection.hidden = false;
      setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  }
  if (!hasResult) {
    els.resultAddress.textContent = '-';
    els.resultPanels.textContent = '-';
    els.resultSize.textContent = '-';
      els.resultProduction.textContent = '-';
      els.resultInstallCost.textContent = '-';
      els.resultInstallCostSource.textContent = '-';
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
    renderGoogleSegmentTable(Number(document.getElementById('systemSize')?.value));
  }

