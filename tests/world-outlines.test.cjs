const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/js/mapa.js'),'utf8');
const block=source.slice(source.indexOf('function worldOutlineLevel('),source.indexOf('const mapColors ='));

test('normal outlines use zoom-appropriate detail while optional simple outlines stay simple',()=>{
  const c=vm.createContext({});vm.runInContext(block,c);
  assert.equal(c.worldOutlineLevel(0,false),'overview');
  assert.equal(c.worldOutlineLevel(4.9,false),'overview');
  assert.equal(c.worldOutlineLevel(5,false),'detail');
  assert.equal(c.worldOutlineLevel(19,true),'simple');
});

test('late outline responses cannot undo a newer zoom or option; unchanged levels never retile',async()=>{
  const requests=[],updates=[];
  const c=vm.createContext({console,worldOutlineRequests:new Map(),worldOutlineApplied:'overview',fallbackOutlineApplied:undefined,
    layout:{map_simple:'off'},basemapReady:true,hasInteractiveMap:()=>true,
    cityMap:{getZoom:()=>8,getSource:id=>({setData:data=>updates.push({id,data})})},
    request:url=>new Promise(resolve=>requests.push({url,resolve})),
  });vm.runInContext(block,c);
  const detail=c.syncWorldOutlines();assert.equal(requests.length,2);
  c.layout.map_simple='on';const simple=c.syncWorldOutlines();assert.equal(requests.length,4);
  requests[0].resolve({features:['old-country']});requests[1].resolve({features:['old-continent']});await detail;
  assert.equal(updates.length,0);
  requests[2].resolve({features:['simple-country']});requests[3].resolve({features:['simple-continent']});await simple;
  assert.equal(updates.length,2);assert.equal(updates[0].data.features[0],'simple-country');
  await c.syncWorldOutlines();assert.equal(updates.length,2);assert.equal(requests.length,4);
  c.layout.map_simple='off';await c.syncWorldOutlines();assert.equal(updates[2].data.features[0],'old-country');
  assert.equal(requests.length,4);
});
