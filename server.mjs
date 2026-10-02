import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAssistant } from './assistant.mjs';
import { createWorkspace } from './workspace.mjs';
import { createAttachments } from './attachments.mjs';

const apiBase = 'https://clinicaltrials.gov/api/v2';
const statuses = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED', 'ENROLLING_BY_INVITATION', 'TERMINATED', 'WITHDRAWN', 'SUSPENDED', 'UNKNOWN']);
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/workspace.js',['workspace.js','text/javascript']]]);
const cache = new Map();

export function searchParameters(input) {
  const params = new URLSearchParams({format:'json', pageSize:'20', countTotal:'true', sort:'@relevance'});
  for (const [key, target] of [['term','query.term'], ['condition','query.cond'], ['treatment','query.intr'], ['location','query.locn'], ['sponsor','query.spons']]) {
    const value = (input.get(key) || '').trim();
    if (value.length > 250) throw new Error('Search terms must be 250 characters or fewer.');
    if (value) params.set(target, value);
  }
  const values = key => [...new Set(input.getAll(key).flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean))];
  const selectedStatuses = values('status');
  if (selectedStatuses.length) {
    if (selectedStatuses.some(v => !statuses.has(v))) throw new Error('Choose valid recruitment statuses.');
    params.set('filter.overallStatus', selectedStatuses.join(','));
  }
  const filters=[];
  const usOnly=input.get('usOnly')!=='false';
  if(usOnly)filters.push('AREA[LocationCountry]"United States"');
  const phases=values('phase');
  if(phases.length) {if(phases.some(v=>!['EARLY_PHASE1','PHASE1','PHASE2','PHASE3','PHASE4','NA'].includes(v))) throw new Error('Choose valid study phases.');filters.push(phases.length===1?'AREA[Phase]'+phases[0]:'('+phases.map(v=>'AREA[Phase]'+v).join(' OR ')+')');}
  const type=input.get('studyType');
  if(type) {if(!['INTERVENTIONAL','OBSERVATIONAL'].includes(type)) throw new Error('Choose a valid study type.');filters.push('AREA[StudyType]'+type);}
  const ageValue=key=>{const value=(input.get(key)||'').trim();if(!value)return null;if(!/^\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Number(value)>120)throw new Error('Enter an age from 0 to 120 years.');return Number(value);};
  const age=ageValue('age'),ageMin=ageValue('ageMin'),ageMax=ageValue('ageMax');
  if(age!==null&&(ageMin!==null||ageMax!==null))throw new Error('Choose a specific age or an age range, not both.');
  if(ageMin!==null&&ageMax!==null&&ageMin>ageMax)throw new Error('The youngest age must not exceed the oldest age.');
  const lower=age??ageMin,upper=age??ageMax;
  if(lower!==null||upper!==null){
    // Match overlap in the registry, including one-sided age limits but excluding records with neither limit reported.
    if(upper!==null)filters.push('(AREA[MinimumAge]RANGE[MIN,'+upper+' years] OR NOT AREA[MinimumAge]RANGE[MIN,MAX])');
    if(lower!==null)filters.push('(AREA[MaximumAge]RANGE['+lower+' years,MAX] OR NOT AREA[MaximumAge]RANGE[MIN,MAX])');
    filters.push('(AREA[MinimumAge]RANGE[MIN,MAX] OR AREA[MaximumAge]RANGE[MIN,MAX])');
  }
  if(filters.length) params.set('filter.advanced',filters.join(' AND '));
  if (filters.length===(usOnly?1:0) && !['query.term','query.cond','query.intr','query.locn','query.spons','filter.overallStatus'].some(key => params.has(key))) throw new Error('Enter a condition, sponsor, treatment, location, or study filter.');
  const token = input.get('pageToken');
  if (token) {
    if (token.length > 10000) throw new Error('Invalid page token.');
    params.set('pageToken',token);
    params.delete('countTotal');
  }
  params.set('fields', 'NCTId,BriefTitle,OverallStatus,BriefSummary,Condition,Phase,StudyType,LeadSponsorName,LeadSponsorClass,InterventionName,EnrollmentCount,StartDate,LocationFacility,LocationCity,LocationState,LocationCountry,CentralContactName,CentralContactRole,CentralContactPhone,CentralContactPhoneExt,CentralContactEMail,LocationContactName,LocationContactRole,LocationContactPhone,LocationContactPhoneExt,LocationContactEMail,LastUpdatePostDate,MinimumAge,MaximumAge,StdAge');
  return params;
}

async function upstream(path, fetcher) {
  const cached = cache.get(path);
  if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetcher(apiBase + path, {signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
  if (!response.ok) {
    const error = new Error(response.status === 400 ? 'ClinicalTrials.gov could not process this search. Try simpler terms.' : 'ClinicalTrials.gov is temporarily unavailable. Please try again.');
    error.status = response.status === 400 ? 400 : 502;
    throw error;
  }
  const value = await response.json();
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(path, {value,expires:Date.now()+5*60*1000});
  return value;
}

export function createServer(fetcher = fetch, env = process.env) {
  const assistant=createAssistant({fetcher,env,getStudy:async id=>upstream('/studies/'+id,fetcher),search:async input=>upstream('/studies?'+searchParameters(input),fetcher)});
  const attachments=createAttachments({env,authenticated:assistant.authenticated});
  assistant.setAttachments(attachments);
  const workspace=createWorkspace({env,fetcher,authenticated:assistant.authenticated});
  const server=http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, value) => {
      if(res.headersSent) {res.end(JSON.stringify(status>=400?{type:'error',...value}:{type:'result',...value})+'\n');return;}
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url,'http://localhost');
      if(await attachments.handle(req,res,url,json)) return;
      if(await assistant(req,res,url,json)) return;
      if(await workspace(req,res,url,json)) return;
      if (req.method !== 'GET') return json(405,{error:'Method not allowed.'});
      if (url.pathname === '/health') return json(200,{status:'ok'});
      if (url.pathname === '/api/studies') {
        let params;
        try {params = searchParameters(url.searchParams);} catch (error) {return json(400,{error:error.message});}
        return json(200,await upstream('/studies?'+params,fetcher));
      }
      if (url.pathname.startsWith('/api/studies/')) {
        const id = url.pathname.slice('/api/studies/'.length);
        if (!/^NCT\d{8}$/.test(id)) return json(400,{error:'Invalid study identifier.'});
        return json(200,await upstream('/studies/'+id,fetcher));
      }
      const asset = staticFiles.get(url.pathname);
      if (!asset) return json(404,{error:'Not found.'});
      const body = await readFile(new URL('./public/'+asset[0],import.meta.url));
      res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8'});res.end(body);
    } catch (error) {
      json(error.status || 502,{error:error.status ? error.message : 'The study service did not respond. Please try again shortly.'});
    }
  });
  server.on('close',attachments.close);return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(Number(process.env.PORT || 3000),'0.0.0.0',() => console.log('Clinical listening on port '+(process.env.PORT || 3000)));
}
