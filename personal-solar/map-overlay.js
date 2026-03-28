// Solar flux GeoTIFF overlay using Google Maps JS API + geotiff.js + proj4.js
let SOLAR_MAP_API_KEY = null;
const IRON_PALETTE = ['00000A','91009C','E64616','FEB400','FFFFF6'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function utmProj4ForLng(lng) {
  const zone = Math.floor((lng + 180) / 6) + 1;
  return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
}

let solarMap = null;
let solarOverlays = [];
let googleMapsApiReady = false;

// Cached canvases and bounds from last fetch
let cachedRgbCanvas = null;
let cachedRgbBounds = null;
let cachedAnnualCanvas = null;
let cachedAnnualBounds = null;
let cachedMonthlyCanvases = null; // array of 12
let cachedMonthlyBounds = null;

// Active overlay state: 'annual' | 'monthly' | 'none'
let activeFluxMode = 'annual';
let activeMonth = 0; // 0-11

function onGoogleMapsApiLoaded() {
  googleMapsApiReady = true;
  SOLAR_MAP_API_KEY = window._solarMapApiKey || null;
  initSolarMap(30.2672, -97.7431, 13);
  if (typeof googleSolarRawPayload !== 'undefined' && googleSolarRawPayload) {
    updateSolarMapFromPayload(googleSolarRawPayload);
  }
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

function syncFluxControlState() {
  const btnAnnual = document.getElementById('solarBtnAnnual');
  const btnMonthly = document.getElementById('solarBtnMonthly');
  const btnNone = document.getElementById('solarBtnNone');
  const monthSelect = document.getElementById('solarMonthSelect');
  if (!btnAnnual) return;
  const btnStyle = (active) => ({
    background: active ? 'rgba(255,255,255,0.25)' : 'transparent',
    color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: '4px', padding: '2px 8px', cursor: 'pointer',
    fontSize: '11px', fontFamily: 'inherit',
  });
  Object.assign(btnAnnual.style, btnStyle(activeFluxMode === 'annual'));
  Object.assign(btnMonthly.style, btnStyle(activeFluxMode === 'monthly'));
  Object.assign(btnNone.style, btnStyle(activeFluxMode === 'none'));
  if (monthSelect) {
    monthSelect.style.display = activeFluxMode === 'monthly' ? 'block' : 'none';
    monthSelect.value = activeMonth;
  }
}

function ensureFluxControls() {
  const mapDiv = document.getElementById('googleLookupMap');
  if (!mapDiv || document.getElementById('solarFluxControls')) return;

  // Use the outer wrap (lookup-map-wrap) so overflow:hidden on the frame doesn't clip controls
  const frame = mapDiv.parentElement;
  const wrap = frame.parentElement;
  wrap.style.position = 'relative';

  const ctrl = document.createElement('div');
  ctrl.id = 'solarFluxControls';
  Object.assign(ctrl.style, {
    position: 'absolute', bottom: '8px', left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'rgba(0,0,0,0.6)', borderRadius: '6px',
    padding: '4px 8px', zIndex: '5', whiteSpace: 'nowrap',
  });

  const btnStyle = (active) => ({
    background: active ? 'rgba(255,255,255,0.25)' : 'transparent',
    color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: '4px', padding: '2px 8px', cursor: 'pointer',
    fontSize: '11px', fontFamily: 'inherit',
  });

  function makeBtn(label, id) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.id = id;
    Object.assign(b.style, btnStyle(false));
    return b;
  }

  const btnAnnual = makeBtn('Annual', 'solarBtnAnnual');
  const btnMonthly = makeBtn('Monthly', 'solarBtnMonthly');
  const btnNone = makeBtn('None', 'solarBtnNone');

  const monthSelect = document.createElement('select');
  monthSelect.id = 'solarMonthSelect';
  Object.assign(monthSelect.style, {
    background: 'rgba(0,0,0,0.5)', color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)', borderRadius: '4px',
    padding: '2px 4px', fontSize: '11px', cursor: 'pointer',
    display: 'none',
  });
  MONTH_NAMES.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = m;
    monthSelect.appendChild(opt);
  });
  monthSelect.value = activeMonth;

  ctrl.appendChild(btnAnnual);
  ctrl.appendChild(btnMonthly);
  ctrl.appendChild(monthSelect);
  ctrl.appendChild(btnNone);
  // Append to wrap (outer div), not frame (has overflow:hidden)
  wrap.appendChild(ctrl);

  function updateBtnStyles() {
    Object.assign(btnAnnual.style, btnStyle(activeFluxMode === 'annual'));
    Object.assign(btnMonthly.style, btnStyle(activeFluxMode === 'monthly'));
    Object.assign(btnNone.style, btnStyle(activeFluxMode === 'none'));
    monthSelect.style.display = activeFluxMode === 'monthly' ? 'block' : 'none';
  }

  btnAnnual.addEventListener('click', () => {
    activeFluxMode = 'annual';
    updateBtnStyles();
    applyFluxOverlay();
  });

  btnMonthly.addEventListener('click', () => {
    activeFluxMode = 'monthly';
    updateBtnStyles();
    applyFluxOverlay();
  });

  btnNone.addEventListener('click', () => {
    activeFluxMode = 'none';
    updateBtnStyles();
    applyFluxOverlay();
  });

  monthSelect.addEventListener('change', () => {
    activeMonth = Number(monthSelect.value);
    if (activeFluxMode === 'monthly') applyFluxOverlay();
  });

  updateBtnStyles();
}

function applyFluxOverlay() {
  // Remove existing flux overlays (keep RGB base = index 0)
  for (let i = solarOverlays.length - 1; i >= 1; i--) {
    solarOverlays[i].setMap(null);
    solarOverlays.splice(i, 1);
  }

  if (activeFluxMode === 'annual' && cachedAnnualCanvas && cachedAnnualBounds) {
    addGroundOverlay(cachedAnnualCanvas, cachedAnnualBounds, 0.8);
  } else if (activeFluxMode === 'monthly' && cachedMonthlyCanvases && cachedMonthlyBounds) {
    const canvas = cachedMonthlyCanvases[activeMonth];
    if (canvas) addGroundOverlay(canvas, cachedMonthlyBounds, 0.8);
  }
}

function paletteColor(value) {
  const idx = Math.min(IRON_PALETTE.length - 1, Math.floor(value * IRON_PALETTE.length));
  const hex = IRON_PALETTE[idx];
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}

function renderSingleBand(band, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < band.length; i++) {
    if (band[i] < min) min = band[i];
    if (band[i] > max) max = band[i];
  }
  const range = max - min || 1;
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
  const radiusMeters = Math.max(15, Math.min(60, Math.round(Math.sqrt(roofArea) * 1.2)));
  const mapPx = document.getElementById('googleLookupMap')?.offsetWidth || 400;
  const zoom = Math.log2(156543 * Math.cos(lat * Math.PI / 180) * mapPx * 1.25 / (2 * radiusMeters));

  activeFluxMode = 'annual';
  activeMonth = 0;
  syncFluxControlState();
  initSolarMap(lat, lng, zoom);
  clearSolarOverlays();
  cachedRgbCanvas = null;
  cachedAnnualCanvas = null;
  cachedMonthlyCanvases = null;
  setMapLoading(true);

  try {
    const layerUrl = new URL('https://solar.googleapis.com/v1/dataLayers:get');
    layerUrl.searchParams.set('location.latitude', lat);
    layerUrl.searchParams.set('location.longitude', lng);
    layerUrl.searchParams.set('radiusMeters', String(radiusMeters));
    layerUrl.searchParams.set('view', 'IMAGERY_AND_ALL_FLUX_LAYERS');
    layerUrl.searchParams.set('requiredQuality', 'HIGH');
    layerUrl.searchParams.set('pixelSizeMeters', '0.1');
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

    const [rgbData, maskData, fluxData, monthlyData] = await Promise.all([
      fetchGeoTiff(addKey(layers.rgbUrl)),
      fetchGeoTiff(addKey(layers.maskUrl)),
      fetchGeoTiff(addKey(layers.annualFluxUrl)),
      fetchGeoTiff(addKey(layers.monthlyFluxUrl)),
    ]);

    // RGB base layer
    const rgbCanvas = renderRgb(rgbData.rasters, rgbData.width, rgbData.height);
    const rgbBounds = bboxToLatLngBounds(rgbData.bbox, lng, rgbData.geoKeys);
    cachedRgbCanvas = rgbCanvas;
    cachedRgbBounds = rgbBounds;
    addGroundOverlay(rgbCanvas, rgbBounds, 1.0);

    // Mask canvas (used for both annual and monthly)
    const maskCanvas = renderSingleBand(maskData.rasters[0], maskData.width, maskData.height);

    // Annual flux overlay
    const annualCanvas = renderSingleBand(fluxData.rasters[0], fluxData.width, fluxData.height);
    applyMask(annualCanvas, maskCanvas);
    const fluxBounds = bboxToLatLngBounds(fluxData.bbox, lng, fluxData.geoKeys);
    cachedAnnualCanvas = annualCanvas;
    cachedAnnualBounds = fluxBounds;

    // Monthly flux overlays (12 bands)
    const monthlyBounds = bboxToLatLngBounds(monthlyData.bbox, lng, monthlyData.geoKeys);
    cachedMonthlyBounds = monthlyBounds;
    cachedMonthlyCanvases = [];
    for (let m = 0; m < 12; m++) {
      const band = monthlyData.rasters[m];
      if (band) {
        const mc = renderSingleBand(band, monthlyData.width, monthlyData.height);
        applyMask(mc, maskCanvas);
        cachedMonthlyCanvases.push(mc);
      } else {
        cachedMonthlyCanvases.push(null);
      }
    }

    ensureFluxControls();
    applyFluxOverlay();
  } catch (err) {
    console.error('Solar flux overlay error:', err);
  } finally {
    setMapLoading(false);
  }
}
