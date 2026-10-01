(() => {
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const by=id=>document.getElementById(id);
  let questions=[],answers={},step=0,completed=false,loaded=false,sending=false,feedbackId=null,reviewedSubmission=null,navigating=false,items=[];
  const profileKeys=['territory','clinics','indications','investigators','studyPreferences','workingPreferences'];
  const labels=['Territory / states','Clinics you cover','Priority indications','Investigators / PI priorities','Study preferences / phases','Working preferences'];
  let sharedProfile={};
  const note=text=>by('onboarding-note').textContent=text;
  async function api(path,value){const r=await fetch('/api/workspace/'+path,{...(value!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Request':'1'},body:JSON.stringify(value)}:{}),signal:AbortSignal.timeout(25000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Please try again.');return d;}
  function draft(){try{const v=JSON.parse(localStorage.getItem('clinical-onboarding-draft')||'null');if(v){answers=v.answers||{};step=v.step||0;completed=v.completed===true;}}catch{}}
  function keepDraft(){try{localStorage.setItem('clinical-onboarding-draft',JSON.stringify({answers,step,completed}));}catch{}}
  async function save(profile){keepDraft();await api('save',{answers,step,completed,...(profile?{profile}:{})});document.dispatchEvent(new CustomEvent('clinical-onboarding-context',{detail:answers}));}
  function capture(){if(step<questions.length)answers[questions[step].id]=by('onboarding-answer')?.value.trim()||'';}
  function render(){
    const area=by('onboarding-question');area.replaceChildren();
    by('onboarding-progress').textContent=step<questions.length?'Question '+(step+1)+' of '+questions.length:completed?'Setup saved — editable anytime':'Review your answers';
    by('onboarding-back').disabled=step===0;by('onboarding-next').disabled=false;by('onboarding-skip').disabled=false;by('onboarding-next').hidden=step>=questions.length;by('onboarding-skip').hidden=step>=questions.length;by('onboarding-save-review').hidden=step<questions.length;
    if(step<questions.length){const q=questions[step];const label=el('label',q.title);const input=el('textarea');input.id='onboarding-answer';input.rows=4;input.maxLength=3000;input.value=answers[q.id]||'';input.addEventListener('input',()=>{answers[q.id]=input.value;keepDraft();});label.append(input);area.append(label,el('p',q.hint,'workspace-note'));}
    else{
      area.append(el('p','Review or edit your answers. These are saved in your workspace; sharing them with Joe is a separate choice.','workspace-note'));
      for(const q of questions){const label=el('label',q.title);const input=el('textarea');input.rows=2;input.maxLength=3000;input.value=answers[q.id]||'';input.addEventListener('input',()=>{answers[q.id]=input.value;keepDraft();});label.append(input);area.append(label);}
      area.append(el('h3','Confirm the preferences the assistant should use'),el('p','Fill only what you can confirm. Your detailed onboarding answers stay separate.','workspace-note'));
      const fields=el('div',undefined,'profile-fields');profileKeys.forEach((key,i)=>{const label=el('label',labels[i]);const input=el('textarea');input.rows=2;input.maxLength=1500;input.id='onboarding-profile-'+key;input.value=sharedProfile[key]||'';label.append(input);fields.append(label);});area.append(fields);
      const suggest=el('button','Prepare a suggestion for Joe','secondary');suggest.type='button';suggest.addEventListener('click',()=>{by('feedback-message').value=answers.priorities||'';by('feedback-context').checked=false;by('feedback-panel').open=true;by('feedback-message').focus();by('feedback-panel').scrollIntoView({block:'start',behavior:'smooth'});});area.append(suggest);
    }
  }
  async function load(){try{
    const d=await api('load');loaded=true;sharedProfile=d.profile||{};items=d.suggestions||[];
    // Keep an unfinished local draft available; explicit resume avoids silent overwrites.
    const local=Object.values(answers).some(Boolean);
    if(!local){answers=d.onboarding.answers||{};step=d.onboarding.step||0;completed=d.onboarding.completed;}
    else note('Your local draft is available. Continue to save it, or reload the shared answers.');
    if(Object.values(sharedProfile).some(Boolean))document.dispatchEvent(new CustomEvent('clinical-shared-profile',{detail:sharedProfile}));
    document.dispatchEvent(new CustomEvent('clinical-onboarding-context',{detail:d.onboarding.answers||{}}));
    by('onboarding-load').hidden=false;render();renderHistory();
  }catch(e){note(e.message);}}
  by('onboarding-load').addEventListener('click',async()=>{try{const d=await api('load');answers=d.onboarding.answers||{};step=d.onboarding.step;completed=d.onboarding.completed;sharedProfile=d.profile;document.dispatchEvent(new CustomEvent('clinical-onboarding-context',{detail:answers}));keepDraft();render();note('Shared answers loaded.');}catch(e){note(e.message);}});
  async function move(delta,skip=false){if(navigating)return;if(!loaded){note('Unlock the assistant to save and continue onboarding.');return;}navigating=true;for(const id of ['onboarding-next','onboarding-back','onboarding-skip'])by(id).disabled=true;capture();const prior=step;if(skip)answers[questions[step].id]='';step=Math.max(0,Math.min(questions.length,step+delta));try{await save();render();note('Progress saved.');}catch(e){step=prior;keepDraft();note(e.message);}finally{navigating=false;render();}}
  by('onboarding-next').addEventListener('click',()=>move(1));by('onboarding-back').addEventListener('click',()=>move(-1));by('onboarding-skip').addEventListener('click',()=>move(1,true));
  by('onboarding-pause').addEventListener('click',async()=>{capture();try{await save();by('onboarding-panel').open=false;note('Progress saved. Continue whenever you like.');}catch(e){note(e.message);}});
  by('onboarding-search').addEventListener('click',()=>{capture();keepDraft();by('onboarding-panel').open=false;document.querySelector('#search-form').scrollIntoView({behavior:'smooth'});});
  by('onboarding-save-review').addEventListener('click',async()=>{const p=Object.fromEntries(profileKeys.map(k=>[k,by('onboarding-profile-'+k).value.trim()]));try{completed=true;await save(p);sharedProfile=p;document.dispatchEvent(new CustomEvent('clinical-shared-profile',{detail:p}));note('Onboarding and confirmed assistant preferences saved. You can edit them anytime.');render();}catch(e){completed=false;note(e.message);}});
  document.addEventListener('clinical-unlocked',load);
  document.addEventListener('clinical-profile-saved',async e=>{if(!loaded)return;try{await save(e.detail);sharedProfile=e.detail;}catch(error){note('Profile remains available in this browser, but shared saving failed: '+error.message);}});
  document.addEventListener('clinical-locked',()=>{loaded=false;by('feedback-history').replaceChildren();note('Unlock the assistant to load your saved workspace.');});
  function context(){return questions.map(q=>q.title+'\n'+(answers[q.id]||'Skipped')).join('\n\n').slice(0,12000);}
  function preview(){reviewedSubmission={id:feedbackId,message:by('feedback-message').value.trim(),priority:by('feedback-priority').value,context:by('feedback-context').checked?context():''};by('feedback-preview').textContent='To: joe@uptechprojects.com\nPriority: '+reviewedSubmission.priority+'\n\n'+reviewedSubmission.message+(reviewedSubmission.context?'\n\nOnboarding context you chose to share:\n'+reviewedSubmission.context:'');}
  by('feedback-review').addEventListener('click',()=>{if(!by('feedback-message').value.trim()){by('feedback-note').textContent='Describe your suggestion first.';return;}feedbackId=crypto.randomUUID();preview();by('feedback-confirmation').hidden=false;});
  for(const id of ['feedback-message','feedback-priority','feedback-context'])by(id).addEventListener('input',()=>{if(!sending){feedbackId=null;by('feedback-confirmation').hidden=true;}});
  by('feedback-cancel').addEventListener('click',()=>{by('feedback-confirmation').hidden=true;});
  by('feedback-send').addEventListener('click',async()=>{
    if(sending||!feedbackId||!reviewedSubmission)return;sending=true;for(const id of ['feedback-message','feedback-priority','feedback-context','feedback-review','feedback-cancel'])by(id).disabled=true;by('feedback-send').disabled=true;by('feedback-note').textContent='Saving your suggestion…';
    try{const d=await api('feedback',reviewedSubmission);items=items.filter(x=>x.id!==d.id);items.push(d);renderHistory();by('feedback-note').textContent='Saved suggestion '+d.id.slice(0,8)+'. '+(d.notification==='sent'?'Email notification accepted by the email service.':d.notification==='failed'?'Saved, but email delivery failed. Please contact Joe directly.':'Saved; email notification is awaiting configuration.');by('feedback-message').value='';by('feedback-context').checked=false;by('feedback-confirmation').hidden=true;feedbackId=null;
    }catch(e){by('feedback-note').textContent=e.message+' Retry uses the same submission number to avoid duplicates.';}finally{sending=false;for(const id of ['feedback-message','feedback-priority','feedback-context','feedback-review','feedback-cancel'])by(id).disabled=false;by('feedback-send').disabled=false;}
  });
  function renderHistory(){const area=by('feedback-history');area.replaceChildren();if(!items.length){area.append(el('p','Your submitted suggestions will appear here.','workspace-note'));return;}for(const s of [...items].reverse()){const row=el('article',undefined,'feedback-item');row.append(el('strong',s.id.slice(0,8)+' · '+s.priority),el('p',s.message),el('small',new Date(s.createdAt).toLocaleString()));area.append(row);}}
  by('feedback-refresh').addEventListener('click',async()=>{try{const d=await api('load');items=d.suggestions;renderHistory();by('feedback-note').textContent='Suggestions refreshed.';}catch(e){by('feedback-note').textContent=e.message;}});
  draft();api('status').then(async s=>{questions=s.questions;render();if(!s.storage)note('Shared saving is awaiting storage setup. You can draft answers here; they are not submitted.');const auth=await fetch('/api/assistant/status').then(r=>r.json());if(auth.authenticated)await load();}).catch(e=>note(e.message));
})();
