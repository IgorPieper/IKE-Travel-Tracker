const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
const block=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
function setup(kind='place') {
  const original={notatka:'original'},change={notatka:'edited'},nodes={};let saved=0,valid=true,succeeds=true;
  const editor={place:{id:'a'},pin:{id:'p'},initialSnapshot:JSON.stringify(original)};
  const c=vm.createContext({editedPlace:kind==='place'?editor:null,editedPin:kind==='pin'?editor:null,
    visitQueue:Promise.resolve(),byId:id=>nodes[id]||=( {hidden:false} ),key:p=>p.id,
    readPlaceChange:validate=>validate&&!valid?null:change,readPinChange:validate=>validate&&!valid?null:change,
    commitPlace:async()=>{saved++;return succeeds;},saveCustomPin:async()=>{saved++;return succeeds;},
    syncEditorSidebar:()=>{},updateSidebar:()=>{},pinMarkers:[],pinDraft:{},addPinButton:{focus:()=>{}}});
  vm.runInContext(block('async function closePlaceDetails(', 'function syncEditorSidebar(')+
    block('async function closePinEditor(', 'function setPinEditorBusy('),c);
  return {c,editor,change,nodes,saved:()=>saved,valid:v=>valid=v,succeeds:v=>succeeds=v};
}
for(const kind of ['place','pin']) {
  test(kind+' waits for an in-flight photo upload before saving and closing',async()=>{
    const {c,editor,change,saved}=setup(kind);
    let finish; editor.photoUpload=new Promise(resolve=>finish=()=>{change.zdjecia=[{id:'a'.repeat(64),caption:''}];resolve();});
    const closing=kind==='place'?c.closePlaceDetails():c.closePinEditor();
    await Promise.resolve();assert.equal(saved(),0);finish();
    assert.equal(await closing,true);assert.equal(saved(),1);assert.equal(change.zdjecia.length,1);
  });
  test(kind+' closes only after auto-saving changes; repeated dismissals save once',async()=>{
    const {c,editor,saved}=setup(kind),close=kind==='place'?()=>c.closePlaceDetails():()=>c.closePinEditor();
    let release;c.visitQueue=new Promise(resolve=>release=resolve);
    const a=close(),b=close();assert.equal(saved(),0);release();
    assert.equal(await a,true);assert.equal(await b,true);assert.equal(saved(),1);
    assert.equal(kind==='place'?c.editedPlace:c.editedPin,undefined);assert.equal(editor.closing,undefined);
  });
  test(kind+' keeps invalid or failed edits open and permits retry',async()=>{
    const {c,editor,saved,valid,succeeds}=setup(kind),close=kind==='place'?()=>c.closePlaceDetails():()=>c.closePinEditor();
    valid(false);assert.equal(await close(),false);assert.equal(saved(),0);
    valid(true);succeeds(false);assert.equal(await close(),false);
    assert.equal(kind==='place'?c.editedPlace:c.editedPin,editor);
    succeeds(true);assert.equal(await close(),true);assert.equal(saved(),2);
  });
  test(kind+' unchanged edits and explicit discard never write progress',async()=>{
    const {c,editor,change,saved}=setup(kind);
    editor.initialSnapshot=JSON.stringify(change);
    await (kind==='place'?c.closePlaceDetails():c.closePinEditor());assert.equal(saved(),0);
    if(kind==='place') c.editedPlace=editor;else c.editedPin=editor;
    editor.initialSnapshot='different';
    await (kind==='place'?c.closePlaceDetails(false,true):c.closePinEditor(false,true));assert.equal(saved(),0);
  });
}
test('sidebar editor hides previous content without changing view state and restores scrolling',()=>{
  const classes=new Set(),panel={scrollTop:120,classList:{contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)}};
  const places={};const c=vm.createContext({editedPlace:{},editedPin:null,editorSidebarScroll:0,byId:id=>id==='map-sidebar'?panel:places});
  vm.runInContext(block('function syncEditorSidebar(', 'function setPinPlacement('),c);
  c.syncEditorSidebar();assert.equal(places.hidden,true);assert.equal(classes.has('editor-open'),true);
  panel.scrollTop=0;c.editedPlace=null;c.syncEditorSidebar();
  assert.equal(places.hidden,false);assert.equal(panel.scrollTop,120);assert.equal(classes.has('editor-open'),false);
});
for (const autoClose of ['on','off']) test('rapidly opening different places saves the previous editor with auto close '+autoClose,async()=>{
  let release;const closing=new Promise(resolve=>release=resolve),opened=[];
  const c=vm.createContext({ready:true,layout:{editor_auto_close:autoClose},updateEditorSaveLabels:()=>{},editedPlace:{place:{id:'old'}},editedPin:null,editorRequest:0,
    consumeFocusSelection:()=>false,key:p=>p.id,closePlaceDetails:()=>closing,closePinEditor:async()=>true,
    setMapSidebarOpen:()=>{},savedPlaces:new Map([['b',{}],['c',{}]]),
    fillPlaceFields:()=>{},readPlaceChange:()=>({}),syncEditorSidebar:()=>opened.push(c.editedPlace.place.id),
    placeRemove:{},setPlaceEditorBusy:()=>{},byId:()=>({}),commitPlace:()=>{throw Error('unexpected save');}});
  vm.runInContext(block('async function openPlace(', 'async function closePlaceDetails('),c);
  const a=c.openPlace({id:'b'}),b=c.openPlace({id:'c'});assert.equal(opened.length,0);release(true);
  await Promise.all([a,b]);assert.deepEqual(opened,['c']);
});

test('manual closing mode keeps the editor open on blank outside clicks',async()=>{
  let closed=0;
  const c=vm.createContext({ready:true,layout:{editor_auto_close:'off'},editedPlace:{place:{id:'old'}},editedPin:null,
    closePlaceDetails:()=>closed++,closePinEditor:()=>closed++});
  vm.runInContext(block('function dismissEditorOutside(', 'document.addEventListener("pointerdown", dismissEditorOutside'),c);
  c.dismissEditorOutside({target:{closest:()=>null}});
  assert.equal(closed,0);assert.equal(c.editedPlace.place.id,'old');
  c.layout.editor_auto_close='on';c.dismissEditorOutside({target:{closest:()=>null}});
  assert.equal(closed,2);
});

test('selecting another place auto-saves the previous edits even with outside closing disabled',async()=>{
  const {c,editor,saved}=setup('place');
  Object.assign(c,{ready:true,layout:{editor_auto_close:'off'},editorRequest:0,consumeFocusSelection:()=>false,
    setMapSidebarOpen:()=>{},savedPlaces:new Map([['next',{}]]),fillPlaceFields:()=>{},
    updateEditorSaveLabels:()=>{},placeRemove:{},setPlaceEditorBusy:()=>{}});
  vm.runInContext(block('async function openPlace(', 'async function closePlaceDetails('),c);
  await c.openPlace({id:'next'});
  assert.equal(saved(),1);
  assert.notEqual(c.editedPlace,editor);
  assert.equal(c.editedPlace.place.id,'next');
});

test('switching from a place to a pin still attempts saving when outside closing is disabled',async()=>{
  let attempts=0;
  const previous={place:{id:'old'}};
  const c=vm.createContext({layout:{editor_auto_close:'off'},editedPlace:previous,editedPin:null,editorRequest:0,
    closePlaceDetails:async()=>{attempts++;return false;}});
  vm.runInContext(block('async function openPinEditor(', 'async function closePinEditor('),c);
  await c.openPinEditor({id:'pin'},true);
  assert.equal(attempts,1);
  assert.equal(c.editedPlace,previous);
  assert.equal(c.editedPin,null);
});

test('save label follows actual edits including photos and reverting a change',()=>{
  const button=()=>({removeAttribute:()=>{}}),placeSave=button(),pinSave=button(),nodes={};
  let change={notatka:'original',zdjecia:[]};
  const editor={initialSnapshot:JSON.stringify(change)};
  const c=vm.createContext({editedPlace:editor,editedPin:null,placeSave,pinSave,layout:{editor_auto_close:'off'},
    readPlaceChange:()=>change,readPinChange:()=>({}),tr:(_,en)=>en,byId:id=>nodes[id]||={}});
  vm.runInContext(block('function updateEditorSaveLabels()', 'for (const form of [placeForm,'),c);
  c.updateEditorSaveLabels();assert.equal(placeSave.textContent,'Exit');assert.equal(nodes['close-place-details'].hidden,true);
  change.notatka='changed';c.updateEditorSaveLabels();assert.equal(placeSave.textContent,'Save');
  change.notatka='original';c.updateEditorSaveLabels();assert.equal(placeSave.textContent,'Exit');
  editor.photoUploading=true;c.updateEditorSaveLabels();assert.equal(placeSave.textContent,'Save');
  editor.photoUploading=false;change.zdjecia=[{id:'a'.repeat(64),caption:''}];c.updateEditorSaveLabels();assert.equal(placeSave.textContent,'Save');
});
