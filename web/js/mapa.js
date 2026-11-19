"use strict";

const byId = (id) => document.getElementById(id);
const canvas = byId("atlas");
const ctx = canvas.getContext("2d");
const tooltip = byId("tooltip");
const search = byId("search");
const results = byId("results");
const status = byId("status");
const tabs = [...document.querySelectorAll("[data-preset]")];
const defaultPresets = {
  continents: { label: "Kontynenty", english: "Continents", category: "kontynent", min: 0, zoom: 0, max: 4 },
  countries: { label: "Państwa", english: "Countries", category: "panstwo", min: 0, zoom: 0, max: 4 },
  regions: { label: "Rejony", english: "Regions", category: "miasto", min: 1, zoom: 4, max: 12 },
  major: { label: "Duże miasta", english: "Major cities", category: "miasto", min: 4, zoom: 7, max: 12 },
  "capital-cities": { label: "Stolice", english: "Capitals", category: "miasto", min: 0, zoom: 7, max: 16 },
  cities: { label: "Miasta", english: "Cities", category: "miasto", min: 6, zoom: 10.75, max: 15 },
  settlements: { label: "Wsie", english: "Villages", category: "miasto", min: 9, zoom: 11.25, max: 16 },
  visited: { label: "Zaznaczone", english: "Marked", category: "miasto", min: 0, zoom: 0, max: 16 },
  "visited-only": { label: "Odwiedzone", english: "Visited", category: "miasto", min: 0, zoom: 0, max: 16, savedStatus: "visited" },
  "planned-only": { label: "Zaplanowane", english: "Planned", category: "miasto", min: 0, zoom: 0, max: 16, savedStatus: "planned" },
};
const layerLabels = { forests: ["Lasy", "Forests"], lakes: ["Jeziora", "Lakes"], rivers: ["Rzeki", "Rivers"],
  seas: ["Morza i oceany", "Seas and oceans"],
  capitals: ["Czerwone obrysy stolic", "Red capital boundaries"], warnings: ["Ostrzeżenia dla państw", "Travel advisories"] };
const presetLabel = (preset) => tr(preset.label, preset.english);
const visibilityKeys = [...Object.keys(defaultPresets), ...Object.keys(layerLabels)];
let visibility = Object.fromEntries(visibilityKeys.map((key) => [key, true]));
visibility.major = false;
visibility.seas = false;
visibility["visited-only"] = false;
visibility["planned-only"] = false;
const isSavedPreset = (id = activePreset) => id === "visited" || Boolean(defaultPresets[id]?.savedStatus);
function rowInSavedPreset(row, id = activePreset) {
  if (row.kategoria === "kontynent") return false;
  const status = defaultPresets[id]?.savedStatus;
  return !status || (row.tryb === "plan") === (status === "planned");
}
// U.S. Department of State, whole-country Level 4 advisories.
const warningSnapshotDate = "2026-11-18";
const warningCountries = new Set("AF BF BY CD CF HT IR IQ KP LB LY ML MM NE RU SD SO SS SY TD UA UG YE".split(" "));
const maxZoomLevel = 19;
const mapZoomRange = { min: 0, max: maxZoomLevel };
const presets = Object.fromEntries(Object.entries(defaultPresets).map(([id, preset]) => [id, { ...preset }]));
const clampZoom = (zoom, preset) => Math.min(preset.max, Math.max(preset.min, zoom));
const presetZoom = (preset) => clampZoom(preset.zoom, preset);
const regions = new Intl.DisplayNames(["pl"], { type: "region", fallback: "none" });
const englishRegions = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const englishRegion = (code) => /^[A-Z]{2}$/.test(code) ? englishRegions.of(code) : undefined;
const normalize = (s) => s.toLocaleLowerCase("pl").normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ł", "l");
const key = (place) => place.category + ":" + place.id;
const basePlaceName = (place) => tr(place.name,
  (place.category === "panstwo" ? englishRegion(place.code) : place.original) || place.name);
const displayPlaceName = (place) => {
  const name = basePlaceName(place);
  const reading = areaFocusActive() ? placeReading(place) : "";
  return reading ? `${name} (${reading})` : name;
};
let placeReadings = { byCountry: {}, byName: {} };
function placeReading(place) {
  const name = (place.name !== undefined ? basePlaceName(place) : place.nazwa)?.trim();
  if (!name || !/(?!\p{Script=Latin})\p{L}/u.test(name)) return "";
  const saved = place.id && savedPlaces.get("miasto:" + place.id);
  const country = place.country || place.code || places.panstwo.find((item) => item.id === (place.panstwo_id || saved?.panstwo_id))?.code || "";
  const known = placeReadings.byCountry[country]?.[name] || placeReadings.byName[name];
  if (known) return known;
  if (place.original && !/(?!\p{Script=Latin})\p{L}/u.test(place.original)) return place.original;
  return (place.category || place.kategoria) === "panstwo" ? englishRegion(country) || "" : "";
}
function appendPlaceReading(parent, place) {
  if (areaFocusActive()) return;
  const reading = placeReading(place);
  if (!reading) return;
  const line = document.createElement("small");
  line.className = "place-reading";
  line.textContent = reading;
  line.lang = "und-Latn";
  parent.append(line);
}
function displayRegionName(place) {
  if (place.country === "PL" && place.region?.includes(" · ")) {
    return tr(place.region, place.region.replace(/^wieś · /, "Village · ").replace(" · powiat ", " · County of "));
  }
  return tr(place.region, englishRegion(place.country) || place.region);
}
const view = { x: 500, y: 252, zoom: 2 ** presetZoom(presets.countries) };
const pointers = new Map();
let places = { kontynent: [], panstwo: [], miasto: [] };
const continentsById = new Map();
let marked = new Set();
let planned = new Set();
let pendingMapClick;
const visitColor = "#b695e5";
const planColor = "#f5c689";
let category = "panstwo";
let activePreset = "countries";
let cityMap;
let cityProblem = false;
let savedRows = [];
let savedPlaces = new Map();
let editedPlace;
const placeForm = byId("place-form");
const placePlanned = byId("place-planned");
const placeDate = byId("place-date");
const placeVisitDates = byId("place-visit-dates");
const addPlaceVisit = byId("add-place-visit");
const placeRating = byId("place-rating");
const placeNote = byId("place-note");
const placeSave = byId("save-place");
const placeRemove = byId("remove-place");
const pinLayerElement = byId("map-pins");
const addPinButton = byId("add-pin");
const pinName = byId("pin-name");
const pinDate = byId("pin-date");
const pinVisitDates = byId("pin-visit-dates");
const addPinVisit = byId("add-pin-visit");
const pinLong = byId("pin-long");
const pinColor = byId("pin-color");
const defaultPinColor = pinColor.defaultValue;
const pinDraft = byId("pin-draft");
const pinRemove = byId("remove-pin");
const pinSave = byId("save-pin");
let pinPlacement = false;
let editedPin;
let pinMarkers = [];
let cityPlaces = new Map();
const cityContainer = byId("city-map");
const cityLayer = "city-fill";
const polishCityLayer = "polish-cities";
const majorCityLayer = "major-cities";
const polishMajorLayer = "polish-major-cities";
const villageLayer = "polish-villages";
const visitedCitiesSource = "visited-cities";
const visitedPlaceLayer = "visited-place-outlines";
const visitedCountryLayer = "visited-country-outlines";
const countryFillLayer = "country-fill";
const continentFillLayer = "continent-fill";
const continentOutlineLayer = "continent-outline";
const visitedPinLayer = "visited-place-pins";
const overviewCities = "overview-cities";
const overviewVillages = "overview-villages";
const capitalLayer = "capital-outlines";
const warningLayer = "country-warnings";
const forestLayer = "world-forests";
const markerLayer = (source) => source + "-markers";
const regionLayer = "regional-boundaries";
const visitedRegionLayer = "visited-regional-boundaries";
const adminRegions = new Map();
let regionData;
let regionCatalogueRequest;
let visitedOutlinesRequest;
const hasInteractiveMap = () => Boolean(cityMap && cityContainer.classList.contains("ready"));
const archiveBase = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/";
const fallbackRelease = "2026-10-21.0";
let loadedOvertureRelease;
let hovered = null;
let dragged = false;
let visitQueue = Promise.resolve();
const visitUpdates = location.protocol === "file:" || typeof BroadcastChannel === "undefined"
  ? null : new BroadcastChannel("atlas-visits");
let ready = false;
let frame = 0;

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

function readMarked(rows) {
  savedRows = rows;
  savedPlaces = new Map();
  for (const row of rows) {
    const id = row.kategoria + ":" + row.id;
    if (row.tryb !== "plan" || !savedPlaces.has(id)) savedPlaces.set(id, row);
  }
  marked = new Set(rows.filter((row) => row.tryb !== "plan").map((row) => row.kategoria + ":" + row.id));
  planned = new Set(rows.filter((row) => row.tryb === "plan").map((row) => row.kategoria + ":" + row.id));
  paintVisits();
  paintCityPins();
  syncVisitedCountries();
  syncCapitalOutlines();
  paintRegions();
  loadRegions();
  loadVisitedOutlines();
  document.dispatchEvent(new Event("atlas-visits-change"));
}

function cityPosition(x, y) {
  function projectedY(lat) {
    const p = lat * Math.PI / 180;
    const p2 = p * p;
    const p4 = p2 * p2;
    return 260 - 182.75 * p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  }
  let south = -85, north = 85;
  for (let i = 0; i < 24; i++) {
    const middle = (south + north) / 2;
    if (projectedY(middle) > y) south = middle;
    else north = middle;
  }
  const lat = (south + north) / 2;
  const p2 = (lat * Math.PI / 180) ** 2;
  const p4 = p2 * p2;
  const width = 182.75 * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  return [Math.max(-180, Math.min(180, (x - 500) / width * 180 / Math.PI)), lat];
}

function statusColor(category, field, fallback, formatId = (id) => id) {
  const rows = savedRows.filter((row) => row.kategoria === category && (areaFocusActive() || !isSavedPreset() || rowInSavedPreset(row)));
  const matches = (planning) => ["in", ["get", field], ["literal",
    rows.filter((row) => (row.tryb === "plan") === planning).map((row) => formatId(row.id))]];
  return ["case", matches(false), visitColor, matches(true), planColor, fallback];
}

function paintVisits() {
  if (cityMap?.getLayer("area-focus-status")) cityMap.setPaintProperty("area-focus-status", "fill-color",
    statusColor("miasto", "id", "rgba(0,0,0,0)"));
  const fill = statusColor("miasto", "division_id", "#ffffff");
  for (const layer of [polishCityLayer, polishMajorLayer, cityLayer, overviewCities, villageLayer, overviewVillages,
    visitedPlaceLayer, "area-capital-fill"]) {
    if (cityMap?.getLayer(layer)) cityMap.setPaintProperty(layer, "fill-color", fill);
  }
  if (cityMap?.getLayer(majorCityLayer)) cityMap.setPaintProperty(majorCityLayer, "fill-color",
    statusColor("miasto", "division_id", "#ffffff", (id) => id.replace(/^overture:/, "")));
  if (cityMap?.getLayer(visitedPlaceLayer)) cityMap.setFilter(visitedPlaceLayer,
    ["in", ["get", "division_id"], ["literal", savedRows.filter((row) => row.kategoria === "miasto" && rowInSavedPreset(row)).map((row) => row.id)]]);
  for (const source of [villageSource, overviewVillages]) {
    const layer = markerLayer(source);
    if (cityMap?.getLayer(layer)) cityMap.setPaintProperty(layer, "circle-color", fill);
  }
}

function syncVisitedCountries() {
  if (!cityMap?.getLayer(visitedCountryLayer)) return;
  const ids = savedRows.filter((row) => row.kategoria === "panstwo" && rowInSavedPreset(row)).map((row) => row.id);
  const selected = ["in", ["get", "country_id"], ["literal", ids]];
  cityMap.setFilter(visitedCountryLayer, ["all", ["==", ["get", "kind"], "country"], selected]);
  const fill = statusColor("panstwo", "country_id", "rgba(0,0,0,0)");
  cityMap.setPaintProperty(visitedCountryLayer, "fill-color", fill);
  cityMap.setPaintProperty(countryFillLayer, "fill-color", (areaFocusActive() ? focusShowsCountries() : activePreset === "countries") ? fill : "rgba(0,0,0,0)");
  cityMap.setPaintProperty(continentFillLayer, "fill-color", statusColor("kontynent", "id", "#fff"));
}

function syncCapitalOutlines() {
  if (!cityMap?.getLayer(capitalLayer)) return;
  const ids = savedRows.filter((row) => row.kategoria === "miasto" && rowInSavedPreset(row)).map((row) => row.id);
  cityMap.setFilter(capitalLayer, isSavedPreset() && !areaFocusActive()
    ? ["in", ["get", "division_id"], ["literal", ids]] : null);
}

function paintRegions() {
  if (!cityMap?.getLayer(regionLayer)) return;
  const ids = savedRows.filter((row) => row.kategoria === "rejon" && rowInSavedPreset(row)).map((row) => row.id);
  const selected = ["in", ["get", "id"], ["literal", ids]];
  const fill = statusColor("rejon", "id", "#fff");
  cityMap.setPaintProperty(regionLayer, "fill-color", fill);
  cityMap.setPaintProperty(visitedRegionLayer, "fill-color", fill);
  cityMap.setFilter(visitedRegionLayer, selected);
}

function getRegionCatalogue() {
  regionCatalogueRequest ||= request("/rejony.json", { cache: "reload" }).catch((error) => {
    regionCatalogueRequest = undefined;
    throw error;
  });
  return regionCatalogueRequest;
}

function loadRegions() {
  if (!basemapReady || !(activePreset === "regions" || isSavedPreset() || focusShowsRegions()) || regionData ||
    (isSavedPreset() && !areaFocusActive() && !savedRows.some((row) => row.kategoria === "rejon" && rowInSavedPreset(row)))) return;
  regionData = getRegionCatalogue().then((data) => {
    for (const { properties: props } of data.features) {
      const region = regions.of(props.country) || props.country;
      adminRegions.set(props.id, { id: props.id, category: "rejon", name: props.name, region, country: props.country,
        searchText: normalize(props.name + " " + props.alias + " " + region),
        getPosition: () => [props.lon, props.lat] });
    }
    cityMap.addSource("admin-regions", { type: "geojson", data, maxzoom: 10, tolerance: 0.3 });
    cityMap.addLayer({ id: regionLayer, type: "fill", source: "admin-regions",
      paint: { "fill-color": "#fff", "fill-opacity": 0.7, "fill-outline-color": "#797084" } }, visitedCountryLayer);
    cityMap.addLayer({ id: visitedRegionLayer, type: "fill", source: "admin-regions",
      paint: { "fill-color": "#b695e5", "fill-opacity": 0.7, "fill-outline-color": "#8057b6" } }, visitedPlaceLayer);
    paintRegions();
    syncPresetLayers();
    updateSidebar();
    updateCityView();
  }).catch((error) => {
    console.error(error);
    regionData = undefined;
    if (activePreset === "regions") byId("map-hint").textContent = tr("Nie udało się wczytać granic rejonów.",
      "Region boundaries could not be loaded.");
  });
}

async function loadVisitedOutlines() {
  const source = cityMap?.getSource(visitedPlaceLayer);
  if (!source || !isSavedPreset()) return;
  visitedOutlinesRequest?.abort();
  const controller = new AbortController();
  visitedOutlinesRequest = controller;
  try {
    const data = await request("/api/odwiedzone-obrysy", { signal: controller.signal });
    if (!controller.signal.aborted) source.setData(data);
  } catch (error) {
    if (!controller.signal.aborted) console.error(error);
  }
}

function savedCityPosition(row) {
  if (row.lon != null && row.lat != null && row.lon !== "" && row.lat !== "") {
    return [Number(row.lon), Number(row.lat)];
  }
  const place = polishCities.get(row.id) || majorCities.get(row.id);
  if (place) return place.getPosition();
  const legacy = legacyCities.get(row.id) || legacyCities.get(normalize(row.nazwa));
  if (legacy) return cityPosition(legacy.x, legacy.y);
}

function paintCityPins() {
  const source = cityMap?.getSource(visitedCitiesSource);
  if (!source) return;
  const features = [];
  for (const row of savedRows) {
    if (row.kategoria !== "miasto" || (!areaFocusActive() && isSavedPreset() && !rowInSavedPreset(row))) continue;
    const position = savedCityPosition(row);
    if (!position || !position.every(Number.isFinite)) continue;
    const village = row.id.startsWith("simc:");
    const major = isMajorCity(row.id);
    const pinLayer = major ? "visited-major-city-pins"
      : village ? "visited-village-pins"
        : row.id.startsWith("prg:") ? "visited-polish-city-pins" : "visited-city-pins";
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: position },
      properties: { id: row.id, name: row.nazwa, pinLayer, planned: row.tryb === "plan" } });
  }
  source.setData({ type: "FeatureCollection", features });
}

function pinImage(color) {
  const icon = document.createElement("canvas");
  icon.width = 28;
  icon.height = 34;
  const pen = icon.getContext("2d");
  pen.fillStyle = color;
  pen.strokeStyle = "#ffffff";
  pen.lineWidth = 2;
  pen.lineJoin = "round";
  pen.beginPath();
  pen.moveTo(14, 31);
  pen.bezierCurveTo(11, 27, 3, 20, 3, 13);
  pen.arc(14, 13, 11, Math.PI, 0);
  pen.bezierCurveTo(25, 20, 17, 27, 14, 31);
  pen.closePath();
  pen.fill();
  pen.stroke();
  pen.beginPath();
  pen.moveTo(9, 13);
  pen.lineTo(13, 17);
  pen.lineTo(19, 10);
  pen.stroke();
  return pen.getImageData(0, 0, 28, 34);
}

function outlineCenter(feature) {
  const { type, coordinates } = feature.geometry;
  const rings = type === "MultiPolygon" ? coordinates.flat() : coordinates;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) for (const [lon, lat] of ring) {
    bounds[0] = Math.min(bounds[0], lon);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lon);
    bounds[3] = Math.max(bounds[3], lat);
  }
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

function cityFromFeature(feature) {
  if (!feature) return null;
  const props = feature.properties;
  const id = props.division_id;
  const name = (props["@name"] || props.name)?.trim();
  if (!id || !name) return null;
  const code = props.country;
  const region = props.label || (/^[A-Z]{2}$/.test(code) ? regions.of(code) || code : "");
  const alias = capitalAliases.get(normalize(name + " " + region));
  return { id: id.includes(":") ? id : "overture:" + id, name, region,
    country: code, major: props.major === true, category: "miasto",
    searchText: normalize([name, placeReading({ category: "miasto", name, country: code }), region, englishRegion(code), alias].filter(Boolean).join(" ")),
    getPosition: () => Number.isFinite(props.lon) && Number.isFinite(props.lat)
      ? [props.lon, props.lat] : outlineCenter(feature) };
}

function eligibleCityFeature(feature) {
  const id = feature.properties.division_id;
  return polishCities.has(id) || /^(simc|overture|osm|ne|jp):/.test(id) ||
    majorCities.has("overture:" + id);
}

const cityZoom = 9;
const worldCitySource = "world-settlements";
const polishCityZoom = 8;
const majorCityZoom = 6;
const villageZoom = 9;
const worldWaterZoom = 8;
const polishWaterZoom = 9;
const villageSource = "polish-rural-settlements";
const polishWaterSource = "polish-water";
const pinZoom = {
  "visited-city-pins": cityZoom,
  "visited-polish-city-pins": polishCityZoom,
  "visited-major-city-pins": majorCityZoom,
  "visited-village-pins": villageZoom,
};
const pinLayers = [...Object.keys(pinZoom), visitedPinLayer, "area-capital-pins"];
const geographyUrl = "/podklad.json";
const mapColors = { river: "#93bed8", lake: "#dceef8", lakeBorder: "#9ac3db" };
const retryMap = byId("retry-map");
const waterView = {};
let worldWaterLoading = false;
let worldWaterUnavailable = false;
const worldCitiesView = {};
let basemapReady = false;
let searchSignature = "";
let collectCityView = false;
const legacyCities = new Map();
const capitalAliases = new Map();
const capitalRecords = new Map();
const capitalOutlines = new Map();
const capitalOutlineNames = new Set();
const polishCities = new Map();
const majorCities = new Map();
let loadedVillageBounds;
let villageBoundsRequest;
let placeSearchRequest;
let placeSearchTimer;
let placeSearchResults = [];

function isMajorCity(id) {
  return Boolean(polishCities.get(id)?.major || majorCities.has(id) || capitalRecords.has(id));
}

function isCapitalCity(id) {
  return capitalOutlines.has(id) || capitalRecords.has(id);
}

function capitalLocations() {
  return [...capitalOutlines.values(), ...[...capitalRecords.values()].filter((place) =>
    ![place.name, place.original].filter(Boolean).some((name) => capitalOutlineNames.has(normalize(name + " " + place.region))))];
}

function capitalPointData() {
  return { type: "FeatureCollection", features: capitalLocations().map((place) => ({
    type: "Feature", properties: { id: place.id, name: place.name, hasOutline: capitalOutlines.has(place.id) },
    geometry: { type: "Point", coordinates: place.getPosition() },
  })) };
}

function placeInPreset(place) {
  if (areaFocusActive()) return focusPlaceAllowed(place);
  if (activePreset === "major") return isMajorCity(place.id);
  if (activePreset === "capital-cities") return isCapitalCity(place.id);
  if (activePreset === "cities") return !place.id.startsWith("simc:");
  return true;
}

function syncPresetLayers() {
  const focused = areaFocusActive();
  const onlyMajor = activePreset === "major" && !focused;
  const onlyCapitals = activePreset === "capital-cities" && !focused;
  const visited = isSavedPreset() && !focused;
  const showRegions = focused ? focusShowsRegions() : activePreset === "regions";
  const showVillages = focused ? focusShowsVillages() : activePreset === "settlements";
  const showCities = focused ? focusShowsCities() : ["cities", "settlements"].includes(activePreset);
  const showWorld = showCities && !viewportInsidePoland();
  const viewBounds = visibleWorldBounds();
  const [west, south, east, north] = viewBounds;
  const villagesInView = east >= 14 && west <= 24.3 && north >= 48.9 && south <= 55.1;
  const villageDetailBounds = polishViewport(viewBounds, 0);
  const detailCities = containsBounds(worldCitiesView.bounds, viewBounds);
  const detailVillages = villageDetailBounds && containsBounds(loadedVillageBounds, villageDetailBounds);
  const zoom = cityMap.getZoom();
  if (showWorld && (zoom < cityZoom || !settlementViewportFits(viewBounds))) {
    addOverview(overviewCities, "/obrysy-miast.json");
  }
  if (showVillages && villagesInView && (zoom < villageZoom || !villageDetailBounds)) {
    addOverview(overviewVillages, "/obrysy-wsi.json");
  }
  const shown = {
    "land-mask": visibility.seas,
    [countryFillLayer]: focused ? focusShowsCountries() : (activePreset === "countries" || visited),
    countries: activePreset !== "continents" || focused,
    [continentFillLayer]: activePreset === "continents" && !focused,
    [continentOutlineLayer]: activePreset === "continents" && !focused,
    [warningLayer]: !focused && visibility.warnings && !visited && activePreset !== "continents",
    [capitalLayer]: visibility.capitals && (onlyMajor || onlyCapitals || showCities || visited || focusShowsRegions()),
    "area-capital-fill": onlyCapitals || (focused && focusShowsRegions()),
    "area-capital-pins": onlyCapitals || (focused && focusShowsRegions()),
    [regionLayer]: showRegions,
    [visitedRegionLayer]: visited,
    [visitedCountryLayer]: visited,
    [visitedPlaceLayer]: visited,
    [visitedPinLayer]: visited,
    [polishMajorLayer]: onlyMajor,
    [majorCityLayer]: onlyMajor || showCities,
    [polishCityLayer]: showCities,
    [cityLayer]: showWorld && detailCities,
    [overviewCities]: showWorld && !detailCities,
    [villageLayer]: showVillages && Boolean(detailVillages),
    [overviewVillages]: showVillages && !detailVillages,
    [markerLayer(villageSource)]: showVillages && Boolean(detailVillages),
    [markerLayer(overviewVillages)]: showVillages && !detailVillages,
    "visited-city-pins": showCities,
    "visited-polish-city-pins": showCities,
    "visited-major-city-pins": onlyMajor || showCities,
    "visited-village-pins": showVillages,
    "polish-rivers": presetShowsWater() && visibility.rivers,
    "polish-lakes": presetShowsWater() && visibility.lakes,
  };
  cityMap.setPaintProperty("map-background", "background-color", visibility.seas ? mapColors.lake : "#fff");
  for (const [id, show] of Object.entries(shown)) setLayerVisible(id, show);
  if (cityMap.getLayer("area-capital-pins")) {
    cityMap.setLayerZoomRange("area-capital-pins", 0, cityZoom);
    cityMap.setFilter("area-capital-pins", null);
  }
  if (cityMap.getLayer(capitalLayer)) cityMap.setLayerZoomRange(capitalLayer, onlyCapitals ? 0 : 4, 24);
  for (const source of [villageSource, overviewVillages]) {
    const layer = markerLayer(source);
    if (shown[layer] && cityMap.getLayer(layer) && cityMap.getFilter(layer)?.[2]?.[2] !== zoom) cityMap.setFilter(layer, [
      "all", ["==", ["geometry-type"], "Point"], [">", ["get", "markerZoom"], zoom],
    ]);
  }
  loadRegions();
  syncAreaFocusLayers();
}

function setLayerVisible(id, show) {
  const next = show ? "visible" : "none";
  if (cityMap.getLayer(id) && (cityMap.getLayoutProperty(id, "visibility") || "visible") !== next) {
    cityMap.setLayoutProperty(id, "visibility", next);
  }
}

function addOverview(id, url) {
  if (!basemapReady || cityMap.getSource(id)) return;
  cityMap.addSource(id, { type: "geojson", data: url, maxzoom: 11, tolerance: 0 });
  cityMap.addLayer({ id, type: "fill", source: id,
    paint: { "fill-color": "#fff", "fill-outline-color": "#797084" } }, "river-2");
  if (id === overviewVillages) addVillageMarkers(id);
  paintVisits();
}

function addVillageMarkers(source) {
  cityMap.addLayer({ id: markerLayer(source), type: "circle", source,
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 1.7, "circle-stroke-width": 1,
      "circle-stroke-color": "#8a8194", "circle-color": "#ffffff" } }, "river-2");
}

function emptyFeatures() {
  return { type: "FeatureCollection", features: [] };
}

function containsBounds(outer, inner) {
  return outer && outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

function mapBounds(map = cityMap) {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function visibleWorldBounds() {
  const [west, south, east, north] = mapBounds();
  return [Math.max(-180, west), Math.max(-90, south), Math.min(180, east), Math.min(90, north)];
}

function settlementViewportFits([west, south, east, north]) {
  return east > west && north > south && east - west <= 2.5 && north - south <= 2;
}

function polishViewport(bounds, padding = 0.2) {
  const [west, south, east, north] = bounds;
  const horizontal = Math.max(0, Math.min((east - west) * padding, (2.49 - (east - west)) / 2));
  const vertical = Math.max(0, Math.min((north - south) * padding, (1.99 - (north - south)) / 2));
  const clipped = [Math.max(14, west - horizontal), Math.max(48.9, south - vertical),
    Math.min(24.3, east + horizontal), Math.min(55.1, north + vertical)];
  return clipped[2] > clipped[0] && clipped[3] > clipped[1] &&
    clipped[2] - clipped[0] <= 2.5 && clipped[3] - clipped[1] <= 2 ? clipped : null;
}

async function loadPolishWater(bounds, zoom, map = cityMap, viewCache = waterView, source = polishWaterSource) {
  const nearby = polishViewport(bounds);
  if (!nearby) return;
  const detail = Math.min(12, Math.max(polishWaterZoom, Math.floor(zoom)));
  if (viewCache.detail === detail && containsBounds(viewCache.bounds, bounds)) return;
  if (viewCache.pending?.detail === detail && containsBounds(viewCache.pending.bounds, bounds)) return;
  viewCache.pending?.controller.abort();
  const controller = new AbortController();
  viewCache.pending = { controller, detail, bounds: nearby };
  try {
    const data = await request("/api/woda?bbox=" + nearby.join(",") + "&z=" + detail, { signal: controller.signal });
    if (controller.signal.aborted) return;
    viewCache.detail = detail;
    viewCache.bounds = nearby;
    map.getSource(source).setData(data);
  } catch (error) {
    if (!controller.signal.aborted) console.error(error);
  } finally {
    if (viewCache.pending?.controller === controller) viewCache.pending = undefined;
  }
}

function updateMapWater() {
  if (!basemapReady) return;
  const zoom = cityMap.getZoom();
  if (presetShowsWater() && (visibility.rivers || visibility.lakes) && zoom >= polishWaterZoom) {
    loadPolishWater(mapBounds(), zoom);
  }
  ensureWorldBasemap();
  updateWaterFallback();
}

const presetShowsWater = () => areaFocusActive() ? focusShowsCities() : ["regions", "cities", "settlements"].includes(activePreset);

function updateWaterFallback() {
  const zoom = cityMap.getZoom();
  const hasPolishDetail = zoom >= polishWaterZoom && mapCenterInPoland() &&
    containsBounds(waterView.bounds, mapBounds());
  for (const kind of ["river", "lake"]) {
    const world = "world-" + kind + "s";
    const hasWorldDetail = cityMap.getLayer(world) && cityMap.getLayoutProperty(world, "visibility") !== "none" &&
      cityMap.isSourceLoaded("world-water") && !worldWaterUnavailable;
    const show = presetShowsWater() && visibility[kind + "s"] && !hasPolishDetail && !hasWorldDetail;
    for (let i = 2; i <= 8; i++) {
      setLayerVisible(kind + "-" + i, show);
    }
  }
}

async function loadVisibleVillages() {
  const source = cityMap?.getSource(villageSource);
  if (!source || (areaFocusActive() ? !focusShowsVillages() : activePreset !== "settlements") || cityMap.getZoom() < villageZoom) return;
  const bounds = visibleWorldBounds();
  const viewBounds = polishViewport(bounds, 0);
  if (!viewBounds) return;
  if (containsBounds(loadedVillageBounds, viewBounds) || containsBounds(villageBoundsRequest?.bounds, viewBounds)) return;
  const nearby = polishViewport(bounds, 0.3);
  villageBoundsRequest?.controller.abort();
  const controller = new AbortController();
  villageBoundsRequest = { controller, bounds: nearby };
  try {
    const data = await request("/api/wsie?bbox=" + nearby.join(","), { signal: controller.signal });
    if (controller.signal.aborted) return;
    source.setData(data);
    loadedVillageBounds = nearby;
    syncPresetLayers();
  } catch (error) {
    if (!controller.signal.aborted) console.error(error);
  } finally {
    if (villageBoundsRequest?.controller === controller) villageBoundsRequest = undefined;
  }
}

function schedulePlaceSearch() {
  clearTimeout(placeSearchTimer);
  placeSearchRequest?.abort();
  placeSearchResults = [];
  const query = search.value.trim();
  if ((areaFocusActive() ? !focusShowsCities() : !["cities", "settlements"].includes(activePreset)) || query.length < 2) return;
  const preset = activePreset;
  placeSearchTimer = setTimeout(async () => {
    const controller = new AbortController();
    placeSearchRequest = controller;
    const focus = areaFocus.area;
    const suffix = "?q=" + encodeURIComponent(query) + (focus ? "&" + new URLSearchParams({ category: focus.category, id: focus.id, villages: focusShowsVillages() ? "1" : "0" }) : "");
    const sources = focus ? ["/api/obszar-szukaj"] : ["/api/miasta"];
    if (!focus && preset === "settlements") sources.push("/api/wsie");
    const responses = await Promise.allSettled(sources.map((source) => request(source + suffix, { signal: controller.signal })));
    if (controller.signal.aborted || activePreset !== preset || query !== search.value.trim()) return;
    placeSearchResults = responses.flatMap((response) => response.status === "fulfilled"
      ? response.value.map(({ id, name, region, country, position }) => ({
        id, name, region: region || regions.of(country) || country, country, category: "miasto",
        getPosition: () => position,
      })) : []);
    if (focus && !focusShowsVillages()) placeSearchResults = placeSearchResults.filter((place) => !place.id.startsWith("simc:"));
    updateSidebar();
  }, 160);
}

async function loadPolishCities(dataRequest) {
  try {
    const data = await dataRequest;
    for (const feature of data.features) {
      const place = cityFromFeature(feature);
      if (place) polishCities.set(place.id, place);
    }
    cityMap.addSource("polish-settlements", { type: "geojson", data, maxzoom: 13, tolerance: 0 });
    cityMap.addLayer({ id: polishCityLayer, type: "fill", source: "polish-settlements",
      paint: { "fill-color": "#ffffff", "fill-outline-color": "#797084" } }, "river-2");
    cityMap.addLayer({ id: polishMajorLayer, type: "fill", source: "polish-settlements",
      filter: ["==", ["get", "major"], true],
      paint: { "fill-color": "#ffffff", "fill-outline-color": "#797084" } }, "river-2");
    syncPresetLayers();
    paintVisits();
    paintCityPins();
    updateSidebar();
  } catch (error) {
    console.error(error);
  }
}

async function loadMajorCities(dataRequest, capitalRequest) {
  try {
    const [data, capitals] = await Promise.all([dataRequest, capitalRequest]);
    for (const feature of data.features) {
      const place = cityFromFeature(feature);
      if (place) majorCities.set(place.id, place);
    }
    const extra = [];
    for (const feature of capitals.features) {
      const place = cityFromFeature(feature);
      if (!place) continue;
      place.capital = true;
      feature.properties.capital = true;
      capitalOutlines.set(place.id, place);
      capitalOutlineNames.add(normalize(place.name + " " + place.region));
      if (majorCities.has(place.id) || place.id.startsWith("prg:")) continue;
      majorCities.set(place.id, place);
      extra.push({ ...feature, properties: { ...feature.properties,
        division_id: place.id.replace(/^overture:/, ""), capital: true } });
    }
    data.features.push(...extra);
    cityMap.getSource(capitalLayer).setData(capitals);
    cityMap.getSource("area-capital-points").setData(capitalPointData());
    cityMap.addSource("major-settlements", { type: "geojson", data, maxzoom: 10, tolerance: 0 });
    cityMap.addLayer({ id: majorCityLayer, type: "fill", source: "major-settlements",
      paint: { "fill-color": "#ffffff", "fill-outline-color": "#797084" } }, "river-2");
    syncPresetLayers();
    paintVisits();
    paintCityPins();
    updateSidebar();
  } catch (error) {
    console.error(error);
  }
}

function updateCityView(collect = false) {
  if (!cityMap) return;
  if (updateFocusHint()) { retryMap.hidden = true; updateControls(); return; }
  if (activePreset === "continents") {
    retryMap.hidden = true;
    byId("map-hint").textContent = tr("Kliknij kontynent, aby otworzyć jego szczegóły.", "Click a continent to open its details.");
    updateControls();
    return;
  }
  if (activePreset === "countries") {
    retryMap.hidden = true;
    byId("map-hint").textContent = tr("Kliknij państwo, aby otworzyć jego szczegóły.", "Click a country to open its details.");
    updateControls();
    return;
  }
  if (activePreset === "capital-cities") {
    retryMap.hidden = true;
    byId("map-hint").textContent = tr("Kliknij stolicę, aby otworzyć jej szczegóły.", "Click a capital to open its details.");
    updateControls();
    return;
  }
  if (isSavedPreset() || activePreset === "regions") {
    retryMap.hidden = true;
    byId("map-hint").textContent = isSavedPreset()
      ? activePreset === "visited-only" ? tr("Wyświetlane są tylko odwiedzone miejsca.", "Only visited places are shown.")
        : activePreset === "planned-only" ? tr("Wyświetlane są tylko zaplanowane miejsca.", "Only planned places are shown.")
          : tr("Fioletowe miejsca są odwiedzone, pomarańczowe są w planach.", "Purple places are visited. Orange places are planned.")
      : adminRegions.size ? tr("Kliknij rejon, aby otworzyć jego szczegóły.", "Click a region to open its details.")
        : tr("Wczytywanie granic rejonów…", "Loading region boundaries…");
    updateControls();
    return;
  }
  const zoom = cityMap.getZoom();
  const needsWorld = activePreset !== "major" && zoom >= cityZoom &&
    settlementViewportFits(visibleWorldBounds()) && !viewportInsidePoland();
  if (collect) {
    const layers = [cityLayer, polishCityLayer, polishMajorLayer, majorCityLayer, villageLayer, overviewCities, overviewVillages,
      markerLayer(villageSource), markerLayer(overviewVillages)]
      .filter((layer) => cityMap.getLayer(layer));
    const unique = new Map();
    for (const feature of layers.length ? cityMap.queryRenderedFeatures({ layers }) : []) {
      if (!eligibleCityFeature(feature)) continue;
      const place = cityFromFeature(feature);
      if (place && placeInPreset(place) && !unique.has(place.id)) unique.set(place.id, place);
    }
    cityPlaces = unique;
  }
  retryMap.hidden = !needsWorld || !cityProblem;
  byId("map-hint").textContent = !basemapReady
    ? tr("Wczytywanie podkładu mapy…", "Loading the basemap…")
    : cityPlaces.size ? tr("Kliknij miejscowość, aby otworzyć jej szczegóły.", "Click a place to open its details.")
      : activePreset === "major" ? tr("Przesuń mapę lub wyszukaj duże miasto.", "Pan the map or search for a major city.")
      : needsWorld && cityProblem ? tr("Część obrysów chwilowo niedostępna. Podkład mapy jest nadal widoczny.", "Some boundaries are temporarily unavailable.")
        : needsWorld && worldCitiesView.pending ? tr("Wczytywanie obrysów miast…", "Loading city boundaries…")
        : tr("Przesuń mapę albo wyszukaj miejscowość.", "Pan the map or search for a place.");
  updateControls();
  if (search.value && collect) {
    const signature = [...cityPlaces.keys()].sort().join(",");
    if (signature !== searchSignature) {
      searchSignature = signature;
      updateSidebar();
    }
  }
}

function archiveUrl(release, theme) {
  return archiveBase + release + "/" + theme + ".pmtiles";
}

let baseNetworkController = new AbortController();
const onlineEnabled = (key) => layout[key] !== "off";
const baseOnlineEnabled = () => visibility.forests || (onlineEnabled("online_water") && (visibility.rivers || visibility.lakes));
function timedArchive(url) {
  const source = new pmtiles.FetchSource(url);
  const networkSignal = baseNetworkController.signal;
  return new pmtiles.PMTiles({
    getKey: () => source.getKey(),
    getBytes: (offset, count, signal, etag) => source.getBytes(offset, count,
      AbortSignal.any([networkSignal, ...(signal ? [signal] : []), AbortSignal.timeout(12000)]), etag),
  });
}

function findBaseArchive() {
  const theme = "base";
  const fallback = timedArchive(archiveUrl(fallbackRelease, theme));
  const checkedFallback = fallback.getHeader().then((header) => ({ archive: fallback, header, release: fallbackRelease }));
  const checkedLatest = request("https://stac.overturemaps.org/catalog.json", {
    signal: AbortSignal.any([baseNetworkController.signal, AbortSignal.timeout(2500)]),
  }).then(async ({ latest }) => {
    if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(latest) || latest === fallbackRelease) return checkedFallback;
    const archive = timedArchive(archiveUrl(latest, theme));
    return { archive, header: await archive.getHeader(), release: latest };
  });
  return Promise.any([checkedFallback, checkedLatest]);
}

let baseArchiveRequest;
function baseArchive() {
  if (!baseOnlineEnabled()) return Promise.reject(new DOMException("Online layers disabled", "AbortError"));
  if (baseNetworkController.signal.aborted) baseNetworkController = new AbortController();
  baseArchiveRequest ??= findBaseArchive().catch((error) => {
    baseArchiveRequest = undefined;
    throw error;
  });
  return baseArchiveRequest;
}

function mapCenterInPoland() {
  const { lng, lat } = cityMap.getCenter().wrap();
  return pointInPoland(lng, lat);
}

function pointInPoland(lng, lat) {
  const poland = places.panstwo.find((place) => place.name === "Polska");
  if (!poland) return false;
  const point = project(lng, lat);
  ctx.save();
  ctx.resetTransform();
  const inside = ctx.isPointInPath(poland.path, ...point, "evenodd");
  ctx.restore();
  return inside;
}

function viewportInsidePoland() {
  if (!cityMap) return false;
  const [west, south, east, north] = mapBounds();
  return west >= 14 && east <= 24.3 && south >= 48.9 && north <= 55.1 &&
    [[west, south], [east, south], [west, north], [east, north]].every(([lon, lat]) => pointInPoland(lon, lat));
}

async function ensureWorldBasemap() {
  const showWorld = onlineEnabled("online_water") && presetShowsWater() &&
    cityMap.getZoom() >= worldWaterZoom && !mapCenterInPoland();
  const showForest = visibility.forests && (areaFocusActive() ? focusShowsCities() : (activePreset !== "continents" && !isSavedPreset())) && cityMap.getZoom() >= 5;
  if (cityMap.getSource("world-water")) {
    setLayerVisible("world-rivers", showWorld && visibility.rivers);
    setLayerVisible("world-lakes", showWorld && visibility.lakes);
    setLayerVisible(forestLayer, showForest);
    return;
  }
  if ((!showForest && !(showWorld && (visibility.rivers || visibility.lakes))) ||
      worldWaterLoading || worldWaterUnavailable) return;
  worldWaterLoading = true;
  try {
    const { archive, header, release } = await baseArchive();
    if (!baseOnlineEnabled()) return;
    mapTileProtocol().add(archive);
    cityMap.addSource("world-water", {
      type: "vector", tiles: ["pmtiles://" + archive.source.getKey() + "/{z}/{x}/{y}"],
      minzoom: header.minZoom, maxzoom: header.maxZoom,
    });
    const shared = { source: "world-water", "source-layer": "water", minzoom: worldWaterZoom };
    const inland = ["in", ["get", "subtype"], ["literal", ["lake", "pond", "reservoir", "river", "stream", "canal"]]];
    cityMap.addLayer({ id: "world-rivers", type: "line", ...shared,
      filter: ["all", inland, ["==", ["geometry-type"], "LineString"]],
      paint: { "line-color": mapColors.river, "line-width": 1.1 } }, "polish-rivers");
    cityMap.addLayer({ id: "world-lakes", type: "fill", ...shared,
      filter: ["all", inland, ["==", ["geometry-type"], "Polygon"]],
      paint: { "fill-color": mapColors.lake } }, "polish-rivers");
    cityMap.addLayer({ id: forestLayer, type: "fill", source: "world-water", "source-layer": "land_cover",
      minzoom: 5, filter: ["==", ["get", "subtype"], "forest"],
      paint: { "fill-color": "#deefdf", "fill-opacity": 0.8 } }, "countries");
    loadedOvertureRelease = release;
    renderDataDates();
    ensureWorldBasemap();
  } catch (error) {
    console.warn(error);
    if (baseOnlineEnabled()) worldWaterUnavailable = true;
  } finally {
    worldWaterLoading = false;
  }
}

async function loadVisibleCities() {
  const source = cityMap?.getSource(worldCitySource);
  if (!source || (areaFocusActive() ? !focusShowsCities() : !["cities", "settlements"].includes(activePreset)) || cityMap.getZoom() < cityZoom ||
    viewportInsidePoland()) return;
  const [west, south, east, north] = mapBounds();
  const viewport = [Math.max(-180, west), Math.max(-90, south), Math.min(180, east), Math.min(90, north)];
  if (viewport[0] >= viewport[2] || viewport[1] >= viewport[3] ||
    containsBounds(worldCitiesView.bounds, viewport) || containsBounds(worldCitiesView.pending?.bounds, viewport)) return;
  const dx = Math.max(0, Math.min((east - west) * 0.2, (2.49 - (east - west)) / 2));
  const dy = Math.max(0, Math.min((north - south) * 0.2, (1.99 - (north - south)) / 2));
  const nearby = [Math.max(-180, west - dx), Math.max(-90, south - dy), Math.min(180, east + dx), Math.min(90, north + dy)];
  if (nearby[2] - nearby[0] > 2.5 || nearby[3] - nearby[1] > 2) return;
  worldCitiesView.pending?.controller.abort();
  const controller = new AbortController();
  worldCitiesView.pending = { controller, bounds: nearby };
  cityProblem = false;
  updateCityView();
  try {
    const data = await request("/api/miasta?bbox=" + nearby.join(","), { signal: controller.signal });
    if (controller.signal.aborted) return;
    source.setData(data);
    worldCitiesView.bounds = nearby;
    syncPresetLayers();
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error);
      cityProblem = true;
    }
  } finally {
    if (worldCitiesView.pending?.controller === controller) worldCitiesView.pending = undefined;
    updateCityView();
  }
}

let cityProtocol;
function mapTileProtocol() {
  if (!cityProtocol) {
    cityProtocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", cityProtocol.tile);
  }
  return cityProtocol;
}

function refreshPreset() {
  updateLayerLegend();
  positionCustomPins();
  if (!basemapReady) return;
  syncPresetLayers();
  paintVisits();
  paintRegions();
  paintCityPins();
  syncVisitedCountries();
  syncCapitalOutlines();
  updateCityView();
  collectCityView = true;
  loadVisitedOutlines();
  loadVisibleCities();
  loadVisibleVillages();
  updateMapWater();
}

function openCityMap() {
  const base = { source: "basemap" };
  const polishData = request("/miasta-polska.json", { cache: "reload" }).catch((error) => {
    console.error(error);
    return { type: "FeatureCollection", features: [] };
  });
  const majorData = request("/duze-miasta.json").catch((error) => {
    console.error(error);
    return emptyFeatures();
  });
  const capitalData = request("/stolice.json").catch((error) => {
    console.error(error);
    return emptyFeatures();
  });
  const waterLayers = (kind, type, paint) => Array.from({ length: 7 }, (_, i) => ({
    id: kind + "-" + (i + 2), type, ...base, minzoom: worldWaterZoom + Math.floor(i / 2),
    filter: ["all", ["==", ["get", "kind"], kind], ["==", ["get", "detail"], i + 2]], paint,
  }));
  cityMap = new maplibregl.Map({
    container: cityContainer,
    center: cityPosition(view.x, view.y),
    zoom: Math.log2(view.zoom),
    minZoom: mapZoomRange.min,
    maxZoom: mapZoomRange.max,
    zoomSnap: 0,
    maxTileCacheSize: 192,
    renderWorldCopies: false,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        basemap: { type: "geojson", data: geographyUrl, maxzoom: 10, tolerance: 0.8 },
        continents: { type: "geojson", data: "/kontynenty-obrysy.json", maxzoom: 10, tolerance: 0.8 },
      },
      layers: [
        { id: "map-background", type: "background", paint: { "background-color": "#fff" } },
        { id: "land-mask", type: "fill", source: "continents", layout: { visibility: "none" },
          paint: { "fill-color": "#fff", "fill-antialias": false } },
        { id: warningLayer, type: "fill", ...base,
          filter: ["in", ["get", "country_id"], ["literal",
            places.panstwo.filter((place) => warningCountries.has(place.code)).map((place) => place.id)]],
          paint: { "fill-color": "#fae1e6" } },
        { id: continentFillLayer, type: "fill", source: "continents", layout: { visibility: "none" },
          paint: { "fill-color": "#fff" } },
        { id: countryFillLayer, type: "fill", ...base, filter: ["==", ["get", "kind"], "country"],
          paint: { "fill-color": "rgba(0,0,0,0)" } },
        { id: "countries", type: "line", ...base, filter: ["==", ["get", "kind"], "country"],
          paint: { "line-color": "#8b8498", "line-width": 1 } },
        { id: continentOutlineLayer, type: "line", source: "continents", layout: { visibility: "none" },
          paint: { "line-color": "#8b8498", "line-width": 1 } },
        ...waterLayers("river", "line", { "line-color": mapColors.river,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 11, 1.4] }),
        ...waterLayers("lake", "fill", { "fill-color": mapColors.lake, "fill-outline-color": mapColors.lakeBorder }),
      ],
    },
  });
  cityMap.touchZoomRotate.disableRotation();
  cityMap.on("load", () => {
    cityMap.addSource(polishWaterSource, { type: "geojson", data: emptyFeatures(), maxzoom: 14, tolerance: 0.55 });
    cityMap.addLayer({ id: "polish-rivers", type: "line", source: polishWaterSource, minzoom: polishWaterZoom,
      filter: ["==", ["get", "kind"], "river"], paint: { "line-color": mapColors.river, "line-width": 1.1 } });
    cityMap.addLayer({ id: "polish-lakes", type: "fill", source: polishWaterSource, minzoom: polishWaterZoom,
      filter: ["!=", ["get", "kind"], "river"],
      paint: { "fill-color": mapColors.lake } });
    cityMap.addSource(worldCitySource, { type: "geojson", data: emptyFeatures(), maxzoom: 14, tolerance: 0.55 });
    cityMap.addLayer({ id: cityLayer, type: "fill", source: worldCitySource,
      paint: { "fill-color": "#fff", "fill-outline-color": "#797084" } }, "river-2");
    cityMap.addSource(villageSource, { type: "geojson", data: emptyFeatures(), maxzoom: 14, tolerance: 0.7 });
    cityMap.addLayer({ id: villageLayer, type: "fill", source: villageSource,
      paint: { "fill-color": "#fff", "fill-outline-color": "#8a8194" } }, "river-2");
    addVillageMarkers(villageSource);
    cityMap.addLayer({ id: visitedCountryLayer, type: "fill", source: "basemap",
      paint: { "fill-color": "#b695e5", "fill-opacity": 0.45, "fill-outline-color": "#8057b6" } }, "river-2");
    syncVisitedCountries();
    cityMap.addSource(visitedPlaceLayer, { type: "geojson", data: emptyFeatures(), maxzoom: 14, tolerance: 0 });
    cityMap.addLayer({ id: visitedPlaceLayer, type: "fill", source: visitedPlaceLayer,
      paint: { "fill-color": "#b695e5", "fill-outline-color": "#8057b6" } }, "river-2");
    cityMap.addSource(visitedCitiesSource, {
      type: "geojson", data: { type: "FeatureCollection", features: [] },
    });
    cityMap.addImage("visited-pin", pinImage("#8057b6"), { pixelRatio: 2 });
    cityMap.addImage("planned-pin", pinImage("#ba7428"), { pixelRatio: 2 });
    cityMap.addImage("capital-pin", pinImage("#c33e4f"), { pixelRatio: 2 });
    const pinLayout = { "icon-image": ["case", ["get", "planned"], "planned-pin", "visited-pin"],
      "icon-anchor": "bottom", "icon-allow-overlap": true };
    Object.entries(pinZoom).forEach(([id, zoom]) => cityMap.addLayer({
      id, type: "symbol", source: visitedCitiesSource, maxzoom: zoom,
      filter: ["==", ["get", "pinLayer"], id],
      layout: pinLayout,
    }));
    cityMap.addLayer({ id: visitedPinLayer, type: "symbol", source: visitedCitiesSource,
      layout: pinLayout });
    cityMap.addSource(capitalLayer, { type: "geojson", data: emptyFeatures(), maxzoom: 13, tolerance: 0 });
    cityMap.addLayer({ id: "area-capital-fill", type: "fill", source: capitalLayer, layout: { visibility: "none" },
      paint: { "fill-color": "#fff", "fill-outline-color": "#797084" } });
    cityMap.addSource("area-capital-points", { type: "geojson", data: capitalPointData() });
    cityMap.addLayer({ id: "area-capital-pins", type: "symbol", source: "area-capital-points", maxzoom: cityZoom,
      layout: { visibility: "none", "icon-image": "capital-pin", "icon-anchor": "bottom", "icon-allow-overlap": true } });
    cityMap.addLayer({ id: capitalLayer, type: "line", source: capitalLayer, minzoom: 4,
      paint: { "line-color": "#c33e4f", "line-width": 1.4 } });
    syncCapitalOutlines();
    basemapReady = true;
    syncPresetLayers();
    paintVisits();
    paintCityPins();
    loadVisitedOutlines();
    loadPolishCities(polishData);
    loadMajorCities(majorData, capitalData);
    cityContainer.classList.add("ready");
    canvas.hidden = true;
    positionCustomPins();
    updateCityView(true);
    loadVisibleCities();
    loadVisibleVillages();
    updateMapWater();
  });
  cityMap.on("webglcontextlost", () => {
    cityContainer.classList.remove("ready");
    canvas.hidden = false;
    scheduleDraw();
    byId("map-hint").textContent = tr("Przywracanie interaktywnej mapy. Wyświetlam lokalny podkład.", "Restoring the interactive map. Showing the local basemap.");
  });
  cityMap.on("webglcontextrestored", () => {
    cityContainer.classList.add("ready");
    canvas.hidden = true;
    updateCityView(true);
  });
  cityMap.on("idle", () => {
    updateCityView(true);
    updateWaterFallback();
  });
  const selectableSources = new Set(["polish-settlements", "major-settlements", villageSource, worldCitySource,
    overviewCities, overviewVillages]);
  cityMap.on("sourcedata", (event) => {
    if (selectableSources.has(event.sourceId) && event.isSourceLoaded) collectCityView = true;
  });
  cityMap.on("render", () => {
    if (!collectCityView) return;
    collectCityView = false;
    updateCityView(true);
  });
  cityMap.on("move", updateMapScale);
  cityMap.on("move", positionCustomPins);
  cityMap.on("moveend", () => {
    const { lng, lat } = cityMap.getCenter().wrap();
    [view.x, view.y] = project(lng, lat);
    view.zoom = 2 ** cityMap.getZoom();
    cityPlaces.clear();
    collectCityView = true;
    syncPresetLayers();
    updateCityView();
    loadVisibleCities();
    loadVisibleVillages();
    updateMapWater();
  });
  const landLayers = [countryFillLayer, continentFillLayer];
  const landPlace = (features) => {
    const countryId = features.find((feature) => feature.layer.id === countryFillLayer)?.properties.country_id;
    const continentId = features.find((feature) => feature.layer.id === continentFillLayer)?.properties.id;
    if (continentId) return continentsById.get(continentId);
    return places.panstwo.find((place) => place.id === countryId);
  };
  cityMap.on("mousemove", landLayers, (event) => {
    const place = landPlace(event.features);
    showHover(place, event.point.x, event.point.y);
    cityMap.getCanvas().style.cursor = place ? "pointer" : "";
  });
  cityMap.on("mouseleave", landLayers, () => {
    showHover(null);
    cityMap.getCanvas().style.cursor = "";
  });
  cityMap.on("error", (event) => {
    console.error(event.error);
    if (event.sourceId === "world-water") {
      worldWaterUnavailable = true;
      return;
    }

  });
  const cityLayers = [polishCityLayer, polishMajorLayer, cityLayer, majorCityLayer, villageLayer,
    overviewCities, overviewVillages, markerLayer(villageSource), markerLayer(overviewVillages), visitedPlaceLayer, "area-capital-fill"];
  cityMap.on("mousemove", cityLayers, (event) => {
    const place = cityFromFeature(event.features.find(eligibleCityFeature));
    if (place) showHover(place, event.point.x, event.point.y);
    cityMap.getCanvas().style.cursor = place ? "pointer" : "";
  });
  cityMap.on("mouseleave", cityLayers, () => {
    showHover(null);
    cityMap.getCanvas().style.cursor = "";
  });
  const regionLayers = [regionLayer, visitedRegionLayer];
  cityMap.on("mousemove", regionLayers, (event) => {
    const place = adminRegions.get(event.features[0].properties.id);
    showHover(place, event.point.x, event.point.y);
    cityMap.getCanvas().style.cursor = place ? "pointer" : "";
  });
  cityMap.on("mouseleave", regionLayers, () => {
    showHover(null);
    cityMap.getCanvas().style.cursor = "";
  });
  cityMap.on("mousemove", pinLayers, (event) => {
    const { id, name } = event.features[0].properties;
    showHover(capitalOutlines.get(id) || capitalRecords.get(id) || { id, category: "miasto", name }, event.point.x, event.point.y);
    cityMap.getCanvas().style.cursor = "pointer";
  });
  cityMap.on("mouseleave", pinLayers, () => {
    showHover(null);
    cityMap.getCanvas().style.cursor = "";
  });
  function placeAt(event) {
    if (!focusContains(event.lngLat.wrap().toArray())) return {};
    const layers = [...cityLayers, ...pinLayers, ...regionLayers, ...landLayers]
      .filter((layer) => cityMap.getLayer(layer) && cityMap.getLayoutProperty(layer, "visibility") !== "none");
    const features = cityMap.queryRenderedFeatures(event.point, { layers });
    const city = features.find((feature) => cityLayers.includes(feature.layer.id) && eligibleCityFeature(feature));
    if (city) {
      const place = cityFromFeature(city);
      if (city.geometry.type !== "Point") place.getPosition = () => event.lngLat.wrap().toArray();
      return { place };
    }
    const pin = features.find((feature) => pinLayers.includes(feature.layer.id));
    if (pin) {
      const { id, name } = pin.properties;
      return { place: capitalOutlines.get(id) || capitalRecords.get(id) || { id, name, category: "miasto", getPosition: () => pin.geometry.coordinates } };
    }
    const region = features.find((feature) => regionLayers.includes(feature.layer.id));
    if (region) return { place: adminRegions.get(region.properties.id) };
    return { place: landPlace(features) };
  }
  cityMap.on("click", (event) => {
    if (placePinAt(event.originalEvent, event.lngLat.wrap().toArray())) return;
    const { place } = placeAt(event);
    if (!place) return;
    if (event.originalEvent.shiftKey) quicklyRemovePlace(place);
    else if (event.originalEvent.ctrlKey) planPlace(place);
    else queuePlaceClick(place, () => openPlace(place));
  });
  // MapLibre consumes Shift-clicks as cancelled box zooms, even without a drag.
  cityMap.on("boxzoomcancel", ({ originalEvent }) => {
    if (!(originalEvent instanceof MouseEvent) || !originalEvent.shiftKey) return;
    const bounds = cityMap.getCanvas().getBoundingClientRect();
    const point = [originalEvent.clientX - bounds.left, originalEvent.clientY - bounds.top];
    const lngLat = cityMap.unproject(point);
    if (placePinAt(originalEvent, lngLat.wrap().toArray())) return;
    const { place } = placeAt({ point, lngLat });
    if (place) quicklyRemovePlace(place);
  });
  cityMap.on("dblclick", (event) => {
    if (event.originalEvent.altKey) {
      event.preventDefault();
      return;
    }
    const { place } = placeAt(event);
    if (!place || event.originalEvent.shiftKey) return;
    event.preventDefault();
    planPlace(place);
  });
  updateCityView();
}

function size() {
  return { w: canvas.clientWidth, h: canvas.clientHeight };
}

function scale() {
  const { w, h } = size();
  return Math.min(w / 1050, h / 550) * view.zoom;
}

function screen(x, y) {
  const { w, h } = size();
  const s = scale();
  return [(x - view.x) * s + w / 2, (y - view.y) * s + h / 2];
}

function world(x, y) {
  const { w, h } = size();
  const s = scale();
  return [(x - w / 2) / s + view.x, (y - h / 2) / s + view.y];
}

const scaleNumbers = Object.fromEntries(["pl", "en"].map((language) =>
  [language, new Intl.NumberFormat(language, { maximumFractionDigits: 1 })]));

function geographicDistance([lon1, lat1], [lon2, lat2]) {
  const radians = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2 +
    Math.cos(lat1 * radians) * Math.cos(lat2 * radians) *
    Math.sin((lon2 - lon1) * radians / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function updateMapScale() {
  const stage = byId("map-stage");
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;
  const usingCityMap = hasInteractiveMap();
  const pixels = Math.min(110, width / 2);
  const pointAt = (x) => usingCityMap
    ? cityMap.unproject([x, height / 2]).toArray()
    : cityPosition(...world(x, height / 2));
  const distance = geographicDistance(pointAt((width - pixels) / 2), pointAt((width + pixels) / 2));
  if (!Number.isFinite(distance) || distance <= 0) return;
  const magnitude = 10 ** Math.floor(Math.log10(distance));
  const mark = magnitude * (distance >= 5 * magnitude ? 5 : distance >= 2 * magnitude ? 2 : 1);
  const formatter = scaleNumbers[document.documentElement.lang] || scaleNumbers.pl;
  const scaleText = mark >= 1000 ? formatter.format(mark / 1000) + " km" : formatter.format(mark) + " m";
  if (byId("scale-distance").textContent !== scaleText) byId("scale-distance").textContent = scaleText;
  byId("scale-bar").style.width = Math.round(pixels * mark / distance) + "px";
}

function keepInBounds() {
  view.x = Math.min(1000, Math.max(0, view.x));
  view.y = Math.min(520, Math.max(0, view.y));
}

function project(lon, lat) {
  const p = lat * Math.PI / 180;
  const p2 = p * p;
  const p4 = p2 * p2;
  const x = lon * Math.PI / 180 * (0.8707 - 0.131979 * p2
    + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [500 + 182.75 * x, 260 - 182.75 * y];
}

function projectedPolygon(geometry) {
  const path = new Path2D();
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      path.moveTo(...project(...ring[0]));
      for (let index = 1; index < ring.length; index++) path.lineTo(...project(...ring[index]));
      path.closePath();
    }
  }
  return path;
}

function draw() {
  frame = 0;
  const { w, h } = size();
  if (!w || !h) return;
  updateMapScale();
  const dpr = window.devicePixelRatio || 1;
  const s = scale();
  const [left, top] = screen(0, 0);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (visibility.seas) {
    ctx.fillStyle = mapColors.lake;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(s, s);
  ctx.lineWidth = Math.min(1.15, 0.55 + 0.45 * s) / s;
  ctx.lineJoin = "round";
  const continents = activePreset === "continents" && !areaFocusActive();
  const visited = isSavedPreset() && !areaFocusActive();
  if (continents || visibility.seas) {
    for (const place of places.kontynent) {
      ctx.fillStyle = continents && marked.has(key(place)) ? visitColor
        : continents && planned.has(key(place)) ? planColor : "#fff";
      ctx.fill(place.path, "evenodd");
      if (continents) {
        ctx.strokeStyle = "#8b8498";
        ctx.stroke(place.path);
      }
    }
  }
  for (const place of continents ? [] : places.panstwo) {
    const active = !areaFocusActive() && (activePreset === "countries" || visited) && marked.has(key(place))
      && (!visited || rowInSavedPreset({ kategoria: "panstwo", tryb: "" }));
    const inPlans = !areaFocusActive() && (activePreset === "countries" || visited) && planned.has(key(place))
      && (!visited || rowInSavedPreset({ kategoria: "panstwo", tryb: "plan" }));
    const warning = visibility.warnings && !visited && warningCountries.has(place.code);
    if (active || inPlans || place === hovered || warning) {
      ctx.fillStyle = active ? visitColor : inPlans ? planColor : place === hovered ? "#eee5fb" : "#fae1e6";
      ctx.fill(place.path, "evenodd");
    }
    ctx.strokeStyle = active ? "#8057b6" : "#8b8498";
    ctx.stroke(place.path);
  }
  drawAreaFocusOverlay();
  ctx.restore();
  positionCustomPins();

}

function scheduleDraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}

function findAt(x, y) {
  if (!focusContains(cityPosition(...world(x, y)))) return null;
  const [px, py] = world(x, y);
  ctx.save();
  ctx.resetTransform();
  const hit = (place) => ctx.isPointInPath(place.path, px, py, "evenodd");
  const place = (activePreset === "continents" && !areaFocusActive() ? places.kontynent : places.panstwo).find(hit);
  ctx.restore();
  return place;
}

function showHover(place, x, y) {
  if (place && areaFocusActive() && Number.isFinite(x) && Number.isFinite(y)) {
    const position = hasInteractiveMap() ? cityMap.unproject([x, y]).wrap().toArray() : cityPosition(...world(x, y));
    if (!focusContains(position)) place = null;
  }
  if (hovered !== place) {
    hovered = place;
    scheduleDraw();
  }
  canvas.classList.toggle("target", Boolean(place));
  if (!place) {
    tooltip.hidden = true;
    return;
  }
  const warning = place.category === "panstwo" && visibility.warnings && warningCountries.has(place.code);
  const label = displayPlaceName(place) + (marked.has(key(place)) ? tr(" · odwiedzone", " · visited")
    : planned.has(key(place)) ? tr(" · w planach", " · planned") : "") +
    (warning ? tr(" · ostrzeżenie poziomu 4", " · Level 4 travel advisory") : "");
  showMapTooltip(label, x, y, areaFocusActive() ? "" : placeReading(place));
}

function showMapTooltip(label, x, y, reading = "") {
  const stage = byId("map-stage");
  tooltip.textContent = label;
  if (reading) {
    const line = document.createElement("small");
    line.className = "place-reading";
    line.lang = "und-Latn";
    line.textContent = reading;
    tooltip.append(line);
  }
  tooltip.hidden = false;
  tooltip.style.left = Math.max(4, Math.min(x + 12, stage.clientWidth - tooltip.offsetWidth - 8)) + "px";
  tooltip.style.top = stage.offsetTop + Math.max(4, y - 34) + "px";
}

function zoomAt(factor, x, y) {
  const before = world(x, y);
  view.zoom = 2 ** clampZoom(Math.log2(view.zoom * factor), mapZoomRange);
  const after = world(x, y);
  view.x += before[0] - after[0];
  view.y += before[1] - after[1];
  keepInBounds();
  showHover(null);
  updateControls();
  scheduleDraw();
}

function updateControls() {
  updateMapScale();
  if (hasInteractiveMap()) {
    byId("zoom-out").disabled = cityMap.getZoom() <= cityMap.getMinZoom() + 1e-6;
    byId("zoom-in").disabled = cityMap.getZoom() >= cityMap.getMaxZoom();
    return;
  }
  byId("zoom-out").disabled = view.zoom <= 2 ** mapZoomRange.min;
  byId("zoom-in").disabled = view.zoom >= 2 ** mapZoomRange.max;
}

function coordinates(event) {
  const r = canvas.getBoundingClientRect();
  return [event.clientX - r.left, event.clientY - r.top];
}

canvas.addEventListener("wheel", (event) => {
  if (!event.deltaY) return;
  event.preventDefault();
  zoomAt(event.deltaY < 0 ? 1.23 : 1 / 1.23, ...coordinates(event));
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || pointers.size >= 2) return;
  const [x, y] = coordinates(event);
  if (!pointers.size) dragged = false;
  else dragged = true;
  pointers.set(event.pointerId, { x, y, startX: x, startY: y });
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  const [x, y] = coordinates(event);
  const previous = pointers.get(event.pointerId);
  if (!previous) {
    if (!pointers.size && event.pointerType === "mouse") showHover(findAt(x, y), x, y);
    return;
  }
  if (Math.hypot(x - previous.startX, y - previous.startY) > 5) dragged = true;
  if (!dragged) return;
  canvas.classList.add("dragging");
  const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
  if (other) {
    view.x -= (x - previous.x) / (2 * scale());
    view.y -= (y - previous.y) / (2 * scale());
    const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
    if (oldDistance > 0) zoomAt(Math.hypot(x - other.x, y - other.y) / oldDistance, (x + other.x) / 2, (y + other.y) / 2);
  } else {
    view.x -= (x - previous.x) / scale();
    view.y -= (y - previous.y) / scale();
  }
  previous.x = x;
  previous.y = y;
  keepInBounds();
  showHover(null);
  scheduleDraw();
});

function endPointer(event) {
  if (!pointers.delete(event.pointerId)) return;
  if (!dragged && event.type === "pointerup") {
    const position = coordinates(event);
    if (!placePinAt(event, cityPosition(...world(...position))) && (["continents", "countries"].includes(activePreset) || isSavedPreset())) {
      const place = findAt(...position);
      if (place && event.shiftKey) quicklyRemovePlace(place);
      else if (place && event.ctrlKey) planPlace(place);
      else if (place) queuePlaceClick(place, () => openPlace(place));
    }
  }
  if (!pointers.size) {
    canvas.classList.remove("dragging");
  }
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("lostpointercapture", endPointer);
canvas.addEventListener("pointerleave", () => showHover(null));
canvas.addEventListener("dblclick", (event) => {
  if (event.shiftKey || event.altKey || !(["continents", "countries"].includes(activePreset) || isSavedPreset())) return;
  const place = findAt(...coordinates(event));
  if (place) planPlace(place);
});
function changePresetZoom(direction) {
  if (hasInteractiveMap()) {
    const zoom = clampZoom(cityMap.getZoom() + 0.5 * direction, mapZoomRange);
    cityMap.easeTo({ zoom, duration: 160 });
  } else {
    const { w, h } = size();
    zoomAt(2 ** (0.4 * direction), w / 2, h / 2);
  }
}

byId("zoom-in").addEventListener("click", () => changePresetZoom(1));
byId("zoom-out").addEventListener("click", () => changePresetZoom(-1));
byId("reset").addEventListener("click", () => {
  if (areaFocusActive() && cityMap) {
    fitFocusedArea();
    return;
  }
  const zoom = presetZoom(presets[activePreset]);
  if (hasInteractiveMap()) {
    cityMap.jumpTo({ zoom });
    return;
  }
  view.zoom = 2 ** zoom;
  showHover(null);
  updateControls();
  scheduleDraw();
});
new ResizeObserver(() => {
  if (byId("map-view").hidden) return;
  if (areaFocusActive() && cityMap) fitFocusedArea(true);
  else cityMap?.resize();
  updateControls();
  scheduleDraw();
}).observe(byId("map-stage"));

function updateSidebar(focusKey) {
  byId("continent-count").textContent = places.kontynent.filter((place) => marked.has(key(place))).length;
  byId("country-count").textContent = places.panstwo.filter((p) => marked.has(key(p))).length;
  const visits = savedRows.filter((row) => row.tryb !== "plan");
  const cityVisits = visits.filter((row) => row.kategoria === "miasto");
  byId("major-count").textContent = polishCities.size && majorCities.size
    ? cityVisits.filter((row) => isMajorCity(row.id)).length : "–";
  byId("capital-city-count").textContent = new Set(cityVisits.filter((row) => isCapitalCity(row.id)).map((row) => row.id)).size;
  byId("city-count").textContent = cityVisits.filter((row) => !row.id.startsWith("simc:")).length;
  byId("settlement-count").textContent = cityVisits.length;
  byId("region-count").textContent = visits.filter((row) => row.kategoria === "rejon").length;
  byId("visited-count").textContent = visits.filter((row) => row.kategoria !== "kontynent").length;
  byId("visited-only-count").textContent = savedRows.filter((row) => rowInSavedPreset(row, "visited-only")).length;
  byId("planned-only-count").textContent = savedRows.filter((row) => rowInSavedPreset(row, "planned-only")).length;
  const query = normalize(search.value.trim());
  const empty = byId("empty");
  byId("list-title").hidden = !query;
  results.replaceChildren();
  if (!query) {
    empty.hidden = true;
    if (focusKey) search.focus({ preventScroll: true });
    return;
  }
  let matches;
  if (focusShowsCountries()) {
    matches = places.panstwo.filter((place) => place.searchText.includes(query));
  } else if (focusShowsRegions()) {
    matches = [...adminRegions.values(), ...capitalRecords.values()].filter((place) =>
      normalize([place.name, displayPlaceName(place), place.region].filter(Boolean).join(" ")).includes(query));
  } else if (isSavedPreset() && !areaFocusActive()) {
    matches = savedRows.filter((row) => rowInSavedPreset(row)
      && (row.tryb !== "plan" || !marked.has(row.kategoria + ":" + row.id))).map((row) => {
      const category = row.kategoria;
      const country = category === "panstwo" ? places.panstwo.find((place) => place.id === row.id) : null;
      const region = category === "rejon" ? adminRegions.get(row.id) : null;
      return { id: row.id, category, name: region?.name || row.nazwa, code: country?.code, country: region?.country,
        region: region?.region, navigateOnly: true,
        getPosition: () => country ? cityPosition(country.x, country.y)
          : region ? region.getPosition() : savedCityPosition(row) };
    }).filter((place) => place &&
      normalize([place.name, displayPlaceName(place), place.region, displayRegionName(place)].filter(Boolean).join(" ")).includes(query));
  } else if (activePreset === "capital-cities" && !areaFocusActive()) {
    matches = capitalLocations().filter((place) => place.searchText.includes(query))
      .map((place) => ({ ...place, navigateOnly: true }));
  } else if (activePreset === "regions" && !areaFocusActive()) {
    matches = [...adminRegions.values()].filter((place) => place.searchText.includes(query));
  } else if (category === "panstwo" || category === "kontynent") {
    matches = places[category].filter((place) => place.searchText.includes(query));
  } else {
    const polygons = [...cityPlaces.values()].filter((p) => placeInPreset(p) && p.searchText.includes(query));
    const names = new Set(polygons.map((p) => normalize(p.name + " " + p.region)));
    const polishLocations = [...polishCities.values()].filter((p) =>
      placeInPreset(p) && p.searchText.includes(query) && !cityPlaces.has(p.id));
    const majorLocations = [...majorCities.values()].filter((p) =>
      p.searchText.includes(query) && !cityPlaces.has(p.id) && (!areaFocusActive() || focusPlaceAllowed(p)));
    const found = placeSearchResults.filter((p) => (areaFocusActive() ? !polygons.some((item) => item.id === p.id) : !cityPlaces.has(p.id)) && !majorLocations.some((item) => item.id === p.id));
    const locations = [...capitalRecords.values()].filter((p) =>
      p.capital && p.region !== "Polska" && p.searchText.includes(query) &&
      ![p.name, p.original].some((name) => names.has(normalize(name + " " + p.region))) &&
      ![p.name, p.original].some((name) => capitalOutlineNames.has(normalize(name + " " + p.region))) &&
      ![...majorLocations, ...found].some((city) =>
        city.region === p.region && [p.name, p.original].some((name) => normalize(city.name) === normalize(name))));
    matches = polygons.concat([...polishLocations, ...majorLocations, ...found].filter(placeInPreset)
      .map((p) => ({ ...p, navigateOnly: true })), locations);
  }
  if (areaFocusActive()) matches = [...new Map(matches.filter(focusPlaceAllowed).map((place) => [key(place), place])).values()]
    .sort((a, b) => Number(normalize(b.name) === query) - Number(normalize(a.name) === query));
  let focusTarget;
  for (const place of matches.slice(0, 50)) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const label = document.createElement("span");
    const icon = document.createElement("strong");
    const active = marked.has(key(place));
    const inPlans = !active && planned.has(key(place));
    button.className = "result";
    button.type = "button";
    label.textContent = displayPlaceName(place);
    appendPlaceReading(label, place);
    if (place.region || inPlans) {
      const region = document.createElement("small");
      region.textContent = [displayRegionName(place), inPlans ? tr("W planach", "Planned") : ""].filter(Boolean).join(" · ");
      label.append(region);
    }
    icon.textContent = inPlans ? "◇" : active ? "✓" : place.navigateOnly ? "↗" : "+";
    icon.classList.toggle("planned-icon", inPlans);
    icon.setAttribute("aria-hidden", "true");
    button.append(label, icon);
    const select = () => {
      if (consumeFocusSelection(place)) return;
      if (savedPlaces.has(key(place))) {
        openPlace(place, { focus: true });
        return;
      }
      if (place.navigateOnly) {
        const center = place.getPosition?.() || (Number.isFinite(place.x) && cityPosition(place.x, place.y));
        if (!center) return;
        const preset = presets[activePreset];
        const visitedZoom = { panstwo: 3, rejon: 6, miasto: 11 };
        cityMap?.jumpTo({ center, zoom: isSavedPreset()
          ? clampZoom(visitedZoom[place.category], preset) : presetZoom(preset) });
        return;
      }
      if (place.category === "rejon") {
        const preset = presets.regions;
        cityMap.jumpTo({ center: place.getPosition(), zoom: clampZoom(6, preset) });
      }
      if (place.capital) {
        cityMap?.jumpTo({ center: place.getPosition(), zoom: presetZoom(presets[activePreset]) });
      }
      if (place.category === "panstwo") {
        const zoom = clampZoom(1, presets.countries);
        if (hasInteractiveMap()) {
          cityMap.jumpTo({ center: cityPosition(place.x, place.y), zoom });
        } else {
          Object.assign(view, { x: place.x, y: place.y, zoom: 2 ** zoom });
          updateControls();
          scheduleDraw();
        }
      }
      openPlace(place, { focus: true });
    };
    button.addEventListener("click", (event) => {
      if (event.shiftKey) quicklyRemovePlace(place);
      else if (event.ctrlKey) planPlace(place, true);
      else if (place.navigateOnly || !event.detail) select();
      else queuePlaceClick(place, select);
    });
    if (!place.navigateOnly) button.addEventListener("dblclick", (event) => {
      if (!event.shiftKey) planPlace(place, true);
    });
    if (focusKey === key(place)) focusTarget = button;
    item.append(button);
    results.append(item);
  }
  if (focusKey) (focusTarget || search).focus({ preventScroll: true });
  empty.hidden = matches.length > 0;
}

function queuePlaceClick(place, select) {
  if (consumeFocusSelection(place)) return;
  if (pendingMapClick) {
    if (pendingMapClick.key === key(place)) return;
    clearTimeout(pendingMapClick.timer);
    pendingMapClick.select();
    pendingMapClick = undefined;
  }
  if (savedPlaces.has(key(place))) {
    select();
    return;
  }
  const timer = setTimeout(() => {
    pendingMapClick = undefined;
    select();
  }, 550);
  pendingMapClick = { key: key(place), timer, select };
}

function cancelPlaceClick(place) {
  if (pendingMapClick?.key === key(place)) {
    clearTimeout(pendingMapClick.timer);
    pendingMapClick = undefined;
  }
}

function planPlace(place, focus = false) {
  cancelPlaceClick(place);
  openPlace(place, { planning: true, focus });
}

function updatePlaceLabels() {
  if (!editedPlace) return;
  byId("place-details-title").textContent = displayPlaceName(editedPlace.place);
  const reading = byId("place-details-reading");
  reading.textContent = areaFocusActive() ? "" : placeReading(editedPlace.place);
  reading.hidden = !reading.textContent;
  byId("place-return-visits").hidden = placePlanned.checked;
  for (const label of placeVisitDates.querySelectorAll("label")) {
    label.textContent = tr("Data kolejnej wizyty", "Date of return visit");
  }
  for (const button of placeVisitDates.querySelectorAll("button")) {
    button.textContent = tr("Usuń wizytę", "Remove visit");
  }
  for (const date of placeVisitDates.querySelectorAll("input")) date.disabled = placePlanned.checked;
  byId("place-date-label").textContent = placePlanned.checked
    ? tr("Planowana data", "Planned date") : tr("Data wizyty", "Date visited");
  byId("place-rating-label").textContent = placePlanned.checked
    ? tr("Chęć odwiedzenia (1–10)", "How much you want to visit (1–10)") : tr("Ocena wizyty (1–10)", "Visit rating (1–10)");
}

function appendVisitDate({ id = crypto.randomUUID(), data = "" } = {}, container = placeVisitDates, addButton = addPlaceVisit) {
  const row = document.createElement("div");
  row.className = "place-return-visit";
  const label = document.createElement("label");
  const date = document.createElement("input");
  date.type = "date";
  date.id = "place-visit-" + id;
  date.dataset.visitId = id;
  date.max = placeDate.max;
  date.required = true;
  date.value = data;
  label.htmlFor = date.id;
  label.textContent = tr("Data kolejnej wizyty", "Date of return visit");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = tr("Usuń wizytę", "Remove visit");
  remove.addEventListener("click", () => {
    row.remove();
    addButton.disabled = false;
    addButton.focus();
  });
  row.append(label, date, remove);
  container.append(row);
  addButton.disabled = container.childElementCount >= 100;
  return date;
}

function fillPlaceFields(row, planning = false) {
  placePlanned.checked = row ? row.tryb === "plan" : planning;
  placeDate.value = row?.data || "";
  const rating = String(row?.ocena ?? "");
  placeRating.value = tr(rating.replace(".", ","), rating.replace(",", "."));
  placeRating.setCustomValidity("");
  placeNote.value = row?.notatka || "";
  placeVisitDates.replaceChildren();
  addPlaceVisit.disabled = false;
  for (const visit of row?.kolejne_wizyty || []) appendVisitDate(visit);
  updatePlaceLabels();
}

function setPlaceEditorBusy(busy) {
  byId("place-fields").disabled = busy;
  placeSave.disabled = busy;
  placeRemove.disabled = busy;
}

function openPlace(place, { planning = false, focus = false } = {}) {
  if (!ready) return;
  if (consumeFocusSelection(place)) return;
  closePinEditor();
  setMapSidebarOpen(true);
  if (editedPlace && key(editedPlace.place) === key(place)) {
    if (focus) byId("place-details-title").focus({ preventScroll: true });
    return;
  }
  const row = savedPlaces.get(key(place));
  const editor = { place, busy: false };
  editedPlace = editor;
  fillPlaceFields(row, planning);
  placeRemove.hidden = !row;
  setPlaceEditorBusy(false);
  byId("map-places").hidden = true;
  byId("place-details").hidden = false;
  byId("map-sidebar").scrollTop = 0;
  if (focus) byId("place-details-title").focus({ preventScroll: true });
  if (!row) commitPlace(editor, { odwiedzone: true, planowane: planning, tylko_nowe: true });
}

function closePlaceDetails(restoreFocus = false) {
  if (!editedPlace) return;
  const focusKey = restoreFocus ? key(editedPlace.place) : null;
  editedPlace = undefined;
  byId("place-details").hidden = true;
  byId("map-places").hidden = false;
  if (focusKey) updateSidebar(focusKey);
}

function setPinPlacement(active) {
  if (active && areaFocus.selecting) setAreaSelection(false);
  pinPlacement = active;
  byId("map-stage").classList.toggle("pin-placement", active);
  byId("pin-placement-hint").hidden = !active;
  addPinButton.setAttribute("aria-pressed", String(active));
}

function placePinAt(event, position) {
  if (areaFocus.selecting || areaFocus.loading) return false;
  if (!ready || (!pinPlacement && !event.altKey)) return false;
  if (!focusContains(position)) return true;
  if (pendingMapClick) clearTimeout(pendingMapClick.timer);
  pendingMapClick = undefined;
  setPinPlacement(false);
  showHover(null);
  openPinEditor({ id: crypto.randomUUID(), position, nazwa: "", opis_dlugi: "", kolor: defaultPinColor }, false);
  return true;
}

function positionCustomPins() {
  if (workspace.hidden) return;
  const draft = editedPin && !editedPin.saved;
  if (!draft) pinDraft.hidden = true;
  if (!pinMarkers.length && !draft) return;
  const width = pinLayerElement.clientWidth;
  const height = pinLayerElement.clientHeight;
  const interactive = hasInteractiveMap();
  const markers = draft ? [...pinMarkers, { pin: editedPin.pin, element: pinDraft }] : pinMarkers;
  for (const { pin, element } of markers) {
    const [lon, lat] = pin.position;
    let x, y;
    if (interactive) ({ x, y } = cityMap.project(pin.position));
    else [x, y] = screen(...project(lon, lat));
    element.hidden = !focusContains(pin.position) || (element !== pinDraft && !areaFocusActive() && isSavedPreset() && !rowInSavedPreset(pin)) || x < 0 || x > width || y < 0 || y > height;
    if (!element.hidden) element.style.transform = `translate(${x - 13}px, ${y - 25}px)`;
  }
}

function renderCustomPins(rows) {
  tooltip.hidden = true;
  pinMarkers = rows.map((row) => {
    const pin = { ...row, position: [Number(row.lon), Number(row.lat)] };
    const element = document.createElement("button");
    const glyph = document.createElement("span");
    element.type = "button";
    element.className = "map-pin";
    element.setAttribute("aria-label", pin.nazwa);
    element.style.setProperty("--pin-color", pin.kolor);
    glyph.className = "pin-glyph";
    glyph.setAttribute("aria-hidden", "true");
    element.append(glyph);
    const showName = () => {
      const marker = element.getBoundingClientRect();
      const overlay = pinLayerElement.getBoundingClientRect();
      showMapTooltip(pin.nazwa, marker.left - overlay.left + marker.width / 2, marker.top - overlay.top + marker.height / 2);
    };
    const hideName = () => { tooltip.hidden = true; };
    element.addEventListener("mouseenter", showName);
    element.addEventListener("mouseleave", hideName);
    element.addEventListener("focus", showName);
    element.addEventListener("blur", hideName);
    element.addEventListener("click", (event) => {
      if (event.shiftKey) {
        const visitCount = 1 + (pin.kolejne_wizyty?.length || 0);
        if (visitCount > 1 && !window.confirm(tr(
          `${pin.nazwa} — liczba zapisanych wizyt: ${visitCount}. Czy usunąć je wszystkie?`,
          `${pin.nazwa} has ${visitCount} saved visits. Delete them all?`,
        ))) return;
        const editor = editedPin?.pin.id === pin.id ? editedPin : { pin };
        saveCustomPin({ usun: true }, editor);
      } else if (!placePinAt(event, pin.position)) openPinEditor(pin, true);
    });
    element.addEventListener("dblclick", (event) => event.stopPropagation());
    return { pin, element };
  });
  pinLayerElement.replaceChildren(...pinMarkers.map(({ element }) => element), pinDraft);
  positionCustomPins();
  document.dispatchEvent(new Event("atlas-pins-change"));
}

function updatePinTitle() {
  if (!editedPin) return;
  for (const label of pinVisitDates.querySelectorAll("label")) label.textContent = tr("Data kolejnej wizyty", "Date of return visit");
  for (const button of pinVisitDates.querySelectorAll("button")) button.textContent = tr("Usuń wizytę", "Remove visit");
  byId("pin-details-title").textContent = editedPin.saved ? editedPin.pin.nazwa : tr("Nowa pinezka", "New pin");
}

function openPinEditor(pin, saved) {
  closePlaceDetails();
  setMapSidebarOpen(true);
  if (editedPin?.pin.id !== pin.id) {
    editedPin = { pin, saved, busy: false };
    pinName.value = pin.nazwa;
    pinName.setCustomValidity("");
    pinLong.value = pin.opis_dlugi || "";
    pinDate.value = pin.data || "";
    pinVisitDates.replaceChildren();
    addPinVisit.disabled = false;
    for (const visit of pin.kolejne_wizyty || []) appendVisitDate(visit, pinVisitDates, addPinVisit);
    pinColor.value = pin.kolor;
    pinRemove.hidden = !saved;
    setPinEditorBusy(false);
    updatePinTitle();
  }
  byId("map-places").hidden = true;
  byId("pin-details").hidden = false;
  pinDraft.style.setProperty("--pin-color", pinColor.value);
  positionCustomPins();
  pinName.focus({ preventScroll: true });
}

function closePinEditor(restoreFocus = false) {
  if (!editedPin) return;
  const marker = pinMarkers.find(({ pin }) => pin.id === editedPin.pin.id)?.element;
  editedPin = undefined;
  pinDraft.hidden = true;
  byId("pin-details").hidden = true;
  byId("map-places").hidden = false;
  if (restoreFocus) (marker && !marker.hidden ? marker : addPinButton).focus({ preventScroll: true });
}

function setPinEditorBusy(busy) {
  byId("pin-fields").disabled = busy;
  pinSave.disabled = busy;
  pinRemove.disabled = busy;
}

function saveCustomPin(change, editor = editedPin) {
  if (!editor || editor.busy) return;
  editor.busy = true;
  if (editedPin === editor) setPinEditorBusy(true);
  visitQueue = visitQueue.then(async () => {
    status.textContent = "";
    try {
      const rows = await request("/api/pinezki", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editor.pin.id, pozycja: editor.pin.position, ...change }),
      });
      renderCustomPins(rows);
      visitUpdates?.postMessage("pins");
      if (editedPin !== editor) return;
      if (change.usun) closePinEditor(true);
      else {
        editor.pin = pinMarkers.find(({ pin }) => pin.id === editor.pin.id).pin;
        editor.saved = true;
        pinDraft.hidden = true;
        pinRemove.hidden = false;
        updatePinTitle();
      }
    } catch {
      status.textContent = tr("Nie udało się zapisać pinezki.", "Could not save the pin.");
    } finally {
      editor.busy = false;
      if (editedPin === editor) setPinEditorBusy(false);
    }
  });
}

addPinButton.addEventListener("click", () => { if (ready) setPinPlacement(!pinPlacement); });
pinDraft.addEventListener("click", (event) => {
  if (event.shiftKey) closePinEditor(true);
  else pinName.focus({ preventScroll: true });
});
pinColor.addEventListener("input", () => pinDraft.style.setProperty("--pin-color", pinColor.value));
byId("close-pin-details").addEventListener("click", () => closePinEditor(true));
pinName.addEventListener("input", () => pinName.setCustomValidity(""));
byId("pin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = pinName.value.trim();
  if (!name) {
    pinName.setCustomValidity(tr("Wpisz nazwę pinezki.", "Enter a name for the pin."));
    pinName.reportValidity();
    return;
  }
  saveCustomPin({
    nazwa: name, opis_dlugi: pinLong.value, kolor: pinColor.value, data: pinDate.value,
    kolejne_wizyty: [...pinVisitDates.querySelectorAll("input")].map((input) => ({ id: input.dataset.visitId, data: input.value })),
  });
});
addPinVisit.addEventListener("click", () => appendVisitDate({}, pinVisitDates, addPinVisit).focus());
pinRemove.addEventListener("click", () => saveCustomPin({ usun: true }));

function commitPlace(editor, change) {
  if (editor.busy) return;
  editor.busy = true;
  const restoreSaveFocus = editedPlace === editor && document.activeElement === placeSave;
  if (editedPlace === editor) setPlaceEditorBusy(true);
  visitQueue = visitQueue.then(async () => {
    const saved = await saveVisit(editor.place, change);
    editor.busy = false;
    if (editedPlace !== editor) return;
    setPlaceEditorBusy(false);
    const row = savedPlaces.get(key(editor.place));
    placeRemove.hidden = !row;
    if (row && change.tylko_nowe) fillPlaceFields(row);
    if (saved && !change.odwiedzone) closePlaceDetails(true);
    else if (restoreSaveFocus && document.activeElement === document.body) placeSave.focus({ preventScroll: true });
  });
}

function quicklyRemovePlace(place) {
  if (consumeFocusSelection(place)) return;
  cancelPlaceClick(place);
  const placeKey = key(place);
  const row = savedPlaces.get(placeKey);
  if (!ready || !row) return;
  const editor = editedPlace && key(editedPlace.place) === placeKey ? editedPlace : { place };
  if (editor.busy) return;
  const visitCount = 1 + (row.kolejne_wizyty?.length || 0);
  if (visitCount > 1 && !window.confirm(tr(
    `${displayPlaceName(place)} — liczba zapisanych wizyt: ${visitCount}. Czy usunąć je wszystkie?`,
    `${displayPlaceName(place)} has ${visitCount} saved visits. Delete them all?`,
  ))) return;
  commitPlace(editor, { odwiedzone: false });
}

placePlanned.addEventListener("change", updatePlaceLabels);
addPlaceVisit.addEventListener("click", () => appendVisitDate().focus());
placeRating.addEventListener("input", () => placeRating.setCustomValidity(""));
placeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editedPlace) return;
  const rating = placeRating.value.trim().replace(",", ".");
  if (rating) {
    const [whole, fraction = ""] = rating.split(".");
    const value = Number(whole);
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(rating) || value < 1 || value > 10 || (value === 10 && /[1-9]/.test(fraction))) {
      placeRating.setCustomValidity(tr("Wpisz liczbę od 1 do 10.", "Enter a number from 1 to 10."));
      placeRating.reportValidity();
      return;
    }
  }
  commitPlace(editedPlace, {
    odwiedzone: true, planowane: placePlanned.checked, data: placeDate.value,
    ocena: rating, notatka: placeNote.value,
    kolejne_wizyty: placePlanned.checked ? undefined : [...placeVisitDates.querySelectorAll("input")].map((date) => ({
      id: date.dataset.visitId, data: date.value,
    })),
  });
});
byId("close-place-details").addEventListener("click", () => closePlaceDetails(true));
placeRemove.addEventListener("click", () => {
  if (editedPlace) commitPlace(editedPlace, { odwiedzone: false });
});

async function saveVisit(place, change) {
  status.textContent = "";
  try {
    const rows = await request("/api/odwiedzone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kategoria: place.category, id: place.id, nazwa: place.name, panstwo: place.country,
        pozycja: change.odwiedzone ? place.getPosition?.() || undefined : undefined, ...change }),
    });
    readMarked(rows);
    visitUpdates?.postMessage("updated");
    showHover(null);
    updateSidebar();
    scheduleDraw();
    return true;
  } catch {
    status.textContent = tr("Zapis CSV się nie powiódł. Zamknij plik w edytorze i spróbuj ponownie.", "Could not save the CSV. Close it in your editor and try again.");
    return false;
  }
}

function refreshMapVisits() {
  const refresh = visitQueue.then(async () => {
    readMarked(await request("/api/odwiedzone"));
    updateSidebar();
    scheduleDraw();
  });
  visitQueue = refresh.catch(() => {});
  return refresh;
}

visitUpdates?.addEventListener("message", (event) => {
  if (event.data === "reset") {
    location.reload();
    return;
  }
  if (event.data === "journal") return;
  if (event.data === "pins") {
    visitQueue = visitQueue.then(async () => renderCustomPins(await request("/api/pinezki"))).catch(console.error);
  } else refreshMapVisits().catch(console.error);
});

tabs.forEach((tab) => tab.addEventListener("click", () => {
  const next = tab.dataset.preset;
  if (activePreset === next || !visibility[next]) return;
  const previousCategory = category;
  activePreset = next;
  category = areaFocusActive() ? focusSearchCategory() : presets[next].category;
  tabs.forEach((item) => item.setAttribute("aria-pressed", item === tab));
  if (previousCategory !== category || isSavedPreset(next) || next === "regions") search.value = "";
  updateSearchPrompt();
  cityPlaces.clear();
  searchSignature = "";
  schedulePlaceSearch();
  showHover(null);
  refreshPreset();
  updateSidebar();
  scheduleDraw();
}));

function updateSearchPrompt() {
  search.placeholder = areaFocusActive() ? tr("Szukaj w tym obszarze…", "Search within this area…")
    : isSavedPreset() ? activePreset === "visited-only" ? tr("Szukaj w odwiedzonych…", "Search visited places…")
    : activePreset === "planned-only" ? tr("Szukaj w zaplanowanych…", "Search planned places…")
      : tr("Szukaj zapisanych miejsc…", "Search saved places…")
    : activePreset === "regions" ? tr("Szukaj rejonu…", "Search for a region…")
    : activePreset === "capital-cities" ? tr("Szukaj stolicy…", "Search for a capital…")
    : activePreset === "continents" ? tr("Wpisz nazwę kontynentu…", "Enter a continent name…")
    : category === "miasto" ? tr("Szukaj miasta na świecie…", "Search for a city…")
    : tr("Wpisz nazwę państwa…", "Enter a country name…");
}

function updateLayerLegend() {
  const water = presetShowsWater() && (visibility.rivers || visibility.lakes);
  byId("water-key").hidden = !water;
  byId("water-key-label").textContent = visibility.rivers && visibility.lakes ? tr("Rzeki i jeziora", "Rivers and lakes")
    : visibility.rivers ? tr("Rzeki", "Rivers") : tr("Jeziora", "Lakes");
  byId("forest-key").hidden = !visibility.forests || (areaFocusActive() ? !focusShowsCities() : (activePreset === "continents" || isSavedPreset()));
  byId("warning-key").hidden = areaFocusActive() || !visibility.warnings || ["continents"].includes(activePreset) || isSavedPreset();
  byId("capital-key").hidden = !visibility.capitals || (areaFocusActive() ? focusShowsCountries() : ["continents", "countries", "regions"].includes(activePreset));
}

const visibilityDialog = byId("visibility-settings");
const parkLayerKeys = ["forests", "lakes", "rivers"];
const visibilityMessage = byId("visibility-message");
const visibilityInputs = new Map();
const visibilityLabels = new Map();
let visibilityQueue = Promise.resolve();
let savedVisibility = visibility;
let visibilityRevision = 0;
for (const key of visibilityKeys) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = visibility[key];
  visibilityInputs.set(key, input);
  const layer = key in layerLabels;
  if (parkLayerKeys.includes(key)) label.dataset.parkLayer = "";
  const text = document.createElement("span");
  visibilityLabels.set(key, text);
  label.append(input, text);
  byId(layer ? "visible-layers" : "visible-presets").append(label);
  input.addEventListener("change", () => {
    const next = { ...visibility, [key]: input.checked };
    const revision = ++visibilityRevision;
    applyVisibility(next);
    visibilityMessage.textContent = "";
    visibilityQueue = visibilityQueue.then(async () => {
      try {
        const response = await request("/api/ustawienia", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: next }),
        });
        savedVisibility = response.visibility;
      } catch {
        if (revision !== visibilityRevision) return;
        applyVisibility(savedVisibility);
        visibilityMessage.textContent = tr("Nie udało się zapisać widoczności w ustawienia.csv.", "Could not save visibility to ustawienia.csv.");
      }
    });
  });
}

function syncOnlineLayers() {
  if (!baseOnlineEnabled()) {
    baseNetworkController.abort();
    baseArchiveRequest = undefined;
    if (cityMap?.getSource("world-water")) {
      for (const id of ["world-rivers", "world-lakes", forestLayer]) {
        if (cityMap.getLayer(id)) cityMap.removeLayer(id);
      }
      cityMap.removeSource("world-water");
    }
  }
  worldWaterUnavailable = false;
  document.dispatchEvent(new Event("atlas-online-change"));
}

function applyVisibility(next) {
  const challengeLayersChanged = ["seas", ...parkLayerKeys].some((layer) => visibility[layer] !== next[layer]);
  visibility = next;
  syncOnlineLayers();
  const shown = tabs.filter((tab) => visibility[tab.dataset.preset]);
  for (const tab of tabs) tab.hidden = !visibility[tab.dataset.preset];
  for (const [key, input] of visibilityInputs) {
    input.checked = visibility[key];
    input.disabled = shown.length === 1 && shown[0].dataset.preset === key;
  }
  if (!visibility[activePreset]) shown[0].click();
  else refreshPreset();
  scheduleDraw();
  if (challengeLayersChanged) document.dispatchEvent(new Event("atlas-visibility-change"));
  document.dispatchEvent(new Event("atlas-settings-sync"));
}

function openVisibilitySettings(parkLayersOnly = false) {
  if (!ready) return;
  setToolbarPanel(null);
  visibilityDialog.classList.toggle("park-layer-options", parkLayersOnly);
  visibilityDialog.showModal();
}

byId("open-visibility-settings").addEventListener("click", () => openVisibilitySettings());
byId("close-visibility-settings").addEventListener("click", () => visibilityDialog.close());

const resetProgressDialog = byId("progress-reset-dialog");
const resetProgressStatus = byId("progress-reset-status");
const cancelProgressReset = byId("cancel-progress-reset");
const confirmProgressReset = byId("confirm-progress-reset");
function openProgressReset() {
  resetProgressStatus.textContent = "";
  resetProgressDialog.showModal();
}
cancelProgressReset.addEventListener("click", () => resetProgressDialog.close());
resetProgressDialog.addEventListener("cancel", (event) => {
  if (confirmProgressReset.disabled) event.preventDefault();
});
byId("progress-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (confirmProgressReset.disabled) return;
  confirmProgressReset.disabled = cancelProgressReset.disabled = true;
  resetProgressStatus.textContent = "";
  if (pendingMapClick) {
    clearTimeout(pendingMapClick.timer);
    pendingMapClick = undefined;
  }
  try {
    await visitQueue;
    await request("/api/reset-postepu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ potwierdzam: true }),
    });
    visitUpdates?.postMessage("reset");
    location.reload();
  } catch {
    resetProgressStatus.textContent = tr("Nie udało się zresetować postępu.", "Could not reset progress.");
    confirmProgressReset.disabled = cancelProgressReset.disabled = false;
  }
});

search.addEventListener("input", () => {
  schedulePlaceSearch();
  updateSidebar();
});
retryMap.addEventListener("click", () => {
  cityProblem = false;
  loadVisibleCities();
  updateCityView();
});

function applyZoomRanges(settings) {
  for (const [id, range] of Object.entries(settings.ranges)) {
    Object.assign(presets[id], { min: range.min, max: range.max });
  }
  updateControls();
  scheduleDraw();
}

const workspace = document.querySelector(".workspace");
const sections = [...document.querySelectorAll(".atlas-nav [data-section]")];
function showSection(id) {
  if (id === "map-view" && (areaFocusActive() || areaFocus.selecting || areaFocus.loading)) leaveAreaFocus();
  if (id !== "map-view" && (areaFocus.selecting || areaFocus.loading)) setAreaSelection(false);
  byId("settings-view").hidden = id !== "settings-view";
  for (const item of sections) {
    const active = item.dataset.section === id;
    byId(item.dataset.section).hidden = !active;
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  setToolbarPanel(null);
  setPinPlacement(false);
  showHover(null);
  if (!workspace.hidden) positionCustomPins();
  if (id === "settings-view") {
    developerProgressState.loaded = false;
    renderMainSettings();
  }
}
for (const button of sections) {
  button.addEventListener("click", () => showSection(button.dataset.section));
}
byId("brand-home").addEventListener("click", (event) => {
  event.preventDefault();
  showSection("map-view");
});
const sidebar = byId("map-sidebar");
const narrowLayout = matchMedia("(max-width: 640px)");
const languageSelect = byId("atlas-language");
let layout = { language: "en", sidebar: "auto", online_focus: "off", achievement_notifications: "on" };
const achievementNotificationsEnabled = () => layout.achievement_notifications !== "off";
const achievementNotificationInput = document.createElement("input");
achievementNotificationInput.type = "checkbox";
achievementNotificationInput.checked = true;
achievementNotificationInput.addEventListener("change", () => {
  saveLayout("achievement_notifications", achievementNotificationInput.checked ? "on" : "off");
  document.dispatchEvent(new Event("atlas-achievement-notifications-change"));
});
const onlineLabels = {
  online_focus: ["Lupka — szczegółowa mapa", "Area focus Detailed Map"],
  online_water: ["Szczegółowe rzeki i jeziora", "Detailed rivers and lakes"],
  online_hewelion: ["Hewelion — szczegółowa mapa", "Hewelion Detailed Map"],
  online_castles: ["Polskie zamki — szczegółowa mapa", "Polish Castles Detailed Map"],
};
const onlineInputs = new Map();
let savedOnline = Object.fromEntries(Object.keys(onlineLabels).map((key) => [key, layout[key] || "on"]));
for (const key of Object.keys(onlineLabels)) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = onlineEnabled(key);
  input.addEventListener("change", () => saveOnlineSettings({ [key]: input.checked ? "on" : "off" }));
  onlineInputs.set(key, input);
}
function saveOnlineSettings(updated, disableForests = false) {
  Object.assign(layout, updated);
  const next = { ...visibility, ...(disableForests ? { forests: false } : {}) };
  const revision = ++visibilityRevision;
  applyVisibility(next);
  visibilityMessage.textContent = "";
  visibilityQueue = visibilityQueue.then(async () => {
    try {
      const response = await request("/api/ustawienia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next, layout: updated }),
      });
      savedVisibility = response.visibility;
      savedOnline = Object.fromEntries(Object.keys(onlineLabels).map((key) => [key, response.layout[key]]));
    } catch {
      if (revision !== visibilityRevision) return;
      Object.assign(layout, savedOnline);
      applyVisibility(savedVisibility);
      visibilityMessage.textContent = tr("Nie udało się zapisać ustawień internetu.", "Could not save internet settings.");
      syncMainSettings();
    }
  });
}
let layoutQueue = Promise.resolve();
let openToolbarPanel = null;
const toolbarPanels = ["legend", "shortcuts", "libraries", "data-dates"];

function renderDataDates() {
  byId("warning-data-date").dateTime = warningSnapshotDate;
  const overture = byId("overture-data-date");
  overture.hidden = !loadedOvertureRelease;
  if (loadedOvertureRelease) overture.querySelector("time").dateTime = loadedOvertureRelease.split(".")[0];
  const formatter = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "long", timeZone: "UTC" });
  for (const element of byId("data-dates-panel").querySelectorAll("time[datetime]")) {
    element.textContent = formatter.format(new Date(element.dateTime + "T00:00:00Z"));
  }
}

function setToolbarPanel(next) {
  openToolbarPanel = next;
  for (const id of toolbarPanels) {
    byId(id + "-panel").hidden = next !== id;
    byId("toggle-" + id).setAttribute("aria-expanded", String(next === id));
  }
}

for (const id of toolbarPanels) {
  byId("toggle-" + id).addEventListener("click", () => setToolbarPanel(openToolbarPanel === id ? null : id));
}
document.addEventListener("click", (event) => {
  if (openToolbarPanel && !event.target.closest("#map-view .toolbar-panel, #toggle-" + openToolbarPanel)) {
    setToolbarPanel(null);
  }
});
function canUseMapShortcuts(event) {
  return !workspace.hidden && !event.defaultPrevented && !document.querySelector("dialog[open]") &&
    !event.target.closest?.("input, select, textarea, [contenteditable]");
}

// Handle the view shortcut before MapLibre handles horizontal arrows as panning.
document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (areaFocusActive()) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !canUseMapShortcuts(event)) return;
  const visibleTabs = tabs.filter((tab) => visibility[tab.dataset.preset]);
  if (visibleTabs.length < 2) return;
  const index = visibleTabs.findIndex((tab) => tab.dataset.preset === activePreset);
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = visibleTabs[(index + step + visibleTabs.length) % visibleTabs.length];
  event.preventDefault();
  event.stopPropagation();
  next.click();
  if (tabs.includes(event.target)) next.focus({ preventScroll: true });
}, { capture: true });

document.addEventListener("keydown", (event) => {
  if (!canUseMapShortcuts(event)) return;
  if (event.key === "Escape") {
    if (openToolbarPanel) {
      const button = byId("toggle-" + openToolbarPanel);
      setToolbarPanel(null);
      button.focus();
    } else if (pinPlacement) {
      setPinPlacement(false);
      addPinButton.focus();
    } else if (!sidebar.hidden) {
      if (editedPin) closePinEditor(true);
      else closePlaceDetails(true);
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "0") byId("reset").click();
  else if (!cityContainer.contains(event.target) && (event.key === "+" || event.key === "-")) {
    changePresetZoom(event.key === "+" ? 1 : -1);
  } else return;
  event.preventDefault();
});

function syncSidebar() {
  const open = layout.sidebar === "auto" ? !narrowLayout.matches : layout.sidebar === "open";
  setMapSidebarOpen(open);
}

function setMapSidebarOpen(open) {
  sidebar.hidden = !open;
  workspace.classList.toggle("sidebar-closed", !open);
  byId("toggle-sidebar").setAttribute("aria-expanded", String(open));
  byId("sidebar-icon").textContent = open ? "«" : "»";
}

function syncLanguage() {
  translatePage(layout.language);
  renderDataDates();
  languageSelect.value = layout.language;
  for (const tab of tabs) tab.querySelector(".preset-label").textContent = presetLabel(presets[tab.dataset.preset]);
  for (const [key, label] of visibilityLabels) {
    label.textContent = key in layerLabels ? tr(...layerLabels[key]) : presetLabel(presets[key]);
  }
  updateSearchPrompt();
  updateLayerLegend();
  updateSidebar();
  updatePlaceLabels();
  updatePinTitle();
  updateCityView();
  status.textContent = "";
  document.dispatchEvent(new Event("atlas-language-change"));
}

function saveLayout(key, value) {
  layout[key] = value;
  layoutQueue = layoutQueue.then(async () => {
    try {
      await request("/api/ustawienia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: { [key]: value } }),
      });
    } catch {
      status.textContent = tr("Nie udało się zapisać układu w ustawienia.csv.", "Could not save the layout to ustawienia.csv.");
      byId("main-settings-status").textContent = status.textContent;
    }
  });
}

byId("toggle-sidebar").addEventListener("click", () => {
  if (ready) saveLayout("sidebar", sidebar.hidden ? "open" : "closed");
  else layout.sidebar = sidebar.hidden ? "open" : "closed";
  syncSidebar();
});
narrowLayout.addEventListener("change", syncSidebar);
languageSelect.addEventListener("change", () => {
  saveLayout("language", languageSelect.value);
  syncLanguage();
});
syncSidebar();

async function start() {
  updateControls();
  try {
    const [data, rows, settings, continents, continentShapes, pins, readings] = await Promise.all([
      request("/mapa.json"), request("/api/odwiedzone"), request("/api/ustawienia"), request("/kontynenty.json"),
      request("/kontynenty-obrysy.json"), request("/api/pinezki"),
      request("/odczyt-nazw.json", { cache: "reload" }).catch(() => ({ byCountry: {}, byName: {} })),
    ]);
    placeReadings = readings;
    applyZoomRanges(settings);
    places.panstwo = data.panstwo.map(([id, name, path, x, y, code]) =>
      ({ id, name, path: new Path2D(path), x, y, code, category: "panstwo",
        searchText: normalize([name, englishRegion(code)].filter(Boolean).join(" ")) }));
    const geometries = new Map(continentShapes.features.map((feature) => [feature.properties.id, feature.geometry]));
    places.kontynent = continents.map(({ id, name, english, center }) => {
      const place = { id, name, original: english, category: "kontynent", path: projectedPolygon(geometries.get(id)),
        getPosition: () => center, searchText: normalize(name + " " + english) };
      continentsById.set(id, place);
      return place;
    });
    places.miasto = data.miasto.map(([id, name, x, y, rank, code, country, original, capital]) => {
      const region = /^[A-Z]{2}$/.test(code) ? regions.of(code) || country : country;
      return { id, name, original, x, y, rank, region, capital, country: code, category: "miasto",
        getPosition: () => cityPosition(x, y),
        searchText: normalize([name, original, region, englishRegion(code)].filter(Boolean).join(" ")) };
    });
    for (const place of places.miasto) {
      legacyCities.set(place.id, place);
      const name = normalize(place.name);
      legacyCities.set(name, legacyCities.has(name) ? null : place);
      if (place.capital) {
        capitalRecords.set(place.id, place);
        capitalAliases.set(normalize(place.original + " " + place.region), place.name);
      }
    }
    readMarked(rows);
    renderCustomPins(pins);
    ready = true;
    layout = { ...layout, ...settings.layout };
    savedOnline = Object.fromEntries(Object.keys(onlineLabels).map((key) => [key, layout[key] || "on"]));
    document.dispatchEvent(new CustomEvent("atlas-settings-loaded", { detail: settings }));
    syncSidebar();
    savedVisibility = settings.visibility;
    applyVisibility(savedVisibility);
    syncLanguage();
    try {
      cityContainer.hidden = false;
      openCityMap();
    } catch (error) {
      console.error(error);
      cityContainer.hidden = true;
      byId("map-hint").textContent = tr("WebGL jest niedostępny. Wyświetlam lokalny podkład państw.", "WebGL is unavailable. Showing the local country map.");
    }
    scheduleDraw();
  } catch {
    status.textContent = tr("Nie udało się wczytać mapy lub plików CSV. Odśwież stronę i spróbuj ponownie.", "Could not load the map or CSV files. Refresh the page to try again.");
  }
}

// Main settings use the same controls and save handlers as the map and challenges.
let mainSettingsMirrors = [];
const developerFillState = { preset: "countries", percentage: "10", status: "visited", busy: false, result: null, error: false, refreshFailed: false };
const developerProgressState = { loaded: false, loading: false, busy: false, achievementsUnlocked: false,
  challenge: "all", last: null, error: false };
function renderDeveloperTools(panel) {
  renderDeveloperFill(panel);
  panel.querySelector(".developer-progress-tools")?.remove();
  const tools = document.createElement("div");
  tools.className = "developer-progress-tools";
  const fields = document.createElement("fieldset");
  fields.disabled = !ready || developerFillState.busy || developerProgressState.busy || developerProgressState.loading;
  const heading = document.createElement("h4");
  heading.textContent = tr("Osiągnięcia", "Achievements");
  fields.append(heading);
  function actionButton(parent, text, handler, reset = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (reset) button.className = "developer-reset";
    button.addEventListener("click", handler);
    parent.append(button);
    return button;
  }
  const achievementActions = document.createElement("div");
  achievementActions.className = "developer-actions";
  actionButton(achievementActions, tr("Odblokuj wszystkie", "Unlock all"), () => runDeveloperProgress("achievements", "unlock"));
  const resetAchievements = actionButton(achievementActions, tr("Resetuj sztuczne odblokowania", "Reset developer unlocks"),
    () => runDeveloperProgress("achievements", "reset"), true);
  resetAchievements.disabled = !developerProgressState.loaded || !developerProgressState.achievementsUnlocked;
  fields.append(achievementActions);
  const challengeHeading = document.createElement("h4");
  challengeHeading.textContent = tr("Wyzwania", "Challenges");
  fields.append(challengeHeading);
  const label = document.createElement("label");
  const labelText = document.createElement("span");
  labelText.textContent = tr("Wyzwanie", "Challenge");
  const select = document.createElement("select");
  for (const [value, pl, en] of [["all", "Wszystkie wyzwania", "All challenges"], ["parks", "Polskie Parki Narodowe", "Polish National Parks"],
    ["bliza", "Wyzwanie Bliza", "Bliza Challenge"], ["islands", "Greckie wyspy", "Greek Islands"], ["hewelion", "Hewelion", "Hewelion"],
    ["castles", "Polskie zamki", "Polish Castles"]]) select.add(new Option(tr(pl, en), value));
  select.value = developerProgressState.challenge;
  select.addEventListener("change", () => { developerProgressState.challenge = select.value; });
  label.append(labelText, select);
  fields.append(label);
  const challengeActions = document.createElement("div");
  challengeActions.className = "developer-actions";
  actionButton(challengeActions, tr("Ukończ", "Complete"), () => runDeveloperProgress("challenges", "complete"));
  actionButton(challengeActions, tr("Resetuj", "Reset"), () => runDeveloperProgress("challenges", "reset"), true);
  fields.append(challengeActions);
  const message = document.createElement("p");
  message.className = "developer-fill-message";
  message.setAttribute("role", "status");
  if (developerProgressState.busy) message.textContent = tr("Zapisywanie…", "Saving…");
  else if (developerProgressState.error) message.textContent = tr("Nie udało się zmienić postępu.", "Could not update progress.");
  else if (developerProgressState.last) {
    const { kind, action } = developerProgressState.last;
    message.textContent = kind === "achievements"
      ? action === "unlock" ? tr("Wszystkie osiągnięcia odblokowane.", "All achievements unlocked.")
        : tr("Sztuczne odblokowania usunięte. Osiągnięcia z mapy zachowane.", "Developer unlocks removed. Earned achievements kept.")
      : action === "complete" ? tr("Wybrane wyzwania ukończone.", "Selected challenges completed.")
        : tr("Postęp wybranych wyzwań wyzerowany.", "Selected challenge progress reset.");
  }
  tools.append(fields, message);
  panel.append(tools);
  if (!developerProgressState.loaded && !developerProgressState.loading) {
    developerProgressState.loading = true;
    fields.disabled = true;
    request("/api/developer/progress").then((data) => {
      if (developerProgressState.achievementsUnlocked !== data.achievementsUnlocked) developerProgressState.last = null;
      developerProgressState.achievementsUnlocked = data.achievementsUnlocked;
      developerProgressState.error = false;
    }).catch(() => { developerProgressState.error = true; }).finally(() => {
      developerProgressState.loaded = true;
      developerProgressState.loading = false;
      const current = byId("settings-developer");
      if (current) renderDeveloperTools(current);
    });
  }
}

function runDeveloperProgress(kind, action) {
  if (developerProgressState.busy || developerFillState.busy || !ready) return;
  if (kind === "achievements" && action === "reset" && !developerProgressState.achievementsUnlocked) return;
  if (action === "reset" && !window.confirm(kind === "achievements"
    ? tr("Usunąć sztuczne odblokowania osiągnięć? Osiągnięcia z mapy zostaną zachowane.", "Remove developer achievement unlocks? Earned achievements will be kept.")
    : tr("Zresetować postęp wybranych wyzwań?", "Reset progress for the selected challenges?"))) return;
  const change = { kind, action, ...(kind === "challenges" ? { challenge: developerProgressState.challenge } : {}) };
  Object.assign(developerProgressState, { busy: true, last: null, error: false });
  renderDeveloperTools(byId("settings-developer"));
  visitQueue = visitQueue.then(async () => {
    try {
      const result = await request("/api/developer/progress", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
      });
      developerProgressState.achievementsUnlocked = result.achievementsUnlocked;
      developerProgressState.last = result;
      const tasks = [];
      document.dispatchEvent(new CustomEvent("atlas-developer-progress-change", { detail: { tasks, ...result } }));
      visitUpdates?.postMessage("developer-progress");
      await Promise.allSettled(tasks);
    } catch { developerProgressState.error = true; }
    finally {
      developerProgressState.busy = false;
      const current = byId("settings-developer");
      if (current) renderDeveloperTools(current);
    }
  });
}

function renderDeveloperFill(panel) {
  panel.querySelector(".developer-fill-form")?.remove();
  const form = document.createElement("form");
  form.className = "developer-fill-form";
  const heading = document.createElement("h4");
  heading.textContent = tr("Wypełnij mapę", "Fill map");
  const hint = document.createElement("p");
  hint.className = "developer-fill-hint";
  hint.textContent = tr("Procent dotyczy wybranego statusu. Dodawane są tylko puste miejsca.",
    "The percentage applies to the selected status. Only empty places are filled.");
  const fields = document.createElement("fieldset");
  fields.disabled = developerFillState.busy || developerProgressState.busy || !ready;
  const preset = document.createElement("select");
  for (const [id, view] of Object.entries(presets)) {
    if (!isSavedPreset(id)) preset.add(new Option(presetLabel(view), id));
  }
  preset.value = developerFillState.preset;
  const percentage = document.createElement("input");
  Object.assign(percentage, { type: "number", min: "0", max: "100", step: "0.1", required: true, value: developerFillState.percentage });
  const status = document.createElement("select");
  status.add(new Option(tr("Odwiedzone", "Visited"), "visited"));
  status.add(new Option(tr("Zaplanowane", "Planned"), "planned"));
  status.value = developerFillState.status;
  for (const [input, text, key] of [[preset, tr("Widok mapy", "Map view"), "preset"],
    [percentage, tr("Docelowe wypełnienie (%)", "Target fill (%)"), "percentage"],
    [status, tr("Status miejsc", "Place status"), "status"]]) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = text;
    label.append(name, input);
    fields.append(label);
    input.addEventListener("input", () => { developerFillState[key] = input.value; });
  }
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = developerFillState.busy ? tr("Wypełnianie…", "Filling…") : tr("Wypełnij", "Fill");
  fields.append(button);
  const message = document.createElement("p");
  message.className = "developer-fill-message";
  message.setAttribute("role", "status");
  const result = developerFillState.result;
  if (developerFillState.error) message.textContent = tr("Nie udało się wypełnić mapy.", "Could not fill the map.");
  else if (result) {
    const format = new Intl.NumberFormat(document.documentElement.lang);
    const statusLabel = result.status === "planned" ? tr("Zaplanowane", "Planned") : tr("Odwiedzone", "Visited");
    message.textContent = result.added
      ? tr(`Dodano: ${format.format(result.added)}. ${statusLabel}: ${format.format(result.filled)} / ${format.format(result.total)}.`,
        `Added: ${format.format(result.added)}. ${statusLabel}: ${format.format(result.filled)} / ${format.format(result.total)}.`)
      : result.remaining === 0 ? tr("Brak wolnych miejsc.", "No empty places left.")
        : tr("Docelowe wypełnienie już osiągnięte.", "Target fill already reached.");
    if (result.added && result.filled < result.target && result.remaining === 0) {
      message.textContent += tr(" Brak wolnych miejsc.", " No empty places left.");
    }
    if (developerFillState.refreshFailed) message.textContent += tr(" Odśwież stronę, aby zobaczyć zmiany.", " Refresh the page to see the changes.");
  }
  form.append(heading, hint, fields, message);
  panel.append(form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (developerFillState.busy || !form.reportValidity()) return;
    const change = { preset: preset.value, percentage: Number(percentage.value), status: status.value };
    Object.assign(developerFillState, { preset: preset.value, percentage: percentage.value, status: status.value,
      busy: true, result: null, error: false, refreshFailed: false });
    renderDeveloperTools(panel);
    visitQueue = visitQueue.then(async () => {
      try {
        const result = await request("/api/developer/fill-map", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
        });
        developerFillState.result = result;
        if (result.added) {
          visitUpdates?.postMessage("updated");
          try {
            readMarked(await request("/api/odwiedzone"));
            updateSidebar();
            scheduleDraw();
          } catch { developerFillState.refreshFailed = true; }
        }
      } catch { developerFillState.error = true; }
      finally {
        developerFillState.busy = false;
        const currentPanel = byId("settings-developer");
        if (currentPanel) renderDeveloperTools(currentPanel);
      }
    });
  });
}
let settingsScrollFrame;
function updateSettingsCategory() {
  settingsScrollFrame = undefined;
  if (byId("settings-view").hidden) return;
  const categories = [...byId("main-settings-categories").querySelectorAll(".main-settings-category")];
  if (!categories.length) return;
  const navigation = byId("settings-category-nav");
  const compact = matchMedia("(max-width: 760px)").matches;
  const boundary = compact ? navigation.getBoundingClientRect().bottom + 28 : 140;
  let current = categories[0];
  for (const category of categories) {
    if (category.getBoundingClientRect().top <= boundary) current = category;
  }
  if (window.scrollY + innerHeight >= document.documentElement.scrollHeight - 3) current = categories.at(-1);
  for (const button of navigation.children) {
    const active = button.getAttribute("aria-controls") === current.id;
    if (active && button.getAttribute("aria-current") !== "true") {
      button.setAttribute("aria-current", "true");
      if (compact) navigation.scrollLeft = button.offsetLeft - navigation.offsetLeft - 12;
    } else if (!active) button.removeAttribute("aria-current");
  }
}
function scheduleSettingsCategory() {
  if (!settingsScrollFrame) settingsScrollFrame = requestAnimationFrame(updateSettingsCategory);
}
window.addEventListener("scroll", scheduleSettingsCategory, { passive: true });
window.addEventListener("resize", scheduleSettingsCategory);
function syncMainSettings() {
  achievementNotificationInput.checked = achievementNotificationsEnabled();
  achievementNotificationInput.disabled = !ready;
  for (const [key, input] of onlineInputs) input.checked = onlineEnabled(key);
  for (const input of document.querySelectorAll("[data-online-setting], [data-visibility-setting]")) {
    const source = input.dataset.onlineSetting ? onlineInputs.get(input.dataset.onlineSetting) : visibilityInputs.get(input.dataset.visibilitySetting);
    input.checked = source.checked;
    const disabled = !ready || source.disabled;
    if (input.disabled !== disabled) input.disabled = disabled;
  }
  for (const { source, input, text, label } of mainSettingsMirrors) {
    if (source.type === "checkbox") input.checked = source.checked;
    else input.value = source.value;
    const disabled = !ready || source.disabled;
    if (input.disabled !== disabled) input.disabled = disabled;
    if (text && text.textContent !== label()) text.textContent = label();
  }
  const messages = ["visibility-message", "island-options-status", "castle-options-status"]
    .map((id) => byId(id).textContent).filter(Boolean);
  if (messages.length) byId("main-settings-status").textContent = messages.join(" ");
}

const transferState = { format: "csv", file: null, content: null, busy: false, journalFormat: "pdf", journalTitle: "" };
const importDialog = byId("progress-import-dialog");
const confirmImport = byId("confirm-progress-import");
const cancelImport = byId("cancel-progress-import");
cancelImport.addEventListener("click", () => importDialog.close());
importDialog.addEventListener("cancel", (event) => {
  if (transferState.busy) event.preventDefault();
});
byId("progress-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (transferState.busy || !transferState.content) return;
  transferState.busy = true;
  confirmImport.disabled = cancelImport.disabled = true;
  byId("progress-import-status").textContent = tr("Importowanie…", "Importing…");
  try {
    await visitQueue;
    await request("/api/import-postepu", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...transferState.content, potwierdzam: true }),
    });
    visitUpdates?.postMessage("reset");
    location.reload();
  } catch {
    transferState.busy = false;
    transferState.sync?.();
    confirmImport.disabled = cancelImport.disabled = false;
    byId("progress-import-status").textContent = tr("Import nie powiódł się. Dotychczasowy postęp został zachowany.", "Import failed. Your existing progress was kept.");
  }
});

function renderProgressTransfer(section) {
  const body = document.createElement("div");
  body.className = "progress-transfer";
  const exportLabel = document.createElement("label");
  const labelText = document.createElement("span");
  labelText.textContent = tr("Format eksportu", "Export format");
  const format = document.createElement("select");
  format.id = "progress-export-format";
  for (const [value, label] of [["csv", "CSV"], ["json", "JSON"], ["kml", "KML · Google My Maps"]]) format.add(new Option(label, value));
  format.value = transferState.format;
  format.addEventListener("change", () => { transferState.format = format.value; });
  exportLabel.append(labelText, format);
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.id = "export-progress";
  exportButton.textContent = tr("Eksportuj postęp", "Export progress");
  const hint = document.createElement("p");
  hint.className = "transfer-hint";
  hint.textContent = tr("CSV i JSON: pełna kopia postępu. KML: mapa dla Google My Maps; duże eksporty są dzielone na pliki w ZIP.", "CSV and JSON: full progress backup. KML: map for Google My Maps; large exports are split into files in a ZIP.");
  const journalDivider = document.createElement("hr");
  const journalHeading = document.createElement("h4");
  journalHeading.className = "transfer-journal-heading";
  journalHeading.textContent = tr("Dziennik podróży", "Travel journal");
  const journalHint = document.createElement("p");
  journalHint.className = "transfer-hint";
  journalHint.textContent = tr("Pamiątkowy pamiętnik z wycieczkami, wizytami i notatkami. Pełny dziennik, od najnowszych wpisów, niezależnie od filtrów.", "A keepsake with your trips, visits and notes. Your complete journal, newest entries first, regardless of filters.");
  const titleLabel = document.createElement("label");
  const titleText = document.createElement("span");
  titleText.textContent = tr("Tytuł pamiętnika", "Journal title");
  const journalTitle = document.createElement("input");
  journalTitle.type = "text";
  journalTitle.id = "journal-export-title";
  journalTitle.maxLength = 100;
  journalTitle.placeholder = tr("Dziennik podróży", "Travel journal");
  journalTitle.value = transferState.journalTitle;
  journalTitle.addEventListener("input", () => { transferState.journalTitle = journalTitle.value; });
  titleLabel.append(titleText, journalTitle);
  const journalFormatLabel = document.createElement("label");
  const journalFormatText = document.createElement("span");
  journalFormatText.textContent = tr("Format dziennika", "Journal format");
  const journalFormat = document.createElement("select");
  journalFormat.id = "journal-export-format";
  journalFormat.add(new Option("PDF", "pdf"));
  journalFormat.add(new Option("Word (.docx)", "docx"));
  journalFormat.value = transferState.journalFormat;
  journalFormat.addEventListener("change", () => { transferState.journalFormat = journalFormat.value; });
  journalFormatLabel.append(journalFormatText, journalFormat);
  const journalButton = document.createElement("button");
  journalButton.type = "button";
  journalButton.id = "export-journal";
  journalButton.textContent = tr("Pobierz dziennik", "Download journal");
  const divider = document.createElement("hr");
  const fileLabel = document.createElement("label");
  fileLabel.className = "transfer-file";
  const fileText = document.createElement("span");
  fileText.textContent = tr("Importuj kopię CSV lub JSON", "Import a CSV or JSON backup");
  const file = document.createElement("input");
  file.type = "file";
  file.id = "progress-import-file";
  file.accept = ".csv,.json";
  fileLabel.append(fileText, file);
  const filename = document.createElement("p");
  filename.className = "transfer-hint";
  filename.textContent = transferState.file?.name || "";
  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.id = "import-progress";
  importButton.textContent = tr("Importuj i zastąp postęp", "Import and replace progress");
  const warning = document.createElement("p");
  warning.className = "transfer-hint";
  warning.textContent = tr("Import zastąpi cały obecny postęp. Ustawienia urządzenia zostaną zachowane.", "Import replaces all current progress. Device settings are kept.");
  const status = document.createElement("p");
  status.className = "transfer-status";
  status.setAttribute("role", "status");
  function sync() {
    format.disabled = file.disabled = exportButton.disabled = !ready || transferState.busy;
    journalTitle.disabled = journalFormat.disabled = journalButton.disabled = !ready || transferState.busy;
    importButton.disabled = !ready || transferState.busy || !transferState.file;
  }
  transferState.sync = sync;
  async function downloadFile(url, fallback) {
    const response = await fetch(url);
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || fallback;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
  file.addEventListener("change", () => {
    transferState.file = file.files[0] || null;
    transferState.content = null;
    filename.textContent = transferState.file?.name || "";
    status.textContent = "";
    sync();
  });
  exportButton.addEventListener("click", async () => {
    if (transferState.busy) return;
    transferState.busy = true;
    sync();
    status.textContent = tr("Przygotowywanie eksportu…", "Preparing export…");
    try {
      await visitQueue;
      await downloadFile("/api/eksport?format=" + encodeURIComponent(transferState.format), "travel-tracker." + transferState.format);
      status.textContent = tr("Eksport gotowy.", "Export ready.");
    } catch {
      status.textContent = tr("Eksport nie powiódł się. Spróbuj ponownie.", "Export failed. Please try again.");
    } finally {
      transferState.busy = false;
      transferState.sync();
    }
  });
  journalButton.addEventListener("click", async () => {
    if (transferState.busy) return;
    transferState.busy = true;
    sync();
    status.textContent = tr("Tworzenie pamiętnika…", "Creating your journal…");
    try {
      await visitQueue;
      const params = new URLSearchParams({ format: transferState.journalFormat, language: document.documentElement.lang,
        title: transferState.journalTitle.trim() });
      await downloadFile("/api/eksport-dziennika?" + params, "travel-journal." + transferState.journalFormat);
      status.textContent = tr("Dziennik gotowy do pobrania.", "Your journal is ready to download.");
    } catch {
      status.textContent = tr("Nie udało się utworzyć dziennika. Spróbuj ponownie.", "Could not create your journal. Please try again.");
    } finally {
      transferState.busy = false;
      transferState.sync();
    }
  });
  importButton.addEventListener("click", async () => {
    if (transferState.busy || !transferState.file) return;
    transferState.busy = true;
    sync();
    status.textContent = tr("Sprawdzanie pliku…", "Checking file…");
    try {
      const selected = transferState.file;
      const extension = selected.name.split(".").pop().toLowerCase();
      if (!["csv", "json"].includes(extension) || selected.size > 64 * 1024 * 1024) throw new Error();
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer());
      transferState.content = { format: extension, content };
      const result = await request("/api/import-postepu", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...transferState.content, potwierdzam: false }),
      });
      byId("progress-import-preview").textContent = selected.name + " · " + tr("Liczba wpisów: ", "Records: ") + result.records;
      byId("progress-import-status").textContent = "";
      confirmImport.disabled = cancelImport.disabled = false;
      status.textContent = "";
      importDialog.showModal();
    } catch {
      transferState.content = null;
      status.textContent = tr("Nieprawidłowa kopia postępu. Wybierz CSV lub JSON wyeksportowany z aplikacji (maks. 64 MB). Nic nie zmieniono.", "Invalid backup. Choose a CSV or JSON exported from this app (max. 64 MB). Nothing was changed.");
    } finally {
      transferState.busy = false;
      transferState.sync();
    }
  });
  body.append(exportLabel, exportButton, hint, journalDivider, journalHeading, journalHint, titleLabel, journalFormatLabel,
    journalButton, divider, fileLabel, filename, importButton, warning, status);
  section.append(body);
  sync();
}

function renderMainSettings() {
  if (byId("settings-view").hidden) return;
  const container = byId("main-settings-categories");
  const navigation = byId("settings-category-nav");
  container.replaceChildren();
  navigation.replaceChildren();
  mainSettingsMirrors = [];
  const icons = {
    general: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c5 5 5 11 0 16-5-5-5-11 0-16Z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    views: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    other: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    progress: '<path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6m4-6v6"/>',
    transfer: '<path d="M8 3v13m-4-4 4 4 4-4m4 9V8m-4 4 4-4 4 4"/>',
    internet: '<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1"/>',
    developer: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    journal: '<path d="M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4V4Zm9 3a3 3 0 0 1 3-3h5v14h-5a3 3 0 0 0-3 3"/>',
  };
  function icon(id) {
    const element = document.createElement("span");
    element.className = "settings-icon";
    element.setAttribute("aria-hidden", "true");
    element.innerHTML = '<svg viewBox="0 0 24 24">' + icons[id] + '</svg>';
    return element;
  }
  function category(id, pl, en, descriptionPl, descriptionEn) {
    const section = document.createElement("section");
    section.className = "main-settings-category";
    section.dataset.settingsCategory = id;
    section.id = "settings-" + id;
    const header = document.createElement("header");
    header.className = "settings-section-heading";
    const title = document.createElement("div");
    const heading = document.createElement("h3");
    heading.tabIndex = -1;
    heading.textContent = tr(pl, en);
    const description = document.createElement("p");
    description.className = "settings-section-description";
    description.textContent = tr(descriptionPl, descriptionEn);
    title.append(heading, description);
    header.append(icon(id), title);
    section.append(header);
    container.append(section);
    const button = document.createElement("button");
    button.type = "button";
    button.append(icon(id), document.createTextNode(tr(pl, en)));
    button.setAttribute("aria-controls", section.id);
    if (id === "general") button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => {
      for (const item of navigation.children) item.removeAttribute("aria-current");
      button.setAttribute("aria-current", "true");
      section.scrollIntoView({ block: "start", behavior: "instant" });
      heading.focus({ preventScroll: true });
    });
    navigation.append(button);
    return section;
  }
  function mirror(section, source, label, description = "") {
    const row = document.createElement("label");
    const input = source.cloneNode(true);
    input.removeAttribute("id");
    const text = document.createElement("span");
    const copy = document.createElement("span");
    copy.className = "settings-field-copy";
    copy.append(text);
    if (description) {
      const hint = document.createElement("small");
      hint.textContent = description;
      copy.append(hint);
    }
    row.append(copy, input);
    input.addEventListener("change", () => {
      byId("main-settings-status").textContent = "";
      if (source.type === "checkbox") source.checked = input.checked;
      else source.value = input.value;
      source.dispatchEvent(new Event("change", { bubbles: true }));
      syncMainSettings();
    });
    mainSettingsMirrors.push({ source, input, text, label });
    section.append(row);
  }
  const general = category("general", "Język i układ", "Language and layout", "", "");
  mirror(general, languageSelect, () => tr("Język", "Language"));
  const sidebarLabel = document.createElement("label");
  const sidebarText = document.createElement("span");
  sidebarText.textContent = tr("Panel boczny mapy", "Map sidebar");
  const sidebarSetting = document.createElement("select");
  for (const [value, pl, en] of [["auto", "Automatycznie", "Automatic"], ["open", "Otwarty", "Open"], ["closed", "Schowany", "Hidden"]]) {
    sidebarSetting.add(new Option(tr(pl, en), value));
  }
  sidebarSetting.value = layout.sidebar;
  sidebarSetting.disabled = !ready;
  sidebarSetting.addEventListener("change", () => {
    byId("main-settings-status").textContent = "";
    saveLayout("sidebar", sidebarSetting.value);
    syncSidebar();
  });
  sidebarLabel.append(sidebarText, sidebarSetting);
  general.append(sidebarLabel);
  renderProgressTransfer(category("transfer", "Import i eksport", "Import and export", "", ""));
  const internet = category("internet", "Internet", "Internet", "Wyłącz te opcje, aby korzystać offline.", "Turn these options off to use the app offline.");
  const disableOnline = document.createElement("button");
  disableOnline.type = "button";
  disableOnline.className = "disable-online";
  disableOnline.textContent = tr("Wyłącz wszystkie", "Turn off all");
  disableOnline.disabled = !ready;
  disableOnline.addEventListener("click", () => {
    byId("main-settings-status").textContent = "";
    saveOnlineSettings(Object.fromEntries(Object.keys(onlineLabels).map((key) => [key, "off"])), true);
  });
  internet.append(disableOnline);
  mirror(internet, visibilityInputs.get("forests"), () => tr("Lasy", "Forests"), tr("Mapa i parki narodowe.", "Map and national parks."));
  for (const [key, input] of onlineInputs) {
    const description = key === "online_water"
      ? tr("Po wyłączeniu rzeki i jeziora są mniej szczegółowe.", "Rivers and lakes are less detailed when turned off.")
      : tr("Bez tej opcji mapa jest mniej szczegółowa.", "The map is less detailed when turned off.");
    mirror(internet, input, () => tr(...onlineLabels[key]), description);
  }
  const layers = category("layers", "Warstwy mapy", "Map layers", "", "");
  const views = category("views", "Widoki mapy", "Map views", "", "");
  for (const [key, input] of visibilityInputs) {
    mirror(key in layerLabels ? layers : views, input, () => visibilityLabels.get(key).textContent);
  }
  const other = category("other", "Pozostałe", "Other", "", "");
  const islandsHeading = document.createElement("h4");
  islandsHeading.className = "settings-subheading";
  islandsHeading.textContent = tr("Greckie wyspy", "Greek islands");
  other.append(islandsHeading);
  mirror(other, byId("enable-cyprus"), () => tr("Cypr", "Cyprus"), tr("Nie wlicza się do postępu.", "Does not count towards progress."));
  const castlesHeading = document.createElement("h4");
  castlesHeading.className = "settings-subheading";
  castlesHeading.textContent = tr("Polskie zamki", "Polish castles");
  other.append(castlesHeading);
  for (const input of byId("castle-options-categories").querySelectorAll("input")) {
    mirror(other, input, () => input.parentElement.querySelector("span").textContent);
  }
  const journal = category("journal", "Dziennik", "Journal", "Widoczne typy wpisów.", "Visible entry types.");
  for (const input of byId("diary-filter-options").querySelectorAll("input")) {
    mirror(journal, input, () => input.parentElement.querySelector("span").textContent);
  }
  const notifications = category("notifications", "Powiadomienia", "Notifications", "", "");
  mirror(notifications, achievementNotificationInput, () => tr("Powiadomienia o osiągnięciach", "Achievement notifications"),
    tr("Pokazuj zdobyte osiągnięcia w prawym górnym rogu.", "Show newly unlocked achievements in the top-right corner."));
  const progress = category("progress", "Dane i postęp", "Data and progress", "Reset wymaga potwierdzenia.", "Reset requires confirmation.");
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "reset-progress";
  reset.textContent = tr("Zresetuj cały postęp", "Reset all progress");
  reset.disabled = !ready;
  reset.setAttribute("aria-haspopup", "dialog");
  reset.addEventListener("click", openProgressReset);
  progress.append(reset);
  if (layout.developer_panel === "on") renderDeveloperTools(category("developer", "Panel developerski", "Developer panel", "", ""));
  byId("settings-code").disabled = !ready;
  byId("settings-code-unlock").disabled = !ready;
  syncMainSettings();
  scheduleSettingsCategory();
}

byId("settings-code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = byId("settings-code");
  const button = byId("settings-code-unlock");
  const message = byId("settings-code-message");
  if (!ready || button.disabled) return;
  if (input.value.trim() !== "Travel Tracker") {
    message.textContent = tr("Nieprawidłowy kod.", "Incorrect code.");
    return;
  }
  button.disabled = true;
  message.textContent = "";
  layoutQueue = layoutQueue.then(async () => {
    try {
      const response = await request("/api/ustawienia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: { developer_panel: "on" } }),
      });
      layout.developer_panel = response.layout.developer_panel;
      input.value = "";
      renderMainSettings();
      message.textContent = tr("Panel developerski odblokowany.", "Developer panel unlocked.");
    } catch {
      message.textContent = tr("Nie udało się zapisać ustawienia. Spróbuj ponownie.", "Could not save the setting. Please try again.");
    } finally {
      button.disabled = false;
    }
  });
});
for (const input of document.querySelectorAll("[data-online-setting], [data-visibility-setting]")) {
  input.addEventListener("change", () => {
    const source = input.dataset.onlineSetting ? onlineInputs.get(input.dataset.onlineSetting) : visibilityInputs.get(input.dataset.visibilitySetting);
    const message = input.closest("dialog")?.querySelector('[role="status"]');
    if (message) message.textContent = "";
    source.checked = input.checked;
    source.dispatchEvent(new Event("change", { bubbles: true }));
    syncMainSettings();
    visibilityQueue.then(() => { if (message) message.textContent = visibilityMessage.textContent; });
  });
}
for (const button of document.querySelectorAll("[data-main-settings]")) {
  button.addEventListener("click", () => {
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
    showSection("settings-view");
    byId("main-settings-title").focus();
  });
}
document.addEventListener("atlas-settings-sync", syncMainSettings);
document.addEventListener("atlas-language-change", renderMainSettings);
const settingsObserver = new MutationObserver(syncMainSettings);
for (const id of ["visibility-settings", "island-options", "castle-options"]) {
  settingsObserver.observe(byId(id), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
}

translatePage(layout.language);
if (location.protocol !== "file:") start();
