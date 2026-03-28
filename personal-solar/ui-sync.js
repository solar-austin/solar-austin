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
  els.results.hidden = !hasResult;
  els.applyButton.disabled = !hasResult;
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
