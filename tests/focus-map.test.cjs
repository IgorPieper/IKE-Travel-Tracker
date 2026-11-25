const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../web/js/obszar.js'), 'utf8');
const geometry = { type: 'Polygon', coordinates: [ [[0,0],[10,0],[10,10],[0,10],[0,0]], [[4,4],[6,4],[6,6],[4,6],[4,4]] ] };

test('focus excludes neighbouring areas and holes, including multipolygons', () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function areaContainsPoint('), source.indexOf('function focusContains(')), context);
  assert.equal(context.areaContainsPoint(geometry, [2,2]), true);
  assert.equal(context.areaContainsPoint(geometry, [12,2]), false);
  assert.equal(context.areaContainsPoint(geometry, [5,5]), false);
  assert.equal(context.areaContainsPoint({type:'MultiPolygon',coordinates:[geometry.coordinates,[[[20,0],[22,0],[22,2],[20,2],[20,0]]]]}, [21,1]), true);
});

test('area selection consumes clicks without marking, including a follow-up double click', () => {
  let selected = 0;
  const state = { selecting: true, loading: false, ignoreUntil: 0 };
  const context = vm.createContext({ areaFocus: state, Date: { now: () => 1000 }, selectFocusArea: () => { selected++; state.selecting=false; state.loading=true; } });
  vm.runInContext(source.slice(source.indexOf('function consumeFocusSelection('),source.indexOf('function leaveAreaFocus(')),context);
  assert.equal(context.consumeFocusSelection({id:'country'}), true);
  assert.equal(selected,1);
  assert.equal(context.consumeFocusSelection({id:'country'}),true);
  assert.equal(selected,1);
  state.loading=false;
  state.ignoreUntil=1500;
  assert.equal(context.consumeFocusSelection({id:'country'}),true);
  state.ignoreUntil=0;
  assert.equal(context.consumeFocusSelection({id:'city'}),false);
});

test('focus search allows countries, regions with capitals, or cities with optional villages', () => {
  const context=vm.createContext({capitalRecords:new Map([['capital',{}]]),cityPosition:(x,y)=>[x,y]});
  vm.runInContext(source.slice(source.indexOf('const areaFocus ='),source.indexOf('function updateFocusHint(')),context);
  context.geometry={type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]]]};
  context.place={category:'miasto',id:'city',getPosition:()=>[2,2]};
  const evaluate=text=>vm.runInContext(text,context);
  evaluate("areaFocus.area={category:'kontynent',feature:{geometry}};");
  assert.equal(evaluate('focusPlaceAllowed(place)'),false);
  context.place.category='panstwo';
  assert.equal(evaluate('focusPlaceAllowed(place)'),true);
  evaluate("areaFocus.area.category='panstwo';");
  context.place.category='miasto';
  assert.equal(evaluate('focusPlaceAllowed(place)'),false);
  context.place.id='capital';
  assert.equal(evaluate('focusPlaceAllowed(place)'),true);
  evaluate("areaFocus.area.category='rejon';");
  context.place.id='city';
  assert.equal(evaluate('focusPlaceAllowed(place)'),true);
  context.place.id='simc:0000001';
  assert.equal(evaluate('focusPlaceAllowed(place)'),false);
  evaluate('areaFocus.villages=true;');
  assert.equal(evaluate('focusPlaceAllowed(place)'),true);
});


test('countries without regions offer their subregions and capitals directly', () => {
  const c=vm.createContext({capitalRecords:new Map([['capital',{}]])});
  vm.runInContext(source.slice(source.indexOf('const areaFocus ='),source.indexOf('function updateFocusHint(')),c);
  c.geometry=geometry;
  const evaluate=text=>vm.runInContext(text,c);
  evaluate("areaFocus.area={category:'panstwo',country:'LV',division_level:'subregion',feature:{geometry}};");
  assert.equal(evaluate('focusShowsSubregions()'),true);
  c.place={category:'rejon',id:'municipality',level:'subregion',getPosition:()=>[2,2]};
  assert.equal(evaluate('focusPlaceAllowed(place)'),true);
  c.place.level='region';assert.equal(evaluate('focusPlaceAllowed(place)'),false);
  c.place={category:'miasto',id:'capital',getPosition:()=>[2,2]};assert.equal(evaluate('focusPlaceAllowed(place)'),true);
});

test('region focus independently permits cities, villages and only its own subregions', () => {
  const c=vm.createContext({capitalRecords:new Map()});
  vm.runInContext(source.slice(source.indexOf('const areaFocus ='),source.indexOf('function updateFocusHint(')),c);
  c.geometry=geometry;
  const evaluate=text=>vm.runInContext(text,c);
  evaluate("areaFocus.area={category:'rejon',id:'parent',feature:{geometry}}; areaFocus.cities=false; areaFocus.villages=true; areaFocus.subregions=true;");
  c.place={category:'miasto',id:'city',getPosition:()=>[2,2]};
  assert.equal(evaluate('focusPlaceAllowed(place)'),false);
  c.place.id='simc:1';assert.equal(evaluate('focusPlaceAllowed(place)'),true);
  c.place={category:'rejon',id:'child',level:'subregion',parent_id:'parent',getPosition:()=>[2,2]};
  assert.equal(evaluate('focusPlaceAllowed(place)'),true);
  c.place.parent_id='neighbor';assert.equal(evaluate('focusPlaceAllowed(place)'),false);
  c.place.parent_id='parent';evaluate('areaFocus.subregions=false;');assert.equal(evaluate('focusPlaceAllowed(place)'),false);
});

test('arming magnifier in an existing focus preserves its area and camera', () => {
  const area = { id: 'africa' };
  const state = { area, selecting:false, loading:false };
  const context = vm.createContext({areaFocus:state, pendingMapClick:undefined,
    setPinPlacement:()=>{}, syncAreaFocusUi:()=>{}, updateCityView:()=>{}});
  vm.runInContext(source.slice(source.indexOf('function setAreaSelection('),source.indexOf('async function selectFocusArea(')),context);
  context.setAreaSelection(true);
  assert.equal(state.area,area);
  assert.equal(state.selecting,true);
});

test('full-area view becomes the zoom-out and pan limit, recalculated for each focus', () => {
  const calls=[], range={min:0,max:19};
  const state={area:{bounds:[-25,-47,58,38],camera_bounds:[-18,-35,52,38]}};
  let zoom=3, minimum=0;
  const frame=[[-60,-40],[90,45]];
  const context=vm.createContext({areaFocus:state,mapZoomRange:range,
    cityMap:{setMaxBounds:value=>calls.push(['max',value]),resize:()=>{},
      setMinZoom:value=>{minimum=value;calls.push(['min',value]);},getZoom:()=>zoom,
      getCenter:()=>({toArray:()=>[17,5]}), getBounds:()=>({toArray:()=>frame}),
      jumpTo:camera=>calls.push(['restore',camera]),
      fitBounds:(extent,options)=>calls.push(['fit',extent,options])}});
  vm.runInContext(source.slice(source.indexOf('function fitFocusedArea('),source.indexOf('function syncFocusDetailMap(')),context);
  context.fitFocusedArea();
  assert.deepEqual(calls[0],['max',null]);
  assert.equal(minimum,3);
  assert.equal(range.min,3);
  assert.deepEqual(calls.at(-1),['max',frame]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call=>call[0]==='fit')[1])),[[-18,-35],[52,38]]);
  // A nested focus replaces the previous limit, while resize preserves a closer camera.
  state.area={bounds:[14,49,24,55]};
  zoom=5;
  context.fitFocusedArea(true);
  assert.equal(minimum,5);
  assert.equal(calls.at(-1)[0],'restore');
  assert.equal(calls.at(-1)[1].zoom,5);
});

test('back removes one magnifier level and restores its camera and layer choices before returning to the main map', () => {
  const parent={id:'region',category:'rejon'},country={id:'country',category:'panstwo'};
  const regionSnapshot={area:parent,place:{id:'region'},cities:false,villages:true,subregions:true,
    category:'miasto',view:{x:2,y:3,zoom:64},center:[18,54],zoom:8};
  const countrySnapshot={...regionSnapshot,area:country,place:{id:'country'},cities:true,villages:false,subregions:false,center:[19,52],zoom:5};
  const calls=[],state={area:{id:'city'},history:[countrySnapshot,regionSnapshot],controller:{abort:()=>calls.push('abort')}};
  const c=vm.createContext({areaFocus:state,areaFocusActive:()=>Boolean(state.area),category:'miasto',view:{},search:{value:'city'},
    mapZoomRange:{min:4},cityMap:{jumpTo:camera=>calls.push(camera)},
    leaveAreaFocus:()=>{calls.push('main');state.area=null;},
    closePlaceDetails:()=>{},closePinEditor:()=>{},showHover:()=>{},syncAreaFocusUi:()=>{},updateSearchPrompt:()=>{},
    fitFocusedArea:()=>{},schedulePlaceSearch:()=>{},refreshPreset:()=>{},updateSidebar:()=>{},scheduleDraw:()=>{}});
  vm.runInContext(source.slice(source.indexOf('function backAreaFocus('),source.indexOf('function syncAreaFocusLayers(')),c);
  c.backAreaFocus();assert.equal(state.area,parent);assert.equal(state.history.length,1);
  assert.equal(state.cities,false);assert.equal(state.villages,true);assert.equal(state.subregions,true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))),{center:[18,54],zoom:8});assert.equal(c.search.value,'');
  c.backAreaFocus();assert.equal(state.area,country);assert.equal(state.history.length,0);
  c.backAreaFocus();assert.equal(calls.at(-1),'main');
});

test('detailed streets support all magnifier levels and are removed when leaving or disabled', () => {
  let enabled=false;
  const layers=new Map(), sources=new Map();
  const area={category:'miasto',bounds:[18,54,19,55]};
  const state={area,details:true};
  const context=vm.createContext({areaFocus:state, onlineEnabled:()=>enabled,focusDetailedActive:()=>Boolean(state.area&&state.details&&enabled),statusColor:()=> 'transparent',
    cityMap:{getLayer:id=>layers.get(id),getSource:id=>sources.get(id),
      addSource:(id,value)=>sources.set(id,value),removeSource:id=>sources.delete(id),
      addLayer:layer=>layers.set(layer.id,layer),removeLayer:id=>layers.delete(id),moveLayer:()=>{}}});
  vm.runInContext(source.slice(source.indexOf('function syncFocusDetailMap('),source.indexOf('function consumeFocusSelection(')),context);
  context.syncFocusDetailMap();
  assert.equal(sources.size,0);
  enabled=true;
  context.syncFocusDetailMap();
  assert.equal(sources.get('area-focus-streets').tiles[0],'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.deepEqual(sources.get('area-focus-streets').bounds,area.bounds);
  assert.equal(layers.has('area-focus-status'),true);
  for(const category of ['panstwo','rejon','kontynent']) {
    state.area={category,bounds:[14,49,24,55]};context.syncFocusDetailMap();
    assert.equal(layers.has('area-focus-streets'),true);
  }
  state.area=null;
  context.syncFocusDetailMap();
  assert.equal(sources.size,0);
  assert.equal(layers.size,0);
});

test('zoom resets detailed mode at higher levels while the locality level keeps its choice',()=>{
  let refreshes=0;
  const state={area:{category:'rejon'},details:true};
  const c=vm.createContext({areaFocus:state,basemapReady:true,syncAreaFocusUi:()=>{},syncAreaFocusLayers:()=>refreshes++});
  vm.runInContext(source.slice(source.indexOf('function resetHigherFocusDetail('),source.indexOf('function syncFocusDetailMap(')),c);
  c.resetHigherFocusDetail();assert.equal(state.details,false);assert.equal(refreshes,1);
  state.area={category:'miasto'};state.details=true;c.resetHigherFocusDetail();assert.equal(state.details,true);
});
