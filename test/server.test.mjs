import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, searchParameters } from '../server.mjs';

test('maps user searches and preserves filters on subsequent pages',()=>{
  const params = searchParameters(new URLSearchParams({condition:'diabetes',treatment:'insulin',location:'Utah',status:'RECRUITING',pageToken:'opaque-token'}));
  assert.equal(params.get('query.cond'),'diabetes');assert.equal(params.get('query.intr'),'insulin');assert.equal(params.get('query.locn'),'Utah');
  assert.equal(params.get('filter.overallStatus'),'RECRUITING');assert.equal(params.get('pageToken'),'opaque-token');assert.equal(params.has('countTotal'),false);
});
test('rejects empty searches, unknown status and oversized input',()=>{
  assert.throws(()=>searchParameters(new URLSearchParams()));
  assert.throws(()=>searchParameters(new URLSearchParams({status:'bogus'})));
  assert.throws(()=>searchParameters(new URLSearchParams({condition:'a'.repeat(251)})));
});
test('serves the interface, proxies searches and handles upstream failures',async()=>{
  const calls = [];
  const server = createServer(async(url)=>{calls.push(url);if(url.includes('unavailable')) return new Response('',{status:503});return Response.json({studies:[{protocolSection:{identificationModule:{nctId:'NCT01234567'}}}],nextPageToken:'next',totalCount:2});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  try {
    const home = await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/Find a study/);
    const response = await fetch(base+'/api/studies?condition=asthma');assert.equal(response.status,200);assert.equal((await response.json()).nextPageToken,'next');assert.match(calls[0],/query.cond=asthma/);
    assert.equal((await fetch(base+'/api/studies?status=invalid')).status,400);
    assert.equal((await fetch(base+'/api/studies/not-a-study')).status,400);
    assert.equal((await fetch(base+'/api/studies?condition=unavailable')).status,502);
    assert.equal((await fetch(base+'/unknown')).status,404);
    assert.equal((await fetch(base+'/health')).status,200);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('maps business development filters and rejects unsupported values',()=>{
  const p=searchParameters(new URLSearchParams({sponsor:'Biogen',phase:'PHASE3',studyType:'INTERVENTIONAL'}));
  assert.equal(p.get('query.spons'),'Biogen');assert.equal(p.get('filter.advanced'),'AREA[Phase]PHASE3 AND AREA[StudyType]INTERVENTIONAL');
  assert.throws(()=>searchParameters(new URLSearchParams({phase:'PHASE99'})));
  assert.throws(()=>searchParameters(new URLSearchParams({studyType:'invalid'})));
});

test('assistant requires configuration and session, executes registry search, and keeps key server-side',async()=>{
  const profile={territory:'Utah',clinics:'Rocky Mountain MS Clinic',indications:'MS',investigators:'',studyPreferences:'',workingPreferences:'Excel'};
  const env={OPENAI_API_KEY:'test-key-never-exposed',CLINICAL_ACCESS_PASSWORD:'test-password-long-enough',AI_DAILY_REQUEST_LIMIT:'1'};
  let aiCalls=0;
  const fetcher=async(url,options)=>{
    if(url.includes('api.openai.com')){
      const input=JSON.parse(options.body);assert.equal(input.store,false);assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY);
      aiCalls++;return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({reply:aiCalls===1?'Searching.':'NCT01234567 is a potential opportunity; confirm site availability.',profile,search:aiCalls===1?{condition:'multiple sclerosis',treatment:'',location:'',status:'RECRUITING',sponsor:'',phase:'PHASE3',studyType:'INTERVENTIONAL'}:null})}]}]});
    }
    assert.match(url,/clinicaltrials.gov/);return Response.json({studies:[{protocolSection:{identificationModule:{nctId:'NCT01234567',briefTitle:'Example trial'}}}],totalCount:1});
  };
  const server=createServer(fetcher,env);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body,cookie)=>fetch(base+'/api/assistant/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Request':'1',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try {
    assert.deepEqual(await (await fetch(base+'/api/assistant/status')).json(),{configured:true,authenticated:false});
    assert.equal((await post('chat',{message:'find MS'})).status,401);
    assert.equal((await post('login',{password:'wrong'})).status,401);
    assert.equal((await fetch(base+'/api/assistant/login',{method:'POST',body:'{}'})).status,403);
    const login=await post('login',{password:env.CLINICAL_ACCESS_PASSWORD});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
    const chat=await post('chat',{message:'Find MS studies',profile:{},history:[]},cookie);assert.equal(chat.status,200);const text=await chat.text();assert.match(text,/NCT01234567/);assert.ok(!text.includes(env.OPENAI_API_KEY));assert.equal(aiCalls,2);
    assert.equal((await post('chat',{message:'again'},cookie)).status,429);
    assert.equal((await post('logout',{},cookie)).status,200);
    env.OPENAI_API_KEY='';assert.equal((await post('login',{password:env.CLINICAL_ACCESS_PASSWORD})).status,503);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
