const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/js/wyzwania.js'),'utf8');

test('cards share a lightweight summary request without replacing a fully loaded map',async()=>{
  const full={data:{features:[{properties:{id:'full'},geometry:{type:'Polygon'}}]}};
  const loadedCatalogues=new Map([['seas',full]]);
  let requests=0,resolve;
  const c=vm.createContext({loadedCatalogues,getData:url=>{
    requests++;assert.equal(url,'/api/challenge-catalogues');return new Promise(r=>resolve=r);
  }});
  vm.runInContext(source.slice(source.indexOf('  let summariesRequest;'),source.indexOf('  let activeCatalogue;')),c);
  const first=c.loadChallengeSummaries(),second=c.loadChallengeSummaries();
  assert.equal(first,second);assert.equal(requests,1);
  resolve({seas:{data:{features:[]}},castles:{data:{features:[{properties:{id:'castle'},geometry:null}]}}});
  await first;
  assert.equal(loadedCatalogues.get('seas'),full);
  assert.equal(loadedCatalogues.get('castles').entries.has('castle'),true);
  await c.loadChallengeSummaries();assert.equal(requests,1);
});

test('a failed summary request can be retried',async()=>{
  let requests=0;
  const c=vm.createContext({loadedCatalogues:new Map(),getData:()=>{
    if(++requests===1)return Promise.reject(new Error('offline'));
    return Promise.resolve({});
  }});
  vm.runInContext(source.slice(source.indexOf('  let summariesRequest;'),source.indexOf('  let activeCatalogue;')),c);
  await assert.rejects(c.loadChallengeSummaries());await c.loadChallengeSummaries();assert.equal(requests,2);
});
