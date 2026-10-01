const form = document.querySelector('#search-form');
const results = document.querySelector('#results');
const message = document.querySelector('#message');
const heading = document.querySelector('#results-heading');
const count = document.querySelector('#result-count');
const searchButton = document.querySelector('#search-button');
const more = document.querySelector('#load-more');
const dialog = document.querySelector('#study-dialog');
const details = document.querySelector('#study-content');
let parameters, nextToken, total, loaded = 0, searching = false, detailRequest = 0;
let currentStudies=[];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function friendly(value) {
  const labels = {NA:'Phase not applicable',EARLY_PHASE1:'Early phase 1',PHASE1:'Phase 1',PHASE2:'Phase 2',PHASE3:'Phase 3',PHASE4:'Phase 4',ACTIVE_NOT_RECRUITING:'Active, not recruiting',NOT_YET_RECRUITING:'Not yet recruiting'};
  return labels[value] || (value || 'Not reported').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
}
async function request(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(25000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to retrieve studies. Please try again.');
  return data;
}
function note(text,error=false) {message.textContent = text;message.className = error ? 'error' : '';}
function card(study) {
  const p = study.protocolSection || {};
  const id = p.identificationModule?.nctId;
  const status = p.statusModule?.overallStatus;
  const node = element('article',undefined,'study-card');
  const meta = element('div',undefined,'card-meta');
  meta.append(element('span',friendly(status),'status'+(status === 'RECRUITING' ? ' recruiting' : '')),element('span',id || ''));
  const summary = p.descriptionModule?.briefSummary || 'Open study details to learn more.';
  node.append(meta,element('h3',p.identificationModule?.briefTitle || 'Untitled study'),element('p',summary.length > 230 ? summary.slice(0,230)+'…' : summary,'summary'));
  node.append(element('p',(p.conditionsModule?.conditions || []).slice(0,3).join(' · ') || 'Condition not reported','card-info'));
  const phases = p.designModule?.phases;
  node.append(element('p','Sponsor: '+(p.sponsorCollaboratorsModule?.leadSponsor?.name || 'Not reported'),'card-info'));
  if (phases?.length) node.append(element('p',phases.map(friendly).join(' / '),'card-info'));
  const locations = p.contactsLocationsModule?.locations || [];
  const location = locations[0];
  node.append(element('p',location ? [location.city,location.state,location.country].filter(Boolean).join(', ')+(locations.length > 1 ? ' + '+(locations.length-1)+' more locations' : '') : 'Location not reported','card-info'));
  const bottom = element('div',undefined,'card-bottom');
  bottom.append(element('small','Updated '+(p.statusModule?.lastUpdatePostDateStruct?.date || 'date not reported')));
  const button = element('button','View study →','secondary');button.type = 'button';button.disabled = !/^NCT\d{8}$/.test(id);button.addEventListener('click',()=>showStudy(id));bottom.append(button);node.append(bottom);
  const save=element('button',shortlisted.has(id) ? 'Saved ✓' : 'Shortlist +','secondary');save.type='button';save.disabled=!id;save.addEventListener('click',()=>{if(shortlisted.size>=50 && !shortlisted.has(id)) return workspaceNote('Your shortlist has 50 studies. Remove one before adding another.');shortlisted.set(id,study);save.textContent='Saved ✓';renderShortlist();persist();});bottom.append(save);
  return node;
}
async function search(append=false) {
  if (searching) return;
  searching = true;searchButton.disabled = true;more.disabled = true;
  note(append ? 'Loading more studies…' : 'Searching ClinicalTrials.gov…');
  if (!append) {
    parameters = new URLSearchParams(new FormData(form));nextToken = undefined;total = undefined;loaded = 0;
    currentStudies=[];
    results.replaceChildren();results.className = 'cards';more.hidden = true;count.textContent = '';heading.textContent = 'Search results';
  }
  const query = new URLSearchParams(parameters);
  if (append && nextToken) query.set('pageToken',nextToken);
  try {
    const data = await request('/api/studies?'+query);
    if (!append) total = data.totalCount;
    const studies = data.studies || [];
    currentStudies.push(...studies);
    for (const study of studies) results.append(card(study));
    loaded += studies.length;nextToken = data.nextPageToken;more.hidden = !nextToken;
    count.textContent = 'Showing '+loaded.toLocaleString()+(typeof total === 'number' ? ' of '+total.toLocaleString()+' studies' : ' studies');
    note(loaded === 0 ? (nextToken ? 'No studies on this page. Load more to continue.' : 'No studies found. Try broader terms or a different recruitment status.') : '');
  } catch (error) {
    note(error.name === 'TimeoutError' ? 'The search took too long. Please try again.' : error.message,true);
  } finally {searching = false;searchButton.disabled = false;more.disabled = false;}
}
function section(title,text) {details.append(element('h3',title),element('p',text || 'Not reported.','prose'));}
async function showStudy(id) {
  const requestId = ++detailRequest;
  details.replaceChildren(element('p','Loading study details…'));
  dialog.showModal();
  try {
    const study = await request('/api/studies/'+id);
    if (requestId !== detailRequest || !dialog.open) return;
    const p = study.protocolSection || {};
    details.replaceChildren(element('span',id,'eyebrow'),element('h2',p.identificationModule?.briefTitle || 'Study details'),element('span',friendly(p.statusModule?.overallStatus),'status'));
    section('Study overview',p.descriptionModule?.briefSummary);
    section('Sponsor',p.sponsorCollaboratorsModule?.leadSponsor?.name);
    section('Study phase / type',[(p.designModule?.phases || []).map(friendly).join(' / '),friendly(p.designModule?.studyType)].join(' · '));
    section('Eligibility criteria',p.eligibilityModule?.eligibilityCriteria);
    const eligibility = p.eligibilityModule || {};
    section('Age and sex criteria',[eligibility.minimumAge ? 'Minimum age: '+eligibility.minimumAge : '',eligibility.maximumAge ? 'Maximum age: '+eligibility.maximumAge : '',eligibility.sex ? 'Sex: '+friendly(eligibility.sex) : ''].filter(Boolean).join('\n'));
    const contacts = p.contactsLocationsModule?.centralContacts || [];
    section('Study contacts',contacts.map(c=>[c.name,c.role,c.phone,c.email].filter(Boolean).join(' · ')).join('\n'));
    const locations = p.contactsLocationsModule?.locations || [];
    details.append(element('h3','Study locations'));
    if (!locations.length) details.append(element('p','No locations reported.'));
    else {
      const list = element('ul');
      for (const loc of locations) list.append(element('li',[loc.facility,loc.city,loc.state,loc.country,loc.status ? friendly(loc.status) : ''].filter(Boolean).join(' · ')));
      details.append(list);
    }
    section('Last updated',p.statusModule?.lastUpdatePostDateStruct?.date);
    details.append(element('p','Recruitment status describes patient enrollment; it does not confirm the sponsor is accepting additional sites. Registry contacts may be for patient inquiries. Confirm business development contacts separately.'));
    const link = element('a','View original record ↗','source-button');link.href = 'https://clinicaltrials.gov/study/'+id;link.target = '_blank';link.rel = 'noopener noreferrer';details.append(link);
  } catch (error) {if (requestId === detailRequest && dialog.open) details.replaceChildren(element('p',error.message));}
}
form.addEventListener('submit',event=>{event.preventDefault();search();});
more.addEventListener('click',()=>search(true));
document.querySelector('#close-dialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{detailRequest++;});
document.querySelectorAll('[data-condition]').forEach(button=>button.addEventListener('click',()=>{if(searching)return;form.reset();document.querySelector('#condition').value = button.dataset.condition;search();}));

const profileKeys=['territory','clinics','indications','investigators','studyPreferences','workingPreferences'];
const profileLabels={territory:'Territory / states',clinics:'Clinics',indications:'Indications',investigators:'Investigators',studyPreferences:'Study preferences',workingPreferences:'Working preferences'};
const emptyProfile=()=>Object.fromEntries(profileKeys.map(key=>[key,'']));
let onboardingContext={};
document.addEventListener('clinical-onboarding-context',e=>{onboardingContext=e.detail;});
let profile=emptyProfile(),proposedProfile=null,chatHistory=[],aiReady=false,aiUnlocked=false,chatBusy=false;
const shortlisted=new Map();
const profileForm=document.querySelector('#profile-form');
const remember=document.querySelector('#remember-profile');
const chatLog=document.querySelector('#conversation');
const chatInput=document.querySelector('#chat-message');
const chatSend=document.querySelector('#chat-send');
const workspaceNote=text=>document.querySelector('#workspace-notice').textContent=text;
document.addEventListener('clinical-shared-profile',e=>{profile=Object.fromEntries(profileKeys.map(k=>[k,e.detail[k]||'']));syncProfile();});
function syncProfile(){for(const key of profileKeys) profileForm.elements[key].value=profile[key] || '';}
function persist(){
  document.dispatchEvent(new CustomEvent('clinical-profile-saved',{detail:profile}));
  try {if(remember.checked) localStorage.setItem('clinical-workspace-v1',JSON.stringify({profile,shortlist:[...shortlisted.values()]}));else localStorage.removeItem('clinical-workspace-v1');}
  catch {workspaceNote('Browser storage is unavailable or full. Download a brief to keep your work.');}
}
try {
  const saved=JSON.parse(localStorage.getItem('clinical-workspace-v1') || 'null');
  if(saved){remember.checked=true;profile=Object.fromEntries(profileKeys.map(k=>[k,typeof saved.profile?.[k]==='string' ? saved.profile[k].slice(0,1500) : '']));for(const study of (Array.isArray(saved.shortlist) ? saved.shortlist.slice(0,50) : [])){const id=study?.protocolSection?.identificationModule?.nctId;if(/^NCT\d{8}$/.test(id)) shortlisted.set(id,study);}}
} catch {workspaceNote('Saved preferences could not be loaded. You can enter them again.');}
syncProfile();
function renderShortlist(){
  const list=document.querySelector('#shortlist');list.replaceChildren();
  document.querySelector('#shortlist-count').textContent=shortlisted.size+' studies';
  if(!shortlisted.size) list.append(element('p','Save promising studies from the results below.','workspace-note'));
  for(const [id,study] of shortlisted){const p=study.protocolSection;const row=element('div',undefined,'shortlist-row');const info=element('div');const link=element('a',p.identificationModule.briefTitle || id);link.href='https://clinicaltrials.gov/study/'+id;link.target='_blank';link.rel='noopener noreferrer';info.append(link,element('small',id+' · '+(p.sponsorCollaboratorsModule?.leadSponsor?.name || 'Sponsor not reported')));const remove=element('button','Remove','secondary');remove.type='button';remove.addEventListener('click',()=>{shortlisted.delete(id);renderShortlist();persist();});row.append(info,remove);list.append(row);}
}
renderShortlist();
profileForm.addEventListener('submit',event=>{event.preventDefault();profile=Object.fromEntries(profileKeys.map(k=>[k,profileForm.elements[k].value.trim()]));syncProfile();persist();workspaceNote(remember.checked ? 'Preferences saved on this browser.' : 'Preferences saved for this visit.');});
remember.addEventListener('change',()=>{persist();workspaceNote(remember.checked ? 'Current preferences and shortlist will be remembered on this browser.' : 'Saved browser data removed; current work remains available for this visit.');});
document.querySelector('#clear-workspace').addEventListener('click',()=>{profile=emptyProfile();shortlisted.clear();remember.checked=false;chatHistory=[];proposedProfile=null;document.querySelector('#profile-suggestion').hidden=true;chatLog.replaceChildren();greeting();syncProfile();renderShortlist();persist();workspaceNote('Preferences, shortlist, and conversation cleared.');});
function bubble(role,text){const b=element('div',undefined,'chat-bubble'+(role==='user'?' user':''));b.append(element('strong',role==='user'?'You':'Research assistant'),element('span',text));chatLog.append(b);chatLog.scrollTop=chatLog.scrollHeight;}
function greeting(){bubble('assistant','Hi Nikki. I can help with study opportunities, sponsor/CRO relationships, and PI visibility. Joe confirmed you cover business development nationwide for Nira. Which clinics or priorities would you like to focus on today? You can also skip this and tell me what you want to work on today.');}
greeting();
async function assistantRequest(path,value){const r=await fetch('/api/assistant/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Request':'1'},body:JSON.stringify(value),signal:AbortSignal.timeout(150000)});const data=await r.json();if(!r.ok){if(r.status===401){aiUnlocked=false;updateAi();}throw new Error(data.error || 'The assistant could not respond.');}return data;}
function updateAi(){document.querySelector('#ai-status').textContent=!aiReady?'AI account setup pending':aiUnlocked?'Assistant ready':'Assistant locked';document.querySelector('#unlock-form').hidden=!aiReady || aiUnlocked;document.querySelector('#lock-ai').hidden=!aiUnlocked;chatSend.disabled=!aiReady || !aiUnlocked || chatBusy;document.querySelectorAll('[data-prompt]').forEach(b=>b.disabled=chatBusy);}
request('/api/assistant/status').then(data=>{aiReady=data.configured;aiUnlocked=data.authenticated;updateAi();}).catch(()=>{document.querySelector('#ai-status').textContent='Assistant unavailable';});
document.querySelector('#unlock-form').addEventListener('submit',async event=>{event.preventDefault();const input=event.currentTarget.elements.password;try{await assistantRequest('login',{password:input.value});input.value='';aiUnlocked=true;updateAi();document.dispatchEvent(new Event('clinical-unlocked'));document.querySelector('#chat-notice').textContent='Assistant unlocked for this browser session.';}catch(error){document.querySelector('#chat-notice').textContent=error.message;}});
document.querySelector('#lock-ai').addEventListener('click',async()=>{try{await assistantRequest('logout',{});aiUnlocked=false;updateAi();document.dispatchEvent(new Event('clinical-locked'));}catch(error){document.querySelector('#chat-notice').textContent=error.message;}});
async function sendChat(text){
  if(chatBusy)return;
  if(!aiReady || !aiUnlocked){document.querySelector('#chat-notice').textContent=!aiReady?'The AI account is awaiting setup. Manual search, preferences and exports work now.':'Enter your assistant access password above.';chatInput.value=text;return;}
  chatBusy=true;updateAi();bubble('user',text);document.querySelector('#chat-notice').textContent='Thinking…';
  try{
    const data=await assistantRequest('chat',{message:text,history:chatHistory.slice(-10),profile,onboarding:onboardingContext});
    chatHistory.push({role:'user',content:text},{role:'assistant',content:data.reply.slice(0,3000)});chatHistory=chatHistory.slice(-10);bubble('assistant',data.reply);chatInput.value='';
    if(data.profile && profileKeys.some(k=>(data.profile[k] || '')!==(profile[k] || ''))){proposedProfile=data.profile;document.querySelector('#proposed-profile').textContent=profileKeys.filter(k=>(data.profile[k] || '')!==(profile[k] || '')).map(k=>profileLabels[k]+': '+(data.profile[k] || 'Not specified')).join('\n');document.querySelector('#profile-suggestion').hidden=false;}
    if(data.data){if(!searching){for(const [key,value] of Object.entries(data.query || {}))if(form.elements[key])form.elements[key].value=value;parameters=new URLSearchParams(data.query);currentStudies=data.data.studies || [];loaded=currentStudies.length;total=data.data.totalCount;nextToken=data.data.nextPageToken;results.replaceChildren(...currentStudies.map(card));results.className='cards';heading.textContent='Studies from your conversation';count.textContent='Showing '+loaded+(typeof total==='number'?' of '+total.toLocaleString()+' studies':' studies');more.hidden=!nextToken;note(loaded?'':'No studies returned. Try broader terms.');}else workspaceNote('A manual search was running; ask again to show the AI search results.');}
    document.querySelector('#chat-notice').textContent='';
  }catch(error){document.querySelector('#chat-notice').textContent=error.name==='TimeoutError'?'The assistant took too long. Your message is still here to retry.':error.message;}
  finally{chatBusy=false;updateAi();}
}
document.querySelector('#chat-form').addEventListener('submit',e=>{e.preventDefault();sendChat(chatInput.value.trim());});
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>sendChat(b.dataset.prompt)));
document.querySelector('#new-chat').addEventListener('click',()=>{if(chatBusy)return;chatHistory=[];chatLog.replaceChildren();greeting();document.querySelector('#chat-notice').textContent='New conversation. Your confirmed preferences and shortlist remain.';});
document.querySelector('#accept-profile').addEventListener('click',()=>{if(!proposedProfile)return;profile=Object.fromEntries(profileKeys.map(k=>[k,proposedProfile[k] || '']));syncProfile();persist();document.querySelector('#profile-suggestion').hidden=true;workspaceNote('Suggested preferences accepted. You can edit them above.');});
document.querySelector('#dismiss-profile').addEventListener('click',()=>{proposedProfile=null;document.querySelector('#profile-suggestion').hidden=true;});
function selectedStudies(){return shortlisted.size ? [...shortlisted.values()] : currentStudies;}
function brief(provider='Research assistant'){
  const studies=selectedStudies();
  return 'Clinical research business development handoff for '+provider+'\nPrepared '+new Date().toISOString()+'\n\nNikki works for Nira Medical. Goals: study opportunities, additional trial sites, sponsor/CRO relationships and PI platform visibility. Corporate workspace is not connected.\n\nCONFIRMED PREFERENCES\n'+profileKeys.map(k=>profileLabels[k]+': '+(profile[k] || 'Unknown—ask Nikki')).join('\n')+'\n\nSTUDIES ('+(shortlisted.size?'shortlist':'current results')+')\n'+studies.map(s=>{const p=s.protocolSection;const id=p.identificationModule.nctId;return [id+' — '+p.identificationModule.briefTitle,'Sponsor: '+(p.sponsorCollaboratorsModule?.leadSponsor?.name || 'Not reported'),'Status: '+friendly(p.statusModule?.overallStatus),'Phase: '+(p.designModule?.phases || []).map(friendly).join(' / '),'Updated: '+(p.statusModule?.lastUpdatePostDateStruct?.date || 'Not reported'),'Source: https://clinicaltrials.gov/study/'+id].join('\n');}).join('\n\n')+'\n\nREQUEST\n'+(document.querySelector('#handoff-question').value.trim() || 'Assess these studies for potential clinic fit. Identify missing feasibility information and useful next steps. Ask relevant clarifying questions.')+'\n\nUse the linked records as evidence. Distinguish facts, inference and unknowns. Recruiting patients does not confirm a sponsor is accepting additional sites. Do not invent investigator credentials, clinic capacity or submission confirmations.\n';
}
function download(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type}));const link=element('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function copyBrief(provider){try{await navigator.clipboard.writeText(brief(provider));workspaceNote('Handoff copied. Paste it into '+provider+' when ready.');}catch{download('clinical-handoff-'+provider.toLowerCase()+'.txt',brief(provider));workspaceNote('Clipboard unavailable; downloaded the handoff instead.');}}
document.querySelector('#copy-grok').addEventListener('click',()=>copyBrief('Grok'));
document.querySelector('#copy-claude').addEventListener('click',()=>copyBrief('Claude'));
document.querySelector('#download-brief').addEventListener('click',()=>{download('clinical-research-brief.txt',brief());workspaceNote('Brief downloaded. You can upload it to SharePoint yourself.');});
function csvCell(value){let text=String(value ?? '');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
document.querySelector('#export-studies').addEventListener('click',()=>{const studies=selectedStudies();if(!studies.length)return workspaceNote('Search or shortlist studies before exporting.');const rows=[['NCT ID','Study','Sponsor','Status','Phase','Study type','Conditions','Last updated','Source']];for(const s of studies){const p=s.protocolSection;const id=p.identificationModule.nctId;rows.push([id,p.identificationModule.briefTitle,p.sponsorCollaboratorsModule?.leadSponsor?.name,friendly(p.statusModule?.overallStatus),(p.designModule?.phases || []).map(friendly).join(' / '),friendly(p.designModule?.studyType),(p.conditionsModule?.conditions || []).join('; '),p.statusModule?.lastUpdatePostDateStruct?.date,'https://clinicaltrials.gov/study/'+id]);}download('clinical-studies.csv','\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');workspaceNote('Exported '+studies.length+' studies for Excel.');});
document.querySelector('#review-findings').addEventListener('click',()=>{const text=document.querySelector('#external-findings').value.trim();if(!text)return workspaceNote('Paste findings first.');sendChat(('Review these external assistant findings. Treat them as unverified; identify claims needing source checks. You can search ClinicalTrials.gov, but do not claim web verification.\n\n'+text).slice(0,3000));});
