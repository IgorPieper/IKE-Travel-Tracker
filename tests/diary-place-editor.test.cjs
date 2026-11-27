const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/dziennik.js'),'utf8');
const block=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));

test('journal resolves saved places without loaded city tiles and retains their original identity',()=>{
  const c=vm.createContext({places:{panstwo:[]},continentsById:new Map(),adminRegions:new Map(),
    capitalOutlines:new Map(),capitalRecords:new Map(),majorCities:new Map(),pinMarkers:[]});
  vm.runInContext(block('  function diaryPlace(', '  async function openVisitEditor('),c);
  const place=c.diaryPlace({id:'overture:city',kategoria:'miasto',nazwa:'Example',country_code:'BD',lon:'90.4',lat:'23.8'});
  assert.equal(place.id,'overture:city');assert.equal(place.category,'miasto');assert.equal(place.country,'BD');
  assert.deepEqual(Array.from(place.getPosition()),[90.4,23.8]);
  const pin=c.diaryPin({id:'p',lon:'18',lat:'54',kolejne_wizyty:'[{"id":"repeat","data":"2020-01-01"}]'});
  assert.equal(pin.kolejne_wizyty[0].id,'repeat');
});

test('removing a place with several visits requires confirmation and cancellation preserves all visits',async()=>{
  let writes=0,loads=0,confirm=false,questions=[];
  const c=vm.createContext({saving:false,savedPlaces:new Map([['miasto:a',{kolejne_wizyty:'[{"id":"again"}]'}]]),
    window:{confirm:text=>{questions.push(text);return confirm;}},tr:(_,en)=>en,placeName:v=>v.nazwa,
    closePlaceDetails:async()=>true,closePinEditor:async()=>true,visitQueue:Promise.resolve(),
    diaryPlace:v=>v,saveVisit:async(p,change)=>{assert.equal(change.odwiedzone,false);writes++;return true;},
    load:async()=>loads++,status:{}});
  vm.runInContext(block('  async function removeVisit(', '  function addVisitActions('),c);
  const visit={id:'a',kategoria:'miasto',nazwa:'Example'};
  await c.removeVisit(visit);assert.equal(writes,0);assert.equal(loads,0);assert.match(questions[0],/2 saved visits/);
  confirm=true;await c.removeVisit(visit);assert.equal(writes,1);assert.equal(loads,1);assert.equal(c.saving,false);
});

test('journal deletion uses the pin API and does not delete when an open editor cannot save',async()=>{
  let writes=0,canClose=false;
  const pin={id:'pin',kolejne_wizyty:[]};
  const c=vm.createContext({saving:false,diaryPin:()=>pin,tr:(_,en)=>en,placeName:()=>'',
    closePlaceDetails:async()=>canClose,closePinEditor:async()=>true,
    saveCustomPin:async(change,options)=>{assert.equal(change.usun,true);assert.equal(options.pin,pin);writes++;return true;},
    load:async()=>{},status:{}});
  vm.runInContext(block('  async function removeVisit(', '  function addVisitActions('),c);
  await c.removeVisit({kategoria:'pinezka'});assert.equal(writes,0);assert.equal(c.saving,false);
  canClose=true;await c.removeVisit({kategoria:'pinezka'});assert.equal(writes,1);
});

test('closing the journal modal returns the same editor to its original sidebar location only once',()=>{
  let restored=0,disconnected=0,focused=0,closed=0;
  const panel={},anchor={replaceWith:p=>{assert.equal(p,panel);restored++;}};
  const c=vm.createContext({mountedEditor:{panel,anchor,key:'repeat',observer:{disconnect:()=>disconnected++},statusObserver:{disconnect:()=>disconnected++}},
    editorDialog:{open:true,close:()=>closed++},view:{hidden:false},
    grid:{querySelectorAll:()=>[{dataset:{editDiaryVisit:'repeat'},focus:()=>focused++}]}});
  vm.runInContext(block('  function restoreEditor()', '  async function closeVisitEditor('),c);
  c.restoreEditor();c.restoreEditor();
  assert.equal(restored,1);assert.equal(disconnected,2);assert.equal(closed,1);assert.equal(focused,1);
});

test('the separate card actions dispatch editing and deletion without opening the enclosing trip',()=>{
  const nodes=[],actions=[];
  const c=vm.createContext({saving:false,tr:(_,en)=>en,placeName:v=>v.nazwa,
    document:{createElement:()=>{const n={dataset:{},setAttribute:()=>{},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}};nodes.push(n);return n;}},
    openVisitEditor:(key,visit)=>actions.push(['edit',key,visit.id]),removeVisit:visit=>actions.push(['remove',visit.id])});
  vm.runInContext(block('  function addVisitActions(', '  function tripCard('),c);
  c.addVisitActions({classList:{add:()=>{}},append:()=>{}},'place:visit:repeat',{id:'p',nazwa:'Place'});
  let stopped=0;for(const n of nodes)n.listeners.click({stopPropagation:()=>stopped++});
  assert.equal(stopped,2);assert.deepEqual(actions,[['edit','place:visit:repeat','p'],['remove','p']]);
});
