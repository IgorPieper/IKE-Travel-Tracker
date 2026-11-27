const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/js/wyzwania.js'),'utf8');

test('sea, island and national park names follow the pointer over polygons and clear on leaving',()=>{
  const names=[],calls=[];
  const entry={properties:{id:'sea',name:'Sea'}};
  const popup={setText:name=>{names.push(name);return popup;},trackPointer:()=>{calls.push('track');return popup;},
    addTo:()=>{calls.push('show');return popup;},remove:()=>calls.push('hide')};
  const c=vm.createContext({isSeas:()=>true,isIslands:()=>false,isPark:()=>false,map:{isMoving:()=>false},activeCatalogue:{entries:new Map([['sea',entry]])},
    hoveredArea:null,areaTooltip:popup,nameOf:e=>e.properties.name});
  vm.runInContext(source.slice(source.indexOf('  function showAreaHover('),source.indexOf('  function hideCastleTooltip(')),c);
  c.showAreaHover({features:[{properties:{id:'sea'}}]});
  c.showAreaHover({features:[{properties:{id:'sea'}}]});
  assert.deepEqual(names,['Sea']);assert.deepEqual(calls,['track','show']);
  c.hideAreaHover();assert.equal(calls.at(-1),'hide');
  c.showAreaHover({features:[{properties:{id:'sea'}}]});assert.equal(names.length,2);
  c.map.isMoving=()=>true;c.showAreaHover({features:[{properties:{id:'sea'}}]});assert.equal(names.length,2);
  c.map.isMoving=()=>false;c.isSeas=()=>false;
  for(const kind of ['isIslands','isPark']) {
    c.hideAreaHover();c[kind]=()=>true;
    const before=names.length;c.showAreaHover({features:[{properties:{id:'sea'}}]});assert.equal(names.length,before+1);
    c[kind]=()=>false;
  }
  assert.equal(source.includes('challenge-sea-points'),false);
  assert.equal(source.includes('challenge-sea-centres'),false);
});

test('clicking a sea toggles saved progress directly, including optional seas, and ignores pending clicks',()=>{
  const saved=[],selected=[],pending=new Set(),progress={morze:new Set()};
  const c=vm.createContext({isSeas:()=>true,activeCatalogue:{entries:new Map([['a',{}],['b',{properties:{optional:true}}]])},pending,progress,
    selectFeature:(...args)=>selected.push(args),saveProgress:(...args)=>{saved.push(args);pending.add(args[1]);}});
  vm.runInContext(source.slice(source.indexOf('  function toggleSea('),source.indexOf('  function toggleCyprus(')),c);
  c.toggleSea('b');assert.deepEqual(saved,[['morze','b',true]]);assert.deepEqual(selected,[['b',false]]);
  c.toggleSea('b');assert.equal(saved.length,1);
  pending.clear();progress.morze.add('b');c.toggleSea('b');assert.deepEqual(saved.at(-1),['morze','b',false]);
  c.toggleSea('missing');assert.equal(saved.length,2);
  c.isSeas=()=>false;c.toggleSea('a');assert.equal(saved.length,2);
});

test('simple seas avoid full geometry; detail is loaded once on zoom and unchanged visible sets are not retiled',async()=>{
  const requests=[],updates=[];
  let zoom=1;
  const feature=(id,bounds)=>({properties:{id,bounds},geometry:{type:'Polygon',coordinates:[]}});
  const simple={features:[feature('a',[0,0,10,10]),feature('b',[30,30,40,40])]};
  const c=vm.createContext({console,mapReady:true,isSeas:()=>true,detailVisible:()=>true,
    activeCatalogue:{data:simple},seaSimpleInput:{checked:true},
    seaLandRequest:undefined,seaDetailRequest:undefined,seaOverviewRequest:undefined,
    seaOverview:undefined,seaDetail:undefined,seaGeometryKey:undefined,
    map:{getZoom:()=>zoom,getBounds:()=>({getWest:()=>1,getEast:()=>5,getSouth:()=>1,getNorth:()=>5}),
      getSource:id=>({setData:data=>updates.push({id,data})})},
    getData:url=>{requests.push(url);return Promise.resolve(simple);},
  });
  vm.runInContext(source.slice(source.indexOf('  function ensureSeaLand('),source.indexOf('  function showFeatures(')),c);
  c.updateSeaGeometry();await new Promise(setImmediate);
  assert.deepEqual(requests,['/morza-lady.json']);
  assert.equal(updates.filter(x=>x.id==='challenge-seas').length,1);
  c.updateSeaGeometry();assert.equal(updates.filter(x=>x.id==='challenge-seas').length,1);
  c.seaSimpleInput.checked=false;c.updateSeaGeometry();await new Promise(setImmediate);
  assert.equal(requests.includes('/morza-mapa.json'),true);
  assert.equal(requests.includes('/morza-wyzwanie.json'),false);
  zoom=8;c.updateSeaGeometry();await new Promise(setImmediate);
  assert.equal(requests.filter(x=>x==='/morza-wyzwanie.json').length,1);
  assert.deepEqual(Array.from(updates.at(-1).data.features,f=>f.properties.id),['a']);
  const count=updates.length;c.updateSeaGeometry();assert.equal(updates.length,count);
  c.seaSimpleInput.checked=true;c.updateSeaGeometry();assert.equal(updates.at(-1).data,simple);
});
