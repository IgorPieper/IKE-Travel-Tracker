const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/js/dziennik.js'),'utf8');
function filters(layout={},range={}) {
 const c=vm.createContext({layout,visits:{},undated:{checked:true},dateFilters:{from:{value:range.from||''},until:{value:range.until||''}},
  visitType:v=>v.kategoria==='wycieczka'?'trips':v.kategoria==='pinezka'?'pins':'countries',cardDate:r=>r.data||r.data_konca||''});
 vm.runInContext(source.slice(source.indexOf('  function visitVisible('),source.indexOf('  function countryName(')),c);return c;
}
test('journal status filters independently hide planned and visited entries',()=>{
 const c=filters({diary_filter_visited:'off'});
 assert.equal(c.visitVisible({kategoria:'panstwo',tryb:'plan'}),true);
 assert.equal(c.visitVisible({kategoria:'panstwo'}),false);
 c.layout.diary_filter_planned='off';assert.equal(c.visitVisible({kategoria:'panstwo',tryb:'plan'}),false);
});
test('date filters use arrival inclusively and allow undated entries separately',()=>{
 const c=filters({}, {from:'2026-01-01',until:'2026-12-31'});
 assert.equal(c.visitVisible({kategoria:'panstwo',data:'2026-01-01',data_konca:'2027-01-02'}),true);
 assert.equal(c.visitVisible({kategoria:'panstwo',data:'2025-12-31'}),false);
 assert.equal(c.visitVisible({kategoria:'panstwo'}),true);
 c.undated.checked=false;assert.equal(c.visitVisible({kategoria:'panstwo'}),false);
});
test('trip visibility follows member statuses without losing its membership',()=>{
 const c=filters({diary_filter_visited:'off'});
 c.visits.one={kategoria:'panstwo'};c.visits.two={kategoria:'panstwo',tryb:'plan'};
 const trip={kategoria:'wycieczka',miejsca:['one','two']};assert.equal(c.tripVisible(trip),true);
 c.layout.diary_filter_planned='off';assert.equal(c.tripVisible(trip),false);assert.equal(trip.miejsca.length,2);
});
