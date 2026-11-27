"use strict";

const areaFocus = { selecting: false, loading: false, area: null, place: null, snapshot: null, history: [], controller: null, error: false, ignoreUntil: 0, cities: true, villages: false, subregions: false, details: false };
const areaFocusActive = () => Boolean(areaFocus.area);
const focusShowsCountries = () => areaFocus.area?.category === "kontynent";
const focusShowsRegions = () => areaFocus.area?.category === "panstwo";
const focusShowsCities = () => areaFocus.area?.category === "miasto" || (areaFocus.area?.category === "rejon" && areaFocus.cities);
const focusShowsVillages = () => areaFocus.area?.category === "rejon" && areaFocus.villages;
const focusShowsSubregions = () => (areaFocus.area?.category === "panstwo" && areaFocus.area.division_level === "subregion") ||
  (areaFocus.area?.category === "rejon" && areaFocus.place?.level !== "subregion" && areaFocus.subregions);
const focusSearchCategory = () => focusShowsCountries() ? "panstwo" : focusShowsRegions() ? "rejon" : "miasto";
const focusDetailedActive = () => Boolean(areaFocus.area && areaFocus.details && onlineEnabled("online_details"));
const focusDistrictsVisible = () => Boolean(areaFocus.area?.is_capital && !focusDetailedActive());

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
  if (focusShowsRegions() && place.category === "rejon" && (place.level || "region") !== (areaFocus.area.division_level || "region")) return false;
  if (focusShowsRegions() && place.category === "miasto" && !place.capital && !capitalRecords.has(place.id)) return false;
  if (areaFocus.area.category === "rejon") {
    if (place.category === "rejon") {
      if (!focusShowsSubregions() || place.level !== "subregion" || place.parent_id !== areaFocus.area.id) return false;
    } else if (place.category !== "miasto" || (place.id.startsWith("simc:") ? !focusShowsVillages() : !focusShowsCities())) return false;
  } else if (focusShowsCities() && place.category !== "miasto") return false;
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
  const back = document.getElementById("focus-back");
  back.hidden = !areaFocusActive();
  back.disabled = areaFocus.loading;
  document.getElementById("map-stage").classList.toggle("area-selecting", areaFocus.selecting);
  document.getElementById("area-focus-banner").hidden = !areaFocusActive();
  document.getElementById("area-focus-cities-option").hidden = areaFocus.area?.category !== "rejon";
  document.getElementById("area-focus-cities").checked = areaFocus.cities;
  document.getElementById("area-focus-villages-option").hidden = areaFocus.area?.category !== "rejon";
  document.getElementById("area-focus-villages").checked = areaFocus.villages;
  document.getElementById("area-focus-subregions-option").hidden = areaFocus.area?.category !== "rejon" || areaFocus.place?.level === "subregion";
  document.getElementById("area-focus-subregions").checked = areaFocus.subregions;
  for (const kind of ["cities", "villages", "subregions"]) {
    const count = areaFocus.area?.counts?.[kind];
    const counter = document.getElementById("area-focus-" + kind + "-count");
    counter.textContent = " (" +
      (typeof count === "number" ? count.toLocaleString(tr("pl-PL", "en-GB")) : count === null || areaFocus.area?.countsFailed ? "—" : "…") + ")";
    counter.title = count === null ? tr("Brak danych o liczbie elementów w tym obszarze.", "The number of elements in this area is unavailable.") : "";
  }
  const districtStatus = document.getElementById("area-focus-district-status");
  districtStatus.hidden = !focusDistrictsVisible();
  districtStatus.textContent = areaFocus.area?.districtsLoading ? tr("Wczytywanie dzielnic…", "Loading districts…")
    : areaFocus.area?.districts?.features?.length ? tr("Dzielnice: ", "Districts: ") + areaFocus.area.districts.features.length
    : areaFocus.area?.districts?.unavailable === "offline" ? tr("Włącz szczegółowe mapy w ustawieniach, aby pobrać dzielnice.", "Allow detailed maps in Settings to download districts.")
    : tr("Granice dzielnic są obecnie niedostępne.", "District boundaries are currently unavailable.");
  const divisionCounts = document.getElementById("area-focus-division-counts");
  divisionCounts.hidden = !["panstwo", "kontynent"].includes(areaFocus.area?.category);
  divisionCounts.textContent = [
    [tr("Państwa", "Countries"), areaFocus.area?.counts?.countries],
    [tr("Rejony", "Regions"), areaFocus.area?.counts?.regions],
    [tr("Podregiony", "Subregions"), areaFocus.area?.counts?.subregions],
  ].filter(([, count]) => count > 0).map(([label, count]) => `${label}: ${count.toLocaleString(tr("pl-PL", "en-GB"))}`).join(" · ");
  const detailOption = document.getElementById("area-focus-detail-option");
  detailOption.hidden = !areaFocusActive();
  const allowed = onlineEnabled("online_details");
  const detailInput = document.getElementById("area-focus-detail");
  if (!allowed) areaFocus.details = false;
  detailInput.checked = focusDetailedActive();
  detailInput.disabled = !allowed;
  detailOption.title = allowed ? tr("Wymaga dostępu do internetu. W tym trybie dodawaj własne pinezki.", "Requires internet access. Use custom pins in this mode.")
    : tr("Włącz szczegółowe mapy w ustawieniach głównych.", "Allow detailed maps in main settings.");
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
    if (areaFocus.area) areaFocus.history.push({ area: areaFocus.area, place: areaFocus.place,
      cities: areaFocus.cities, villages: areaFocus.villages, subregions: areaFocus.subregions,
      category, view: { ...view }, center: cityMap?.getCenter().toArray(), zoom: cityMap?.getZoom() });
    areaFocus.area = area;
    areaFocus.cities = area.category !== "rejon" || place.level === "subregion";
    areaFocus.villages = false;
    areaFocus.subregions = area.category === "rejon" && place.level !== "subregion";
    areaFocus.details = area.category === "miasto" && onlineEnabled("online_details");
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
    loadFocusCounts(area);
    loadCapitalDistricts(area);
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

function loadCapitalDistricts(area) {
  if (!area.is_capital || area.districtsLoading || area.districts) return;
  area.districtsLoading = true;
  syncAreaFocusUi();
  request("/api/stolica-dzielnice?" + new URLSearchParams({id: area.id})).then((data) => {
    area.districts = data;
    area.districtPaths = data.features.map((feature) => projectedPolygon(feature.geometry));
  }).catch(() => { area.districts = {type: "FeatureCollection", features: [], unavailable: "source"}; }).finally(() => {
    area.districtsLoading = false;
    if (areaFocus.area === area) { syncAreaFocusUi(); if (basemapReady) syncAreaFocusLayers(); scheduleDraw(); }
  });
}

function loadFocusCounts(area) {
  if (area.category !== "rejon" || area.countsLoading || area.counts?.cities !== undefined) return;
  area.countsLoading = true;
  request("/api/obszar-liczniki?" + new URLSearchParams({category: area.category, id: area.id})).then((counts) => {
    area.counts = counts;
  }).catch(() => { area.countsFailed = true; }).finally(() => {
    area.countsLoading = false;
    if (areaFocus.area === area) { syncAreaFocusUi(); updatePresetDistanceWarnings(); }
  });
}

function fitFocusedArea(preserveCamera = false) {
  const area = areaFocus.area;
  if (!area) return;
  const [west, south, east, north] = area.camera_bounds || area.bounds;
  if (cityMap) {
    cityMap.setRenderWorldCopies?.(area.category === "kontynent" && area.id === "oceania");
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

function resetHigherFocusDetail() {
  if (!areaFocus.area || areaFocus.area.category === "miasto" || !areaFocus.details) return;
  areaFocus.details = false;
  syncAreaFocusUi();
  if (basemapReady) syncAreaFocusLayers();
}

function syncFocusDetailMap() {
  const area = areaFocus.area;
  const enabled = focusDetailedActive();
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
      paint: { "raster-saturation": -.7, "raster-opacity": area.category === "miasto" ? 1 : .7 } });
    cityMap.addLayer({ id: "area-focus-status", type: "fill", source: "area-focus-boundary",
      paint: { "fill-color": statusColor(area.category, "id", "rgba(0,0,0,0)"), "fill-opacity": .18 } });
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
  Object.assign(areaFocus, { area: null, place: null, snapshot: null, history: [], selecting: false, loading: false, error: false, cities: true, villages: false, subregions: false, details: false });
  if (previous) {
    activePreset = visibility[previous.preset] ? previous.preset : Object.keys(presets).find((id) => visibility[id]);
    category = presets[activePreset].category;
    tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.preset === activePreset)));
    Object.assign(view, previous.view);
    if (cityMap) {
      cityMap.setRenderWorldCopies?.(false);
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

function backAreaFocus() {
  if (!areaFocusActive()) return;
  const previous = areaFocus.history.pop();
  if (!previous) { leaveAreaFocus(); return; }
  areaFocus.controller?.abort();
  Object.assign(areaFocus, { area: previous.area, place: previous.place,
    cities: previous.cities, villages: previous.villages, subregions: previous.subregions,
    details: previous.area.category === "miasto" && onlineEnabled("online_details"),
    selecting: false, loading: false, error: false, ignoreUntil: Date.now() + 650 });
  category = previous.category;
  Object.assign(view, previous.view);
  closePlaceDetails();
  closePinEditor();
  showHover(null);
  search.value = "";
  syncAreaFocusUi();
  updateSearchPrompt();
  fitFocusedArea();
  if (cityMap && previous.center) cityMap.jumpTo({ center: previous.center, zoom: Math.max(previous.zoom, mapZoomRange.min) });
  else Object.assign(view, previous.view);
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
    cityMap.addSource("capital-districts", {type: "geojson", data: emptyFeatures()});
    cityMap.addLayer({id: "capital-district-hover", type: "fill", source: "capital-districts", paint: {"fill-opacity": 0}});
    cityMap.addLayer({id: "capital-district-lines", type: "line", source: "capital-districts", paint: {"line-color": "#765697", "line-width": 1.4, "line-opacity": .9}});
    cityMap.on("mousemove", "capital-district-hover", (event) => {
      const feature = event.features?.[0];
      if (feature && focusDistrictsVisible() && focusContains(event.lngLat.toArray()))
        showMapTooltip(document.documentElement.lang === "en" && feature.properties.name_en || feature.properties.name, event.point.x, event.point.y);
    });
    cityMap.on("mouseleave", "capital-district-hover", () => { tooltip.hidden = true; });
  }
  const area = areaFocus.area;
  syncFocusDetailMap();
  for (const id of ["area-focus-mask", "area-focus-context", "area-focus-boundary"]) setLayerVisible(id, Boolean(area));
  const districts = area?.districts;
  if (areaFocus.renderedDistricts !== districts) {
    cityMap.getSource("capital-districts").setData(districts || emptyFeatures());
    areaFocus.renderedDistricts = districts;
  }
  for (const id of ["capital-district-hover", "capital-district-lines"]) setLayerVisible(id, focusDistrictsVisible());
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
  for (const id of ["capital-district-hover", "capital-district-lines", "area-focus-mask", "area-focus-context", "area-focus-boundary"]) cityMap.moveLayer(id);
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
  if (focusDistrictsVisible()) for (const path of areaFocus.area.districtPaths || []) ctx.stroke(path);
}

document.getElementById("focus-area").addEventListener("click", () => {
  if (ready) setAreaSelection(!areaFocus.selecting);
});
document.getElementById("leave-area-focus").addEventListener("click", leaveAreaFocus);
document.getElementById("focus-back").addEventListener("click", backAreaFocus);
document.getElementById("area-focus-detail").addEventListener("change", (event) => {
  areaFocus.details = onlineEnabled("online_details") && event.target.checked;
  if (pendingMapClick) { clearTimeout(pendingMapClick.timer); pendingMapClick = undefined; }
  lastRightMapClick = undefined;
  syncAreaFocusUi();
  if (basemapReady) syncAreaFocusLayers();
});
document.getElementById("map-stage").addEventListener("pointerdown", (event) => {
  if (event.button !== 1) return;
  event.preventDefault();
  event.stopPropagation();
  const button = document.getElementById("focus-area");
  if (ready && !button.hidden && !button.disabled && !document.querySelector("dialog[open]")) button.click();
}, { capture: true });
for (const type of ["mousedown", "auxclick"]) document.getElementById("map-stage").addEventListener(type, (event) => {
  if (event.button === 1) { event.preventDefault(); event.stopPropagation(); }
}, { capture: true });
for (const kind of ["cities", "villages", "subregions"]) document.getElementById("area-focus-" + kind).addEventListener("change", (event) => {
  areaFocus[kind] = event.target.checked;
  schedulePlaceSearch();
  refreshPreset();
  updateSidebar();
});
document.addEventListener("atlas-settings-loaded", syncAreaFocusUi);
document.addEventListener("atlas-online-change", () => {
  if (areaFocus.area?.is_capital && onlineEnabled("online_details") && areaFocus.area.districts?.unavailable) {
    areaFocus.area.districts = null;loadCapitalDistricts(areaFocus.area);
  }
  syncAreaFocusUi();
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
