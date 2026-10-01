import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { cleanProfile } from './assistant.mjs';

export const questions = [
  {id:'goals',title:'What would you most like help with?',hint:'Finding studies, adding sites, sponsor/CRO relationships, or PI visibility.'},
  {id:'territory',title:'Which states and clinics do you cover?',hint:'Include occasional coverage. Anything uncertain can stay blank.'},
  {id:'fit',title:'Which indications, investigators and clinic capabilities are priorities?',hint:'Research interests, equipment, experience and capacity you can confirm.'},
  {id:'workflow',title:'Walk through your last study opportunity. Where did you spend the most time?',hint:'From discovering a study through contacts and feasibility.'},
  {id:'pipeline',title:'How do you track contacts and follow-ups today?',hint:'What would make an opportunity shortlist useful?'},
  {id:'visibility',title:'Which CRO or investigator platforms do you use?',hint:'Where do registrations, profiles or updates get stuck?'},
  {id:'monitoring',title:'Which searches would you repeat, and which changes deserve an alert?',hint:'New studies, added sites, recruitment changes or recent updates.'},
  {id:'outputs',title:'What would make an Excel export or Grok/Claude handoff useful?',hint:'Preferred columns, summaries, formats and missing context.'},
  {id:'priorities',title:'What should Joe build first, and what would success look like?',hint:'Describe one improvement that would save you time.'}
];
const stages=['New','Reviewing','Planned','Shipped'];
const initial=()=>({version:1,onboarding:{answers:{},step:0,completed:false},profile:cleanProfile(),suggestions:[]});
function fail(status,message){throw Object.assign(new Error(message),{status});}
const text=(v,n=3000)=>typeof v==='string'?v.trim().slice(0,n):'';
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>50000)fail(413,'This submission is too large.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail(400,'Send a valid submission.');}}
export function createStore(directory){
  let queue=Promise.resolve();
  const file=directory?join(directory,'clinical-workspace.json'):null;
  async function read(){if(!file)fail(503,'Shared saving is awaiting storage setup. Your draft has not been submitted.');try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return initial();if(e.status)throw e;fail(503,'Saved workspace could not be read. Please try again later.');}}
  function update(fn){const task=queue.then(async()=>{const data=await read();const result=fn(data);await mkdir(directory,{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';const handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(data));await handle.sync();}finally{await handle.close();}await rename(temp,file);return result;});queue=task.catch(()=>{});return task;}
  return {read:()=>queue.then(read),update};
}
export function createWorkspace({env=process.env,fetcher=fetch,authenticated}={}){
  const store=createStore(env.CLINICAL_DATA_DIR);
  const secret=randomBytes(32);let attempts=0,window=0;const notifying=new Set();
  const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
  const sign=s=>createHmac('sha256',secret).update(s).digest('hex');
  const owner=req=>{const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('clinical_owner='))?.slice(15)||'';const [expiry,sig]=token.split('.');return Boolean(sig && Number(expiry)>Date.now() && equal(sig,sign(expiry)));};
  const mailReady=()=>Boolean(env.RESEND_API_KEY && env.FEEDBACK_FROM);
  const publicItem=s=>({id:s.id,message:s.message,priority:s.priority,createdAt:s.createdAt,stage:s.stage,response:s.response,notification:s.notification,context:s.context});
  async function notify(id){
    if(notifying.has(id))return 'pending';notifying.add(id);
    try{const data=await store.read();const s=data.suggestions.find(x=>x.id===id);if(!s || s.notification==='sent')return s?.notification;
      if(!mailReady())return 'pending';
      let status='failed';try{const r=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'clinical-feedback-'+id},body:JSON.stringify({from:env.FEEDBACK_FROM,to:['joe@uptechprojects.com'],subject:'Clinical suggestion '+id.slice(0,8)+' — '+s.priority,text:'Nikki sent a suggestion.\n\n'+s.message+'\n\nPriority: '+s.priority+'\nSubmitted: '+s.createdAt+'\n'+(s.context?'\nContext Nikki chose to share:\n'+s.context+'\n':'')})});if(r.ok)status='sent';}catch{}
      await store.update(d=>{d.suggestions.find(x=>x.id===id).notification=status;});return status;
    }finally{notifying.delete(id);}
  }
  return async(req,res,url,json)=>{
    if(!url.pathname.startsWith('/api/workspace/'))return false;
    const route=url.pathname.slice('/api/workspace/'.length);
    if(route==='status' && req.method==='GET'){json(200,{storage:Boolean(env.CLINICAL_DATA_DIR),email:mailReady(),ownerConfigured:(env.CLINICAL_ADMIN_PASSWORD||'').length>=12,owner:owner(req),questions});return true;}
    if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
    if(req.method==='POST' && (req.headers['x-clinical-request']!=='1' || !req.headers['content-type']?.startsWith('application/json')))fail(403,'Please use the Clinical interface.');
    if(route==='owner-login' && req.method==='POST'){
      if((env.CLINICAL_ADMIN_PASSWORD||'').length<12)fail(503,'Owner access is awaiting setup.');
      if(Date.now()-window>3600000){window=Date.now();attempts=0;}if(++attempts>20)fail(429,'Too many owner sign-in attempts. Try again in an hour.');
      const value=await body(req);if(typeof value.password!=='string'||!equal(value.password,env.CLINICAL_ADMIN_PASSWORD))fail(401,'That owner password did not match.');
      const expiry=String(Date.now()+43200000);res.setHeader('Set-Cookie',`clinical_owner=${expiry}.${sign(expiry)}; HttpOnly; Secure; SameSite=Strict; Path=/api/workspace; Max-Age=43200`);json(200,{ok:true});return true;
    }
    if(route==='owner-logout' && req.method==='POST'){res.setHeader('Set-Cookie','clinical_owner=; HttpOnly; Secure; SameSite=Strict; Path=/api/workspace; Max-Age=0');json(200,{ok:true});return true;}
    const isOwner=owner(req);
    if(route.startsWith('owner-')?!isOwner:!authenticated(req))fail(401,'Unlock '+(route.startsWith('owner-')?'the owner inbox':'the assistant')+' first.');
    if(route==='load' && req.method==='GET'){const d=await store.read();json(200,{onboarding:d.onboarding,profile:d.profile,suggestions:d.suggestions.map(publicItem)});return true;}
    if(route==='save' && req.method==='POST'){
      const v=await body(req);const answers=Object.fromEntries(questions.map(q=>[q.id,text(v.answers?.[q.id])]));const step=Math.max(0,Math.min(questions.length,Math.trunc(Number(v.step)||0)));
      await store.update(d=>{d.onboarding={answers,step,completed:v.completed===true};if(v.profile)d.profile=cleanProfile(v.profile);});json(200,{ok:true});return true;
    }
    if(route==='feedback' && req.method==='POST'){
      const v=await body(req);const message=text(v.message);if(!message)fail(400,'Describe your suggestion before sending.');if(!['Normal','High','Low'].includes(v.priority))fail(400,'Choose a valid priority.');if(!/^[0-9a-f-]{36}$/i.test(v.id||''))fail(400,'Invalid submission identifier.');
      const item=await store.update(d=>{const existing=d.suggestions.find(x=>x.id===v.id);if(existing)return existing;if(d.suggestions.length>=1000)fail(429,'The suggestion inbox is full. Please contact Joe directly.');const s={id:v.id,message,priority:v.priority,context:text(v.context,12000),createdAt:new Date().toISOString(),stage:'New',response:'',notification:'pending'};d.suggestions.push(s);return s;});
      const notification=await notify(item.id);json(200,{...publicItem(item),notification});return true;
    }
    if(route==='owner-list' && req.method==='GET'){const d=await store.read();json(200,{suggestions:d.suggestions.map(publicItem)});return true;}
    if(route==='owner-update' && req.method==='POST'){const v=await body(req);if(!stages.includes(v.stage))fail(400,'Choose a valid stage.');await store.update(d=>{const s=d.suggestions.find(x=>x.id===v.id);if(!s)fail(404,'Suggestion not found.');s.stage=v.stage;s.response=text(v.response);});json(200,{ok:true});return true;}
    if(route==='owner-retry' && req.method==='POST'){const v=await body(req);if(!(await store.read()).suggestions.some(x=>x.id===v.id))fail(404,'Suggestion not found.');json(200,{notification:await notify(v.id)});return true;}
    fail(404,'Not found.');
  };
}
