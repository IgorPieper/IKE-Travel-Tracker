const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup() {
  const source=fs.readFileSync(path.join(__dirname,'../web/js/mapa.js'),'utf8');
  const context=vm.createContext({focused:false,tr:(pl,en)=>pl,
    savedPlaces:new Map(),places:{panstwo:[]},englishRegion:code=>({JP:'Japan',RU:'Russia'})[code]});
  context.areaFocusActive=()=>context.focused;
  vm.runInContext(source.slice(source.indexOf('const basePlaceName ='),source.indexOf('function displayRegionName(')),context);
  vm.runInContext("placeReadings={byCountry:{JP:{'東京':'Tokyo'}},byName:{'Москва':'Moskva'}};",context);
  context.label=place=>vm.runInContext('displayPlaceName(place)',Object.assign(context,{place}));
  return context;
}

test('focused non-Latin place names include Latin readings in parentheses',()=>{
  const c=setup();
  const city={id:'tokyo',name:'東京',country:'JP',category:'miasto'};
  assert.equal(c.label(city),'東京');
  c.focused=true;
  assert.equal(c.label(city),'東京 (Tokyo)');
  assert.equal(c.label({name:'Москва',country:'RU',category:'rejon'}),'Москва (Moskva)');
  assert.equal(c.label({name:'日本',code:'JP',category:'panstwo'}),'日本 (Japan)');
  assert.equal(c.label({name:'Warszawa',country:'PL',category:'miasto'}),'Warszawa');
});

test('focused inline reading replaces the separate reading line',()=>{
  const c=setup();
  c.focused=true;
  const parent={append:()=>{throw new Error('duplicate reading');}};
  c.appendPlaceReading(parent,{name:'東京',country:'JP',category:'miasto'});
});
