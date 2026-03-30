let googleSolarResult = null;
let googleSolarRawPayload = null;
let installCostLookup = null;
const GOOGLE_SOLAR_DATASET_CACHE = new WeakMap();

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

function getGoogleLookupElements() {
  return {
    addressInput: document.getElementById('googleAddress'),
    lookupButton: document.getElementById('googleLookupButton'),
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

function buildLookupMapUrl(payload, result) {
  const zoom = getLookupMapZoom(payload);
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

async function lookupGoogleRoof() {
  const els = getGoogleLookupElements();
  const address = els.addressInput.value.trim();
  if (!address) {
    els.status.textContent = 'Enter an address to look up a roof.';
    els.results.hidden = true;
    googleSolarResult = null;
    googleSolarRawPayload = null;
    renderGoogleLookupResult();
    return;
  }

  els.lookupButton.disabled = true;
  els.status.textContent = 'Looking up roof data from Google Solar...';

  const cachedAddress = googleSolarRawPayload?.summary?.formattedAddress || googleSolarRawPayload?.request?.address || '';
  if (cachedAddress && address.toLowerCase() === cachedAddress.toLowerCase()) {
    googleSolarResult = summarizeGoogleSolarResult(googleSolarRawPayload);
    syncInstallCostFromGoogleResult();
    applyGoogleRoofResult();
    setUiError('');
    renderGoogleLookupResult();
    updateSolarMapFromPayload(googleSolarRawPayload);
    els.status.textContent = 'Roof lookup complete (from local cache).';
    els.lookupButton.disabled = false;
    return;
  }

  try {
    const response = await fetch(`/.netlify/functions/solar-insights?address=${encodeURIComponent(address)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Google roof lookup failed.');
    }

    googleSolarRawPayload = payload;
    googleSolarResult = summarizeGoogleSolarResult(payload);
    syncInstallCostFromGoogleResult();
    applyGoogleRoofResult();
    setUiError('');
    renderGoogleLookupResult();
    updateSolarMapFromPayload(payload);
    els.status.textContent = 'Roof lookup complete.';
  } catch (error) {
    googleSolarResult = null;
    googleSolarRawPayload = { error: error.message || 'Unknown Google roof lookup error.' };
    setUiError(error.message || 'Unknown Google roof lookup error.');
    renderGoogleLookupResult();
    els.status.textContent = `${error.message} Run this through Netlify locally so the function is available.`;
  } finally {
    els.lookupButton.disabled = false;
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
    applyGoogleRoofResult();
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
