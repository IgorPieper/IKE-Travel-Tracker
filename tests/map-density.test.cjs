const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
function setup(preset='cities') {
  const requests=[],state={zoom:0,bounds:[18,52,19,53],aborted:0};
  const context=vm.createContext({activePreset:preset,cityZoom:9,villageZoom:11,regionZoom:4,majorCityZoom:6,
    areaFocusActive:()=>false,isSavedPreset:()=>['visited','visited-only','planned-only'].includes(context.activePreset),
    tr:(pl,en)=>en,cityMap:{getZoom:()=>state.zoom,getSource:()=>({setData:()=>{}})},
    visibleWorldBounds:()=>state.bounds,settlementViewportFits:b=>b[2]-b[0]<=2.5&&b[3]-b[1]<=2,
    viewportInsidePoland:()=>false,mapBounds:()=>state.bounds,polishViewport:b=>b,
    containsBounds:()=>false,worldCitySource:'cities',villageSource:'villages',worldCitiesView:{},loadedVillageBounds:null,villageBoundsRequest:undefined,
    AbortController,request:async url=>{requests.push(url);return {};},
    loadCitiesInBounds:async(...args)=>requests.push(args),syncPresetLayers:()=>{},updateCityView:()=>{},console,
  });
  const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
  vm.runInContext(block('function densityState(', 'function syncPresetLayers(')
    +block('async function loadVisibleCities(', 'let cityProtocol;')
    +block('async function loadVisibleVillages(', 'function schedulePlaceSearch('),context);
  return {context,state,requests};
}

test('bulk city and village requests wait for sufficient zoom and viewport size',async()=>{
  const {context:c,state,requests}=setup();
  c.worldCitiesView.pending={controller:{abort:()=>state.aborted++}};
  await c.loadVisibleCities();
  assert.equal(requests.length,0);assert.equal(state.aborted,1);
  assert.equal(c.zoomRequirementHint(),'Zoom in to see cities.');
  state.zoom=9;
  await c.loadVisibleCities();
  assert.equal(requests.length,1);assert.equal(c.zoomRequirementHint(),'');
  state.bounds=[0,0,30,20];
  await c.loadVisibleCities();
  assert.equal(requests.length,1);
  c.activePreset='settlements';state.bounds=[18,52,19,53];state.zoom=10;
  await c.loadVisibleVillages();
  assert.equal(requests.length,1);assert.equal(c.zoomRequirementHint(),'Zoom in to see villages.');
  state.zoom=11;
  await c.loadVisibleVillages();
  assert.equal(requests.length,2);assert.equal(c.zoomRequirementHint(),'');
});

test('region and major-city hints disappear at their thresholds; saved views need no zoom',()=>{
  const {context:c,state}=setup('regions');
  assert.match(c.zoomRequirementHint(),/region boundaries/);
  state.zoom=4;assert.equal(c.zoomRequirementHint(),'');
  c.activePreset='major';assert.match(c.zoomRequirementHint(),/major cities/);
  state.zoom=6;assert.equal(c.zoomRequirementHint(),'');
  c.activePreset='visited';state.zoom=0;assert.equal(c.zoomRequirementHint(),'');
});

test('saved outlines are reused when only the view or visit metadata changes',async()=>{
  let fetched=0;
  const c=vm.createContext({savedRows:[{kategoria:'miasto',id:'saved'}],visitedPlaceLayer:'saved-outlines',
    cityMap:{getSource:()=>({setData:()=>{}})},visitedOutlinesKey:null,visitedOutlinesRequest:undefined,
    isSavedPreset:()=>true,wantsCityDetails:()=>false,AbortController,
    request:async()=>{fetched++;return {};},console});
  vm.runInContext(source.slice(source.indexOf('async function loadVisitedOutlines('),source.indexOf('function savedCityPosition(')),c);
  await c.loadVisitedOutlines();await c.loadVisitedOutlines();
  c.savedRows=[{kategoria:'miasto',id:'saved',data:'2001-01-01'}];
  await c.loadVisitedOutlines();assert.equal(fetched,1);
  c.savedRows.push({kategoria:'miasto',id:'another'});
  await c.loadVisitedOutlines();assert.equal(fetched,2);
});
