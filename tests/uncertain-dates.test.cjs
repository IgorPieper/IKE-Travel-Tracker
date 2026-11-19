const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
const functions=source.slice(source.indexOf('function dateIsUncertain('),source.indexOf('bindUncertainDate(placeDate,'));

test('date checkbox shows a tilde without changing the date value',()=>{
  const c=vm.createContext({});
  vm.runInContext(functions,c);
  const date={value:'2026-02-03',dataset:{visitId:'visit-id'},events:{},addEventListener(event,fn){this.events[event]=fn;}};
  const check={checked:true,events:{},addEventListener(event,fn){this.events[event]=fn;}};
  const prefix={};
  c.bindUncertainDate(date,check,prefix);
  assert.equal(prefix.hidden,false);
  assert.equal(date.value,'2026-02-03');
  const visits=c.readVisitDates({querySelectorAll:selector=>{assert.equal(selector,'input[type="date"]');return [date];}});
  assert.equal(visits[0].data,'2026-02-03');
  assert.equal(visits[0].data_niepewna,true);
  check.checked=false;check.events.change();
  assert.equal(prefix.hidden,true);
  assert.equal(c.uncertaintyPrefix('3 February 2026',{data_niepewna:'1'}),'~3 February 2026');
  date.value='';check.checked=true;date.events.input();
  assert.equal(prefix.hidden,true);
});

test('uncertain dates keep journal order and trip-range relevance',()=>{
  const diary=fs.readFileSync(path.join(__dirname,'../web/js/dziennik.js'),'utf8');
  const c=vm.createContext({draft:null,start:{value:''},end:{value:''}});
  vm.runInContext(diary.slice(diary.indexOf('  function cardDate('),diary.indexOf('  function claimedVisits(')),c);
  const rows=[['older',{data:'2001-01-01'}],['newer',{data:'2026-01-01',data_niepewna:'1'}]];
  assert.equal(c.orderCards([...rows])[0][0],'newer');
  c.draft={startEdited:true};c.start.value='2000-01-01';c.end.value='2002-01-01';
  assert.equal(c.orderCards([...rows])[0][0],'older');
  rows[0][1].data_niepewna='1';rows[1][1].data_niepewna='';
  assert.equal(c.orderCards([...rows])[0][0],'older');
});
