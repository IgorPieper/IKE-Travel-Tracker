const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));

test('hiding markings removes saved-only overlays and status colours without changing progress',()=>{
  const visibility={}, rows=[{kategoria:'miasto',id:'1',tryb:'plan'}];
  const c=vm.createContext({markingsHidden:false,savedRows:rows,activePreset:'countries',
    areaFocusActive:()=>false,isSavedPreset:()=>false,visitColor:'purple',planColor:'orange',
    visitedPlaceLayer:'places',visitedCountryLayer:'countries-saved',visitedRegionLayer:'regions-saved',visitedPinLayer:'pins',
    cityMap:{getLayer:()=>true,getLayoutProperty:id=>visibility[id],setLayoutProperty:(id,key,value)=>visibility[id]=value}});
  vm.runInContext(block('function statusColor(', 'function paintVisits(')+block('function setLayerVisible(', 'function addOverview('),c);
  const before=JSON.stringify(rows),original=JSON.stringify(c.statusColor('miasto','id','white'));
  c.markingsHidden=true;
  assert.equal(c.statusColor('miasto','id','white'),'white');
  assert.equal(c.statusColor('rejon','id','transparent'),'transparent');
  for(const id of ['places','countries-saved','regions-saved','pins']) {c.setLayerVisible(id,true);assert.equal(visibility[id],'none');}
  c.setLayerVisible('base-boundaries',true);assert.equal(visibility['base-boundaries']||'visible','visible');
  c.markingsHidden=false;c.setLayerVisible('pins',true);
  assert.equal(visibility.pins,'visible');
  assert.equal(JSON.stringify(c.statusColor('miasto','id','white')),original);
  assert.equal(JSON.stringify(rows),before);
});

test('eye toggles presentation only and repaints all map representations',()=>{
  const calls=[],button={addEventListener:()=>{}};
  const c=vm.createContext({markingsHidden:false,byId:()=>button,showHover:()=>{},syncMarkingsButton:()=>{},
    hasInteractiveMap:()=>true});
  for(const name of ['paintVisits','syncVisitedCountries','paintRegions','syncPresetLayers','positionCustomPins','scheduleDraw']) c[name]=()=>calls.push(name);
  vm.runInContext(block('function toggleMapMarkings(', '// Handle the view shortcut'),c);
  c.toggleMapMarkings();assert.equal(c.markingsHidden,true);assert.equal(calls.length,6);
  c.toggleMapMarkings();assert.equal(c.markingsHidden,false);assert.equal(calls.length,12);
});
