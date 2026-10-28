/* Account-backed picks. The server, not this browser, enforces pick deadlines. */
(() => {
  'use strict';
  const root=document.getElementById('predictions'), esc=escapeHtml;
  root.hidden=false;root.className='game-center';
  root.innerHTML=`<section class="predictions-hero"><div class="eyebrow">YOUR CALL. EVERY GAME.</div><h2>You vs. <span>Salas 64.</span></h2><p>Find your games. Make your picks. See how you stack up against the model.</p><div class="game-hero-tags"><span>Unlimited picks</span><span>Locked at tipoff</span><span>Saved to your account</span></div></section>
  <section class="race-grid" aria-label="Your season comparison"><div><span>Your record</span><strong id="gcYour">—</strong><small id="gcYourNote">Sign in to track your picks</small></div><div class="race-middle"><span>YOU VS. THE MODEL</span><strong id="gcRace">Make your call</strong><small>Same games. Same test.</small></div><div><span>Salas 64 record</span><strong id="gcModel">—</strong><small>Only your graded games with a model pick</small></div></section>
  <div class="gc-toolbar"><div class="gc-tabs" role="group" aria-label="View"><button data-view="games" aria-pressed="true">Games</button><button data-view="picks" aria-pressed="false">My picks</button></div><label>Game day <input type="date" id="gcDate"></label><label>Find a team <input type="search" id="gcSearch" placeholder="Search any team"></label><label>Show <select id="gcFilter"><option value="all">All games</option><option value="ranked">Top 64 involved</option><option value="favorites">My favorites</option><option value="unpicked">Not picked yet</option></select></label></div>
  <div class="gc-caption"><span id="gcCount"></span><span id="gcUpdated"></span></div><p id="gcFeedback" role="status" aria-live="polite"></p><div id="gcGames" class="gc-games"></div>
  <details class="gc-rules"><summary>Scoring & model details</summary><p>Pick as many games as you like and change a pick until its published deadline. Picks lock at the earliest published tipoff; a delay does not reopen them. Canceled and postponed games do not count. Final results refresh periodically, rather than live.</p><p>The comparison counts only games you picked that have a final winner and a frozen pregame model prediction. Games without model data remain available for your own picks and are labeled separately. Forecasts use adjusted efficiency and pace, with a 3-point home advantage. Percentages are estimates, not measured accuracy. Explore opens a neutral-court simulator, so its result may differ.</p><p>The updater loads yesterday, today, and the next two days, and retains earlier published games for your season record. Game days follow Pacific time; tipoff times use your local time. NR means outside the Salas Top 64. Model picks are hidden in this interface until you pick or the game locks; they are public data, not secret predictions. This is a personal season challenge; there is no public leaderboard.</p></details>`;
  const $=id=>document.getElementById(id);
  const pacificDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  $('gcDate').value=pacificDay();
  const lastDay=new Date(pacificDay()+'T12:00:00Z');lastDay.setUTCDate(lastDay.getUTCDate()+2);$('gcDate').max=lastDay.toISOString().slice(0,10);
  let games=[],picks=new Map(),user=null,view='games',busy=false,loaded=false,loadFailed=false,authGeneration=0;
  const locked=g=>g.state!=='scheduled'||!g.lockAt||Date.now()>=Date.parse(g.lockAt);
  const name=(g,id)=>g.away.espnId===id?g.away.team:g.home.espnId===id?g.home.team:'Unknown';
  const rank=t=>t.rank?`#${t.rank}`:'NR';
  const notice=s=>$('gcFeedback').textContent=s;
  function authPrompt(){document.querySelector('.account-drawer').open=true;$('account').scrollIntoView({behavior:'smooth'});$('authEmail').focus();notice('Sign in or create an account to save your picks.');}
  function summarize(){
    const graded=games.filter(g=>picks.has(g.id)&&g.state==='final'&&g.winnerId&&g.model?.winnerId);
    const w=graded.filter(g=>picks.get(g.id).team_id===g.winnerId).length,m=graded.filter(g=>g.model.winnerId===g.winnerId).length;
    $('gcYour').textContent=user?`${w}–${graded.length-w}`:'—';$('gcModel').textContent=user?`${m}–${graded.length-m}`:'—';
    $('gcRace').textContent=!user?'Make your call':!graded.length?'Season starts with you':w===m?'All square':w>m?`You lead by ${w-m}`:`Salas leads by ${m-w}`;
    $('gcYourNote').textContent=user?`${graded.length} comparable games · ${picks.size} saved picks`:'Sign in to track your picks';
  }
  function card(g){
    const pick=picks.get(g.id),isLocked=locked(g),reveal=pick||isLocked;
    const model=g.model;
    const date=g.startAt&&g.timeKnown?new Date(g.startAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Tipoff time TBD';
    const state=g.state==='scheduled'?(isLocked?'Picks locked':'Open for picks'):g.statusLabel;
    const teamButton=t=>`<button class="gc-team" data-game="${esc(g.id)}" data-team="${esc(t.espnId)}" aria-pressed="${pick?.team_id===t.espnId}" ${isLocked||busy?'disabled':''}><span class="gc-logo">${t.logo?`<img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.hidden=true">`:''}</span><span class="gc-team-name"><small>${rank(t)} · ${t===g.home?(g.neutral?'Neutral':'Home'):'Away'}</small><strong>${esc(t.team)}</strong></span><b>${g.state==='final'||g.state==='in-progress'?esc(t.score??'—'):pick?.team_id===t.espnId?'✓':'+'}</b></button>`;
    let outcome=pick?`Your pick: ${name(g,pick.team_id)}`:'Choose your winner';
    if(pick&&g.state==='final'&&g.winnerId)outcome+=pick.team_id===g.winnerId?' · Correct':' · Missed';
    if(g.state==='canceled'||g.state==='postponed')outcome=pick?'Pick void · Excluded from record':'Not available for picks';
    const modelText=!model?'Model unavailable · Waiting for season stats':reveal?`<strong>${esc(name(g,model.winnerId))}</strong> · ${Math.round(100*(model.winnerId===g.away.espnId?model.awayProbability:1-model.awayProbability))}% model win estimate`:'Make your pick to reveal Salas 64’s prediction';
    const explore=`simulator.html?teamA=${encodeURIComponent(g.away.team)}&teamB=${encodeURIComponent(g.home.team)}`;
    return `<article class="gc-game"><div class="gc-game-head"><span>${esc(date)}</span><span class="gc-state ${isLocked?'':'is-open'}">${esc(state)}</span></div>${teamButton(g.away)}${teamButton(g.home)}<p class="gc-your-pick">${esc(outcome)}</p><div class="gc-model"><span class="eyebrow">SALAS 64 MODEL</span><p>${modelText}</p></div><a class="gc-explore" href="${esc(explore)}">Explore this matchup <span aria-hidden="true">↗</span></a></article>`;
  }
  function render(){
    summarize();
    const q=$('gcSearch').value.trim().toLowerCase(),filter=$('gcFilter').value,day=$('gcDate').value;
    const favorites=new Set((window.salas64FavoriteIds||[]).map(String));
    function favorite(t){const own=allTeams.find(x=>String(x.espnId)===t.espnId);return own&&favorites.has(String(own.teamId||own.espnId||`name:${own.team}`));}
    const shown=games.filter(g=>(view==='picks'?picks.has(g.id):g.day===day)&&(!q||[g.away,g.home].some(t=>t.team.toLowerCase().includes(q)))&&(filter==='all'||filter==='ranked'&&(g.away.rank||g.home.rank)||filter==='unpicked'&&!picks.has(g.id)||filter==='favorites'&&[g.away,g.home].some(favorite)));
    $('gcCount').textContent=`${shown.length} ${view==='picks'?'saved picks':'games'}`;
    const focused=document.activeElement?.dataset;
    $('gcGames').innerHTML=shown.length?shown.map(card).join(''):`<div class="gc-empty"><h3>${!loaded?'Loading the games…':loadFailed?'Games could not load':view==='picks'&&!user?'Sign in to see your picks':view==='picks'?'No picks match these filters':'No games match this view'}</h3><p>${loadFailed?'Refresh to try again. Existing account picks have not been changed.':view==='picks'?'Pick winners from the Games tab to build your season record.':'Try another date or filter. Games appear when the schedule feed publishes them.'}</p>${!user?'<button class="primary-link" id="gcSignIn">Sign in / Create account</button>':''}</div>`;
    $('gcSignIn')?.addEventListener('click',authPrompt);
    if(focused?.game){const target=[...root.querySelectorAll('[data-game]')].find(e=>e.dataset.game===focused.game&&e.dataset.team===focused.team);target?.focus({preventScroll:true});}
  }
  async function loadPicks(){
    const generation=++authGeneration,client=window.salas64Client;
    if(!client)return;
    const {data,error}=await client.auth.getSession();if(error){notice('Account could not be checked. Please sign in again.');return;}
    if(generation!==authGeneration)return;
    user=data.session?.user||null;picks=new Map();
    if(user){
      const records=[];
      for(let offset=0;;offset+=1000){
        const result=await client.from('s64_picks').select('game_id,team_id').eq('user_id',user.id).order('game_id').range(offset,offset+999);
        if(generation!==authGeneration)return;
        if(result.error){notice('Saved picks are unavailable. The predictions database may still need setup.');render();return;}
        records.push(...result.data);if(result.data.length<1000)break;
      }
      const ids=new Set(games.map(g=>g.id));picks=new Map(records.filter(p=>ids.has(p.game_id)).map(p=>[p.game_id,p]));
    }
    render();
  }
  async function refresh(){
    try{const response=await fetch(`data/game-center.json?v=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.games))throw Error();games=data.games;loadFailed=false;$('gcUpdated').textContent=`Results updated ${new Date(data.updatedAt).toLocaleString()}`;}
    catch{loadFailed=true;$('gcUpdated').textContent='Schedule feed unavailable';}
    loaded=true;render();await loadPicks();
  }
  root.addEventListener('click',async e=>{
    const tab=e.target.closest('[data-view]');if(tab){view=tab.dataset.view;root.querySelectorAll('[data-view]').forEach(t=>t.setAttribute('aria-pressed',t===tab));$('gcDate').disabled=view==='picks';render();return;}
    const button=e.target.closest('[data-game]');if(!button||busy)return;
    if(!user){authPrompt();return;}
    const g=games.find(g=>g.id===button.dataset.game);if(!g||locked(g)){notice('Picks are locked for this game.');render();return;}
    busy=true;render();notice('Saving your pick…');
    try{
      const result=await window.salas64Client.rpc('s64_submit_pick',{p_game_id:g.id,p_team_id:button.dataset.team});
      if(result.error)throw result.error;
      await loadPicks();notice(`Saved: ${name(g,button.dataset.team)}. You can change this pick until its deadline.`);
    }catch(error){notice(error.message?.includes('locked')?'This game has locked. Your previous pick was kept.':'Could not save this pick. Check your connection and account, then try again.');}
    finally{busy=false;render();}
  });
  ['gcDate','gcSearch','gcFilter'].forEach(id=>$(id).addEventListener(id==='gcSearch'?'input':'change',render));
  window.addEventListener('salas64:auth',()=>{picks=new Map();user=null;render();loadPicks();});
  window.addEventListener('salas64:favorites',render);
  window.addEventListener('salas64:data',render);
  refresh();
  setInterval(()=>{if(!document.hidden&&!busy)refresh();},60000);
  setInterval(()=>{root.querySelectorAll('[data-game]').forEach(button=>{const g=games.find(g=>g.id===button.dataset.game);button.disabled=busy||!g||locked(g);});},1000);
})();
