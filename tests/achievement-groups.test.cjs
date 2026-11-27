const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/js/wyzwania.js'),'utf8');
function context(rows=[]) {
 const c=vm.createContext({savedRows:rows,places:{panstwo:[{id:'fr',code:'FR'},{id:'pl',code:'PL'},{id:'ca',code:'CA'}]},
  usStateIds:new Set(),goalContinents:[],tripCountries:0,secretCities:{},visitedChallengeData:null});
 vm.runInContext(source.slice(source.indexOf('  function achievementProgress()'),source.indexOf('  function achievementState(')),c);
 return c;
}

test('country groups count only their visited members, excluding planned and repeated visits',()=>{
 const c=context([{kategoria:'panstwo',id:'fr'},{kategoria:'panstwo',id:'fr'},
  {kategoria:'panstwo',id:'pl',tryb:'plan'},{kategoria:'panstwo',id:'ca'}]);
 const progress=c.achievementProgress();
 assert.equal(c.achievementMetric('panstwo:FR|PL',progress).count,1);
 assert.equal(c.achievementMetric('panstwo:FR|FR|CA',progress).count,2);
 assert.equal(c.achievementMetric('panstwo:PL',progress).count,0);
 c.savedRows[2].tryb='';
 assert.equal(c.achievementMetric('panstwo:FR|PL',c.achievementProgress()).count,2);
 c.savedRows=[];
 assert.equal(c.achievementMetric('panstwo:FR|PL',c.achievementProgress()).count,0);
});

test('all-county groups require each distinct county while existing any-region achievements stay unchanged',()=>{
 const c=context([{kategoria:'rejon',id:'one'},{kategoria:'rejon',id:'two',tryb:'plan'}]);
 let progress=c.achievementProgress();
 assert.equal(c.achievementMetric('rejony:one|two|one',progress).count,1);
 assert.equal(c.achievementMetric('rejon:one|two',progress).count,1);
 c.savedRows[1].tryb='';progress=c.achievementProgress();
 assert.equal(c.achievementMetric('rejony:one|two',progress).count,2);
 assert.equal(c.achievementMetric('rejon:one|two',progress).count,1);
 c.savedRows=[];assert.equal(c.achievementMetric('rejony:one|two',c.achievementProgress()).count,0);
});
