import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAssistant } from './assistant.mjs';

const apiBase = 'https://clinicaltrials.gov/api/v2';
const statuses = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED', 'ENROLLING_BY_INVITATION', 'TERMINATED', 'WITHDRAWN', 'SUSPENDED', 'UNKNOWN']);
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const cache = new Map();

export function searchParameters(input) {
  const params = new URLSearchParams({format:'json', pageSize:'20', countTotal:'true', sort:'@relevance'});
  for (const [key, target] of [['condition','query.cond'], ['treatment','query.intr'], ['location','query.locn'], ['sponsor','query.spons']]) {
    const value = (input.get(key) || '').trim();
    if (value.length > 250) throw new Error('Search terms must be 250 characters or fewer.');
    if (value) params.set(target, value);
  }
  const status = input.get('status');
  if (status) {
    if (!statuses.has(status)) throw new Error('Choose a valid recruitment status.');
    params.set('filter.overallStatus', status);
  }
  const filters=[];
  const phase=input.get('phase');
  if(phase) {if(!['EARLY_PHASE1','PHASE1','PHASE2','PHASE3','PHASE4','NA'].includes(phase)) throw new Error('Choose a valid study phase.');filters.push('AREA[Phase]'+phase);}
  const type=input.get('studyType');
  if(type) {if(!['INTERVENTIONAL','OBSERVATIONAL'].includes(type)) throw new Error('Choose a valid study type.');filters.push('AREA[StudyType]'+type);}
  if(filters.length) params.set('filter.advanced',filters.join(' AND '));
  if (!['query.cond','query.intr','query.locn','query.spons','filter.overallStatus','filter.advanced'].some(key => params.has(key))) throw new Error('Enter a condition, sponsor, treatment, location, or study filter.');
  const token = input.get('pageToken');
  if (token) {
    if (token.length > 10000) throw new Error('Invalid page token.');
    params.set('pageToken',token);
    params.delete('countTotal');
  }
  params.set('fields', 'NCTId,BriefTitle,OverallStatus,BriefSummary,Condition,Phase,StudyType,LeadSponsorName,LeadSponsorClass,InterventionName,EnrollmentCount,StartDate,LocationFacility,LocationCity,LocationState,LocationCountry,LastUpdatePostDate');
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
  const assistant=createAssistant({fetcher,env,search:async input=>upstream('/studies?'+searchParameters(input),fetcher)});
  return http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, value) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try {
      const url = new URL(req.url,'http://localhost');
      if(await assistant(req,res,url,json)) return;
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(Number(process.env.PORT || 3000),'0.0.0.0',() => console.log('Clinical listening on port '+(process.env.PORT || 3000)));
}
