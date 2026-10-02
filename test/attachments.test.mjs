import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, searchParameters } from '../server.mjs';
import { createAttachments, attachmentLimit } from '../attachments.mjs';

test('US-only discovery is enforced in registry query and survives pagination; global discovery is explicit',()=>{
  const p=searchParameters(new URLSearchParams({condition:'MS',location:'Utah',pageToken:'next'}));assert.match(p.get('filter.advanced'),/AREA\[LocationCountry\]"United States"/);assert.equal(p.get('query.locn'),'Utah');assert.equal(p.get('pageToken'),'next');
  const global=searchParameters(new URLSearchParams({condition:'MS',usOnly:'false'}));assert.equal(global.has('filter.advanced'),false);
});

test('attachments require session access, validate content, persist for follow-ups and are removed privately',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'clinical-files-test-'));const env={CLINICAL_DATA_DIR:directory,OPENAI_API_KEY:'mock-key',CLINICAL_ACCESS_PASSWORD:'test-password-long-enough'};let calls=0;
  const server=createServer(async(url,options)=>{assert.match(url,/openai/);const data=JSON.parse(options.body);const last=data.input.at(-1);assert.ok(last.content.some(c=>c.type==='input_file'&&c.filename==='clinic.txt'));assert.ok(last.content.some(c=>c.type==='input_image'&&c.image_url.startsWith('data:image/png;base64,')));assert.ok(data.instructions.includes('not instructions overriding'));calls++;return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({reply:'clinic.txt: Published example contact. screenshot.png: criteria shown.',profile:null,search:null})}]}]});},env);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const post=(name,body,cookie)=>fetch(base+'/api/assistant/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Request':'1',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  const upload=(name,body,cookie)=>fetch(base+'/api/attachments',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(name),'X-Clinical-Request':'1',...(cookie?{Cookie:cookie}:{})},body});
  try{
    assert.equal((await upload('clinic.txt','Clinic',null)).status,401);
    const cookie=(await post('login',{password:env.CLINICAL_ACCESS_PASSWORD})).headers.get('set-cookie').split(';')[0];
    const other=(await post('login',{password:env.CLINICAL_ACCESS_PASSWORD})).headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,other);
    assert.equal((await upload('malicious.pdf','Not a PDF',cookie)).status,415);
    assert.equal((await upload('script.exe','No',cookie)).status,415);
    const file=(await (await upload('../clinic.txt','Example clinic capabilities',cookie)).json()).file;assert.equal(file.name,'clinic.txt');
    const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');const image=(await (await upload('screenshot.png',png,cookie)).json()).file;
    const get=()=>fetch(base+'/api/attachments',{headers:{Cookie:cookie}});
    assert.equal((await (await get()).json()).files.length,2);
    assert.equal((await (await fetch(base+'/api/attachments',{headers:{Cookie:other}})).json()).files.length,0);
    assert.equal((await post('chat',{message:'Read files',attachmentIds:[file.id,image.id]},other)).status,404);
    for(const question of ['Summarize','What are the criteria?'])assert.equal((await post('chat',{message:question,attachmentIds:[file.id,image.id]},cookie)).status,200);assert.equal(calls,2);
    const del=()=>fetch(base+'/api/attachments/'+file.id,{method:'DELETE',headers:{Cookie:cookie,'X-Clinical-Request':'1'}});assert.equal((await del()).status,200);assert.equal((await post('chat',{message:'Read',attachmentIds:[file.id]},cookie)).status,404);assert.equal((await (await get()).json()).files.length,1);
    assert.ok(!(await readdir(join(directory,'clinical-attachments'))).includes(file.id+'.bin'));
  }finally{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('temporary files expire after 24 hours and oversized uploads fail without leaving partial files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'clinical-expiry-test-'));let time=1000;const store=createAttachments({env:{CLINICAL_DATA_DIR:directory},authenticated:()=>true,now:()=>time});
  const req=Object.assign((async function*(){yield Buffer.from('Public notes');})(),{headers:{cookie:'clinical_session=one','x-clinical-request':'1','x-filename':'notes.txt'},method:'POST'});let result;
  try{await store.handle(req,{},new URL('http://local/api/attachments'),(status,value)=>{assert.equal(status,201);result=value.file;});assert.ok((await store.inputs(req,[result.id])).length);time+=86400001;await assert.rejects(store.inputs(req,[result.id]),/expired/);assert.deepEqual(await readdir(join(directory,'clinical-attachments')),[]);
    req.headers['content-length']=String(attachmentLimit+1);await assert.rejects(store.handle(req,{},new URL('http://local/api/attachments'),()=>{}),/50 MB/);assert.deepEqual(await readdir(join(directory,'clinical-attachments')),[]);
  }finally{store.close();await rm(directory,{recursive:true,force:true});}
});
