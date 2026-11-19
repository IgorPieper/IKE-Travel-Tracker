const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
function setup(preset='cities') {
  const requests=[],state={zoom:0,bounds:[18,52,19,53],aborted:0};
  const context=vm.createContext({activePreset:preset,layout:{},cityZoom:9,villageZoom:11,regionZoom:4,majorCityZoom:6,
    areaFocusActive:()=>false,isSavedPreset:(preset=context.activePreset)=>['visited','visited-only','planned-only'].includes(preset),
    tr:(pl,en)=>en,cityMap:{getZoom:()=>state.zoom,getSource:()=>({setData:()=>{}})},
    visibleWorldBounds:()=>state.bounds,settlementViewportFits:b=>b[2]-b[0]<=2.5&&b[3]-b[1]<=2,
    viewportInsidePoland:()=>false,mapBounds:()=>state.bounds,polishViewport:b=>b,
    containsBounds:()=>false,worldCitySource:'cities',villageSource:'villages',worldCitiesView:{},loadedVillageBounds:null,villageBoundsRequest:undefined,
    AbortController,request:async url=>{requests.push(url);return {features:[]};},
    loadCitiesInBounds:async(...args)=>requests.push(args),syncPresetLayers:()=>{},updateCityView:()=>{},console,
  });
  const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
  vm.runInContext(block('function renderZoom(', 'function syncPresetLayers(')
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
  state.zoom=7;
  await c.loadVisibleCities();
  assert.equal(requests.length,1);assert.equal(c.zoomRequirementHint(),'');
  state.bounds=[0,0,30,20];
  await c.loadVisibleCities();
  assert.equal(requests.length,1);
  c.activePreset='settlements';state.bounds=[18,52,19,53];state.zoom=8;
  await c.loadVisibleVillages();
  assert.equal(requests.length,1);assert.equal(c.zoomRequirementHint(),'Zoom in to see villages.');
  state.zoom=9;
  await c.loadVisibleVillages();
  assert.equal(requests.length,2);assert.equal(c.zoomRequirementHint(),'');
});

test('region and major-city hints disappear at their thresholds; saved views need no zoom',()=>{
  const {context:c,state}=setup('regions');
  assert.match(c.zoomRequirementHint(),/region boundaries/);
  state.zoom=3;assert.equal(c.zoomRequirementHint(),'');
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


test('wide viewports load small bounded tiles and preserve polygons plus markers',async()=>{
  const {context:c,state}=setup('settlements');
  const bounds=[18,51,24,55];
  const tiles=c.settlementTiles(bounds);
  assert.ok(tiles.length>1);
  for(const [w,s,e,n] of tiles) {assert.ok(e-w<=2.5);assert.ok(n-s<=2);}
  const calls=[];
  c.request=async(url)=>{calls.push(url);return {features:[
    {properties:{division_id:'same-village'},geometry:{type:'Polygon'}},
    {properties:{division_id:'same-village'},geometry:{type:'Point'}}]};};
  const data=await c.loadSettlementViewport('/api/wsie',bounds,new AbortController().signal);
  assert.equal(calls.length,tiles.length);
  assert.equal(data.features.length,2);
  state.zoom=9;state.bounds=bounds;
  assert.equal(c.densityState().villages,true);
  assert.equal(c.zoomRequirementHint(),'');
});

test('render distances apply independently and warnings name each affected preset',()=>{
  const {context:c,state}=setup();state.zoom=7;state.bounds=[18,51,24,55];
  assert.equal(c.densityState().cities,true);
  assert.equal(c.densityState().villages,false);
  c.layout.render_villages='7';
  assert.equal(c.densityState().villages,true);
  c.layout.render_cities='10';
  assert.equal(c.densityState().cities,false);
  assert.equal(c.zoomRequirementHint('cities',false),'Zoom in to see cities.');
  assert.equal(c.zoomRequirementHint('settlements',false),'');
});


test('preset warning is a red-frame class with a tooltip, cleared after zooming',()=>{
  const {context:c,state}=setup();state.zoom=7;
  const make=id=>({dataset:{preset:id},classes:new Set(),attributes:{},
    classList:{toggle(name,on){on?this.owner.classes.add(name):this.owner.classes.delete(name);}},
    setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}});
  const city=make('cities'),village=make('settlements'),saved=make('visited');
  for(const tab of [city,village,saved]) tab.classList.owner=tab;
  c.tabs=[city,village,saved];c.byId=()=>({classList:{toggle:()=>{}}});
  c.updatePresetDistanceWarnings();
  assert.equal(city.classes.has('zoom-required'),false);
  assert.equal(village.classes.has('zoom-required'),true);
  assert.equal(village.title,'Zoom in to see villages.');
  assert.equal(saved.classes.has('zoom-required'),false);
  state.zoom=9;c.updatePresetDistanceWarnings();
  assert.equal(village.classes.has('zoom-required'),false);
  assert.equal(village.title,'');
});
