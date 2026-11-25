const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/dziennik.js'),'utf8');
test('trip card marks start and end uncertainty separately without changing raw dates',()=>{
 const c=vm.createContext({dayLabel:d=>d,tr:(pl,en)=>en,dateIsUncertain:row=>row?.data_niepewna==='1',uncertaintyPrefix:(text,row)=>row?.data_niepewna==='1'?'~'+text:text});
 vm.runInContext(source.slice(source.indexOf('  function tripDateLabel('),source.indexOf('  function placeName(')),c);
 const trip={data:'2026-01-01',data_konca:'2026-01-02',data_niepewna:'1'};
 assert.equal(c.tripDateLabel(trip),'~2026-01-01 – 2026-01-02');
 trip.data_niepewna='';trip.data_konca_niepewna='1';
 assert.equal(c.tripDateLabel(trip),'2026-01-01 – ~2026-01-02');
 assert.equal(trip.data,'2026-01-01');
 trip.data_niepewna='1';assert.equal(c.tripDateLabel(trip),'Undated');
});
test('a single selected visit enables saving a new trip',()=>{
 const c=vm.createContext({draft:{existing:false,members:new Set(['one'])},saving:false,selectionStatus:{},save:{},
  visits:{one:{data:'2026-01-01'}},start:{syncUncertainty:()=>{}},end:{syncUncertainty:()=>{}},tr:(pl,en)=>en});
 vm.runInContext(source.slice(source.indexOf('  function updateSelection('),source.indexOf('  function visitCard(')),c);
 c.updateSelection();assert.equal(c.save.disabled,false);
 c.draft.members.clear();c.updateSelection();assert.equal(c.save.disabled,true);
});
