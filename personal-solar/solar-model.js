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

function buildIntervalSolarProfile(monthIndex, intervalsPerHour = DAY_CHART_INTERVALS_PER_HOUR) {
  const hourlyProfile = buildMonthlySolarHourlyProfile(monthIndex);
  const rawProfile = Array.from({ length: 24 * intervalsPerHour }, (_, index) => (
    interpolateCyclicSeries(hourlyProfile, index, intervalsPerHour)
  ));
  return normalizeProfile(rawProfile);
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
      updateSolarMapFromPayload(payload);
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
    updateSolarMapFromPayload(payload);
  } catch (error) {
    const elements = getGoogleLookupElements();
    setUiError(error.message || 'Sample roof data could not be loaded.');
  }
}
