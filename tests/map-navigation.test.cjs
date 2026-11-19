const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
const code=source.slice(source.indexOf('function selectMapPlace('),source.indexOf('function changePresetZoom('));
function setup(){
 const calls=[],listeners={},place={id:'test'};
 const c=vm.createContext({lastRightMapClick:undefined,performance:{now:()=>100},key:p=>p.id,
  placePinAt:(...args)=>{calls.push('tool');return false;},quicklyRemovePlace:()=>calls.push('remove'),
  planPlace:()=>calls.push('plan'),queuePlaceClick:()=>calls.push('visit'),showHover:()=>{}});
 vm.runInContext(code,c);
 const el={addEventListener:(name,fn)=>listeners[name]=fn,setPointerCapture:()=>{}};
 const event=(button,x=0,y=0)=>({button,pointerId:1,clientX:x,clientY:y,preventDefault:()=>{}});
 return {c,calls,listeners,place,el,event};
}
test('left clicks including modifiers never select, remove, plan or place pins',()=>{
 const {c,calls,place,event}=setup();
 for(const modifiers of [{},{shiftKey:true},{ctrlKey:true},{altKey:true}]) c.selectMapPlace({...event(0),...modifiers},place,[0,0]);
 assert.deepEqual(calls,[]);
});
test('right clicks retain visit, plan, double-click and quick removal actions',()=>{
 const {c,calls,place,event}=setup();
 c.selectMapPlace(event(2),place,[0,0]);assert.deepEqual(calls,['tool','visit']);
 c.selectMapPlace(event(2),place,[0,0]);assert.equal(calls.at(-1),'plan');
 c.selectMapPlace({...event(2),shiftKey:true},place,[0,0]);assert.equal(calls.at(-1),'remove');
 c.selectMapPlace({...event(2),ctrlKey:true},place,[0,0]);assert.equal(calls.at(-1),'plan');
});
test('right dragging pans without selecting; cancellation and release movement are safe',()=>{
 const {c,listeners:l,el,event}=setup();let selected=0;const moves=[];
 c.bindMapPointerNavigation(el,(x,y)=>moves.push([x,y]),()=>selected++);
 l.pointerdown(event(2));l.pointermove(event(2,20,10));l.pointerup(event(2,20,10));
 assert.deepEqual(moves,[[20,10]]);assert.equal(selected,0);
 l.pointerdown(event(2));l.pointerup(event(2));assert.equal(selected,1);
 l.pointerdown(event(2));l.pointercancel(event(2));l.pointerup(event(2));assert.equal(selected,1);
 l.pointerdown(event(2));l.pointerup(event(2,20,10));assert.equal(selected,1);
});
test('pin overlays also allow left dragging and ignore left clicks',()=>{
 const {c,listeners:l,el,event}=setup();let selected=0,moved=0;
 c.bindMapPointerNavigation(el,()=>moved++,()=>selected++,true);
 l.pointerdown(event(0));l.pointermove(event(0,10,0));l.pointerup(event(0,10,0));
 l.pointerdown(event(0));l.pointerup(event(0));assert.equal(moved,1);assert.equal(selected,0);
});
