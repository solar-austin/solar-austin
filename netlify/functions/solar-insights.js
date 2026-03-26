'use strict';

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const GOOGLE_SOLAR_BUILDING_URL = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function geocodeAddress(apiKey, address) {
  const url = new URL(GOOGLE_GEOCODE_URL);
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Geocoding request failed with ${response.status}`);
  }

  if (payload.status !== 'OK' || !Array.isArray(payload.results) || payload.results.length === 0) {
    throw new Error(payload.error_message || `Geocoding failed with status ${payload.status}`);
  }

  const first = payload.results[0];
  const components = Array.isArray(first.address_components) ? first.address_components : [];
  const pickComponent = (type) => {
    const match = components.find((component) => Array.isArray(component.types) && component.types.includes(type));
    return match || null;
  };
  return {
    formattedAddress: first.formatted_address,
    latitude: first.geometry?.location?.lat,
    longitude: first.geometry?.location?.lng,
    city: pickComponent('locality')?.long_name || pickComponent('postal_town')?.long_name || null,
    stateCode: pickComponent('administrative_area_level_1')?.short_name || null,
    postalCode: pickComponent('postal_code')?.long_name || null,
  };
}

async function fetchBuildingInsights(apiKey, latitude, longitude, quality) {
  const url = new URL(GOOGLE_SOLAR_BUILDING_URL);
  url.searchParams.set('location.latitude', String(latitude));
  url.searchParams.set('location.longitude', String(longitude));
  url.searchParams.set('requiredQuality', quality || 'HIGH');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message || `Solar API request failed with ${response.status}`);
  }

  return payload;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Missing GOOGLE_SOLAR_API_KEY or GOOGLE_MAPS_API_KEY environment variable.' });
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const params = event.queryStringParameters || {};
    const address = String(body.address || params.address || '').trim();
    const quality = String(body.requiredQuality || params.requiredQuality || 'HIGH').trim().toUpperCase();

    let latitude = toNumber(body.latitude ?? params.latitude);
    let longitude = toNumber(body.longitude ?? params.longitude);
    let formattedAddress = null;
    let city = null;
    let stateCode = null;
    let postalCode = null;

    if (address && (latitude === null || longitude === null)) {
      const geocode = await geocodeAddress(apiKey, address);
      latitude = geocode.latitude;
      longitude = geocode.longitude;
      formattedAddress = geocode.formattedAddress;
      city = geocode.city;
      stateCode = geocode.stateCode;
      postalCode = geocode.postalCode;
    }

    if (latitude === null || longitude === null) {
      return json(400, { error: 'Provide either an address or both latitude and longitude.' });
    }

    const insights = await fetchBuildingInsights(apiKey, latitude, longitude, quality);
    const solarPotential = insights.solarPotential || {};
    const financialAnalyses = Array.isArray(solarPotential.financialAnalyses)
      ? solarPotential.financialAnalyses
      : [];
    const cashPurchase = financialAnalyses.find((item) => item.financingOption === 'CASH_PURCHASE') || null;
    const solarPanelConfigs = Array.isArray(solarPotential.solarPanelConfigs)
      ? solarPotential.solarPanelConfigs
      : [];
    const bestConfig = solarPanelConfigs.reduce((best, current) => {
      if (!best) return current;
      return (current.yearlyEnergyDcKwh || 0) > (best.yearlyEnergyDcKwh || 0) ? current : best;
    }, null);

    return json(200, {
      request: {
        latitude,
        longitude,
        requiredQuality: quality,
        address: address || formattedAddress,
        city,
        stateCode,
        postalCode,
      },
      summary: {
        formattedAddress,
        name: insights.name || null,
        imageryQuality: insights.imageryQuality || null,
        maxArrayPanelsCount: solarPotential.maxArrayPanelsCount ?? null,
        maxArrayAreaMeters2: solarPotential.maxArrayAreaMeters2 ?? null,
        maxSunshineHoursPerYear: solarPotential.maxSunshineHoursPerYear ?? null,
        panelCapacityWatts: solarPotential.panelCapacityWatts ?? null,
        carbonOffsetFactorKgPerMwh: solarPotential.carbonOffsetFactorKgPerMwh ?? null,
        wholeRoofStats: solarPotential.wholeRoofStats || null,
        solarPanelConfigsCount: Array.isArray(solarPotential.solarPanelConfigs)
          ? solarPotential.solarPanelConfigs.length
          : 0,
        bestConfig: bestConfig
          ? {
            panelsCount: bestConfig.panelsCount ?? null,
            yearlyEnergyDcKwh: bestConfig.yearlyEnergyDcKwh ?? null,
          }
          : null,
        cashPurchaseSavings: cashPurchase || null,
      },
      raw: insights,
    });
  } catch (error) {
    return json(500, {
      error: error.message || 'Unknown error while fetching Google Solar data.',
    });
  }
};
