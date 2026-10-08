/* Personal device-local challenge; shared results and frozen model picks live in JSON. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ptDay = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let feed, bucket, picks = {}, storageOK = true, key, loading = false;
  function loadPicks() {
    key = `salas64:picks:${feed.season}:v1`;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      picks = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      localStorage.setItem('salas64:storage-check','1');localStorage.removeItem('salas64:storage-check');
      storageOK = true;
    } catch { picks = {};storageOK = false; }
  }
  function validPick(g) {
    const p = picks[g.id];
    return p && g.teams.some(t => t.id === p.team) && Date.parse(p.at) < Date.parse(g.start) && Date.parse(p.at) >= Date.parse(g.model.frozenAt) ? p : null;
  }
  function teamName(g,id) { return g.teams.find(t=>t.id===id)?.name || '—'; }
  function unlocked(g) {
    return storageOK && feed.day === ptDay() && g.day === ptDay() && g.status === 'scheduled' && Date.now() < Date.parse(g.start) && Date.now() >= Date.parse(g.model.frozenAt);
  }
  function savePick(g, id) {
    if (!unlocked(g)) { render();return; }
    const next = {...picks,[g.id]:{team:id,at:new Date().toISOString()}};
    try {localStorage.setItem(key, JSON.stringify(next));picks=next;}
    catch { storageOK=false;$('pickFeedback').textContent='Your pick could not be saved. Enable browser storage to play.';render();return; }
    render();
    document.querySelector(`[data-game="${g.id}"][data-team="${id}"]`)?.focus();
    $('pickFeedback').textContent=`Saved: ${teamName(g,id)}. You can change this pick until tipoff.`;
  }
  function render() {
    if (!bucket) return;
    const active=document.activeElement?.dataset;
    const focusPick=active?.game && active?.team ? {game:active.game,team:active.team} : null;
    const games=Object.values(bucket.games);
    let you=0, model=0, graded=0;
    const history=games.filter(g=>validPick(g)).sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
    for (const g of history) {
      if(g.status !== 'final' || !g.winner) continue;
      graded++;if(validPick(g).team===g.winner)you++;if(g.model.pick===g.winner)model++;
    }
    $('challengeSeason').textContent=`${feed.season} season`;
    $('yourRecord').textContent=`${you}–${graded-you}`;$('salasRecord').textContent=`${model}–${graded-model}`;
    $('yourRate').textContent=graded?`${Math.round(100*you/graded)}% correct`:'No graded picks yet';
    $('salasRate').textContent=graded?`${Math.round(100*model/graded)}% correct`:'No graded picks yet';
    $('seasonRace').textContent=you===model?'All square':you>model?`You lead by ${you-model}`:`Salas leads by ${model-you}`;
    const today=ptDay();
    $('challengeDate').textContent=`${new Date(today+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})} • Pacific day`;
    const featured=(bucket.days[today]||[]).map(id=>bucket.games[id]).filter(Boolean);
    const age=(Date.now()-Date.parse(feed.updatedAt))/3600000;
    $('predictionStatus').textContent=!storageOK?'Browser storage is unavailable. Enable it to save season picks.':feed.day!==today?'Today’s slate has not been published yet. Your season record is preserved.':!featured.length?'No eligible games are available today. Check back for the next Top 25 slate.':`${featured.filter(g=>validPick(g)).length} of ${featured.length} picked • Picks lock at each tipoff.${age>2?' Results feed is delayed; grading may take longer.':''}`;
    $('dailyGames').innerHTML=featured.map((g,i)=>{
      const p=validPick(g),canPick=unlocked(g),started=Date.now()>=Date.parse(g.start);
      const time=new Date(g.start).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',timeZoneName:'short'});
      const state=g.status==='final'?`Final • ${g.scores?.join(' – ') || ''}`:g.status==='void'?'Canceled / rescheduled • not counted':g.status==='live'?'Live • picks locked':started?'Picks locked • awaiting result':`Tipoff ${time}`;
      const result=g.status==='void'?'Not counted':g.status==='final'?(p?(p.team===g.winner?'You got it ✓':'You missed this one'):'No pick — not counted'):p?'Your pick is saved':canPick?'Tap a team to pick': 'No pick submitted';
      return `<article class="game-tile"><h4>GAME ${i+1} ${g.neutral?'• NEUTRAL COURT':'• AWAY / HOME'}</h4><div class="game-state">${escape(state)}</div>${g.teams.map(t=>`<button class="pick-team" data-game="${escape(g.id)}" data-team="${escape(t.id)}" aria-pressed="${p?.team===t.id}" ${canPick?'':'disabled'}><span><small>#${escape(t.rank)}</small> ${escape(t.name)}</span><span>${p?.team===t.id?'✓':''}</span></button>`).join('')}<div class="model-pick">Salas picks <strong>${escape(teamName(g,g.model.pick))}</strong><small>${escape(g.model.probability)}% model estimate • ${g.model.scores.map(escape).join(' – ')} projected</small><small>${escape(result)}</small></div></article>`;
    }).join('');
    $('dailyGames').querySelectorAll('[data-team]').forEach(button=>button.addEventListener('click',()=>savePick(bucket.games[button.dataset.game],button.dataset.team)));
    if(focusPick){const button=[...$('dailyGames').querySelectorAll('[data-team]')].find(b=>b.dataset.game===focusPick.game && b.dataset.team===focusPick.team);if(button && !button.disabled)button.focus({preventScroll:true});}
    $('historyCount').textContent=`(${history.length})`;
    $('pickHistory').innerHTML=history.length?history.map(g=>{
      const p=validPick(g),final=g.status==='final' && g.winner;
      const status=g.status==='void'?'Not counted':final?`You: ${p.team===g.winner?'W':'L'} · Salas: ${g.model.pick===g.winner?'W':'L'}`:'Pending';
      return `<div class="history-row"><strong>${escape(g.teams.map(t=>t.name).join(' vs. '))}</strong><span>${escape(g.day)} · You: ${escape(teamName(g,p.team))} · Salas: ${escape(teamName(g,g.model.pick))}</span>${escape(status)}</div>`;
    }).join(''):'<p class="meta">Your first pick starts your season. Finished games appear here with both results.</p>';
  }
  async function refresh() {
    if(loading)return;loading=true;
    try {
      const res=await fetch(`data/predictions.json?v=${Date.now()}`,{cache:'no-store'});
      if(!res.ok)throw Error('Feed unavailable');
      const next=await res.json();
      if(next.schemaVersion!==1 || !next.seasons?.[next.season]?.games || !next.seasons[next.season].days)throw Error('Invalid feed');
      feed=next;bucket=feed.seasons[feed.season];loadPicks();render();
    } catch {
      $('predictionStatus').textContent=feed?'Results could not refresh. Showing the last loaded feed; grading may be delayed.':'The daily challenge is not available yet. Once the game updater runs, picks and season results appear here.';
    } finally {loading=false;}
  }
  const popup=$('challengePopup');
  function dismiss(target) {
    popup.close();document.body.style.overflow='';
    try{sessionStorage.setItem('salas64:welcome',ptDay());}catch{}
    if(target){document.querySelector(target).scrollIntoView();const heading=document.querySelector(target+' h2');heading.tabIndex=-1;heading.focus({preventScroll:true});}
    else document.querySelector('.section-nav a').focus();
  }
  $('dismissChallenge').onclick=()=>dismiss();
  $('startChallenge').onclick=()=>dismiss('#predictions');
  $('browseChallenge').onclick=()=>dismiss('#rankings');
  popup.addEventListener('cancel',e=>{e.preventDefault();dismiss();});
  popup.addEventListener('click',e=>{if(e.target===popup){const r=popup.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dismiss();}});
  let show=true;try{show=sessionStorage.getItem('salas64:welcome')!==ptDay();}catch{}
  if(show){popup.showModal();document.body.style.overflow='hidden';}
  window.addEventListener('storage',e=>{if(e.key===key){loadPicks();render();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  setInterval(()=>{if(!document.hidden && bucket)render();},15000);
  refresh();
})();
