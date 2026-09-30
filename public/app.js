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
  if (phases?.length) node.append(element('p',phases.map(friendly).join(' / '),'card-info'));
  const locations = p.contactsLocationsModule?.locations || [];
  const location = locations[0];
  node.append(element('p',location ? [location.city,location.state,location.country].filter(Boolean).join(', ')+(locations.length > 1 ? ' + '+(locations.length-1)+' more locations' : '') : 'Location not reported','card-info'));
  const bottom = element('div',undefined,'card-bottom');
  bottom.append(element('small','Updated '+(p.statusModule?.lastUpdatePostDateStruct?.date || 'date not reported')));
  const button = element('button','View study →','secondary');button.type = 'button';button.disabled = !/^NCT\d{8}$/.test(id);button.addEventListener('click',()=>showStudy(id));bottom.append(button);node.append(bottom);
  return node;
}
async function search(append=false) {
  if (searching) return;
  searching = true;searchButton.disabled = true;more.disabled = true;
  note(append ? 'Loading more studies…' : 'Searching ClinicalTrials.gov…');
  if (!append) {
    parameters = new URLSearchParams(new FormData(form));nextToken = undefined;total = undefined;loaded = 0;
    results.replaceChildren();results.className = 'cards';more.hidden = true;count.textContent = '';heading.textContent = 'Search results';
  }
  const query = new URLSearchParams(parameters);
  if (append && nextToken) query.set('pageToken',nextToken);
  try {
    const data = await request('/api/studies?'+query);
    if (!append) total = data.totalCount;
    const studies = data.studies || [];
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
    details.append(element('p','A search match does not confirm eligibility. Contact the study team about participation.'));
    const link = element('a','View original record ↗','source-button');link.href = 'https://clinicaltrials.gov/study/'+id;link.target = '_blank';link.rel = 'noopener noreferrer';details.append(link);
  } catch (error) {if (requestId === detailRequest && dialog.open) details.replaceChildren(element('p',error.message));}
}
form.addEventListener('submit',event=>{event.preventDefault();search();});
more.addEventListener('click',()=>search(true));
document.querySelector('#close-dialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{detailRequest++;});
document.querySelectorAll('[data-condition]').forEach(button=>button.addEventListener('click',()=>{if(searching)return;form.reset();document.querySelector('#condition').value = button.dataset.condition;search();}));
