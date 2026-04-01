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
    const usage = importedMonthlyKwh
      ? importedMonthlyKwh[monthIndex]
      : annualUsage * getActiveUsageProfile()[monthIndex];
    const solar = annualSolar * solarModel.monthlyProfile[monthIndex];
    const flow = simulateMonthlyFlow(
      usage,
      solar,
      monthIndex,
      MONTH_DAYS[monthIndex],
      inputs.batteryPower,
      solarModel.hourlyProfiles[monthIndex],
      importedMonthlyHourlyProfiles?.[monthIndex] ?? null
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

