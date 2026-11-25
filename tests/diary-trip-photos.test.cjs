const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../web/js/'+name),'utf8');
const diary=read('dziennik.js'),photos=read('zdjecia.js');
function context() {
  const c=vm.createContext({});
  vm.runInContext(photos.slice(0,photos.indexOf('function photoGallery('))+diary.slice(0,diary.indexOf('(() => {')),c);
  return c;
}
const photo=(id,caption='')=>({id:id.repeat(64),caption});
test('trip preview uses the first trip photo and counts distinct photos from every member',()=>{
  const c=context(),first=photo('a','Trip caption'),second=photo('b'),third=photo('c');
  const trip={miejsca:['one','repeat','missing','two'],zdjecia:JSON.stringify([first,second])};
  const visits={one:{zdjecia:JSON.stringify([{...first,caption:'Visit caption'}])},repeat:{zdjecia:[first]},two:{zdjecia:[third]}};
  const result=c.diaryTripPhotos(trip,visits);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),[first,second,third]);
  assert.equal(trip.miejsca.length,4);
});
test('a trip with no own photos previews a member photo and repeated visits never inflate the count',()=>{
  const c=context(),first=photo('a');
  const visits={one:{zdjecia:[first]},two:{zdjecia:[first]}};
  const result=c.diaryTripPhotos({miejsca:['one','two'],zdjecia:''},visits);
  assert.equal(result.length,1);assert.equal(result[0].id,first.id);
  assert.equal(c.diaryTripPhotos({miejsca:[],zdjecia:''},{}).length,0);
});
