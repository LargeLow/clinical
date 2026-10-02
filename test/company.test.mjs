import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,searchParameters} from '../server.mjs';
import {baseline,companyContext,defaultProfile,migrateWorkspace,prioritizeDavisSites} from '../public/company.mjs';

test('local evidence shows the matching site before distant locations without changing cached records',()=>{
  const study={protocolSection:{contactsLocationsModule:{locations:[{city:'Phoenix',state:'Arizona',country:'United States'},{city:'Layton',state:'Utah',country:'United States',facility:'Tanner Clinic'},{city:'Layton',state:'Other',country:'United States'}]}}};
  const sorted=prioritizeDavisSites(study);
  assert.equal(sorted.protocolSection.contactsLocationsModule.locations[0].facility,'Tanner Clinic');
  assert.equal(sorted.protocolSection.contactsLocationsModule.locations.length,3);
  assert.equal(study.protocolSection.contactsLocationsModule.locations[0].city,'Phoenix');
});

test('Davis geography scopes state and city to one location and preserves nationwide discovery',()=>{
  const local=searchParameters(new URLSearchParams({scope:'davis',condition:'psoriasis',pageToken:'next'}));
  assert.match(local.get('filter.advanced'),/SEARCH\[Location\]\(AREA\[LocationCountry\]"United States" AND AREA\[LocationState\]Utah AND/);
  assert.match(local.get('filter.advanced'),/AREA\[LocationCity\]"South Weber"/);
  assert.doesNotMatch(local.get('filter.advanced'),/AREA\[LocationCity\]"Roy"|AREA\[LocationCity\]"Ogden"/);
  assert.equal(local.get('pageToken'),'next');
  const national=searchParameters(new URLSearchParams({scope:'nationwide',sponsor:'Merck'}));
  assert.equal(national.get('filter.advanced'),'AREA[LocationCountry]"United States"');
  assert.equal(national.get('query.spons'),'Merck');
  assert.throws(()=>searchParameters(new URLSearchParams({scope:'bogus'})));
});

test('migration archives old company preferences without treating capacity or PI claims as Tanner facts',()=>{
  const old={profile:{territory:'Nationwide',clinics:'Nira Medical',investigators:'Previous PI'},onboarding:{answers:{fit:'MS research capacity'},step:5,completed:true},suggestions:[{id:'keep'}]};
  const next=migrateWorkspace(old);
  assert.deepEqual(next.profile,defaultProfile());
  assert.deepEqual(next.legacyContext.profile,old.profile);
  assert.deepEqual(next.legacyContext.onboarding,old.onboarding);
  assert.deepEqual(next.onboarding,{answers:{},step:0,completed:false});
  assert.deepEqual(next.suggestions,old.suggestions);
  assert.equal(migrateWorkspace(next),next);
  assert.equal(old.profile.clinics,'Nira Medical');
  assert.equal(baseline.locations.length,9);
});

test('shared legacy workspace migration persists once, preserves feedback, and survives later profile saves',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'clinical-migrate-'));
  const path=join(dir,'clinical-workspace.json');
  const old={version:1,profile:{territory:'Nationwide',clinics:'Nira'},onboarding:{answers:{territory:'Nationwide'},step:1,completed:false},suggestions:[]};
  await writeFile(path,JSON.stringify(old));
  const env={OPENAI_API_KEY:'test',CLINICAL_ACCESS_PASSWORD:'migration-test-password',CLINICAL_DATA_DIR:dir};
  const server=createServer(undefined,env);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const headers={'Content-Type':'application/json','X-Clinical-Request':'1'};
  try{
    const login=await fetch(base+'/api/assistant/login',{method:'POST',headers,body:JSON.stringify({password:env.CLINICAL_ACCESS_PASSWORD})});
    headers.Cookie=login.headers.get('set-cookie').split(';')[0];
    const data=await (await fetch(base+'/api/workspace/load',{headers})).json();
    assert.equal(data.companyContext,companyContext);
    assert.equal(data.profile.clinics,defaultProfile().clinics);
    assert.deepEqual(data.legacyContext.profile,old.profile);
    const save=await fetch(base+'/api/workspace/save',{method:'POST',headers,body:JSON.stringify({profile:{...defaultProfile(),indications:'pediatrics'},answers:{fit:'Confirmed new setup'},step:2})});
    assert.equal(save.status,200);
    const again=await (await fetch(base+'/api/workspace/load',{headers})).json();
    assert.equal(again.profile.indications,'pediatrics');
    assert.deepEqual(again.legacyContext.profile,old.profile);
    const disk=JSON.parse(await readFile(path,'utf8'));
    assert.equal(disk.companyContext,companyContext);
    assert.deepEqual(disk.legacyContext.onboarding,old.onboarding);
    assert.deepEqual(disk.suggestions,old.suggestions);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
