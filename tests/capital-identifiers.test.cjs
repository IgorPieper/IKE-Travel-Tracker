const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');

test('saved capital pins follow corrected city coordinates while other saved coordinates remain intact',()=>{
 const c=vm.createContext({capitalOutlines:new Map([['capital',{getPosition:()=>[3.05,36.77]}]]),
  polishCities:new Map(),majorCities:new Map(),legacyCities:new Map(),normalize:s=>s});
 vm.runInContext(source.slice(source.indexOf('function savedCityPosition('),source.indexOf('function paintCityPins(')),c);
 assert.deepEqual(Array.from(c.savedCityPosition({id:'capital',lon:'3.18',lat:'36.68'})),[3.05,36.77]);
 assert.deepEqual(Array.from(c.savedCityPosition({id:'other',lon:'3.18',lat:'36.68'})),[3.18,36.68]);
 assert.deepEqual(Array.from(c.savedCityPosition({id:'capital',lon:'',lat:''})),[3.05,36.77]);
});
test('new capital outlines retain legacy IDs used by saved visits',()=>{
 const c=vm.createContext({regions:{of:code=>code},capitalAliases:new Map(),normalize:s=>s.toLowerCase(),placeReading:()=>'',englishRegion:()=>'',outlineCenter:()=>[0,0]});
 vm.runInContext(source.slice(source.indexOf('function cityFromFeature('),source.indexOf('function eligibleCityFeature(')),c);
 const props={division_id:'1159150799',legacy_id:'1159150799',name:'Abudża',original:'Abuja',country:'NG',lon:7.49,lat:9.05};
 assert.equal(c.cityFromFeature({properties:props}).id,'1159150799');
 assert.ok(c.cityFromFeature({properties:props}).searchText.includes('abuja'));
 assert.equal(c.cityFromFeature({properties:{...props,division_id:'uuid-123',legacy_id:undefined}}).id,'overture:uuid-123');
 assert.equal(c.cityFromFeature({properties:{...props,division_id:'osm:r123'}}).id,'osm:r123');
});
