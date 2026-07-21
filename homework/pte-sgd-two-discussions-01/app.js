const API_BASE = 'https://william-sgd-homework.jamesbowers86.workers.dev';
const tasks = [
  { id:'task-01', topic:'Car-free weekends in city centres', audio:'audio/task-01-v1.mp3' },
  { id:'task-02', topic:'A four-day working week', audio:'audio/task-02-v1.mp3' }
];

const params = new URLSearchParams(location.search);
const token = params.get('session') || '';
const PREP_SECONDS = window.__HOMEWORK_TEST_TIMINGS__?.prep ?? 10;
const RECORD_SECONDS = window.__HOMEWORK_TEST_TIMINGS__?.record ?? 120;
const screens = [...document.querySelectorAll('.screen')];
const audio = document.getElementById('discussionAudio');
const notesBox = document.getElementById('notesBox');
const submitNotesBox = document.getElementById('submitNotesBox');
let stream = null;
let recorder = null;
let chunks = [];
let currentTaskIndex = 0;
let noteMode = 'typed';
let currentBlob = null;
let attemptId = '';
let recordingStartedAt = 0;
let countdownHandle = null;

const storageKey = `william-sgd-homework-${token.slice(-12)}`;
const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
saved.notes ||= {};
saved.completed ||= [];

function persist(){ localStorage.setItem(storageKey, JSON.stringify(saved)); }
function show(id){ screens.forEach(s => s.classList.toggle('active', s.id === id)); }
function setStatus(id, message, isError=false){ const el=document.getElementById(id); el.textContent=message; el.style.color=isError?'#a33c26':''; }
function authHeaders(extra={}){ return { Authorization:`Bearer ${token}`, ...extra }; }
function fit(){
  const stage=document.getElementById('stage');
  if(innerWidth<=760){ stage.style.transform='none'; stage.style.left='0'; stage.style.top='0'; return; }
  const scale=Math.min(innerWidth/1920,innerHeight/1080); stage.style.transform=`scale(${scale})`; stage.style.left=`${(innerWidth-1920*scale)/2}px`; stage.style.top=`${(innerHeight-1080*scale)/2}px`;
}
addEventListener('resize',fit); fit();

async function api(path, options={}){
  const response=await fetch(`${API_BASE}${path}`,{...options,headers:{...authHeaders(),...(options.headers||{})},referrerPolicy:'no-referrer'});
  const data=await response.json().catch(()=>({ok:false,error:'bad-response'}));
  if(!response.ok) throw new Error(data.error||`request-${response.status}`);
  return data;
}

function fail(title,copy){ document.getElementById('errorTitle').textContent=title; document.getElementById('errorCopy').textContent=copy; show('screenError'); }

async function boot(){
  if(token.length<20) return fail('This homework link is incomplete.','Ask James for a new homework link.');
  try{
    const status=await api('/api/v1/session');
    const remoteDone=status.tasks.map(t=>t.task_id);
    saved.completed=[...new Set([...saved.completed,...remoteDone])]; persist();
    if(saved.completed.length===2) return show('screenComplete');
    currentTaskIndex=saved.completed.includes('task-01')?1:0;
  }catch(error){ return fail('This homework link has expired.','Ask James for a new homework link.'); }
}

async function ensureMic(){
  if(stream && stream.active) return stream;
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported-browser');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  return stream;
}

document.getElementById('checkMic').addEventListener('click',async()=>{
  const button=document.getElementById('checkMic'); button.disabled=true; setStatus('introStatus','Waiting for microphone permission.');
  try{ await ensureMic(); setStatus('introStatus','Microphone ready.'); prepareReady(); }
  catch(error){ button.disabled=false; setStatus('introStatus',error.message==='unsupported-browser'?'Use a current version of Chrome, Edge or Safari.':'Allow microphone access, then try again.',true); }
});

function prepareReady(){
  const task=tasks[currentTaskIndex];
  document.getElementById('taskNumber').textContent=`Task ${currentTaskIndex+1} of 2`;
  document.getElementById('taskTopic').textContent='Summarize Group Discussion';
  document.getElementById('readyStatus').textContent='';
  document.querySelectorAll('input[name=noteMode]').forEach(input=>{ input.disabled=false; input.checked=input.value==='typed'; });
  document.getElementById('beginTask').disabled=false;
  show('screenReady');
}

document.getElementById('beginTask').addEventListener('click',async()=>{
  noteMode=document.querySelector('input[name=noteMode]:checked').value;
  const task=tasks[currentTaskIndex];
  if(saved.played?.includes(task.id)){ setStatus('readyStatus','This discussion has already played. Ask James for help if there was a technical problem.',true); return; }
  try{ await ensureMic(); }
  catch{ setStatus('readyStatus','The microphone is no longer available. Check permission and try again.',true); return; }
  document.getElementById('beginTask').disabled=true;
  saved.played=[...new Set([...(saved.played||[]),task.id])]; persist();
  notesBox.value=saved.notes[task.id]||'';
  document.getElementById('typedPanel').hidden=noteMode!=='typed';
  document.getElementById('paperPanel').hidden=noteMode!=='photo';
  document.getElementById('runTaskNumber').textContent=`Task ${currentTaskIndex+1} of 2`;
  document.getElementById('phaseTitle').textContent='Listening';
  document.getElementById('phaseCopy').textContent='The discussion is playing once. Make a new line when the speaker changes.';
  document.getElementById('timer').textContent='Audio';
  document.getElementById('stage').className='stage listening';
  setStatus('runStatus',''); show('screenRun');
  audio.src=task.audio; audio.currentTime=0;
  audio.onended=beginPreparation;
  audio.onerror=()=>setStatus('runStatus','The audio did not start. Ask James for help.',true);
  try{ await audio.play(); }catch{ setStatus('runStatus','Playback was blocked. Tap the page once, then ask James for a fresh task link.',true); }
});

notesBox.addEventListener('input',()=>{
  const task=tasks[currentTaskIndex]; saved.notes[task.id]=notesBox.value; persist();
  document.getElementById('saveState').textContent='Saved on this device';
});

function countdown(seconds,onTick,onDone){
  clearInterval(countdownHandle); const end=performance.now()+seconds*1000;
  const update=()=>{ const remaining=Math.max(0,Math.ceil((end-performance.now())/1000)); onTick(remaining); if(remaining<=0){clearInterval(countdownHandle);onDone();} };
  update(); countdownHandle=setInterval(update,100);
}

function format(seconds){ return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; }

function beginPreparation(){
  document.getElementById('stage').className='stage preparing';
  document.getElementById('phaseTitle').textContent='Prepare';
  document.getElementById('phaseCopy').textContent='Choose the topic, speaker views, relationships and outcome.';
  countdown(PREP_SECONDS,s=>document.getElementById('timer').textContent=`0:${String(s).padStart(2,'0')}`,beginRecording);
}

function bestMime(){ return ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t))||''; }
function tone(){
  const ctx=new (window.AudioContext||window.webkitAudioContext)(); const osc=ctx.createOscillator(); const gain=ctx.createGain();
  osc.frequency.value=880; gain.gain.value=.05; osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+.22); osc.onended=()=>ctx.close();
}

function beginRecording(){
  chunks=[]; currentBlob=null; attemptId=crypto.randomUUID().replaceAll('-','');
  const mime=bestMime(); recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  recorder.onstop=finishRecording;
  recorder.start(1000); recordingStartedAt=performance.now(); tone();
  document.getElementById('stage').className='stage recording';
  document.getElementById('phaseTitle').textContent='Recording';
  document.getElementById('phaseCopy').textContent='Summarize in your own words. Keep going after a small mistake.';
  document.getElementById('finishEarly').hidden=false;
  countdown(RECORD_SECONDS,s=>document.getElementById('timer').textContent=format(s),()=>{if(recorder.state==='recording')recorder.stop()});
}

document.getElementById('finishEarly').addEventListener('click',()=>{ if(recorder?.state==='recording'){ clearInterval(countdownHandle); recorder.stop(); } });

async function finishRecording(){
  document.getElementById('finishEarly').hidden=true;
  const durationMs=Math.max(1000,Math.round(performance.now()-recordingStartedAt));
  currentBlob=new Blob(chunks,{type:recorder.mimeType||chunks[0]?.type||'audio/webm'});
  document.getElementById('phaseTitle').textContent='One moment';
  document.getElementById('phaseCopy').textContent='Your answer is complete.';
  document.getElementById('timer').textContent='…';
  await uploadRecording(durationMs);
}

async function uploadRecording(durationMs){
  const task=tasks[currentTaskIndex]; setStatus('runStatus','');
  try{
    const result=await api(`/api/v1/submissions/${task.id}/audio`,{method:'POST',headers:{'Content-Type':currentBlob.type,'X-Attempt-Id':attemptId,'X-Duration-Ms':String(durationMs)},body:currentBlob});
    prepareNotesSubmission();
  }catch(error){
    setStatus('runStatus',error.message==='task-already-submitted'?'This task is already complete.':'Something went wrong. Try again.',true);
    const retry=document.createElement('button'); retry.className='button primary'; retry.textContent='Try again'; retry.onclick=()=>{retry.remove();uploadRecording(durationMs)}; document.querySelector('#screenRun .audio-panel').appendChild(retry);
  }
}

function prepareNotesSubmission(){
  const task=tasks[currentTaskIndex];
  document.getElementById('submitTaskNumber').textContent=`Task ${currentTaskIndex+1} of 2`;
  document.getElementById('typedSubmitPanel').hidden=noteMode!=='typed';
  document.getElementById('photoSubmitPanel').hidden=noteMode!=='photo';
  submitNotesBox.value=saved.notes[task.id]||notesBox.value||'';
  document.getElementById('continueTask').hidden=true;
  setStatus('submitStatus',''); show('screenSubmit');
}

async function sendNotes(form){
  const task=tasks[currentTaskIndex];
  try{ await api(`/api/v1/submissions/${task.id}/notes`,{method:'POST',body:form}); completeCurrentTask(); }
  catch(error){ setStatus('submitStatus','Something went wrong with the notes. Check them and try again.',true); }
}

document.getElementById('sendTypedNotes').addEventListener('click',()=>{
  const value=submitNotesBox.value.trim(); if(!value){setStatus('submitStatus','Add your notes before sending.',true);return;}
  const form=new FormData(); form.set('mode','typed'); form.set('notes_text',value); sendNotes(form);
});
document.getElementById('notesPhoto').addEventListener('change',e=>{document.getElementById('photoName').textContent=e.target.files[0]?.name||'No photo selected'});
document.getElementById('sendPhotoNotes').addEventListener('click',()=>{
  const photo=document.getElementById('notesPhoto').files[0]; if(!photo){setStatus('submitStatus','Choose a clear photo first.',true);return;}
  const form=new FormData(); form.set('mode','photo'); form.set('photo',photo); sendNotes(form);
});

function completeCurrentTask(){
  const task=tasks[currentTaskIndex]; saved.completed=[...new Set([...saved.completed,task.id])]; persist();
  setStatus('submitStatus','Task complete.');
  const button=document.getElementById('continueTask'); button.hidden=false; button.textContent=currentTaskIndex===0?'Continue to task 2':'Finish homework';
}

document.getElementById('continueTask').addEventListener('click',()=>{
  if(currentTaskIndex===1){ stream?.getTracks().forEach(track=>track.stop()); show('screenComplete'); }
  else{ currentTaskIndex=1; currentBlob=null; chunks=[]; document.getElementById('notesPhoto').value=''; document.getElementById('photoName').textContent='No photo selected'; prepareReady(); }
});

boot();
