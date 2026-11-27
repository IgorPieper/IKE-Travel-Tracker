const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/wyzwania.js'),'utf8');

test('the real catalogue has 48 required seas, four optional seas and completes at 44',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/challenges/morza-wyzwanie.json'),'utf8'));
 const entries=new Map(data.features.map(f=>[f.properties.id,f]));
 const required=data.features.filter(f=>!f.properties.optional).map(f=>f.properties.id);
 const optional=data.features.filter(f=>f.properties.optional).map(f=>f.properties.id);
 assert.equal(required.length,48);assert.deepEqual(optional.sort(),['fidzi','kaspijskie','martwe','sargassowe']);
 const progress={morze:new Set([...required.slice(0,43),...optional])};
 const c=vm.createContext({progress,tr:(_,en)=>en});
 vm.runInContext(source.slice(source.indexOf('  function seasProgress('),source.indexOf('  function completedParks(')),c);
 assert.equal(c.seasProgress({entries}).count,43);assert.equal(c.seasProgress({entries}).complete,false);
 progress.morze.add(required[43]);assert.equal(c.seasProgress({entries}).complete,true);
 assert.equal(c.seasProgress({entries}).target,44);
});

test('completion requires 90 percent rounded up; removed IDs do not grant extra credit',()=>{
 const entries=new Map(Array.from({length:50},(_,i)=>['sea-'+i,{}]));
 entries.set('optional-one',{properties:{optional:true}});entries.set('optional-two',{properties:{optional:true}});
 const progress={morze:new Set([...entries.keys()].slice(0,44))};progress.morze.add('not-on-list');
 progress.morze.add('optional-one');progress.morze.add('optional-two');
 const c=vm.createContext({progress,tr:(_,en)=>en});
 vm.runInContext(source.slice(source.indexOf('  function seasProgress('),source.indexOf('  function completedParks(')),c);
 assert.equal(c.seasProgress({entries}).count,44);assert.equal(c.seasProgress({entries}).complete,false);
 assert.equal(c.seasProgress({entries}).target,45);assert.equal(c.seasProgress({entries}).total,50);
 progress.morze.add('sea-44');assert.equal(c.seasProgress({entries}).complete,true);
 progress.morze.delete('sea-0');assert.equal(c.seasProgress({entries}).complete,false);
 assert.equal(c.seasProgress({entries:new Map()}).complete,false);
 assert.equal(c.seasProgress({entries:new Map([['one',{}]])}).target,1);
});

test('loading older challenge progress initializes the new sea category safely',()=>{
 const c=vm.createContext({progress:{zamek:new Set(),morze:new Set(['old'])},visitedChallengeData:false});
 vm.runInContext(source.slice(source.indexOf('  function recordProgress('),source.indexOf('  function loadProgress(')),c);
 c.recordProgress({zamek:['a']});assert.equal(c.progress.morze.size,0);assert.equal(c.progress.zamek.has('a'),true);
 c.recordProgress({morze:['b']});assert.equal(c.progress.morze.has('b'),true);
});
