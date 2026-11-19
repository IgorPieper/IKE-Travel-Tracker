const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(preset, focusCategory = null, villages = false) {
  const source = fs.readFileSync(path.join(__dirname, '../web/js/mapa.js'), 'utf8');
  const filters = {}, paints = {}, sources = {}, shown = {}, zoomRanges = {};
  const rows = ['panstwo', 'rejon', 'miasto', 'kontynent'].flatMap(category => [
    { kategoria: category, id: category + '-visited', nazwa: 'Visited', tryb: 'auto' },
    { kategoria: category, id: category + '-planned', nazwa: 'Planned', tryb: 'plan' },
  ]);
  const context = vm.createContext({
    activePreset: preset, markingsHidden:false, compactCountries:new Set(['SM']), places:{panstwo:[]}, savedRows: rows, tr:(pl,en)=>en, layout:{},tabs:[],byId:()=>({classList:{toggle:()=>{}}}), visitColor: 'purple', planColor: 'orange',
    areaFocusActive: () => Boolean(focusCategory), syncAreaFocusLayers: () => {},
    focusShowsCountries: () => focusCategory === 'kontynent',
    focusShowsRegions: () => focusCategory === 'panstwo',
    focusShowsCities: () => ['rejon','miasto'].includes(focusCategory),
    focusShowsVillages: () => focusCategory === 'rejon' && villages,
    cityMap: { getLayer: () => ({}), setFilter: (id, value) => filters[id] = value,
      getFilter: id => filters[id], setLayerZoomRange:(id,min,max)=>zoomRanges[id]=[min,max],
      setPaintProperty: (id, property, value) => paints[id + ':' + property] = value,
      getSource: id => ({ setData: value => sources[id] = value }), getZoom: () => 2 },
    visibility: { capitals: true, warnings: true, seas: false, rivers: true, lakes: true },
    savedCityPosition: () => [20, 50], isMajorCity: () => false,
    markerLayer: source => source + '-markers',
    viewportInsidePoland: () => false, visibleWorldBounds: () => [-180, -80, 180, 80],
    polishViewport: () => null, containsBounds: () => false, worldCitiesView: {}, loadedVillageBounds: null,
    setLayerVisible: (id, value) => shown[id] = value, loadRegions: () => {},
    presetShowsWater: () => false, mapColors: { lake: 'blue' },
    cityZoom: 9, villageZoom: 11, regionZoom:4, majorCityZoom:6,
    settlementViewportFits: bounds => bounds[2]-bounds[0]<=2.5 && bounds[3]-bounds[1]<=2, addOverview: () => {},
  });
  for (const id of ['polishCityLayer', 'polishMajorLayer', 'cityLayer', 'overviewCities', 'villageLayer', 'overviewVillages',
    'visitedPlaceLayer', 'majorCityLayer', 'villageSource', 'visitedCountryLayer', 'countryFillLayer', 'continentFillLayer',
    'continentOutlineLayer', 'capitalLayer', 'regionLayer', 'visitedRegionLayer', 'visitedCitiesSource', 'warningLayer', 'visitedPinLayer']) context[id] = id;
  const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  vm.runInContext(block('const defaultPresets =', 'const layerLabels =')
    + block('const isSavedPreset =', '// U.S. Department')
    + block('function statusColor(', 'function getRegionCatalogue(')
    + block('function paintCityPins(', 'function pinImage(')
    + block('function renderZoom(', 'function setLayerVisible('), context);
  return { context, filters, paints, sources, shown, zoomRanges };
}

test('regions keep compact countries whole and restore the country filter when changing views', () => {
  const {context:c,filters,shown}=setup('regions');
  c.places.panstwo=[{id:'san-marino',code:'SM'},{id:'poland',code:'PL'}];
  c.syncVisitedCountries();c.syncPresetLayers();
  assert.equal(shown.countryFillLayer,true);
  assert.deepEqual(Array.from(filters.countryFillLayer[2][2][1]),['san-marino']);
  c.activePreset='countries';c.syncVisitedCountries();
  assert.equal(JSON.stringify(filters.countryFillLayer),JSON.stringify(['==',['get','kind'],'country']));
});

test('compact country districts are excluded from the shared region catalogue',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
  const data=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'../data/maps/rejony.json.gz'))));
  assert.ok(data.features.some(f=>f.properties.country==='SM'));
  const c=vm.createContext({request:async()=>data,regionCatalogueRequest:undefined});
  vm.runInContext(source.slice(source.indexOf('const compactCountries ='),source.indexOf('const presetLabel ='))+
    source.slice(source.indexOf('function getRegionCatalogue('),source.indexOf('function loadRegions(')),c);
  const result=await c.getRegionCatalogue();
  assert.ok(!result.features.some(f=>['SM','MC','VA','LI','AD','MT'].includes(f.properties.country)));
  assert.equal(result.features.filter(f=>f.properties.country==='PL').length,data.features.filter(f=>f.properties.country==='PL').length);
});

test('saved-only presets retain the combined view and filter both statuses consistently', () => {
  for (const [preset, suffixes] of [['visited', ['visited', 'planned']], ['visited-only', ['visited']], ['planned-only', ['planned']]]) {
    const { context: c, filters, paints, sources, shown } = setup(preset);
    c.paintVisits(); c.syncVisitedCountries(); c.syncCapitalOutlines(); c.paintRegions(); c.paintCityPins(); c.syncPresetLayers();
    const ids = category => suffixes.map(suffix => category + '-' + suffix);
    const plain = value => JSON.parse(JSON.stringify(value));
    assert.deepEqual(plain(filters.visitedPlaceLayer[2][1]), ids('miasto'));
    assert.deepEqual(plain(filters.visitedCountryLayer[2][2][1]), ids('panstwo'));
    assert.deepEqual(plain(filters.visitedRegionLayer[2][1]), ids('rejon'));
    assert.deepEqual(plain(filters.capitalLayer[2][1]), ids('miasto'));
    assert.deepEqual(plain(sources.visitedCitiesSource.features.map(feature => feature.properties.id)), ids('miasto'));
    assert.equal(c.rowInSavedPreset({ kategoria: 'kontynent', tryb: '' }), false);
    assert.equal(c.rowInSavedPreset({ kategoria: 'kontynent', tryb: 'plan' }), false);
    assert.equal(shown.countries, true);
    assert.equal(shown.visitedPlaceLayer, true);
    assert.equal(shown.visitedRegionLayer, true);
    assert.equal(shown.visitedPinLayer, true);
    assert.equal(shown.cityLayer, false);
    assert.equal(shown.warningLayer, false);
    const fill = paints['visitedCountryLayer:fill-color'];
    assert.deepEqual(plain(fill[1][2][1]), suffixes.includes('visited') ? ['panstwo-visited'] : []);
    assert.deepEqual(plain(fill[3][2][1]), suffixes.includes('planned') ? ['panstwo-planned'] : []);
  }
});

test('switching back to ordinary views restores both statuses and all capital outlines', () => {
  const { context: c, filters, sources } = setup('planned-only');
  c.paintCityPins(); c.syncCapitalOutlines();
  c.activePreset = 'countries';
  c.paintCityPins(); c.syncCapitalOutlines();
  assert.equal(sources.visitedCitiesSource.features.length, 2);
  assert.equal(filters.capitalLayer, null);
  assert.equal(vm.runInContext("isSavedPreset('visited-only')", c), true);
  assert.equal(vm.runInContext("isSavedPreset('planned-only')", c), true);
  assert.equal(vm.runInContext("isSavedPreset('countries')", c), false);
});

test('focus hierarchy respects density thresholds and villages still require opt-in', () => {
  for (const zoom of [2, 15]) for (const [category, villages, countries, regions, cities] of [
    ['kontynent', false, true, false, false], ['panstwo', false, false, true, false],
    ['rejon', false, false, false, true], ['rejon', true, false, false, true],
  ]) {
    const { context: c, shown } = setup('countries',category,villages);
    c.cityMap.getZoom=()=>zoom;
    c.visibleWorldBounds=()=>zoom>=9?[18,52,19,53]:[-180,-80,180,80];
    c.syncPresetLayers();
    assert.equal(shown.countryFillLayer,countries);
    assert.equal(shown.regionLayer,regions && zoom>=4);
    assert.equal(shown.polishCityLayer,cities && zoom>=9);
    assert.equal(shown['area-capital-fill'],category==='panstwo');
    assert.equal(shown['area-capital-pins'],category==='panstwo');
    assert.equal(shown.overviewVillages,false);
    assert.equal(shown['visited-village-pins'],false);
    assert.equal(shown.visitedPinLayer,cities);
  }
});


test('capitals view keeps boundaries and limits red pins to distant zooms', () => {
  for (const zoom of [0, 7, 15]) {
    const {context:c,shown,filters,zoomRanges}=setup('capital-cities');
    c.cityMap.getZoom=()=>zoom;
    c.syncPresetLayers();
    assert.equal(shown['area-capital-fill'],true);
    assert.equal(shown['area-capital-pins'],true);
    assert.equal(shown.capitalLayer,true);
    for (const layer of ['polishCityLayer','polishMajorLayer','majorCityLayer','cityLayer','villageLayer','overviewCities','overviewVillages','visited-major-city-pins'])
      assert.equal(shown[layer],false,layer);
    assert.equal(shown.countries,true);
    assert.equal(filters['area-capital-pins'],null);
    assert.deepEqual(zoomRanges['area-capital-pins'],[0,9]);
  }
});


test('capital search includes boundary and fallback capitals and excludes other towns', () => {
  const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
  const outline={id:'warsaw',name:'Warsaw',region:'Poland'};
  const fallback={id:'capital-without-outline',name:'Fallback capital',region:'Country'};
  const context=vm.createContext({activePreset:'capital-cities',areaFocusActive:()=>false,
    capitalOutlines:new Map([['warsaw',outline]]),capitalRecords:new Map([['old-warsaw',{id:'old-warsaw',name:'Warsaw',region:'Poland'}],['capital-without-outline',fallback]]),
    capitalOutlineNames:new Set(['warsaw poland']),normalize:text=>text.toLowerCase()});
  vm.runInContext(source.slice(source.indexOf('function isCapitalCity('),source.indexOf('function syncPresetLayers(')),context);
  assert.equal(context.placeInPreset({id:'warsaw'}),true);
  assert.equal(context.placeInPreset({id:'capital-without-outline'}),true);
  assert.equal(context.placeInPreset({id:'krakow'}),false);
  assert.deepEqual(JSON.parse(JSON.stringify(context.capitalLocations().map(place=>place.id))),['warsaw','capital-without-outline']);
});


test('distant city and village views keep saved places while hiding bulk outlines',()=>{
  for(const preset of ['cities','settlements','major']) {
    const {context:c,shown,filters}=setup(preset);
    c.paintVisits();c.syncPresetLayers();
    for(const layer of ['polishCityLayer','polishMajorLayer','majorCityLayer','cityLayer','overviewCities','villageLayer','overviewVillages'])
      assert.equal(shown[layer],false,layer);
    assert.equal(shown.visitedPlaceLayer,true);
    assert.equal(shown.visitedPinLayer,true);
    assert.ok(filters.visitedPlaceLayer);
  }
});
