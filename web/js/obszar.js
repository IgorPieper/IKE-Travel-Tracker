"use strict";

const areaFocus = { selecting: false, loading: false, area: null, place: null, snapshot: null, controller: null, error: false, ignoreUntil: 0, villages: false };
const areaFocusActive = () => Boolean(areaFocus.area);
const focusShowsCountries = () => areaFocus.area?.category === "kontynent";
const focusShowsRegions = () => areaFocus.area?.category === "panstwo";
const focusShowsCities = () => ["rejon", "miasto"].includes(areaFocus.area?.category);
const focusShowsVillages = () => areaFocus.area?.category === "rejon" && areaFocus.villages;
const focusSearchCategory = () => focusShowsCountries() ? "panstwo" : focusShowsRegions() ? "rejon" : "miasto";

function areaContainsPoint(geometry, position) {
  const [lon, lat] = position;
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [previousX, previousY] = ring[j];
      if ((y > lat) !== (previousY > lat) && lon < (previousX - x) * (lat - y) / (previousY - y) + x) inside = !inside;
    }
    return inside;
  };
  const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  return polygons.some((rings) => inRing(rings[0]) && !rings.slice(1).some(inRing));
}

function focusContains(position) {
  return !areaFocusActive() || areaContainsPoint(areaFocus.area.feature.geometry, position);
}

function focusPlaceAllowed(place) {
  if (!areaFocusActive()) return true;
  if (focusShowsCountries() && place.category !== "panstwo") return false;
  if (focusShowsRegions() && !["rejon", "miasto"].includes(place.category)) return false;
  if (focusShowsRegions() && place.category === "rejon" && place.level === "subregion") return false;
  if (focusShowsRegions() && place.category === "miasto" && !place.capital && !capitalRecords.has(place.id)) return false;
  if (focusShowsCities() && place.category !== "miasto") return false;
  if (!focusShowsVillages() && place.id.startsWith("simc:")) return false;
  const position = place.getPosition?.() || (Number.isFinite(place.x) && cityPosition(place.x, place.y));
  return Boolean(position && focusContains(position));
}

function updateFocusHint() {
  const hint = document.getElementById("map-hint");
  hint.hidden = false;
  if (areaFocus.loading) hint.textContent = tr("Wczytywanie obszaru…", "Loading area…");
  else if (areaFocus.error) hint.textContent = tr("Nie udało się wczytać obrysu. Wybierz inny obszar lub spróbuj ponownie.", "Could not load the boundary. Choose another area or try again.");
  else if (areaFocus.selecting) hint.textContent = tr("Kliknij lewym przyciskiem obszar, który chcesz wyodrębnić. Escape anuluje wybór.", "Left-click an area to focus on it. Escape cancels selection.");
  else if (areaFocusActive()) { hint.textContent = ""; hint.hidden = true; }
  else return false;
  return true;
}

function syncAreaFocusUi() {
  const button = document.getElementById("focus-area");
  button.disabled = !ready || areaFocus.loading;
  button.hidden = areaFocus.area?.category === "miasto";
  button.setAttribute("aria-pressed", String(areaFocus.selecting));
  document.getElementById("map-stage").classList.toggle("area-selecting", areaFocus.selecting);
  document.getElementById("area-focus-banner").hidden = !areaFocusActive();
  document.getElementById("area-focus-villages-option").hidden = areaFocus.area?.category !== "rejon";
  document.getElementById("area-focus-villages").checked = areaFocus.villages;
  document.getElementById("area-focus-detail-option").hidden = areaFocus.area?.category !== "miasto";
  document.querySelector(".map-views").hidden = areaFocusActive();
  document.getElementById("map-title").textContent = areaFocusActive() ? displayPlaceName(areaFocus.place) : tr("Mapa świata", "World map");
  updateFocusHint();
}

function setAreaSelection(active) {
  areaFocus.controller?.abort();
  areaFocus.loading = false;
  areaFocus.selecting = active;
  areaFocus.error = false;
  if (active) {
    setPinPlacement(false);
    if (pendingMapClick) clearTimeout(pendingMapClick.timer);
    pendingMapClick = undefined;
  }
  syncAreaFocusUi();
  if (!active) updateCityView();
}

async function selectFocusArea(place) {
  if (!place || areaFocus.loading) return;
  areaFocus.ignoreUntil = Date.now() + 650;
  areaFocus.selecting = false;
  areaFocus.loading = true;
  areaFocus.error = false;
  const controller = new AbortController();
  areaFocus.controller = controller;
  syncAreaFocusUi();
  try {
    const params = new URLSearchParams({ category: place.category, id: place.id });
    const area = await request("/api/obszar?" + params, { signal: controller.signal });
    if (controller.signal.aborted) return;
    areaFocus.snapshot ||= { category, preset: activePreset, view: { ...view },
      center: cityMap?.getCenter().toArray(), zoom: cityMap?.getZoom() };
    areaFocus.area = area;
    areaFocus.villages = false;
    areaFocus.place = place;
    areaFocus.area.path = projectedPolygon(area.feature.geometry);
    areaFocus.area.outerContext = area.context.features.filter((feature) => !areaContainsPoint(area.feature.geometry, outlineCenter(feature)));
    areaFocus.area.contextPaths = areaFocus.area.outerContext.map((feature) => projectedPolygon(feature.geometry));
    category = focusSearchCategory();
    updateSearchPrompt();
    showHover(null);
    closePlaceDetails();
    closePinEditor();
    search.value = "";
    schedulePlaceSearch();
    syncAreaFocusUi();
    fitFocusedArea();
    refreshPreset();
    updateSidebar();
    scheduleDraw();
  } catch (error) {
    if (!controller.signal.aborted) {
      areaFocus.selecting = true;
      areaFocus.error = true;
    }
  } finally {
    if (areaFocus.controller === controller) {
      areaFocus.loading = false;
      syncAreaFocusUi();
    }
  }
}

function fitFocusedArea(preserveCamera = false) {
  const area = areaFocus.area;
  if (!area) return;
  const [west, south, east, north] = area.camera_bounds || area.bounds;
  if (cityMap) {
    const previous = preserveCamera ? { center: cityMap.getCenter().toArray(), zoom: cityMap.getZoom() } : null;
    // Measure the full-area view without constraints left by the previous selection.
    cityMap.setMaxBounds(null);
    cityMap.setMinZoom(0);
    cityMap.resize();
    cityMap.fitBounds([[west, Math.max(-85, south)], [east, Math.min(85, north)]],
      { padding: 32, duration: 0, maxZoom: 16 });
    mapZoomRange.min = cityMap.getZoom();
    const frame = cityMap.getBounds().toArray();
    cityMap.setMinZoom(mapZoomRange.min);
    // Lock the outermost view to this frame; closer views can still pan within it.
    cityMap.setMaxBounds(frame);
    if (previous) cityMap.jumpTo({ center: previous.center, zoom: Math.max(previous.zoom, mapZoomRange.min) });
  } else {
    const [x, y] = project((west + east) / 2, (south + north) / 2);
    const zoom = Math.max(1, 240 / Math.max(east - west, north - south, .01));
    mapZoomRange.min = Math.log2(zoom);
    Object.assign(view, { x, y, zoom });
  }
}

function syncFocusDetailMap() {
  const area = areaFocus.area;
  const enabled = area?.category === "miasto" && onlineEnabled("online_focus");
  if (areaFocus.rasterArea !== area || !enabled) {
    if (cityMap.getLayer("area-focus-status")) cityMap.removeLayer("area-focus-status");
    if (cityMap.getLayer("area-focus-streets")) cityMap.removeLayer("area-focus-streets");
    if (cityMap.getSource("area-focus-streets")) cityMap.removeSource("area-focus-streets");
    areaFocus.rasterArea = null;
  }
  if (enabled && !cityMap.getSource("area-focus-streets")) {
    cityMap.addSource("area-focus-streets", { type: "raster", tileSize: 256, maxzoom: 19,
      bounds: area.bounds, attribution: '© OpenStreetMap contributors',
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"] });
    cityMap.addLayer({ id: "area-focus-streets", type: "raster", source: "area-focus-streets",
      paint: { "raster-saturation": -.7 } });
    cityMap.addLayer({ id: "area-focus-status", type: "fill", source: "area-focus-boundary",
      paint: { "fill-color": statusColor("miasto", "id", "rgba(0,0,0,0)"), "fill-opacity": .18 } });
    areaFocus.rasterArea = area;
  }
  if (enabled) {
    cityMap.moveLayer("area-focus-streets");
    cityMap.moveLayer("area-focus-status");
  }
}

function consumeFocusSelection(place) {
  if (areaFocus.selecting) { selectFocusArea(place); return true; }
  return areaFocus.loading || Date.now() < areaFocus.ignoreUntil;
}

function leaveAreaFocus() {
  const previous = areaFocus.snapshot;
  mapZoomRange.min = 0;
  areaFocus.controller?.abort();
  Object.assign(areaFocus, { area: null, place: null, snapshot: null, selecting: false, loading: false, error: false, villages: false });
  if (previous) {
    activePreset = visibility[previous.preset] ? previous.preset : Object.keys(presets).find((id) => visibility[id]);
    category = presets[activePreset].category;
    tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.preset === activePreset)));
    Object.assign(view, previous.view);
    if (cityMap) {
      cityMap.setMaxBounds(null);
      cityMap.setMinZoom(0);
      cityMap.jumpTo({ center: previous.center, zoom: previous.zoom });
    }
  }
  syncAreaFocusUi();
  search.value = "";
  updateSearchPrompt();
  schedulePlaceSearch();
  refreshPreset();
  updateSidebar();
  scheduleDraw();
}

function syncAreaFocusLayers() {
  if (!basemapReady) return;
  if (!cityMap.getSource("area-focus-boundary")) {
    for (const source of ["area-focus-boundary", "area-focus-mask", "area-focus-context"]) cityMap.addSource(source, { type: "geojson", data: emptyFeatures() });
    cityMap.addLayer({ id: "area-focus-mask", type: "fill", source: "area-focus-mask", paint: { "fill-color": "#fff", "fill-opacity": 1, "fill-antialias": false } });
    cityMap.addLayer({ id: "area-focus-context", type: "line", source: "area-focus-context", paint: { "line-color": "#c6c1ce", "line-width": .8, "line-opacity": .65 } });
    cityMap.addLayer({ id: "area-focus-boundary", type: "line", source: "area-focus-boundary", paint: { "line-color": "#765697", "line-width": 1.5 } });
  }
  const area = areaFocus.area;
  syncFocusDetailMap();
  for (const id of ["area-focus-mask", "area-focus-context", "area-focus-boundary"]) setLayerVisible(id, Boolean(area));
  if (!area) return;
  if (areaFocus.rendered !== area) {
    const geometry = area.feature.geometry;
    const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
    const world = [[-180,-85.05113],[180,-85.05113],[180,85.05113],[-180,85.05113],[-180,-85.05113]];
    cityMap.getSource("area-focus-boundary").setData(area.feature);
    cityMap.getSource("area-focus-mask").setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...polygons.map((rings) => rings[0])] } });
    areaFocus.rendered = area;
  }
  const details = densityState();
  const contextLevel = `${details.cities}:${details.villages}`;
  if (areaFocus.contextArea !== area || areaFocus.contextLevel !== contextLevel || areaFocus.contextRows !== savedRows) {
    const features = area.outerContext.filter(({ properties }) => properties.kind !== "locality" ||
      savedPlaces.has("miasto:" + properties.id) || (properties.id?.startsWith("simc:") ? details.villages : details.cities));
    cityMap.getSource("area-focus-context").setData({ type: "FeatureCollection", features });
    area.contextPaths = features.map((feature) => projectedPolygon(feature.geometry));
    areaFocus.contextArea = area;
    areaFocus.contextLevel = contextLevel;
    areaFocus.contextRows = savedRows;
  }
  // Any subsequently loaded detail layers must stay beneath the isolation mask.
  for (const id of ["area-focus-mask", "area-focus-context", "area-focus-boundary"]) cityMap.moveLayer(id);
}

function drawAreaFocusOverlay() {
  if (!areaFocusActive()) return;
  const mask = new Path2D();
  mask.rect(-2000, -2000, 4000, 4000);
  mask.addPath(areaFocus.area.path);
  ctx.fillStyle = "#fff";
  ctx.fill(mask, "evenodd");
  ctx.strokeStyle = "#d5d0dc";
  for (const path of areaFocus.area.contextPaths) ctx.stroke(path);
  ctx.strokeStyle = "#765697";
  ctx.stroke(areaFocus.area.path);
}

document.getElementById("focus-area").addEventListener("click", () => {
  if (ready) setAreaSelection(!areaFocus.selecting);
});
document.getElementById("leave-area-focus").addEventListener("click", leaveAreaFocus);
document.getElementById("area-focus-villages").addEventListener("change", (event) => {
  areaFocus.villages = event.target.checked;
  schedulePlaceSearch();
  refreshPreset();
  updateSidebar();
});
document.addEventListener("atlas-settings-loaded", syncAreaFocusUi);
document.addEventListener("atlas-online-change", () => {
  if (basemapReady) syncAreaFocusLayers();
});
document.addEventListener("atlas-language-change", syncAreaFocusUi);
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]")) return;
  if (event.key === "Escape" && (areaFocus.selecting || areaFocus.loading)) {
    setAreaSelection(false);
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, { capture: true });
