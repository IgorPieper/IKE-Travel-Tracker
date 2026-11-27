const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('administrative viewport loads the active tier, preserves saved outlines and ignores stale responses', async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../web/js/mapa.js'), 'utf8');
  const requests = [], rendered = [];
  const c = vm.createContext({
    URLSearchParams, AbortController, console, regionViewportKey:undefined, regionViewportRequest:undefined,
    cityMap:{getSource:()=>({setData:data=>rendered.push(data)})}, activePreset:'subregions',
    areaFocusActive:()=>false, densityState:()=>({regions:true,subregions:false}),
    isSavedPreset:()=>false, focusShowsRegions:()=>false, focusShowsSubregions:()=>false,
    savedRows:[{kategoria:'rejon',id:'saved'}], rowInSavedPreset:()=>true,
    mapBounds:()=>[10,40,30,60], compactCountries:new Set(['SM']),
    request:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})),
  });
  vm.runInContext(source.slice(source.indexOf('function syncRegionViewport('),source.indexOf('async function loadVisitedOutlines(')), c);
  c.syncRegionViewport();
  assert.equal(new URLSearchParams(requests[0].url.split('?')[1]).get('levels'),'');
  assert.equal(new URLSearchParams(requests[0].url.split('?')[1]).get('ids'),'saved');
  c.densityState=()=>({regions:true,subregions:true}); c.syncRegionViewport();
  assert.equal(requests[0].options.signal.aborted,true);
  assert.equal(new URLSearchParams(requests[1].url.split('?')[1]).get('levels'),'subregion');
  requests[0].resolve({features:[{properties:{country:'US'}}]}); await new Promise(setImmediate);
  assert.equal(rendered.length,0);
  requests[1].resolve({features:[{properties:{country:'DE'}},{properties:{country:'SM'}}]}); await new Promise(setImmediate);
  assert.equal(rendered.length,1); assert.equal(rendered[0].features.length,1);
  c.syncRegionViewport(); assert.equal(requests.length,2);
  c.activePreset='countries';c.syncRegionViewport();assert.equal(requests.length,2);
  assert.equal(requests[1].options.signal.aborted,true);
});
