let monthlyChart;
let billChart;
let gridFlowChart;
let dailyChart;
let paybackChart;
let sizeMappingChart;

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
  const monthlyUsageFactor = (getActiveUsageProfile()[selectedMonthIndex] ?? 0) * 12;
  const dailyUsage = annualAverageDailyUsage * monthlyUsageFactor;
  const dailySolar = (solarModel.annualSolarBase * solarModel.monthlyProfile[selectedMonthIndex]) / MONTH_DAYS[selectedMonthIndex];
  const solarProfile = solarModel.dailyProfiles[selectedMonthIndex];
  const batteryPower = Math.max(0, inputs.batteryPower);
  const batteryCapacity = batteryPower * 4;
  const intervalsPerDay = 24 * DAY_CHART_INTERVALS_PER_HOUR;
  const activeLoadProfile = importedMonthlyHourlyProfiles?.[selectedMonthIndex] ?? HOURLY_LOAD_PROFILE;
  const loadShape = Array.from({ length: intervalsPerDay }, (_, index) => (
    interpolateCyclicSeries(activeLoadProfile, index, DAY_CHART_INTERVALS_PER_HOUR)
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

function renderBillChart(yearOne, tenYear) {
  const ctx = document.getElementById('billChart');
  const monthlyLoanPayment = tenYear ? (tenYear.annualLoanPayment / 12) : 0;
  const hasLoan = monthlyLoanPayment > 0;

  // Stacked bars show composition; current bill line gives comparison baseline
  const datasets = [
    {
      type: 'bar',
      label: 'Bill with solar',
      data: yearOne.monthlyRows.map((row) => row.billWithSolar),
      backgroundColor: 'rgba(46, 125, 88, 0.72)',
      borderColor: 'rgba(46, 125, 88, 0.9)',
      borderWidth: 1,
      stack: 'cost',
    },
    {
      type: 'line',
      label: 'Current bill',
      data: yearOne.monthlyRows.map((row) => row.billWithoutSolar),
      borderColor: '#2563a6',
      backgroundColor: 'transparent',
      tension: 0.32,
      borderWidth: 2.5,
      pointRadius: 3,
      fill: false,
      order: 0,
    },
  ];

  if (hasLoan) {
    datasets.splice(1, 0, {
      type: 'bar',
      label: 'Monthly payment',
      data: MONTHS.map(() => monthlyLoanPayment),
      backgroundColor: 'rgba(155, 76, 15, 0.55)',
      borderColor: 'rgba(155, 76, 15, 0.8)',
      borderWidth: 1,
      stack: 'cost',
    });
  }

  const data = { labels: MONTHS, datasets };

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

  billChart = new Chart(ctx, { type: 'bar', data, options });
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
