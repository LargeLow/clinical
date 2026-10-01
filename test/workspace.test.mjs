import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server.mjs';
import {createStore} from '../workspace.mjs';
const headers={'Content-Type':'application/json','X-Clinical-Request':'1'};
async function start(env,fetcher){const server=createServer(fetcher,env);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;return{server,call:(path,value,cookie='')=>fetch(base+'/api/workspace/'+path,{method:value===undefined?'GET':'POST',headers:{...headers,Cookie:cookie},...(value===undefined?{}:{body:JSON.stringify(value)})}),login:()=>fetch(base+'/api/assistant/login',{method:'POST',headers,body:JSON.stringify({password:env.CLINICAL_ACCESS_PASSWORD})})};}
const close=server=>new Promise(r=>server.close(r));
test('workspace requires assistant access; owner access is separate; data and feedback survive restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clinical-test-'));const env={OPENAI_API_KEY:'not-a-real-key',CLINICAL_ACCESS_PASSWORD:'nikki-test-password',CLINICAL_ADMIN_PASSWORD:'joe-test-password',CLINICAL_DATA_DIR:dir,RESEND_API_KEY:'email-secret-test',FEEDBACK_FROM:'joe@example.com'};let emailCalls=0,failEmail=true;
 const fetcher=async(url,opt)=>{assert.equal(url,'https://api.resend.com/emails');emailCalls++;assert.equal(opt.headers.Authorization,'Bearer email-secret-test');const message=JSON.parse(opt.body);assert.deepEqual(message.to,['joe@uptechprojects.com']);assert.match(message.text,/Better exports/);return new Response('',{status:failEmail?503:200});};
 let app=await start(env,fetcher);
 try{
 assert.equal((await app.call('load')).status,401);const login=await app.login();const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/Path=\/api;/);
 assert.equal((await app.call('save',{answers:{territory:'Utah'},step:2,profile:{territory:'Utah'}},cookie)).status,200);
 assert.equal((await app.call('owner-list',undefined,cookie)).status,401);
 assert.equal((await app.call('feedback',{id:'invalid',message:'Test',priority:'Normal'},cookie)).status,400);
 const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';const submission={id,message:'Better exports',priority:'High'};
 const feedback=await app.call('feedback',submission,cookie);assert.equal(feedback.status,200);assert.equal((await feedback.json()).notification,'failed');assert.equal((await app.call('load',undefined,cookie)).status,200);
 assert.equal((await app.call('owner-login',{password:'wrong'})).status,401);const ownerLogin=await app.call('owner-login',{password:env.CLINICAL_ADMIN_PASSWORD});const owner=ownerLogin.headers.get('set-cookie').split(';')[0];
 failEmail=false;assert.equal((await (await app.call('owner-retry',{id},owner)).json()).notification,'sent');assert.equal(emailCalls,2);
 await app.call('feedback',submission,cookie);assert.equal(emailCalls,2);const list=await (await app.call('owner-list',undefined,owner)).json();assert.equal(list.suggestions.length,1);assert.equal(list.suggestions[0].context,'');assert.doesNotMatch(JSON.stringify(list),/email-secret-test/);
 assert.equal((await app.call('owner-update',{id,stage:'Invented',response:''},owner)).status,400);assert.equal((await app.call('owner-update',{id,stage:'Planned',response:'I will add columns.'},owner)).status,200);
 await close(app.server);app=await start(env,fetcher);assert.equal((await app.call('load',undefined,cookie)).status,401);const fresh=(await app.login()).headers.get('set-cookie').split(';')[0];const saved=await (await app.call('load',undefined,fresh)).json();assert.equal(saved.onboarding.answers.territory,'Utah');assert.equal(saved.onboarding.step,2);assert.equal(saved.profile.territory,'Utah');assert.equal(saved.suggestions[0].stage,'Planned');assert.equal(saved.suggestions[0].response,'I will add columns.');
 }finally{await close(app.server);await rm(dir,{recursive:true,force:true});}
});
test('atomic storage serializes simultaneous submissions and does not erase corrupt data',async()=>{const dir=await mkdtemp(join(tmpdir(),'clinical-store-'));try{const store=createStore(dir);await Promise.all(Array.from({length:20},(_,i)=>store.update(d=>d.suggestions.push({id:i}))));assert.equal((await store.read()).suggestions.length,20);const {writeFile}=await import('node:fs/promises');const path=join(dir,'clinical-workspace.json');await writeFile(path,'broken');await assert.rejects(store.update(d=>d.profile={}),/could not be read/);assert.equal(await readFile(path,'utf8'),'broken');}finally{await rm(dir,{recursive:true,force:true});}});
test('unconfigured durable storage rejects submission rather than losing it on restart',async()=>{const app=await start({OPENAI_API_KEY:'test',CLINICAL_ACCESS_PASSWORD:'nikki-test-password'});try{const cookie=(await app.login()).headers.get('set-cookie').split(';')[0];const r=await app.call('feedback',{id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',message:'Test',priority:'Normal'},cookie);assert.equal(r.status,503);assert.match((await r.json()).error,/storage setup/);}finally{await close(app.server);}});
