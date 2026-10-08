import {buildTracks,createState,chooseNext,recordOutcome,adjustLevel,describeState} from './adaptive.js';

const root = document.querySelector('#root');
const dialog = document.querySelector('#resource-dialog');
const STORAGE = 'homework-arcade-progress-v1';
const CORRECT_PAUSE_MS = 1500;
const ADAPTIVE_STORAGE = 'homework-arcade-adaptive-v1';
const categories = {
  analogies: {name:'Word connections',icon:'A:B',color:'#e9614d',desc:'Find the same relationship in a new pair.'},
  similarities: {name:'What’s alike?',icon:'≈',color:'#167668',desc:'Find a shared idea. Explain how things belong together.'},
  spoken_similarities: {name:'Talk it through',icon:'≈',color:'#167668',desc:'Hear two ideas and explain what they have in common.'},
  vocabulary: {name:'Word explorer',icon:'Aa',color:'#6554b3',desc:'Say what a word means and give an example.'},
  classification: {name:'Find the family',icon:'∷',color:'#b36c14',desc:'Choose the word that belongs with the others.'},
  memory: {name:'Memory detective',icon:'◉',color:'#167668',desc:'Remember a list or listen closely to a short story.'},
  sequencing: {name:'Sequence shuffle',icon:'123',color:'#6554b3',desc:'Numbers from small to big. Letters from A to Z.'},
  mystery: {name:'Mystery words',icon:'?',color:'#e9614d',desc:'Follow a clue and find a word with the right first letter.'},
  math: {name:'Math lab',icon:'+',color:'#167668',desc:'Explore number words, patterns, and everyday math.'},
  reading: {name:'Read & discover',icon:'≡',color:'#6554b3',desc:'Read, compare, and explain your thinking.'},
  drawing: {name:'Listen & draw',icon:'✎',color:'#b36c14',desc:'Follow directions one step at a time.'},
  description: {name:'Picture talk',icon:'▧',color:'#e9614d',desc:'Describe a picture in full sentences, with examples.'},
  discovery: {name:'Curiosity challenges',icon:'!',color:'#b36c14',desc:'Ask questions, make something, and explain what you find.'}
};
let data, key, manifest, busy = false;
let tab = 'practice', sound = true, session = [], position = 0, attempts = 0, answered = false;
let currentFirst = 0, sessionDone = 0, finished = false;
let timers = new Set(), urls = new Set(), renderVersion = 0;
let activeAudio, narrationAudio, audioResolve, audioWatchdog, audioEpoch=0, audioContext, audioSources=new Set(), audioBuffers=new Map();
let auditoryReady=false,plays=0,sequenceIntroPlayed=false;
let adaptiveTracks=[],adaptiveRun=null;
let adaptiveSaved=readAdaptiveProgress();
let progress = readProgress();
const e = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el = id => document.getElementById(id);
function readProgress(){try{const p=JSON.parse(localStorage.getItem(STORAGE));return p&&typeof p==='object'&&p.items? p : {items:{},rounds:0};}catch{return {items:{},rounds:0};}}
function saveProgress(){try{localStorage.setItem(STORAGE,JSON.stringify(progress));}catch{/* Practice also works without storage. */}}
function notePresentation(){const q=current();if(!q)return;if(adaptiveRun){adaptiveRun.presented=true;return;}const item=progress.items[q.id]||{attempts:0,missed:false,done:false};if(!item.seen){item.seen=true;progress.items[q.id]=item;saveProgress();}}
function readAdaptiveProgress(){try{const saved=JSON.parse(localStorage.getItem(ADAPTIVE_STORAGE));return saved?.version===1&&saved.tracks&&typeof saved.tracks==='object'&&!Array.isArray(saved.tracks)?{version:1,tracks:saved.tracks,selectedTrack:typeof saved.selectedTrack==='string'?saved.selectedTrack:undefined}:{version:1,tracks:{}};}catch{return {version:1,tracks:{}};}}
function sanitizeAdaptiveProgress(){const tracks={};for(const track of adaptiveTracks){if(Object.hasOwn(adaptiveSaved.tracks,track.id))tracks[track.id]=createState(track,adaptiveSaved.tracks[track.id]);}adaptiveSaved={version:1,tracks,selectedTrack:adaptiveTracks.some(track=>track.id===adaptiveSaved.selectedTrack)?adaptiveSaved.selectedTrack:undefined};}
function saveAdaptiveProgress(){if(adaptiveRun){adaptiveSaved.tracks[adaptiveRun.track.id]=adaptiveRun.state;adaptiveSaved.selectedTrack=adaptiveRun.track.id;}try{localStorage.setItem(ADAPTIVE_STORAGE,JSON.stringify(adaptiveSaved));}catch{/* Adaptation also works without storage. */}}
function clearActivity(){for(const timer of timers){clearTimeout(timer);clearInterval(timer);}timers.clear();stopAudio();if('speechSynthesis' in window)speechSynthesis.cancel();}
function stopAudio(){audioEpoch+=1;clearTimeout(audioWatchdog);audioWatchdog=undefined;if(activeAudio){activeAudio.onended=activeAudio.onerror=activeAudio.onloadedmetadata=null;activeAudio.pause();activeAudio.removeAttribute('src');activeAudio.load();activeAudio=undefined;}if(audioResolve){audioResolve(false);audioResolve=undefined;}for(const source of audioSources){try{source.stop();source.disconnect();}catch{}}audioSources.clear();}
async function playClip(asset){
 stopAudio();const epoch=audioEpoch;if(!asset)throw new Error('audio-unavailable');
 // Unlock this reusable media element within the click gesture for WebKit.
 const audio=narrationAudio ||= new Audio();activeAudio=audio;audio.preload='auto';audio.src='audio-unlock.mp3';try{audio.play()?.catch(()=>{});}catch{}
 const url=await assetUrl(asset,asset.mime||'audio/mpeg');if(epoch!==audioEpoch||!key)return false;
 audio.pause();audio.src=url;audio.load();
 return new Promise((resolve,reject)=>{
  audioResolve=resolve;
  const fail=()=>{if(epoch!==audioEpoch)return;clearTimeout(audioWatchdog);audioWatchdog=undefined;audio.pause();audioResolve=undefined;activeAudio=undefined;reject(new Error('audio-playback'));};
  const deadline=ms=>{clearTimeout(audioWatchdog);audioWatchdog=setTimeout(fail,ms);};
  deadline(30000);audio.onloadedmetadata=()=>{if(epoch===audioEpoch)deadline((Number.isFinite(audio.duration)?audio.duration:0)*1000+30000);};
  audio.onended=()=>{if(epoch!==audioEpoch)return;clearTimeout(audioWatchdog);audioWatchdog=undefined;audioResolve=undefined;activeAudio=undefined;resolve(true);};audio.onerror=fail;
  const question=current(),isStimulus=['prompt','story','list'].some(name=>question?.audio?.[name]?.id===asset.id);
  audio.play().then(()=>{if(epoch===audioEpoch&&isStimulus&&current()===question)notePresentation();}).catch(fail);
 });
}
async function readQuestion(q){if(q.audio?.prompt)return playClip(q.audio.prompt);if(q.auditory)throw new Error('audio-unavailable');speak(q.prompt);return true;}
function administration(q){return q.administration||{};}
function later(fn,ms){const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;}
function speak(text){if(!sound||!('speechSynthesis' in window))return;speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-US';utterance.rate=.86;speechSynthesis.speak(utterance);}
function current(){return session[position];}
function category(q){return categories[q.category]||{name:'Practice',icon:'+',color:'#167668',desc:'Try a new challenge.'};}
function normalize(s){return String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
function answers(q){return Array.isArray(q.answer)?q.answer:[q.answer].filter(Boolean);}
function mark(success){
 const q=current();if(!q)return;
 const old=progress.items[q.id]||{attempts:0,missed:false,done:false};
 if(adaptiveRun&&!adaptiveRun.recorded){
  if(success)adaptiveRun.outcome=attempts===0&&!adaptiveRun.helpUsed?'independent':'supported';
  else if(!adaptiveRun.outcome)adaptiveRun.outcome='unmet';
 }
 old.attempts+=1;
 if(!success)old.missed=true;
 if(success){old.done=true;old.reviewed=true;if(attempts===0)currentFirst+=1;sessionDone+=1;}
 else old.reviewed=false;
 progress.items[q.id]=old;saveProgress();attempts+=1;
}
function badge(){return '<div class="brand"><span class="brand-mark" aria-hidden="true">+</span>Homework Arcade</div>';}
function header(){return `<header class="topbar">${badge()}<div class="top-actions"><button id="sound" class="text-btn" aria-pressed="${sound}" aria-label="Read aloud ${sound?'on':'off'}">Voice ${sound?'on':'off'}</button><button id="lock" class="quiet pill">Lock</button></div></header>`;}
function bindHeader(){el('lock')?.addEventListener('click',lock);if(current()?.auditory){sound=true;el('sound').textContent='Audio on';el('sound').disabled=true;return;}el('sound')?.addEventListener('click',()=>{sound=!sound;if(!sound&&'speechSynthesis' in window)speechSynthesis.cancel();el('sound').textContent=`Voice ${sound?'on':'off'}`;el('sound').setAttribute('aria-pressed',sound);el('sound').setAttribute('aria-label',`Read aloud ${sound?'on':'off'}`);});}
function lock(){
 commitAdaptiveQuestion(false);adaptiveRun=null;adaptiveTracks=[];
 busy=false;clearActivity();renderVersion+=1;key=undefined;data=undefined;session=[];position=0;finished=false;sequenceIntroPlayed=false;
 if(dialog.open)dialog.close();el('resource-body').replaceChildren();el('resource-title').textContent='';
 for(const url of urls)URL.revokeObjectURL(url);urls.clear();renderLock();
 audioBuffers.clear();if(narrationAudio){narrationAudio.onended=narrationAudio.onerror=narrationAudio.onloadedmetadata=null;narrationAudio.pause();narrationAudio.removeAttribute('src');narrationAudio.load();narrationAudio=undefined;}if(audioContext){audioContext.close().catch(()=>{});audioContext=undefined;}
}
function renderLock(){
 root.innerHTML=`<main class="lock-layout"><div class="lock-intro">${badge()}<h1>A little practice.<br>A lot of discovery.</h1><p>Words, memory, and curious thinking. Your private practice space.</p><div class="lock-decoration" aria-hidden="true"><span>Aa</span><span>+</span><span>≈</span></div></div><form id="unlock-form" class="lock-card"><div class="eyebrow">Private arcade</div><h2>Ready to play?</h2><p class="muted">Enter your password to open the activities and worksheets.</p><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required autofocus><button id="unlock" type="submit">Unlock arcade</button><p id="unlock-error" class="error" role="alert"></p><p class="small">Your materials stay encrypted until you unlock them. Practice at your own pace.</p></form></main>`;
 el('unlock-form').addEventListener('submit',unlock);
}
async function decryptBytes(asset,usingKey=key){
 const r=await fetch(asset.file);if(!r.ok)throw new Error('file-unavailable');
 const payload=new Uint8Array(await r.arrayBuffer());
 return crypto.subtle.decrypt({name:'AES-GCM',iv:payload.slice(0,12),additionalData:new TextEncoder().encode(`homework-arcade-v1:${asset.id}`)},usingKey,payload.slice(12));
}
async function unlock(event){
 event.preventDefault();if(busy)return;
 if(!crypto.subtle){el('unlock-error').textContent='Please open the arcade over HTTPS or on localhost.';return;}
 busy=true;el('unlock').disabled=true;el('unlock').textContent='Opening…';el('unlock-error').textContent='';
 let password=el('password').value;el('password').value='';let stage='network';
 try{
  const r=await fetch('vault/manifest.json');if(!r.ok)throw new Error('manifest-unavailable');manifest=await r.json();
  if(manifest.version!==1||manifest.iterations!==600000)throw new Error('manifest-invalid');
  const salt=Uint8Array.from(atob(manifest.salt),c=>c.charCodeAt(0));
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);password='';
  const derived=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:manifest.iterations},material,{name:'AES-GCM',length:256},false,['decrypt']);
  stage='password';const bytes=await decryptBytes(manifest.content,derived);stage='content';
  const parsed=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(parsed.questions)||!Array.isArray(parsed.resources))throw new Error('content-invalid');
  key=derived;data=parsed;adaptiveTracks=buildTracks(data.questions);sanitizeAdaptiveProgress();saveAdaptiveProgress();busy=false;tab='practice';renderHome();
 }catch(err){busy=false;password='';el('unlock-error').textContent=stage==='password'&&err.name==='OperationError'?'That password didn’t unlock the arcade. Try again.':'The arcade couldn’t load. Check your connection and try again.';el('unlock').disabled=false;el('unlock').textContent='Unlock arcade';el('password').focus();}
}
function renderHome(){
 commitAdaptiveQuestion(false);adaptiveRun=null;
 clearActivity();renderVersion+=1;session=[];finished=false;
 const complete=data.questions.filter(q=>progress.items[q.id]?.done).length;
 const missed=data.questions.filter(q=>!administration(q).ordered&&q.shuffle!==false&&progress.items[q.id]?.missed&&!progress.items[q.id]?.reviewed).length;
 root.innerHTML=`<div class="container">${header()}<main id="main" tabindex="-1"><div class="intro"><div><div class="eyebrow">Practice time</div><h1>${e(data.title||'Your homework arcade')}</h1><p>Think it through. Say it out loud. Try again.</p></div><div class="stats"><div class="stat"><strong>${complete}</strong><span>completed</span></div><div class="stat"><strong>${data.questions.length}</strong><span>challenges</span></div><div class="stat"><strong>${progress.rounds||0}</strong><span>rounds played</span></div></div></div><nav class="tabs" aria-label="Arcade sections">${[['practice','Play'],['resources','Worksheets'],['notes','Coach notes']].map(([id,title])=>`<button data-tab="${id}" class="${tab===id?'active':''}" aria-current="${tab===id?'page':'false'}">${title}</button>`).join('')}</nav><div id="home-body"></div></main><p class="footnote">Practice at your own pace · Progress stays on this device</p></div>`;
 bindHeader();document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{tab=button.dataset.tab;renderHome();}));
 if(tab==='practice')renderDecks(missed);else if(tab==='resources')renderResources();else renderNotes();
}
function shuffle(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function adaptiveHome(){
 if(!adaptiveTracks.length)return '';
 const selected=adaptiveTracks.find(t=>t.id===adaptiveSaved.selectedTrack)||adaptiveTracks.find(t=>t.category==='spoken_similarities')||adaptiveTracks[0];
 return `<section class="adaptive-home"><div><div class="eyebrow">Child + coach</div><h2>Find your next stretch</h2><p>Start with a challenge. Work on your own, then use a clue together when you need one. The next question adjusts to how it went.</p></div><div class="adaptive-start"><label for="adaptive-focus">Practice skill</label><select id="adaptive-focus">${adaptiveTracks.map(t=>`<option value="${e(t.id)}" ${t.id===selected.id?'selected':''}>${e(t.label)}</option>`).join('')}</select><p id="adaptive-start-note" class="small"></p><div class="actions"><button id="adaptive-start">Start adaptive practice</button><button id="adaptive-reset" class="quiet">Find my level again</button></div></div><p class="small adaptive-home-note">Practice keeps going after mistakes. Finish whenever you want. Each skill remembers its own challenge level.</p></section>`;
}
function bindAdaptiveHome(){
 if(!el('adaptive-focus'))return;
 const update=()=>{
  const track=adaptiveTracks.find(t=>t.id===el('adaptive-focus').value),saved=adaptiveSaved.tracks[track.id],state=createState(track,saved),info=describeState(track,state);
  el('adaptive-start').textContent=info.trial?'Continue adaptive practice':'Start adaptive practice';
  el('adaptive-start-note').textContent=`${info.trial?'Continue at':'Start at'} ${adaptiveLevelLabel(track,info.level)}. ${track.difficultyNote||track.evidenceNote||'The coach can make the next question harder or gentler.'}`;
  el('adaptive-reset').hidden=!info.trial;
 };
 el('adaptive-focus').addEventListener('change',update);
 el('adaptive-start').addEventListener('click',()=>startAdaptive(el('adaptive-focus').value));
 el('adaptive-reset').addEventListener('click',()=>startAdaptive(el('adaptive-focus').value,true));
 update();
}
function adaptiveLevelLabel(track,level){return track.levelLabels?.[level-1]||`challenge band ${level} of ${track.maxLevel}`;}
function startAdaptive(trackId,fresh=false){
 const track=adaptiveTracks.find(t=>t.id===trackId);if(!track)return;
 clearActivity();
 const prior=createState(track,adaptiveSaved.tracks[trackId]),base=fresh?createState(track):prior;
 const familiar=[...new Set([...prior.familiar,...track.items.filter(item=>{const old=progress.items[item.id];return old?.seen||old?.done||old?.attempts>0;}).map(item=>item.id)])];
 const state=createState(track,{...base,familiar}),item=chooseNext(track,state);if(!item)return;
 adaptiveRun={track,state,recorded:false,sessionCounts:{independent:0,supported:0,unmet:0,pass:0}};
 session=[item.question];position=0;currentFirst=0;sessionDone=0;finished=false;sequenceIntroPlayed=false;
 saveAdaptiveProgress();resetQuestion();renderQuestion();
}
function commitAdaptiveQuestion(includePass){
 if(!adaptiveRun||adaptiveRun.recorded||!current())return;
 const outcome=adaptiveRun.outcome||(includePass?'pass':null);
 if(!outcome){if(adaptiveRun.presented){adaptiveRun.state=createState(adaptiveRun.track,{...adaptiveRun.state,familiar:[...adaptiveRun.state.familiar,current().id]});saveAdaptiveProgress();}return;}
 adaptiveRun.state=recordOutcome(adaptiveRun.track,adaptiveRun.state,current().id,outcome);
 if(outcome==='pass'&&adaptiveRun.presented)adaptiveRun.state=createState(adaptiveRun.track,{...adaptiveRun.state,familiar:[...adaptiveRun.state.familiar,current().id]});
 if(adaptiveRun.requestedLevel!==null)adaptiveRun.state=adjustLevel(adaptiveRun.track,adaptiveRun.state,adaptiveRun.requestedLevel-adaptiveRun.state.level);
 adaptiveRun.sessionCounts[outcome]+=1;adaptiveRun.recorded=true;saveAdaptiveProgress();
}
function adaptiveStatus(){
 const {track,state}=adaptiveRun,info=describeState(track,state);
 const item=track.items.find(item=>item.id===current().id),review=state.familiar.includes(current().id);
 return `<section class="adaptive-status" aria-label="Adaptive practice"><div><div class="eyebrow">Adaptive · ${e(track.label)} · ${review?'Review':'Fresh'}</div><h2 id="adaptive-level">${e(adaptiveLevelLabel(track,item?.level||info.level))}</h2><p class="small">${e(info.phase==='calibration'?'Finding a useful challenge level.':info.reason)}${item?.level!==info.level?` Target: ${e(adaptiveLevelLabel(track,info.level))}.`:''}</p></div><div class="adaptive-steering" aria-label="Coach adjusts the next question"><button id="adaptive-easier" class="quiet" ${info.level<=1?'disabled':''}>Try gentler</button><button id="adaptive-harder" class="quiet" ${info.level>=track.maxLevel?'disabled':''}>Try harder</button><p id="adaptive-steering-note" class="small" role="status">Changes apply to the next question.</p></div></section>`;
}
function adaptiveStrategy(q){
 if(q.type==='sequence')return 'Before a fresh sequence, agree on a strategy: collect the numbers first, then sort the letters. After this trial, compare the order together. Keep the one-play listening rule.';
 if(q.category==='vocabulary')return 'Ask what kind of thing it is, what it does, or when someone would use it. Invite one example. A clue supports thinking; a model answer is for learning after the child tries.';
 if(['similarities','spoken_similarities'].includes(q.category))return 'Ask the child to name one feature of each thing. Then ask which feature or group they share. Move from a concrete example to a more general idea.';
 if(q.category==='analogies')return 'Ask how the first two things are connected. Say the relationship in a short sentence, then use that same sentence for the new pair.';
 if(q.category==='classification')return 'Ask what all the example words have in common. Name that group, then test each choice against the same idea.';
 return 'Ask the child to explain the first step. Give one small clue, let them try it, then reduce your help on the next fresh question.';
}
function adaptiveCoach(q){return `<details class="adaptive-coach"><summary>Coach support</summary><p>${e(adaptiveStrategy(q))}</p><p class="small">Score an answer the child already gave as independent. If you offer a clue, show a model, or practise it together, record support.</p><button id="adaptive-help" class="quiet">We used a clue</button><p id="adaptive-help-note" class="small" role="status">Try on your own first.</p></details>`;}
function noteAdaptiveHelp(){
 if(!adaptiveRun||adaptiveRun.recorded)return;
 adaptiveRun.helpUsed=true;if(adaptiveRun.outcome==='independent')adaptiveRun.outcome='supported';
 if(el('adaptive-help'))el('adaptive-help').disabled=true;
 if(el('adaptive-help-note'))el('adaptive-help-note').textContent='Support noted. Fresh questions will check what can be done independently.';
 if(el('adaptive-result-note')&&adaptiveRun.outcome==='supported')el('adaptive-result-note').textContent='Solved with support. We’ll practise near this level and check on a fresh question.';
}
function bindAdaptiveQuestion(){
 el('adaptive-end').addEventListener('click',renderAdaptiveFinish);
 el('adaptive-help').addEventListener('click',noteAdaptiveHelp);
 const steer=delta=>{
  const target=adaptiveRun.requestedLevel??adaptiveRun.state.level;
  adaptiveRun.requestedLevel=Math.max(1,Math.min(adaptiveRun.track.maxLevel,target+delta));
  // Save the preference now, then reapply it after the pending answer is recorded.
  adaptiveRun.state=adjustLevel(adaptiveRun.track,adaptiveRun.state,adaptiveRun.requestedLevel-adaptiveRun.state.level);
  saveAdaptiveProgress();
  el('adaptive-steering-note').textContent=`Next: ${adaptiveLevelLabel(adaptiveRun.track,adaptiveRun.requestedLevel)}.`;
  el('adaptive-easier').disabled=adaptiveRun.requestedLevel<=1;el('adaptive-harder').disabled=adaptiveRun.requestedLevel>=adaptiveRun.track.maxLevel;
 };
 el('adaptive-easier').addEventListener('click',()=>steer(-1));el('adaptive-harder').addEventListener('click',()=>steer(1));
}
function adaptiveFeedback(ok){
 if(!adaptiveRun)return;
 const feedback=el('feedback');
 if(ok){const review=adaptiveRun.state.familiar.includes(current().id);feedback.insertAdjacentHTML('beforeend',`<p id="adaptive-result-note" class="adaptive-result-note">${adaptiveRun.outcome==='supported'?'Solved with support. We’ll practise near this level and check on a fresh question.':review?'Solved independently on review. Fresh questions check whether you’re ready to move higher.':'Solved independently. That helps us choose your next stretch.'}</p>`);return;}
 feedback.insertAdjacentHTML('beforeend',`<aside class="adaptive-coaching-result"><h3>Work on the idea together</h3><p>${e(adaptiveStrategy(current()))}</p><p class="small">After practising, tell us how it went. A supported answer is different from an independent answer.</p><div class="actions"><button id="adaptive-solved">Solved with coaching</button><button id="adaptive-unmet" class="quiet">Still out of reach · next</button></div></aside>`);
 el('adaptive-solved').addEventListener('click',()=>{
  if(!adaptiveRun||adaptiveRun.recorded||['supported','independent'].includes(adaptiveRun.outcome))return;
  noteAdaptiveHelp();mark(true);answered=true;disableResponse();document.querySelectorAll('[data-option],#spoken-sequence').forEach(button=>button.disabled=true);
  showFeedback(true,'You worked through the idea together. Try a fresh challenge with less help.',true);
 });
 el('adaptive-unmet').addEventListener('click',()=>{if(!adaptiveRun||adaptiveRun.recorded)return;adaptiveRun.outcome='unmet';next();});
}
function renderAdaptiveFinish(){
 if(!adaptiveRun)return;
 clearActivity();commitAdaptiveQuestion(false);finished=true;renderVersion+=1;
 const {track,state,sessionCounts}=adaptiveRun,info=describeState(track,state);
 progress.rounds=(progress.rounds||0)+1;saveProgress();
 root.innerHTML=`<div class="container">${header()}<main class="question-card finish"><div class="eyebrow">Practice paused · ${e(track.label)}</div><h1>Your next stretch is saved.</h1><p>${sessionCounts.independent} solved independently · ${sessionCounts.supported} with support · ${sessionCounts.unmet} still to practise.</p><p>Continue at ${e(adaptiveLevelLabel(track,info.level))}.</p><p class="muted">Ask the child which clue helped, and how they could use that idea on a new question.</p><div class="actions"><button id="adaptive-continue">Keep practising</button><button id="done" class="quiet">All challenges</button></div></main></div>`;
 bindHeader();el('adaptive-continue').addEventListener('click',()=>startAdaptive(track.id));el('done').addEventListener('click',renderHome);el('adaptive-continue').focus({preventScroll:true});
}
function renderDecks(missed){
 const active=Object.keys(categories).filter(c=>data.questions.some(q=>q.category===c));
 el('home-body').innerHTML=`${adaptiveHome()}<section class="banner library-banner"><div><h2>Browse your homework</h2><p>Choose a worksheet set, review misses, or try a mix.</p></div><div class="banner-actions"><button id="mix" class="gold-btn">Play a 10-question mix</button><button id="review" class="white-btn" ${missed?'':'disabled'}>Review misses${missed?` (${missed})`:''}</button></div></section><div class="section-heading"><h2>Pick your challenge</h2><p>${active.length} ways to practice</p></div><section class="deck-grid" aria-label="Practice decks">${active.map(c=>{
 const meta=categories[c],questions=data.questions.filter(q=>q.category===c),done=questions.filter(q=>progress.items[q.id]?.done).length;
 return `<button data-deck="${c}" class="deck"><span class="deck-icon" aria-hidden="true">${meta.icon}</span><h3>${meta.name}</h3><p>${meta.desc}</p><div class="deck-bottom"><span>${questions.length} challenges</span><strong>${done}/${questions.length} done</strong></div><progress value="${done}" max="${questions.length}" aria-label="${e(meta.name)} completed"></progress></button>`;
 }).join('')}</section>`;
 bindAdaptiveHome();
 // One question per deck first, then fill the mix from unseen activities.
 el('mix').addEventListener('click',()=>{
  const flexible=data.questions.filter(q=>!administration(q).ordered&&q.shuffle!==false);
  const groups=shuffle(active);let pool=[];
  for(const c of groups){const qs=flexible.filter(q=>q.category===c);if(!qs.length)continue;const unseen=qs.filter(q=>!progress.items[q.id]?.done);pool.push(shuffle(unseen.length?unseen:qs)[0]);}
  pool=pool.slice(0,10);const more=shuffle(flexible.filter(q=>!pool.includes(q))).sort((a,b)=>Number(!!progress.items[a.id]?.done)-Number(!!progress.items[b.id]?.done));
  startSession([...pool,...more].slice(0,10));
 });
 el('review').addEventListener('click',()=>startSession(data.questions.filter(q=>!administration(q).ordered&&q.shuffle!==false&&progress.items[q.id]?.missed&&!progress.items[q.id]?.reviewed)));
 document.querySelectorAll('[data-deck]').forEach(b=>b.addEventListener('click',()=>{
  const qs=data.questions.filter(q=>q.category===b.dataset.deck);
  startSession(qs.some(q=>administration(q).ordered||q.shuffle===false)?qs:shuffle(qs));
 }));
}
function renderResources(){
 el('home-body').innerHTML=`<div class="section-heading"><div><h2>Original worksheets</h2><p>All available PDFs, preserved as they were sent.</p></div></div><div class="resource-grid">${data.resources.map((r,i)=>`<button class="resource-card" data-resource="${i}"><div><h3>${e(r.name)}</h3><span>${r.pages} pages · ${e(r.sourceLabel||'Homework resource')}</span></div><span aria-hidden="true">PDF</span></button>`).join('')}</div>`;
 document.querySelectorAll('[data-resource]').forEach(b=>b.addEventListener('click',()=>openResource(Number(b.dataset.resource))));
}
function linkText(text){return e(text).replace(/https?:\/\/[^\s<>]+/g,url=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);}
function renderNotes(){
 let notices=(data.coverage||[]).map(n=>`<p>${linkText(n)}</p>`).join('');
 el('home-body').innerHTML=`${notices?`<aside class="coverage"><h3>Material access</h3>${notices}</aside>`:''}<div class="notes-grid"><section class="note-card"><h2>Make room for a second answer</h2><p class="note-body">After an answer, ask “Can you give an example?” or “What’s another way?” For open questions, use the example as a guide and decide together whether the answer makes sense.</p></section>${data.administration?.length?`<section class="note-card"><details><summary>Original spoken-activity instructions</summary><p>For home preparation, keep the listening and recall rules below. Practice continues after mistakes; the original worksheet miss cutoffs do not end your session.</p>${data.administration.map(a=>`<div class="coach-example"><h3>${e(a.title||a.id.replaceAll('-',' '))}</h3><p>${e(a.guidance||(a.sourceInstructions||[]).join(' '))}</p>${a.practiceExamples?`<p>Examples: ${a.practiceExamples.map(ex=>`${e(ex.sequence.join(', '))} becomes ${e(ex.answer.join(', '))}`).join('; ')}.</p>`:''}</div>`).join('')}<p class="small">These are home practice materials, not a validated assessment or an IQ result.</p></details></section>`:''}${data.emails.map(n=>`<section class="note-card"><details><summary>${e(n.subject)}</summary><div class="note-body">${linkText(n.body)}</div></details></section>`).join('')}${data.externalLinks?.length?`<section class="note-card"><h3>Linked practice</h3>${data.externalLinks.map(n=>`<p>${typeof n==='string'?linkText(n):linkText(n.label||n.title||n.name||'Practice resource')+' '+linkText(n.url||n.link||'')}</p>`).join('')}</section>`:''}${data.notes?.length?`<section class="note-card"><details><summary>Worksheet clarifications</summary><div class="note-body">${linkText(data.notes.map(n=>typeof n==='string'?n:JSON.stringify(n)).join('\n\n'))}</div></details></section>`:''}</div>`;
}
function startSession(questions){if(!questions.length)return;clearActivity();adaptiveRun=null;session=questions;position=0;currentFirst=0;sessionDone=0;finished=false;sequenceIntroPlayed=false;resetQuestion();renderQuestion();}
function resetQuestion(){attempts=0;answered=false;auditoryReady=false;plays=0;if(adaptiveRun){adaptiveRun.helpUsed=false;adaptiveRun.outcome=null;adaptiveRun.recorded=false;adaptiveRun.requestedLevel=null;adaptiveRun.presented=false;}}
function next(){clearActivity();if(adaptiveRun){commitAdaptiveQuestion(true);const item=chooseNext(adaptiveRun.track,adaptiveRun.state);if(!item){renderAdaptiveFinish();return;}session.push(item.question);position+=1;resetQuestion();renderQuestion();return;}if(position+1>=session.length){finished=true;progress.rounds=(progress.rounds||0)+1;saveProgress();renderFinish();return;}position+=1;resetQuestion();renderQuestion();}
function questionShell(q){
 const meta=category(q);
 const spoken=q.auditory&&!['sequence','recall','story','drawing'].includes(q.type);
 return `<div class="container">${header()}<main><div class="session-toolbar"><button id="back" class="quiet">All challenges</button><div class="session-track">${adaptiveRun?`<span>Question ${position+1}</span>`:`<progress value="${position}" max="${session.length}" aria-label="Round progress"></progress><span>${position+1} / ${session.length}</span>`}</div><button id="skip" class="text-btn">${q.auditory?'Pass':'Skip'}</button>${adaptiveRun?'<button id="adaptive-end" class="quiet">Finish practice</button>':''}</div>${adaptiveRun?adaptiveStatus():''}<article class="question-card ${q.category==='similarities'&&q.imageAsset?'picture-choice':''}"><div class="question-meta"><span class="eyebrow">${e(meta.name)}</span><button id="read-prompt" class="quiet" ${q.auditory?'hidden':''}>Read aloud</button></div><h1 class="prompt" id="question-prompt" tabindex="-1">${e(spoken?'Listen to the question.':q.prompt)}</h1><div id="question-content"></div><div id="feedback" aria-live="polite"></div>${adaptiveRun?adaptiveCoach(q):''}<div class="source-line">Homework worksheet · page ${q.page||1}<button id="source" class="text-btn" ${q.auditory?'hidden':''}>Open worksheet</button></div></article></main></div>`;
}
async function assetUrl(asset,mime){
 const usingKey=key;const bytes=await decryptBytes(asset,usingKey);if(!key||key!==usingKey)throw new Error('locked');
 const url=URL.createObjectURL(new Blob([bytes],{type:mime||asset.mime||'application/octet-stream'}));urls.add(url);return url;
}
function renderQuestion(){
 clearActivity();const q=current(),version=++renderVersion;root.innerHTML=questionShell(q);bindHeader();
 if(!q.auditory)notePresentation();
 el('back').addEventListener('click',renderHome);el('skip').addEventListener('click',()=>{if(!adaptiveRun&&q.auditory&&!answered)mark(false);next();});
 if(adaptiveRun)bindAdaptiveQuestion();
 el('read-prompt').addEventListener('click',()=>{readQuestion(q).catch(()=>{el('feedback').innerHTML='<p class="error" role="alert">Audio couldn’t play. Try again.</p>';});});
 el('source').addEventListener('click',()=>{const index=data.resources.findIndex(r=>r.name===q.source);if(index>=0)openResource(index,q.page||1);});
 if(!data.resources.some(r=>r.name===q.source))el('source').remove();
 const content=el('question-content');
 if(q.imageAsset){content.insertAdjacentHTML('beforeend','<p class="image-status" id="image-status" role="status">Opening picture…</p><img id="question-image" class="question-image" hidden>');
  assetUrl(q.imageAsset).then(url=>{if(version!==renderVersion){URL.revokeObjectURL(url);urls.delete(url);return;}el('question-image').onload=()=>{if(version===renderVersion){notePresentation();if(el('hear-question'))el('hear-question').disabled=false;}};el('question-image').src=url;el('question-image').alt=q.imageAlt||'Homework question illustration';el('question-image').hidden=false;el('image-status').remove();}).catch(()=>{if(version===renderVersion)el('image-status').textContent='The picture couldn’t load. Try reopening this challenge.';});
 }
 if(q.grid){const rows=Array.isArray(q.grid)?q.grid:[];content.insertAdjacentHTML('beforeend',`<div class="grid-table"><table aria-label="Worksheet grid">${q.columns?`<tr><th></th>${q.columns.map(c=>`<th scope="col">${e(c)}</th>`).join('')}</tr>`:''}${rows.map((row,i)=>`<tr>${q.rows?`<th scope="row">${e(q.rows[i])}</th>`:''}${(Array.isArray(row)?row:String(row).split(' ')).map(cell=>`<td>${e(cell)}</td>`).join('')}</tr>`).join('')}</table></div>`);}
 switch(q.type){case 'choice':renderChoice(q);break;case 'sequence':renderSequence(q);break;case 'recall':renderRecall(q);break;case 'story':renderStory(q);break;case 'drawing':renderDrawing(q);break;default:renderOpen(q);}
 if(q.auditory&&!['sequence','recall','story','drawing'].includes(q.type))addAuditoryPrompt(q);
 el('question-prompt').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
}
function setResponseEnabled(enabled){document.querySelectorAll('[data-option],#check,#compare').forEach(b=>b.disabled=!enabled);}
function addAuditoryPrompt(q){
 const content=el('question-content');content.insertAdjacentHTML('afterbegin',`<div class="audio-prompt"><button id="hear-question" ${q.imageAsset?'disabled':''}>Listen to question</button><p id="audio-status" class="small" role="status">Answer aloud after you listen.</p></div>`);setResponseEnabled(false);
 el('hear-question').addEventListener('click',async()=>{const button=el('hear-question'),version=renderVersion;button.disabled=true;setResponseEnabled(false);el('audio-status').textContent='Listening…';
  try{const complete=await readQuestion(q);if(!complete||version!==renderVersion)return;plays+=1;auditoryReady=true;setResponseEnabled(true);el('audio-status').textContent='Your turn. Say your answer aloud.';const cap=q.maxPlays||administration(q).maxPlays||Infinity;button.disabled=plays>=cap;button.textContent='Hear question again';}
  catch{if(version===renderVersion){button.disabled=false;if(auditoryReady)setResponseEnabled(true);el('audio-status').textContent='Audio couldn’t play. Check your connection and try again.';}}
 });
}
function revealCoachPrompt(q){if(q.auditory){el('question-prompt').textContent=q.prompt;if(el('source'))el('source').hidden=false;if(el('hear-question'))el('hear-question').disabled=true;}}
function renderChoice(q){
 el('question-content').insertAdjacentHTML('beforeend',`<p class="question-instruction">${q.category==='similarities'&&q.imageAsset?'Bottom pictures are numbered from left to right.':'Choose your answer. Then explain your thinking.'}</p><div class="answers">${(q.options||[]).map((option,i)=>`<button class="answer" data-option="${i}"><span class="key" aria-hidden="true">${i+1}</span><span>${e(option)}</span></button>`).join('')}</div>`);
 document.querySelectorAll('[data-option]').forEach(b=>b.addEventListener('click',()=>checkChoice(Number(b.dataset.option))));
}
function checkChoice(index){
 if(answered||!key||!session.length)return;const q=current();if(q.auditory&&!auditoryReady)return;const option=q.options[index],success=answers(q).some(a=>normalize(a)===normalize(option));
 mark(success);const button=document.querySelector(`[data-option="${index}"]`);button.classList.add(success?'correct':'wrong');
 if(success){answered=true;document.querySelectorAll('[data-option]').forEach(b=>b.disabled=true);showFeedback(true,q.explanation||'That fits. Can you explain the connection?');}
 else if(q.auditory&&administration(q).ordered&&!adaptiveRun){answered=true;document.querySelectorAll('[data-option]').forEach(b=>b.disabled=true);revealCoachPrompt(q);showFeedback(false,`Answer: ${answers(q).join(' / ')}. ${q.explanation||''}`,true);}
 else {button.disabled=true;showFeedback(false,'Try another answer. Think about the relationship or group.');}
}
function renderOpen(q){
 const hasExact=!!q.answer;
 el('question-content').insertAdjacentHTML('beforeend',`<p class="question-instruction">${hasExact?'Type an answer, or say it aloud with a grown-up.':'Say your answer in a full sentence. Give an example, then compare ideas with a grown-up.'}</p><div class="response-area"><label for="response">Your answer${hasExact?'':' or notes'}</label><textarea id="response" placeholder="Think it through…" spellcheck="true"></textarea><div class="actions">${hasExact?'<button id="check">Check answer</button>':''}<button id="compare" class="${hasExact?'quiet':''}">${hasExact?'Show answer / spoken response':'Compare ideas'}</button></div></div>`);
 el('check')?.addEventListener('click',()=>{if(answered)return;const value=normalize(el('response').value);if(!value){el('response').focus();return;}const ok=answers(q).some(a=>normalize(a)===value);if(ok){mark(true);answered=true;showFeedback(true,q.explanation||`Answer: ${answers(q).join(' / ')}`);disableResponse();}else{mark(false);el('feedback').innerHTML='<div class="feedback wrong"><h3>Let’s look again</h3><p>The automatic check didn’t match. A grown-up can check a different wording with “Show answer / spoken response.”</p></div>';adaptiveFeedback(false);}});
 el('compare').addEventListener('click',()=>coachCompare(q));
}
function disableResponse(){if(el('check'))el('check').disabled=true;if(el('compare'))el('compare').disabled=true;if(el('response'))el('response').readOnly=true;}
function coachCompare(q){
 if(answered)return;
 if(q.auditory&&!['drawing'].includes(q.type)&&!auditoryReady)return;
 revealCoachPrompt(q);
 if(q.rubric){
  el('feedback').innerHTML=`<div class="coach-example"><div class="eyebrow">Grown-up’s guide</div><p><strong>2 · Clear core meaning:</strong> ${e(q.rubric['2'])}</p><p><strong>1 · Partly correct:</strong> ${e(q.rubric['1'])}</p><p><strong>0 · Still to learn:</strong> ${e(q.rubric['0'])}</p><p class="small">Judge the meaning and specificity; these examples are not required wording.${adaptiveRun?' Score the answer given before seeing this guide.':''}</p><div class="coach-score"><button data-points="2">${adaptiveRun?'Clear meaning on own · 2':'Clear meaning · 2'}</button>${adaptiveRun?'<button data-points="2" data-supported="true" class="quiet">Clear meaning with a clue · 2</button>':''}<button data-points="1" class="quiet">Partly correct · 1</button><button data-points="0" class="quiet">Practice again · 0</button></div></div>`;
  document.querySelectorAll('[data-points]').forEach(button=>button.addEventListener('click',()=>{if(answered)return;const points=Number(button.dataset.points);if(button.dataset.supported)noteAdaptiveHelp();mark(adaptiveRun?points===2:points>0);progress.items[q.id].points=points;saveProgress();answered=true;disableResponse();showFeedback(adaptiveRun?points===2:points>0,points===2?'A clear definition. Can you give another example?':points===1?'You have part of the idea. Compare your answer with the core meaning.':'Keep exploring the word together.',true,points===2);}));return;
 }
 const sample=q.example||(q.answer?answers(q).join(' · '):'There can be more than one good answer. Explain why your answer fits.');
  el('feedback').innerHTML=`<div class="coach-example"><div class="eyebrow">Compare ideas</div><p>${e(sample)}</p>${q.explanation?`<p>${e(q.explanation)}</p>`:''}<p class="small">A grown-up checks the meaning, not the exact words.${adaptiveRun?' Judge the answer the child gave before seeing this guide.':''}</p><div class="coach-score"><button id="coach-good">${adaptiveRun?'Answered independently':'That makes sense'}</button>${adaptiveRun?'<button id="coach-supported" class="quiet">Solved with a clue</button>':''}<button id="coach-practice" class="quiet">Let’s practice this again</button></div></div>`;
 el('coach-good').addEventListener('click',()=>{if(answered)return;mark(true);answered=true;disableResponse();showFeedback(true,'Good thinking. Try giving a second answer or an example.');});
 el('coach-supported')?.addEventListener('click',()=>{if(answered)return;noteAdaptiveHelp();mark(true);answered=true;disableResponse();showFeedback(true,'The clue helped. Try a fresh question with less help.');});
 el('coach-practice').addEventListener('click',()=>{if(answered)return;mark(false);if(q.auditory||adaptiveRun){answered=true;disableResponse();showFeedback(false,q.explanation||sample,true);return;}el('feedback').innerHTML=`<div class="feedback wrong"><h3>Keep exploring</h3><p>${e(q.explanation||sample)}</p><button id="retry" class="quiet">Try another response</button><button id="move-on" class="text-btn">Move on</button></div>`;el('retry').addEventListener('click',()=>{el('feedback').replaceChildren();el('response')?.focus();});el('move-on').addEventListener('click',next);});
}
function showFeedback(ok,text,advance=false,autoAdvance=ok){
 if(answered)revealCoachPrompt(current());
 el('feedback').innerHTML=`<div class="feedback ${ok?'':'wrong'}"><h3>${ok?'Nicely done!':'Keep thinking'}</h3><p>${e(text)}</p>${ok||advance?'<button id="next">Next challenge</button>':''}</div>`;
 el('next')?.addEventListener('click',next);if(ok)el('next').focus({preventScroll:true});
 adaptiveFeedback(ok);
 if(ok&&autoAdvance)advanceAfterCorrect();
}
function advanceAfterCorrect(){
 const version=renderVersion,question=current();
 if(!answered||!key||!question||finished)return;
 el('next').insertAdjacentHTML('afterend','<button id="stay" class="quiet">Stay here</button><p id="advance-status" class="small" role="status">Next challenge in a moment.</p>');
 const timer=later(()=>{if(key&&answered&&!finished&&version===renderVersion&&current()===question)next();},CORRECT_PAUSE_MS);
 el('stay').addEventListener('click',()=>{clearTimeout(timer);timers.delete(timer);el('stay').remove();el('advance-status').textContent='Take your time. Choose Next challenge when you’re ready.';});
}
async function sequenceBuffer(asset){
 if(audioBuffers.has(asset.id))return audioBuffers.get(asset.id);
 const usingKey=key,ctx=audioContext;const bytes=await decryptBytes(asset,usingKey);const buffer=await ctx.decodeAudioData(bytes);
 if(!key||key!==usingKey)throw new Error('locked');audioBuffers.set(asset.id,buffer);return buffer;
}
function renderSequence(q){
 el('question-content').insertAdjacentHTML('beforeend','<p class="question-instruction">Listen once. Say the numbers from smallest to largest, then the letters in alphabetical order. You won’t see the sequence.</p><div class="sequence-stage" id="sequence-stage" aria-live="polite">Ready to listen</div><div class="actions"><button id="play-sequence">Play sequence once</button><span id="sequence-status" class="small" role="status"></span></div><div id="sequence-response" hidden><div class="response-area"><label for="response">Numbers first, then letters</label><input id="response" autocomplete="off" placeholder="Type your recalled answer"><div class="actions"><button id="check">Check answer</button><button id="spoken-sequence" class="quiet">Score a spoken answer</button></div></div></div>');
 let instructionsReady=sequenceIntroPlayed;
 el('play-sequence').disabled=!instructionsReady;
 if(!instructionsReady&&!data.sequenceInstructions)el('sequence-status').textContent='The introduction audio is unavailable. Reopen this activity after checking your connection.';
 if(!sequenceIntroPlayed&&data.sequenceInstructions){
 el('play-sequence').disabled=true;
 el('question-content').insertAdjacentHTML('afterbegin','<div class="audio-prompt"><button id="sequence-instructions" class="quiet">Hear how to play</button><p id="instruction-status" class="small" role="status">Numbers first, then letters. The introduction includes two practice examples.</p></div>');
 el('sequence-instructions').addEventListener('click',async()=>{const version=renderVersion;el('sequence-instructions').disabled=true;el('play-sequence').disabled=true;el('instruction-status').textContent='Listening to the introduction…';try{const complete=await playClip(data.sequenceInstructions);if(complete&&version===renderVersion){instructionsReady=true;sequenceIntroPlayed=true;el('sequence-instructions').disabled=false;el('play-sequence').disabled=false;el('instruction-status').textContent='Ready for your first sequence.';}}catch{if(version===renderVersion){el('sequence-instructions').disabled=false;el('play-sequence').disabled=!instructionsReady;el('instruction-status').textContent='The introduction couldn’t play. Try again.';}}});
 }
 el('play-sequence').addEventListener('click',async()=>{
  if(plays>=1||!instructionsReady)return;const version=renderVersion;const button=el('play-sequence');button.disabled=true;el('sequence-stage').textContent='Getting ready…';
  try{
   stopAudio();const epoch=audioEpoch;
   audioContext ||= new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();
   const tokens=q.sequence||[],buffers=await Promise.all(tokens.map(token=>{const asset=data.audioSymbols?.[token];if(!asset)throw new Error('audio-unavailable');return sequenceBuffer(asset);}));
   if(epoch!==audioEpoch||version!==renderVersion)return;
   plays=1;notePresentation();if(el('sequence-instructions'))el('sequence-instructions').disabled=true;el('sequence-stage').textContent='Listening…';el('sequence-status').textContent='One item per second. No replay.';
   const start=audioContext.currentTime+.15;
   buffers.forEach((buffer,i)=>{const source=audioContext.createBufferSource();source.buffer=buffer;if(i===buffers.length-1)source.playbackRate.value=.94;source.connect(audioContext.destination);source.start(start+i*(q.itemIntervalMs||1000)/1000);audioSources.add(source);source.onended=()=>audioSources.delete(source);});
   later(()=>{if(epoch!==audioEpoch||version!==renderVersion)return;auditoryReady=true;el('sequence-stage').textContent='Your turn';el('sequence-response').hidden=false;el('response').focus();},150+tokens.length*(q.itemIntervalMs||1000));
  }catch{if(version===renderVersion){button.disabled=false;el('sequence-stage').textContent='Audio unavailable';el('sequence-status').textContent='The trial has not started. Check your audio and try again.';}}
 });
 const complete=ok=>{if(answered)return;mark(ok);answered=true;el('check').disabled=true;el('spoken-sequence').disabled=true;el('response').readOnly=true;showFeedback(ok,`${ok?'You remembered and reorganized the sequence.':'Let’s compare after this attempt.'} Answer: ${answers(q).join(' · ')}`,true);};
 el('check').addEventListener('click',()=>{if(!auditoryReady||answered)return;const response=el('response').value.toUpperCase().replace(/[^A-Z0-9]/g,'');if(!response)return;const expected=answers(q).join('').replace(/[^A-Z0-9]/gi,'').toUpperCase();complete(response===expected);});
 el('spoken-sequence').addEventListener('click',()=>{if(!auditoryReady||answered)return;el('check').disabled=true;el('response').readOnly=true;el('feedback').innerHTML=`<div class="coach-example"><div class="eyebrow">Grown-up’s answer key</div><p>${e(answers(q).join(' · '))}</p>${adaptiveRun?'<p class="small">Judge the recalled answer given before seeing the key. Keep the one-play rule for this trial.</p>':''}<div class="actions"><button id="seq-good">${adaptiveRun?'Correct on own':'Correct order'}</button>${adaptiveRun?'<button id="seq-supported" class="quiet">Correct with a strategy clue</button>':''}<button id="seq-miss" class="quiet">Practice again later</button></div></div>`;el('seq-good').addEventListener('click',()=>complete(true));el('seq-supported')?.addEventListener('click',()=>{if(answered)return;noteAdaptiveHelp();complete(true);});el('seq-miss').addEventListener('click',()=>complete(false));});
 el('response').addEventListener('keydown',event=>{if(event.key==='Enter')el('check').click();});
}
function renderRecall(q){
 const words=q.words||[];
 if(q.auditory){renderAuditoryRecall(q);return;}
 el('question-content').insertAdjacentHTML('beforeend',`<p class="question-instruction">Study the words for up to one minute. Then the list disappears. Recall as many as you can.</p><div class="actions"><button id="start-recall">Show word list</button><span id="countdown" class="countdown"></span></div><div id="recall-stage"></div>`);
 el('start-recall').addEventListener('click',()=>{
  el('start-recall').disabled=true;el('recall-stage').innerHTML=`<div class="recall-words">${words.map(w=>`<span>${e(w)}</span>`).join('')}</div><button id="hide-list" class="quiet">Ready to recall</button>`;
  let seconds=60;el('countdown').textContent='1:00';
  const timer=setInterval(()=>{seconds-=1;if(!key)return;el('countdown').textContent=`0:${String(seconds).padStart(2,'0')}`;if(seconds<=0)hide();},1000);timers.add(timer);
  const hide=()=>{clearInterval(timer);timers.delete(timer);el('countdown').textContent='';el('recall-stage').innerHTML='<div class="response-area"><label for="recall-response">What do you remember?</label><textarea id="recall-response" placeholder="Separate each item with a comma or a new line."></textarea><div class="actions"><button id="check-recall">Check my list</button></div></div>';el('recall-response').focus();el('check-recall').addEventListener('click',()=>{
   const guess=[...new Set(el('recall-response').value.split(/[,;\n]+/).map(normalize).filter(Boolean))];if(!guess.length){el('recall-response').focus();return;}
   const found=words.filter(w=>guess.includes(normalize(w))),missed=words.filter(w=>!guess.includes(normalize(w)));mark(found.length===words.length);
   // Partial recall is practice completed, with missed items available for review.
   if(found.length!==words.length){progress.items[q.id].done=true;progress.items[q.id].reviewed=false;saveProgress();sessionDone+=1;}
   answered=true;el('check-recall').disabled=true;el('recall-response').readOnly=true;
   el('feedback').innerHTML=`<div class="feedback"><h3>${found.length} of ${words.length} remembered</h3><p>${missed.length?`Still to practice: ${e(missed.join(', '))}`:'You remembered every word.'}</p><p class="small">Check spelling or a spoken answer together. Grouping words can help you remember.</p><button id="next">Next challenge</button></div>`;el('next').addEventListener('click',next);if(found.length===words.length)advanceAfterCorrect();
  });};el('hide-list').addEventListener('click',hide);
 });
}
function renderAuditoryRecall(q){
 const words=q.words||[];
 el('question-content').insertAdjacentHTML('beforeend','<p class="question-instruction">Listen to the words once. Wait one minute after the list ends, then recall as many as you can. The words won’t be shown.</p><div class="sequence-stage" id="recall-state">Ready to listen</div><div class="actions"><button id="start-recall">Listen to word list once</button><span id="countdown" class="countdown" role="status"></span></div><div id="recall-stage"></div>');
 el('start-recall').addEventListener('click',async()=>{const version=renderVersion;el('start-recall').disabled=true;el('recall-state').textContent='Listening…';
  try{const complete=await playClip(q.audio?.list);if(!complete||version!==renderVersion)return;plays=1;el('recall-state').textContent='Keep the words in mind';let seconds=q.recallDelaySeconds||60;el('countdown').textContent=`${seconds}s until recall`;
   const timer=setInterval(()=>{seconds-=1;if(!key||version!==renderVersion)return;el('countdown').textContent=`${seconds}s until recall`;if(seconds<=0){clearInterval(timer);timers.delete(timer);el('recall-state').textContent='Your turn';el('countdown').textContent='';auditoryReady=true;
    el('recall-stage').innerHTML='<div class="response-area"><label for="recall-response">What do you remember?</label><textarea id="recall-response" placeholder="Separate each item with a comma or a new line."></textarea><div class="actions"><button id="check-recall">Check my list</button><button id="spoken-recall" class="quiet">Score a spoken list</button></div></div>';el('recall-response').focus();
    el('check-recall').addEventListener('click',()=>{const guess=[...new Set(el('recall-response').value.split(/[,;\n]+/).map(normalize).filter(Boolean))];if(!guess.length)return;const found=words.filter(w=>guess.includes(normalize(w)));finishRecall(q,found.length);});
    el('spoken-recall').addEventListener('click',()=>{el('feedback').innerHTML=`<div class="coach-example"><div class="eyebrow">Grown-up’s word list</div><p>${e(words.join(', '))}</p><label for="recall-count">How many were remembered?</label><input id="recall-count" type="number" min="0" max="${words.length}" value="0"><button id="score-recall">Save recall</button></div>`;el('score-recall').addEventListener('click',()=>finishRecall(q,Math.max(0,Math.min(words.length,Number(el('recall-count').value)||0))));});
   }},1000);timers.add(timer);
  }catch{if(version===renderVersion){el('start-recall').disabled=false;el('recall-state').textContent='Audio couldn’t play. The waiting minute has not started.';}}
 });
}
function finishRecall(q,count){if(answered)return;const words=q.words||[];mark(count===words.length);if(count!==words.length){progress.items[q.id].done=true;progress.items[q.id].reviewed=false;saveProgress();sessionDone+=1;}progress.items[q.id].recalled=count;saveProgress();answered=true;el('check-recall').disabled=true;el('spoken-recall').disabled=true;el('recall-response').readOnly=true;showFeedback(true,`${count} of ${words.length} remembered. Original list: ${words.join(', ')}. Check spelling or spoken answers together.`,true,count===words.length);}
function renderStory(q){
 const audible=q.auditory;
 el('question-content').insertAdjacentHTML('beforeend',`<p class="question-instruction">${audible?'Listen to the story once or twice, then answer from memory.':'Read the story once or twice, then answer from memory.'}</p>${audible?'<div class="sequence-stage" id="story-state">Ready to listen</div>':`<div class="story" id="story-text">${e(q.story)}</div>`}<div class="actions"><button id="read-story" class="quiet">${audible?'Listen to the story':'Read the story aloud'}</button><button id="hide-story" ${audible?'disabled':''}>Ready for questions</button><span id="story-status" class="small" role="status"></span></div><div id="story-stage"></div>`);
 el('read-story').addEventListener('click',async()=>{const version=renderVersion;if(audible){el('read-story').disabled=true;el('hide-story').disabled=true;el('story-state').textContent='Listening…';try{const complete=await playClip(q.audio?.story);if(!complete||version!==renderVersion)return;plays+=1;el('read-story').disabled=plays>=(q.maxPlays||2);el('read-story').textContent='Listen once more';el('hide-story').disabled=false;el('story-state').textContent='Ready to recall';el('story-status').textContent=`${plays} of ${q.maxPlays||2} allowed readings`;}catch{if(version===renderVersion){el('read-story').disabled=false;el('story-state').textContent='Audio couldn’t play. Try again.';}}}else if(q.audio?.story){playClip(q.audio.story).catch(()=>el('story-status').textContent='Audio couldn’t play. Try again.');}else speak(q.story);});
 el('hide-story').addEventListener('click',()=>{
  clearActivity();auditoryReady=true;el('story-text')?.remove();el('story-state')?.remove();el('read-story').remove();el('hide-story').remove();
  el('story-stage').innerHTML=`<div class="story-questions">${(q.subquestions||[]).map((s,i)=>`<div><label for="story-response-${i}">${audible?`Answer ${i+1}`:`${i+1}. ${e(s.prompt)}`}</label>${audible?`<button class="quiet recall-question" data-story-audio="${i}">Hear question ${i+1}</button>`:''}<input id="story-response-${i}" autocomplete="off"></div>`).join('')}</div><div class="actions"><button id="story-compare">Compare answers</button><span id="recall-status" class="small" role="status"></span></div>`;
  document.querySelectorAll('[data-story-audio]').forEach(button=>button.addEventListener('click',()=>{playClip(q.audio?.subquestions?.[Number(button.dataset.storyAudio)]).catch(()=>{el('recall-status').textContent='Audio couldn’t play. Try again.';});}));
  el('story-compare').addEventListener('click',()=>{
   if(answered)return;
   el('feedback').innerHTML=`<div class="coach-example"><div class="eyebrow">Story answers</div>${(q.subquestions||[]).map((s,i)=>`<p>${i+1}. ${e(s.prompt)}<br><strong>${e(Array.isArray(s.answer)?s.answer.join(' / '):s.answer)}</strong></p>`).join('')}<p class="small">A grown-up can accept answers with the same meaning.</p><div class="actions"><button id="story-good">Remembered the story</button><button id="story-practice" class="quiet">Practice again later</button></div></div>`;
   el('story-good').addEventListener('click',()=>{if(answered)return;el('story-compare').disabled=true;mark(true);answered=true;showFeedback(true,'You listened closely. Can you retell the story in your own words?');});
   el('story-practice').addEventListener('click',()=>{mark(false);next();});
  });
 });
}
function renderDrawing(q){
 const steps=q.steps||[];
 el('question-content').insertAdjacentHTML('beforeend',`<p class="question-instruction">Draw here, or use paper. Use paper for any folding steps. Listen to each direction before moving on.</p><div class="drawing-layout"><div class="drawing-tools"><label for="drawing-mode">Using</label><select id="drawing-mode"><option value="pad">Drawing pad</option><option value="paper">Paper</option></select></div><div class="drawing-step"><div class="eyebrow" id="step-label">Direction 1 / ${steps.length}</div><p id="step-text">${q.auditory?'Listen, then draw.':e(steps[0]||q.prompt)}</p><div class="actions"><button id="speak-step" class="quiet">Read direction</button><button id="next-step" ${q.auditory?'disabled':''}>Next direction</button></div><p id="drawing-audio-status" class="small" role="status"></p></div><div class="drawing-tools"><label for="pen-color">Pen</label><input id="pen-color" type="color" value="#17213d"><label for="pen-width" class="sr-only">Pen width</label><select id="pen-width"><option value="3">Fine</option><option value="7">Thick</option></select><button id="erase" class="quiet" aria-pressed="false">Eraser</button><button id="clear-drawing" class="quiet">Clear drawing</button></div><div class="canvas-wrap"><canvas id="drawing" width="980" height="700" aria-label="Drawing area. You can also complete the directions on paper."></canvas></div></div>`);
 let step=0,erasing=false,drawing=false,last;
 const canvas=el('drawing'),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.lineCap='round';ctx.lineJoin='round';
 const xy=event=>{const rect=canvas.getBoundingClientRect();return [(event.clientX-rect.left)*canvas.width/rect.width,(event.clientY-rect.top)*canvas.height/rect.height];};
 canvas.addEventListener('pointerdown',event=>{drawing=true;last=xy(event);canvas.setPointerCapture(event.pointerId);ctx.fillStyle=erasing?'white':el('pen-color').value;ctx.beginPath();ctx.arc(last[0],last[1],Number(el('pen-width').value)/2,0,Math.PI*2);ctx.fill();});
 canvas.addEventListener('pointermove',event=>{if(!drawing)return;const point=xy(event);ctx.strokeStyle=erasing?'white':el('pen-color').value;ctx.lineWidth=erasing?25:Number(el('pen-width').value);ctx.beginPath();ctx.moveTo(...last);ctx.lineTo(...point);ctx.stroke();last=point;});
 canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);
 el('erase').addEventListener('click',()=>{erasing=!erasing;el('erase').setAttribute('aria-pressed',erasing);el('erase').textContent=erasing?'Use pen':'Eraser';});
 el('clear-drawing').addEventListener('click',()=>{ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);});
 el('drawing-mode').addEventListener('change',()=>{canvas.parentElement.hidden=el('drawing-mode').value==='paper';});
 el('speak-step').addEventListener('click',async()=>{const clip=el('drawing-mode').value==='pad'&&q.audio?.canvasSteps?.[step]?q.audio.canvasSteps[step]:q.audio?.steps?.[step];if(clip){const version=renderVersion;el('speak-step').disabled=true;el('next-step').disabled=true;el('drawing-audio-status').textContent='Listening…';el('drawing-mode').disabled=true;try{const complete=await playClip(clip);if(complete&&version===renderVersion){el('speak-step').disabled=false;el('next-step').disabled=false;el('drawing-audio-status').textContent='Your turn to draw.';el('drawing-mode').disabled=false;}}catch{if(version===renderVersion){el('speak-step').disabled=false;el('drawing-audio-status').textContent='Audio couldn’t play. Try again.';el('drawing-mode').disabled=false;}}}else if(q.auditory){el('drawing-audio-status').textContent='This direction’s audio couldn’t load. Try reopening the activity.';}else speak(steps[step]||q.prompt);});
 el('next-step').addEventListener('click',()=>{
  if(step+1<steps.length){step+=1;el('step-label').textContent=`Direction ${step+1} / ${steps.length}`;el('step-text').textContent=q.auditory?'Listen, then draw.':steps[step];if(q.auditory)el('next-step').disabled=true;el('drawing-audio-status').textContent='';if(step+1===steps.length)el('next-step').textContent='Compare drawing';}
  else coachCompare(q);
 });
}
function renderFinish(){
 clearActivity();renderVersion+=1;
 root.innerHTML=`<div class="container">${header()}<main class="question-card finish"><div class="finish-mark" aria-hidden="true">✓</div><div class="eyebrow">Round complete</div><h1>You made room for new ideas.</h1><p>${sessionDone} of ${session.length} challenges completed.<br>${currentFirst} completed on the first attempt.</p><p class="muted">Tell a grown-up one thing you learned, or show them your favorite challenge.</p><div class="actions"><button id="done">Choose another challenge</button><button id="replay" class="quiet">Play this round again</button></div></main></div>`;
 bindHeader();el('done').addEventListener('click',renderHome);el('replay').addEventListener('click',()=>startSession(session));
}
async function openResource(index,page=1){
 const resource=data?.resources[index];if(!resource)return;
 el('stay')?.click();
 const version=key;el('resource-title').textContent=resource.name;el('resource-status').textContent='Opening encrypted worksheet…';el('resource-body').replaceChildren();if(!dialog.open)dialog.showModal();
 try{
  const url=await assetUrl(resource.asset,'application/pdf');if(!key||key!==version||!dialog.open){URL.revokeObjectURL(url);urls.delete(url);return;}
  if(adaptiveRun&&!answered)noteAdaptiveHelp();
  el('resource-status').textContent=`${resource.pages} pages · Original worksheet`;
  el('resource-body').innerHTML=`<div class="resource-actions"><a id="pdf-open" target="_blank" rel="noopener">Open PDF in a new tab</a><a id="pdf-download" download>Download PDF</a><span class="small">On a phone, opening the PDF separately may work best.</span></div><iframe id="pdf-frame" class="pdf-frame" title="${e(resource.name)}"></iframe>`;
  el('pdf-open').href=`${url}#page=${page}`;el('pdf-download').href=url;el('pdf-download').download=resource.name;el('pdf-frame').src=`${url}#page=${page}`;
 }catch{if(key&&dialog.open)el('resource-status').textContent='The worksheet couldn’t load. Close this window and try again.';}
}
el('close-resource').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{el('resource-body').replaceChildren();el('resource-title').textContent='';el('resource-status').textContent='';});
window.addEventListener('pagehide',()=>commitAdaptiveQuestion(false));
document.addEventListener('keydown',event=>{
 if(!key||!session.length||finished||dialog.open||event.altKey||event.ctrlKey||event.metaKey)return;
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
 const q=current();if(q?.type==='choice'&&/^[1-9]$/.test(event.key)){const i=Number(event.key)-1;const b=document.querySelector(`[data-option="${i}"]`);if(b&&!b.disabled){event.preventDefault();b.click();}}
});
renderLock();
