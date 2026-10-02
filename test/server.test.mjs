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
    const home = await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/Nikki’s research workspace/);
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

test('multiple status and phase filters use OR within groups and preserve pagination',()=>{
  const input=new URLSearchParams('status=RECRUITING&status=NOT_YET_RECRUITING&phase=PHASE2&phase=PHASE3&studyType=INTERVENTIONAL&pageToken=next');
  const p=searchParameters(input);
  assert.equal(p.get('filter.overallStatus'),'RECRUITING,NOT_YET_RECRUITING');
  assert.equal(p.get('filter.advanced'),'(AREA[Phase]PHASE2 OR AREA[Phase]PHASE3) AND AREA[StudyType]INTERVENTIONAL');
  assert.equal(p.get('pageToken'),'next');
  const comma=searchParameters(new URLSearchParams({status:'RECRUITING,NOT_YET_RECRUITING,RECRUITING',phase:'PHASE2,PHASE3'}));
  assert.equal(comma.get('filter.overallStatus'),'RECRUITING,NOT_YET_RECRUITING');
  assert.throws(()=>searchParameters(new URLSearchParams('status=RECRUITING&status=INVALID')));
  assert.throws(()=>searchParameters(new URLSearchParams('phase=PHASE2&phase=INVALID')));
});

test('streamed assistant preserves registry results when summary fails and emits visible errors',async()=>{
  const env={OPENAI_API_KEY:'mock-key',CLINICAL_ACCESS_PASSWORD:'test-password-long-enough'};
  let calls=0;
  const server=createServer(async(url,options)=>{
    if(!url.includes('openai.com'))return Response.json({totalCount:1,studies:[{protocolSection:{identificationModule:{nctId:'NCT00000001',briefTitle:'Registry example'}}}]});
    const payload=JSON.parse(options.body);assert.equal(payload.model,'gpt-4.1-mini');assert.equal(payload.reasoning,undefined);
    if(++calls>1)return Response.json({error:{code:'rate_limit_exceeded'}},{status:429});
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({reply:'Searching.',profile:null,search:{condition:'MS',treatment:'',location:'',sponsor:'',status:'RECRUITING,NOT_YET_RECRUITING',phase:'PHASE2,PHASE3',studyType:''}})}]}]});
  },env);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const post=(path,value,cookie)=>fetch(base+'/api/assistant/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Request':'1',Accept:'application/x-ndjson',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(value)});
  try{
    const cookie=(await post('login',{password:env.CLINICAL_ACCESS_PASSWORD})).headers.get('set-cookie').split(';')[0];
    const r=await post('chat',{message:'Find studies',profile:{territory:'United States'}},cookie);
    const events=(await r.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events[0].type,'progress');assert.ok(events.find(e=>e.type==='studies'));
    const final=events.at(-1);assert.equal(final.type,'result');assert.match(final.reply,/NCT00000001/);assert.match(final.warning,/summary/);assert.equal(final.profile.territory,'United States');
    const failed=await post('chat',{message:'Hello'},cookie);const errors=(await failed.text()).trim().split('\n').map(JSON.parse);assert.equal(errors.at(-1).type,'error');assert.match(errors.at(-1).error,/rate limited/);
    assert.equal((await fetch(base+'/health')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('selected-study discussion fetches registry evidence and carries shared filters without a new search',async()=>{
  const env={OPENAI_API_KEY:'mock',CLINICAL_ACCESS_PASSWORD:'test-password-long-enough'};let selectedFetched=false,aiCalls=0;
  const server=createServer(async(url,options)=>{
    if(url.includes('openai.com')){aiCalls++;const payload=JSON.parse(options.body);const input=payload.input.map(m=>m.content).join('\n');assert.match(input,/Current search filters/);assert.match(input,/PHASE2,PHASE3/);assert.match(input,/verified-contact@example.org/);assert.match(input,/Selected study fetched/);return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({reply:'Published contact: verified-contact@example.org',profile:null,search:null})}]}]});}
    assert.match(url,/\/studies\/NCT99999999$/);selectedFetched=true;return Response.json({protocolSection:{identificationModule:{nctId:'NCT99999999',briefTitle:'Verified selected trial'},contactsLocationsModule:{centralContacts:[{name:'Registry contact',email:'verified-contact@example.org'}]}}});
  },env);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body,cookie)=>fetch(base+'/api/assistant/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Request':'1',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try{const cookie=(await post('login',{password:env.CLINICAL_ACCESS_PASSWORD})).headers.get('set-cookie').split(';')[0];const response=await post('chat',{message:'Draft outreach for this study',studyId:'NCT99999999',filters:{phase:'PHASE2,PHASE3'}},cookie);assert.equal(response.status,200);const data=await response.json();assert.equal(data.data,null);assert.match(data.reply,/verified-contact/);assert.equal(aiCalls,1);assert.ok(selectedFetched);const invalid=await post('chat',{message:'Review',studyId:'invalid'},cookie);assert.equal(invalid.status,400);assert.equal(aiCalls,1);}finally{await new Promise(r=>server.close(r));}
});

test('study keywords and participant-age filters preserve pagination and reject invalid ranges',()=>{
  const specific=searchParameters(new URLSearchParams({term:'remyelination',age:'65',pageToken:'next'}));
  assert.equal(specific.get('query.term'),'remyelination');assert.equal(specific.get('pageToken'),'next');assert.match(specific.get('filter.advanced'),/MinimumAge\]RANGE\[MIN,65 years\]/);assert.match(specific.get('filter.advanced'),/MaximumAge\]RANGE\[65 years,MAX\]/);assert.match(specific.get('fields'),/MinimumAge,MaximumAge/);
  const range=searchParameters(new URLSearchParams({condition:'multiple sclerosis',ageMin:'50',ageMax:'75',phase:'PHASE2,PHASE3'}));
  assert.match(range.get('filter.advanced'),/MinimumAge\]RANGE\[MIN,75 years\]/);assert.match(range.get('filter.advanced'),/MaximumAge\]RANGE\[50 years,MAX\]/);assert.match(range.get('filter.advanced'),/NOT AREA\[MaximumAge\]/);assert.match(range.get('filter.advanced'),/Phase/);
  for(const value of ['-1','121','65 years','NaN','Infinity'])assert.throws(()=>searchParameters(new URLSearchParams({age:value})));
  assert.throws(()=>searchParameters(new URLSearchParams({ageMin:'75',ageMax:'50'})));
  assert.throws(()=>searchParameters(new URLSearchParams({age:'65',ageMin:'50'})));
  assert.throws(()=>searchParameters(new URLSearchParams({term:'a'.repeat(251)})));
  assert.ok(searchParameters(new URLSearchParams({ageMin:'0.5'})).has('filter.advanced'));
});

test('assistant translates plain-language age and study-term searches into registry filters',async()=>{
  const env={OPENAI_API_KEY:'mock',CLINICAL_ACCESS_PASSWORD:'test-password-long-enough'};let aiCalls=0,query='';
  const server=createServer(async(url,options)=>{
    if(url.includes('openai.com')){const payload=JSON.parse(options.body);assert.ok(payload.text.format.schema.properties.search.anyOf[1].required.includes('ageMin'));aiCalls++;return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({reply:aiCalls===1?'Searching.':'Found MS studies with matching reported ages.',profile:null,search:aiCalls===1?{term:'fatigue',condition:'multiple sclerosis',age:'',ageMin:'50',ageMax:'75',location:'United States',status:'',sponsor:'',phase:'',studyType:'',treatment:''}:null})}]}]});}
    query=url;return Response.json({totalCount:1,studies:[{protocolSection:{identificationModule:{nctId:'NCT88888888',briefTitle:'Fatigue study'},eligibilityModule:{minimumAge:'18 Years',maximumAge:'65 Years'}}}]});
  },env);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body,cookie)=>fetch(base+'/api/assistant/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Request':'1',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try{const cookie=(await post('login',{password:env.CLINICAL_ACCESS_PASSWORD})).headers.get('set-cookie').split(';')[0];const r=await post('chat',{message:'Find MS fatigue studies in the US for ages 50–75'},cookie);assert.equal(r.status,200);const data=await r.json();assert.equal(data.query.ageMin,'50');assert.equal(data.data.totalCount,1);const parsed=new URL(query);assert.equal(parsed.searchParams.get('query.term'),'fatigue');assert.match(parsed.searchParams.get('filter.advanced'),/75 years/);}finally{await new Promise(r=>server.close(r));}
});
