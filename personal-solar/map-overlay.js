// Solar flux GeoTIFF overlay using Google Maps JS API + geotiff.js + proj4.js
let SOLAR_MAP_API_KEY = null;
const IRON_PALETTE = ['00000A','91009C','E64616','FEB400','FFFFF6'];

function utmProj4ForLng(lng) {
  const zone = Math.floor((lng + 180) / 6) + 1;
  return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
}

let solarMap = null;
let solarOverlays = [];
let googleMapsApiReady = false;

let cachedRgbCanvas = null;
let cachedRgbBounds = null;
let cachedAnnualCanvas = null;
let cachedAnnualBounds = null;
let activeFluxMode = 'annual';
let activeMonth = 0;

function onGoogleMapsApiLoaded() {
  googleMapsApiReady = true;
  SOLAR_MAP_API_KEY = window._solarMapApiKey || null;
  initSolarMap(30.2672, -97.7431, 13);
  if (typeof googleSolarRawPayload !== 'undefined' && googleSolarRawPayload) {
    updateSolarMapFromPayload(googleSolarRawPayload);
  }
  initAddressAutocomplete();
}

function initAddressAutocomplete() {
  const input = document.getElementById('googleAddress');
  if (!input || !google.maps.places) return;
  const autocomplete = new google.maps.places.Autocomplete(input, {
    types: ['address'],
    componentRestrictions: { country: 'us' },
    fields: ['formatted_address'],
  });
  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (place.formatted_address) {
      input.value = place.formatted_address;
    }
    if (typeof lookupGoogleRoof === 'function') lookupGoogleRoof();
  });
}

function initSolarMap(lat, lng, zoom) {
  const mapDiv = document.getElementById('googleLookupMap');
  if (!mapDiv || !googleMapsApiReady) return;
  if (solarMap) {
    solarMap.setCenter({ lat, lng });
    solarMap.setZoom(zoom);
    return;
  }
  solarMap = new google.maps.Map(mapDiv, {
    center: { lat, lng },
    zoom,
    mapTypeId: 'satellite',
    tilt: 0,
    disableDefaultUI: true,
    zoomControl: false,
    scrollwheel: false,
    gestureHandling: 'none',
  });
}

function clearSolarOverlays() {
  solarOverlays.forEach((o) => o.setMap(null));
  solarOverlays = [];
}

function setMapLoading(loading) {
  const mapDiv = document.getElementById('googleLookupMap');
  if (!mapDiv) return;
  let indicator = document.getElementById('solarMapLoading');
  if (loading) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'solarMapLoading';
      indicator.textContent = 'Loading solar data…';
      Object.assign(indicator.style, {
        position: 'absolute', inset: '0', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)', color: '#fff',
        fontSize: '13px', fontFamily: 'inherit', zIndex: '10',
        pointerEvents: 'none', borderRadius: 'inherit',
      });
      mapDiv.parentElement.style.position = 'relative';
      mapDiv.parentElement.appendChild(indicator);
    }
    indicator.style.display = 'flex';
  } else if (indicator) {
    indicator.style.display = 'none';
  }
}



function applyFluxOverlay() {
  // Remove existing flux overlays (keep RGB base = index 0)
  for (let i = solarOverlays.length - 1; i >= 1; i--) {
    solarOverlays[i].setMap(null);
    solarOverlays.splice(i, 1);
  }
  if (cachedAnnualCanvas && cachedAnnualBounds) {
    addGroundOverlay(cachedAnnualCanvas, cachedAnnualBounds, 0.8);
  }
}

function paletteColor(value) {
  // Linear interpolation between palette stops for smooth gradients
  const stops = IRON_PALETTE.map(hex => ({
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  }));
  const n = stops.length - 1;
  const scaled = Math.max(0, Math.min(1, value)) * n;
  const lo = Math.floor(scaled);
  const hi = Math.min(n, lo + 1);
  const t = scaled - lo;
  return {
    r: Math.round(stops[lo].r + t * (stops[hi].r - stops[lo].r)),
    g: Math.round(stops[lo].g + t * (stops[hi].g - stops[lo].g)),
    b: Math.round(stops[lo].b + t * (stops[hi].b - stops[lo].b)),
  };
}

function renderSingleBand(band, width, height, fixedMin, fixedMax) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  let min = fixedMin ?? Infinity;
  let max = fixedMax ?? -Infinity;
  if (fixedMin == null || fixedMax == null) {
    for (let i = 0; i < band.length; i++) {
      if (band[i] < min) min = band[i];
      if (band[i] > max) max = band[i];
    }
  }
  const range = (max - min) || 1;
  for (let i = 0; i < band.length; i++) {
    const color = paletteColor((band[i] - min) / range);
    const px = i * 4;
    imgData.data[px] = color.r;
    imgData.data[px + 1] = color.g;
    imgData.data[px + 2] = color.b;
    imgData.data[px + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function renderRgb(rasters, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const [r, g, b] = rasters;
  for (let i = 0; i < r.length; i++) {
    const px = i * 4;
    imgData.data[px] = r[i];
    imgData.data[px + 1] = g[i];
    imgData.data[px + 2] = b[i];
    imgData.data[px + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

async function fetchGeoTiff(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`GeoTIFF fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return {
    rasters,
    bbox: image.getBoundingBox(),
    geoKeys: image.getGeoKeys(),
    width: image.getWidth(),
    height: image.getHeight(),
  };
}

function renderRoofMask(band, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < band.length; i++) {
    const px = i * 4;
    imgData.data[px]     = 43;   // teal R
    imgData.data[px + 1] = 181;  // teal G
    imgData.data[px + 2] = 160;  // teal B
    imgData.data[px + 3] = band[i] > 0 ? 200 : 0;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function renderMaskBand(band, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < band.length; i++) {
    const px = i * 4;
    imgData.data[px] = 255;
    imgData.data[px + 1] = 255;
    imgData.data[px + 2] = 255;
    imgData.data[px + 3] = band[i] > 0 ? 255 : 0;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function applyMask(fluxCanvas, maskCanvas) {
  const w = fluxCanvas.width;
  const h = fluxCanvas.height;
  const scaled = document.createElement('canvas');
  scaled.width = w;
  scaled.height = h;
  const sCtx = scaled.getContext('2d');
  sCtx.drawImage(maskCanvas, 0, 0, maskCanvas.width, maskCanvas.height, 0, 0, w, h);
  const fluxCtx = fluxCanvas.getContext('2d');
  const fluxData = fluxCtx.getImageData(0, 0, w, h);
  const maskData = sCtx.getImageData(0, 0, w, h);
  for (let i = 0; i < fluxData.data.length; i += 4) {
    fluxData.data[i + 3] = maskData.data[i];
  }
  fluxCtx.putImageData(fluxData, 0, 0);
}

function bboxToLatLngBounds(bbox, lng, geoKeys) {
  const modelType = geoKeys && geoKeys.GTModelTypeGeoKey;
  if (modelType === 2) {
    return new google.maps.LatLngBounds(
      new google.maps.LatLng(bbox[1], bbox[0]),
      new google.maps.LatLng(bbox[3], bbox[2])
    );
  }
  const proj4str = utmProj4ForLng(lng);
  const sw = proj4(proj4str, 'EPSG:4326', [bbox[0], bbox[1]]);
  const ne = proj4(proj4str, 'EPSG:4326', [bbox[2], bbox[3]]);
  return new google.maps.LatLngBounds(
    new google.maps.LatLng(sw[1], sw[0]),
    new google.maps.LatLng(ne[1], ne[0])
  );
}

function addGroundOverlay(canvas, bounds, opacity) {
  const dataUrl = canvas.toDataURL();
  const overlay = new google.maps.GroundOverlay(dataUrl, bounds, { opacity });
  overlay.setMap(solarMap);
  solarOverlays.push(overlay);
}

async function updateSolarMapFromPayload(payload) {
  if (!googleMapsApiReady || !SOLAR_MAP_API_KEY) return;
  const lat = payload?.raw?.center?.latitude ?? payload?.request?.latitude;
  const lng = payload?.raw?.center?.longitude ?? payload?.request?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const roofArea = Number(payload?.raw?.solarPotential?.wholeRoofStats?.areaMeters2) || 0;
  // radiusMeters: large enough to exceed the visible area; keep under 100m so 0.1m pixels stay manageable
  const radiusMeters = 100;
  // Zoom: based on roof size for good property detail, independent of radiusMeters
  const roofDiagonal = roofArea > 0 ? Math.sqrt(roofArea) * 1.41 : 20;
  const targetVisibleMeters = Math.max(50, Math.min(130, roofDiagonal * 3));
  const mapEl = document.getElementById('googleLookupMap');
  const mapPx = window._mapContainerWidth ||
                (mapEl?.getBoundingClientRect().width) ||
                (mapEl?.offsetWidth) || 900;
  window._mapContainerWidth = null;
  const zoom = Math.log2(156543 * Math.cos(lat * Math.PI / 180) * mapPx / targetVisibleMeters);

  activeFluxMode = 'annual';
  activeMonth = 0;
  initSolarMap(lat, lng, zoom);
  clearSolarOverlays();
  cachedRgbCanvas = null;
  cachedAnnualCanvas = null;
  setMapLoading(true);

  try {
    const layerUrl = new URL('https://solar.googleapis.com/v1/dataLayers:get');
    layerUrl.searchParams.set('location.latitude', lat);
    layerUrl.searchParams.set('location.longitude', lng);
    layerUrl.searchParams.set('radiusMeters', String(radiusMeters));
    layerUrl.searchParams.set('view', 'IMAGERY_AND_ANNUAL_FLUX_LAYERS');
    layerUrl.searchParams.set('requiredQuality', 'HIGH');
    layerUrl.searchParams.set('pixelSizeMeters', '0.25');
    layerUrl.searchParams.set('key', SOLAR_MAP_API_KEY);

    const resp = await fetch(layerUrl.toString());
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      console.error('Solar dataLayers error:', resp.status, errBody);
      return;
    }
    const layers = await resp.json();

    const addKey = (rawUrl) => {
      const u = new URL(rawUrl);
      u.searchParams.set('key', SOLAR_MAP_API_KEY);
      return u.toString();
    };

    const [rgbData, fluxData, maskData] = await Promise.all([
      fetchGeoTiff(addKey(layers.rgbUrl)),
      fetchGeoTiff(addKey(layers.annualFluxUrl)),
      fetchGeoTiff(addKey(layers.maskUrl)),
    ]);

    // RGB base layer — must match the same coordinate space as the flux overlay
    const rgbCanvas = renderRgb(rgbData.rasters, rgbData.width, rgbData.height);
    const rgbBounds = bboxToLatLngBounds(rgbData.bbox, lng, rgbData.geoKeys);
    cachedRgbCanvas = rgbCanvas;
    cachedRgbBounds = rgbBounds;
    addGroundOverlay(rgbCanvas, rgbBounds, 1.0);

    // Annual flux with iron palette, masked to roof pixels only
    const fluxCanvas = renderSingleBand(fluxData.rasters[0], fluxData.width, fluxData.height, 0, 1800);
    const maskCanvas = renderMaskBand(maskData.rasters[0], maskData.width, maskData.height);
    applyMask(fluxCanvas, maskCanvas);
    const fluxBounds = bboxToLatLngBounds(fluxData.bbox, lng, fluxData.geoKeys);
    cachedAnnualCanvas = fluxCanvas;
    cachedAnnualBounds = fluxBounds;
    applyFluxOverlay();
  } catch (err) {
    console.error('Solar flux overlay error:', err);
  } finally {
    setMapLoading(false);
  }
}
