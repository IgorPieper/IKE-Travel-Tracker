const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/galeria.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(0,source.indexOf('(() => {')),context);

test('gallery tag filtering includes untagged photos by default and accepts any selected tag',()=>{
  const photos=[{id:'a',tags:[{id:'trip:one'},{id:'manual:usa'}]},{id:'b',tags:[{id:'manual:usa'}]},{id:'c',tags:[]}];
  const filter=selected=>photos.filter(photo=>context.galleryMatchesTags(photo,new Set(selected))).map(photo=>photo.id);
  assert.deepEqual(filter([]),['a','b','c']);
  assert.deepEqual(filter(['trip:one']),['a']);
  assert.deepEqual(filter(['manual:usa']),['a','b']);
  assert.deepEqual(filter(['trip:one','manual:usa']),['a','b']);
  assert.deepEqual(filter(['trip:missing']),[]);
});

test('identical trip and custom tag names remain independent filters',()=>{
  assert.equal(context.galleryMatchesTags({tags:[{id:'trip:usa',name:'USA',kind:'trip'}]},new Set(['manual:usa'])),false);
  assert.equal(context.galleryMatchesTags({tags:[{id:'trip:usa',name:'USA',kind:'trip'}]},new Set(['trip:usa'])),true);
});
