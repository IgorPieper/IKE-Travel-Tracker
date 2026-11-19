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

test('detailed streets load only for opted-in localities and are removed when leaving', () => {
  let enabled=false;
  const layers=new Map(), sources=new Map();
  const area={category:'miasto',bounds:[18,54,19,55]};
  const state={area};
  const context=vm.createContext({areaFocus:state, onlineEnabled:()=>enabled,statusColor:()=> 'transparent',
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
  state.area={category:'panstwo'};
  context.syncFocusDetailMap();
  assert.equal(sources.size,0);
  assert.equal(layers.size,0);
});
