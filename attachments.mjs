import { mkdir, open, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';

export const attachmentLimit=49*1024*1024; // Leave room beneath the provider's combined 50 MB request ceiling.
const types={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',rtf:'application/rtf',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',ppt:'application/vnd.ms-powerpoint',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv',tsv:'text/tab-separated-values',txt:'text/plain',md:'text/markdown'};
function fail(status,message){throw Object.assign(new Error(message),{status});}
export function createAttachments({env=process.env,authenticated,now=Date.now}={}){
  const root=join(env.CLINICAL_DATA_DIR||tmpdir(),'clinical-attachments');
  let sweep=Promise.resolve(),uploading=false;
  const owner=req=>createHash('sha256').update((req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('clinical_session='))||'').digest('hex');
  const path=(id,suffix)=>join(root,id+suffix);
  const valid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
  const remove=async id=>{await Promise.all([rm(path(id,'.json'),{force:true}),rm(path(id,'.bin'),{force:true})]);};
  async function cleanup(){const work=sweep.then(async()=>{await mkdir(root,{recursive:true,mode:0o700});for(const name of await readdir(root)){if(!name.endsWith('.json'))continue;const id=name.slice(0,-5);if(!valid(id))continue;try{const m=JSON.parse(await readFile(path(id,'.json'),'utf8'));if(m.expiresAt<=now())await remove(id);}catch{await remove(id);}}});sweep=work.catch(()=>{});return work;}
  const timer=setInterval(()=>cleanup().catch(()=>{}),60000);timer.unref();
  const publicItem=m=>({id:m.id,name:m.name,size:m.size,type:m.type,expiresAt:m.expiresAt,warning:m.warning});
  async function list(req){await cleanup();const result=[];for(const name of await readdir(root)){if(!name.endsWith('.json'))continue;try{const m=JSON.parse(await readFile(join(root,name),'utf8'));if(m.owner===owner(req)&&m.expiresAt>now())result.push(m);}catch{}}return result;}
  async function get(req,id){if(!valid(id))fail(400,'Invalid attachment.');let m;try{m=JSON.parse(await readFile(path(id,'.json'),'utf8'));}catch{fail(404,'This attachment is no longer available. Please attach it again.');}if(m.owner!==owner(req))fail(404,'This attachment is not available in this session.');if(m.expiresAt<=now()){await remove(id);fail(410,'This attachment expired. Please attach it again.');}return m;}
  async function inputs(req,ids=[]){if(!Array.isArray(ids)||ids.some(id=>!valid(id)))fail(400,'Choose valid attachments.');const records=await Promise.all([...new Set(ids)].map(id=>get(req,id)));if(records.reduce((n,m)=>n+m.size,0)>attachmentLimit)fail(413,'These files exceed the AI provider’s combined 50 MB ceiling. Remove a file and retry.');const content=[];for(const m of records){const bytes=await readFile(path(m.id,'.bin'));content.push({type:'input_text',text:'Attachment: '+m.name+(m.warning?'\nReading limitation: '+m.warning:'')});const data='data:'+m.type+';base64,'+bytes.toString('base64');content.push(m.type.startsWith('image/')?{type:'input_image',image_url:data,detail:'auto'}:{type:'input_file',filename:m.name,file_data:data});}return content;}
  async function handle(req,res,url,json){
    if(!url.pathname.startsWith('/api/attachments'))return false;
    if(!authenticated(req))fail(401,'Unlock the assistant before attaching files.');
    if(url.pathname==='/api/attachments'&&req.method==='GET'){json(200,{files:(await list(req)).map(publicItem),maxBytes:attachmentLimit});return true;}
    if(req.headers['x-clinical-request']!=='1')fail(403,'Please use the Clinical interface.');
    if(url.pathname.startsWith('/api/attachments/')&&req.method==='DELETE'){const id=url.pathname.slice('/api/attachments/'.length);await get(req,id);await remove(id);json(200,{ok:true});return true;}
    if(url.pathname!=='/api/attachments'||req.method!=='POST')fail(405,'Method not allowed.');
    if(uploading)fail(429,'Another file is uploading. Please retry in a moment.');
    let name;try{name=decodeURIComponent(req.headers['x-filename']||'');}catch{fail(400,'Invalid filename.');}
    name=name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g,'').slice(0,180);
    const ext=extname(name).slice(1).toLowerCase(),type=types[ext];
    if(!type)fail(415,['heic','heif'].includes(ext)?'Export this phone photo as JPG or PNG first.':ext==='msg'?'Save this Outlook email as PDF or paste its text for now.':'Supported: PDF, images, Word, PowerPoint, Excel, CSV/TSV, TXT and Markdown.');
    const files=await list(req),existingSize=files.reduce((n,m)=>n+m.size,0),declared=Number(req.headers['content-length']||0);
    if(declared&&existingSize+declared>attachmentLimit)fail(413,'These files exceed the AI provider’s combined 50 MB ceiling. Remove a file and retry.');
    uploading=true;const id=randomUUID();let handle,size=0,prefix=Buffer.alloc(0);
    try{
      handle=await open(path(id,'.bin'),'wx',0o600);
      for await(const chunk of req){size+=chunk.length;if(size+existingSize>attachmentLimit)fail(413,'These files exceed the AI provider’s combined 50 MB ceiling.');if(prefix.length<512)prefix=Buffer.concat([prefix,chunk]).subarray(0,512);await handle.writeFile(chunk);}
      await handle.close();handle=null;if(!size)fail(400,'This file is empty.');
      const zip=prefix.subarray(0,2).toString()==='PK',ole=prefix.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1';
      const okay=ext==='pdf'?prefix.includes(Buffer.from('%PDF-')):ext==='png'?prefix.subarray(0,8).toString('hex')==='89504e470d0a1a0a':['jpg','jpeg'].includes(ext)?prefix[0]===255&&prefix[1]===216:ext==='webp'?prefix.subarray(0,4).toString()==='RIFF'&&prefix.subarray(8,12).toString()==='WEBP':ext==='gif'?/^GIF8[79]a/.test(prefix.toString()):['docx','pptx','xlsx'].includes(ext)?zip:['doc','ppt','xls'].includes(ext)?ole:ext==='rtf'?prefix.toString().startsWith('{\\rtf'):!prefix.includes(0);
      if(!okay)fail(415,'The file content does not match its type. Export a fresh copy and try again.');
      const warning=['xlsx','xls','csv','tsv'].includes(ext)?'The AI reads up to the first 1,000 rows per sheet. For a larger table, attach the relevant subset; calculations should be checked in Excel.':['docx','doc','pptx','ppt','rtf'].includes(ext)?'Text is read; embedded charts and images are not. Export to PDF if those matter.':'';
      const m={id,name,size,type,owner:owner(req),expiresAt:now()+86400000,warning};await writeFile(path(id,'.json'),JSON.stringify(m),{mode:0o600});json(201,{file:publicItem(m)});return true;
    }catch(e){if(handle)await handle.close().catch(()=>{});await remove(id);throw e;}finally{uploading=false;}
  }
  cleanup().catch(()=>{});
  return {handle,inputs,close:()=>clearInterval(timer)};
}
