/* Salas 64 presentation layer. Ranking and simulation formulas stay in app.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => escapeHtml(value);
  const homePage = document.body.dataset.page === 'rankings';
  const teamPage = document.body.dataset.page === 'team';
  const pageLink = t => `team.html?team=${encodeURIComponent(t.team)}`;
  const logo = t => `<span class="mini-logo">${t.logo && /^https?:\/\//.test(t.logo) ? `<img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${esc(teamInitials(t.team))}</span>` : esc(teamInitials(t.team))}</span>`;
  let currentTeam;
  const layout = document.querySelector('.layout');
  // Preserve the existing account form and its Supabase event handlers.
  const accountWrap = document.createElement('details');
  accountWrap.className = 'account-drawer';
  accountWrap.innerHTML = '<summary>My account & favorites</summary>';
  $('account').before(accountWrap); accountWrap.append($('account'));
  document.querySelector('.nav-account').addEventListener('click', () => {accountWrap.open = true;});
  $('authEmail').addEventListener('focus', () => {accountWrap.open = true;});
  document.addEventListener('click',e=>{if(e.target.id==='modalFavoriteBtn' && e.target.textContent.includes('Sign in'))accountWrap.open=true;},true);
  const favObserver = new MutationObserver(() => {if($('accountFeedback').textContent.includes('Sign in to save')) accountWrap.open=true;});
  favObserver.observe($('accountFeedback'),{childList:true});

  if(homePage){
    const hero=document.createElement('section');hero.className='dashboard-hero';
    hero.innerHTML='<div><div class="eyebrow">THE DAILY 64</div><h2>Follow the movement.<br><span>Know the contenders.</span></h2><p>Independent rankings. Matchup simulations. Your picks against the model.</p></div><a class="primary-link" href="#rankings">Explore the rankings ↓</a>';
    layout.prepend(hero);
    const weekly=document.createElement('section');weekly.className='weekly-overview';weekly.setAttribute('aria-label','Daily highlights');
    weekly.append(document.querySelector('.weekly-grid'));hero.after(weekly);
    const oldHeading=[...$('rankings').querySelectorAll('.card-header-row')].find(x=>x.textContent.includes('Today in'));
    oldHeading?.nextElementSibling?.remove();oldHeading?.remove();$('rankings').querySelector('.compare-hr')?.remove();
    const grid=document.createElement('div');grid.className='dashboard-grid';weekly.after(grid);grid.append($('rankings'));
    const side=document.createElement('aside');side.className='insight-sidebar';side.setAttribute('aria-label','Rankings insights');
    side.innerHTML='<section class="card spotlight"><div class="eyebrow">AT THE TOP</div><div id="leaderSpotlight" class="loading-placeholder">Loading the leader…</div></section><section class="card bubble-card" id="bubbleCard" aria-labelledby="bubbleTitle"><h2 id="bubbleTitle">Explore a Matchup</h2></section><section class="card challenge-promo"><div class="eyebrow">YOUR CALL. EVERY GAME.</div><h2>Can you beat<br>Salas 64?</h2><p>Pick as many games as you want. Follow your record against the model.</p><a class="primary-link" href="predictions.html">Make your picks →</a></section>';
    grid.append(side);layout.append(accountWrap);$('predictions').hidden=true;$('simulator').hidden=true;
    const filters=document.createElement('div');filters.className='filter-row';
    filters.innerHTML='<label>Conference<select id="conferenceFilter"><option value="">All conferences</option></select></label><label>Show<select id="rankFilter"><option value="64">All 64</option><option value="25">Top 25</option></select></label><label class="check-filter"><input id="favoritesFilter" type="checkbox"> Favorites</label><span id="filterCount" role="status"></span>';
    $('rankings').querySelector('.sort-row').before(filters);
    $('teamSearchInput').setAttribute('aria-label','Search all Division I teams');
    $('teamSearchInput').addEventListener('input',applyFilters);
    ['conferenceFilter','rankFilter','favoritesFilter'].forEach(id=>$(id).addEventListener('change',()=>{applyFilters();}));
    new MutationObserver(()=>{decorateRows();applyFilters();}).observe($('rankingsList'),{childList:true});
  } else if(teamPage) {
    const profile=document.createElement('article');profile.id='teamProfile';profile.className='team-profile';
    profile.innerHTML='<a class="back-link" href="index.html#rankings">← All rankings</a><p id="teamLoadStatus" role="status">Loading team profile…</p><div id="profileBody" hidden><section class="card profile-hero" id="profileHeader"></section><div class="profile-columns"><section class="card"><div class="eyebrow">THE SEASON SO FAR</div><h2>Ranking history</h2><div id="rankingHistory" class="history-chart"></div></section><section class="card"><div class="eyebrow">UNDER THE HOOD</div><h2>Team strengths</h2><div id="strengthStats"></div></section></div><div class="profile-columns"><section class="card"><h2>Recent results</h2><div id="recentGames"></div></section><section class="card"><h2>Upcoming games</h2><div id="upcomingGames"></div></section></div><section class="card"><div class="eyebrow">HEAD TO HEAD</div><h2>Pick an opponent</h2><p class="meta">Open this team in the neutral-court matchup simulator.</p><form id="compareTeamForm" class="profile-compare"><label for="profileOpponent">Opponent</label><select id="profileOpponent"></select><button class="primary-link" type="submit">Compare matchup →</button></form></section></div>';
    layout.prepend(profile);layout.append(accountWrap);
    ['rankings','predictions','simulator'].forEach(id=>$(id).hidden=true);
    $('teamModal').removeAttribute('role');$('teamModal').removeAttribute('aria-modal');
    $('closeModal').hidden=true;
    $('compareTeamForm').addEventListener('submit',e=>{e.preventDefault();location.href=`simulator.html?teamA=${encodeURIComponent(currentTeam.team)}&teamB=${encodeURIComponent($('profileOpponent').value)}#simulator`;});
  }
  if(!homePage && !teamPage){
    ['rankings','predictions','simulator'].forEach(id=>$(id).hidden=id!==document.body.dataset.page);
    layout.append(accountWrap);
  }
  function decorateRows(){
    document.querySelectorAll('.ranking-row').forEach(row=>{
      const t=salasRankings.find(t=>t.team.toLowerCase()===row.dataset.team);if(!t||row.dataset.decorated)return;
      row.dataset.decorated='true';row.setAttribute('aria-label',`View ${t.team}, ranked ${t.rank}`);
      const name=row.querySelector('.team-name');name.innerHTML=`${logo(t)}<span class="team-label">${esc(t.team)}<small>${esc(t.conference||'')}</small></span>`;
    });
  }
  function applyFilters(){
    if(!homePage)return;
    const q=$('teamSearchInput').value.trim().toLowerCase(), conf=$('conferenceFilter').value, limit=Number($('rankFilter').value), onlyFav=$('favoritesFilter').checked;
    const favs=new Set((window.salas64FavoriteIds||[]).map(String));let count=0;
    document.querySelectorAll('.ranking-row').forEach(row=>{
      const t=salasRankings.find(t=>t.team.toLowerCase()===row.dataset.team);if(!t)return;
      const match=t.team.toLowerCase().includes(q)&&(!conf||t.conference===conf)&&t.rank<=limit&&(!onlyFav||favs.has(String(t.teamId || t.espnId || t.logo?.match(/\/([0-9]+)\.(?:png|svg)/)?.[1] || `name:${t.team}`)));
      row.hidden=!match;if(match)count++;
    });
    $('filterCount').textContent=count?`${count} teams`:onlyFav?'No favorites found. Sign in and favorite a team on its page.':'No matching teams.';
  }
  function renderBubble(){
    if(!homePage)return;
    // Use the model's complete ordering, including its existing tie breakers.
    // Homepage filters must not change which teams are closest to entering.
    const rankedNames=new Set(salasRankings.map(t=>t.team));
    const teams=isPreseason?[]:allTeams.filter(t=>
      !rankedNames.has(t.team) && t.rank == null &&
      Number.isInteger(t.modelRank) && t.modelRank>=65 && t.modelRank<=69 &&
      t.salasScore != null && Number.isFinite(Number(t.salasScore))
    ).sort((a,b)=>a.modelRank-b.modelRank);
    const card=$('bubbleCard');
    if(!teams.length){
      card.innerHTML='<div class="eyebrow">HEAD TO HEAD</div><h2 id="bubbleTitle">Explore a Matchup</h2><p class="bubble-intro">Pick any two teams and open the matchup simulator.</p><a class="primary-link bubble-cta" href="simulator.html">Choose your teams →</a><p class="bubble-note">Simulations unlock when both teams have season stats. On the Bubble will appear here once season scores are available.</p>';
      return;
    }
    card.innerHTML='<div class="eyebrow">THE NEXT TEAMS UP</div><h2 id="bubbleTitle">On the Bubble</h2><p class="bubble-intro">Just outside the Top 64. Updated daily as teams make their case.</p><div class="bubble-list">'+teams.map(t=>
      `<a class="bubble-team" href="${pageLink(t)}" aria-label="${esc(t.team)}, NR, Salas Score ${formatScore(t.salasScore)}. View team page">${logo(t)}<span class="bubble-name"><strong>${esc(t.team)}</strong><small>NR · ${esc(t.record||'Record pending')}</small></span><span class="bubble-score"><strong>${formatScore(t.salasScore)}</strong><small>Salas</small></span></a>`
    ).join('')+'</div><p class="bubble-note">Closest to entering, in model order. Tap a team to follow its season.</p>';
  }
  function onData(){
    if(teamPage){renderProfile();return;}
    if(!homePage)return;
    decorateRows();
    const select=$('conferenceFilter'),old=select.value;
    select.innerHTML='<option value="">All conferences</option>'+[...new Set(salasRankings.map(t=>t.conference).filter(Boolean))].sort().map(c=>`<option>${esc(c)}</option>`).join('');
    select.value=old;select.disabled=select.options.length===1;
    const first=[...salasRankings].sort((a,b)=>a.rank-b.rank)[0];
    $('leaderSpotlight').innerHTML=first?`<a href="${pageLink(first)}" class="leader-link">${logo(first)}<span class="leader-rank">01</span><h2>${esc(first.team)}</h2><p>${esc(first.record)} · ${isPreseason?'Current leader':'Salas Score '+formatScore(first.salasScore)}</p><span class="info-link">View team profile →</span></a>`:'<p class="empty-state">Rankings are not available yet.</p>';
    if(isPreseason){document.querySelectorAll('.weekly-note').forEach(el=>{if(el.textContent==='—')el.textContent='Available after the season starts';});}
    applyFilters();renderBubble();
    const params=new URLSearchParams(location.search);
    for(const [param,id] of [['teamA','teamASelect'],['teamB','teamBSelect']]){if(salasRankings.some(t=>t.team===params.get(param)))$(id).value=params.get(param);}
  }
  function renderProfile(){
    const requested=new URLSearchParams(location.search).get('team');
    currentTeam=allTeams.find(t=>t.team.toLowerCase()===String(requested).toLowerCase());
    if(!currentTeam){$('teamLoadStatus').textContent=window.salasPayload?'This team was not found in the current directory. Search for its school name on the rankings page.':'Team data could not load. Refresh the page to try again.';return;}
    const t=currentTeam;document.title=`${t.team} | Salas 64`;document.querySelector('meta[name="description"]').content=`${t.team} rankings, team statistics, and matchup comparisons from Salas 64.`;
    $('teamLoadStatus').hidden=true;$('profileBody').hidden=false;
    $('profileHeader').append($('teamModal'));
    openTeamCard(t);
    const subtitle=document.createElement('p');subtitle.className='profile-subtitle';subtitle.textContent=[t.conference,window.salasPayload?.updatedLabel].filter(Boolean).join(' · ');document.querySelector('.team-card-title').append(subtitle);
    const bestNote=document.createElement('p');bestNote.className='meta';bestNote.textContent='Best win is selected by opponent model strength, with extra credit for away and neutral-site wins.';document.querySelector('.best-win').append(bestNote);
    document.querySelector('.salas-score-label').textContent=isPreseason?'SALAS SCORE · AVAILABLE IN SEASON':'SALAS SCORE';
    $('strengthStats').innerHTML=[['Offensive efficiency',t.offensiveRating,'Points scored per 100 possessions; higher is better.'],['Defensive efficiency',t.defensiveRating,'Points allowed per 100 possessions; lower is better.'],['Pace',t.pace,'Estimated possessions per game.']].map(([label,value,note])=>`<div class="strength-row"><div><strong>${label}</strong><p>${note}</p></div><b>${formatScore(value)}</b></div>`).join('');
    $('recentGames').innerHTML=Array.isArray(t.recentGames)&&t.recentGames.length?t.recentGames.map(g=>`<div class="result-row"><span class="result-badge ${g.win?'win':'loss'}">${g.win?'W':'L'}</span><div><strong>${esc(g.opponent)}</strong><small>${esc(String(g.date||'').slice(0,10))} · ${esc(g.location||'')}</small></div><strong>${esc(g.points??'—')}–${esc(g.opponentPoints??'—')}</strong></div>`).join(''):'<p class="empty-state">No results published yet. Completed games will appear after the daily rankings update.</p>';
    $('upcomingGames').innerHTML='<p class="empty-state">Loading the schedule. You can compare this team with any opponent below.</p>';
    $('profileOpponent').innerHTML=allTeams.filter(x=>x.team!==t.team).map(x=>`<option value="${esc(x.team)}">${rankLabel(x)} ${esc(x.team)}</option>`).join('');
    renderHistory(t);
  }
  async function renderHistory(t){
    const now=window.salasPayload;
    if(now.preseason){
      $('rankingHistory').innerHTML=`<div class="history-current"><strong>${rankLabel(t)}</strong><span>Starting ranking</span></div><p class="empty-state">Progress will appear after live season rankings begin, using this ranking as the starting point.</p>`;
      return;
    }
    let snapshots=[];let failed=false;
    try{const r=await fetch('data/history/index.json',{cache:'no-store'});if(!r.ok)throw Error('history unavailable');snapshots=await r.json();if(!Array.isArray(snapshots))throw Error('invalid history');}catch{failed=true;}
    const baseline=now.rankingBaseline;
    const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
    const currentDate=day(now.updatedAt);
    // Only use history explicitly tied to the saved starting rankings.
    snapshots=snapshots.filter(s=>s.season===now.season && s.phase==='live' && baseline && s.baselineId===baseline.id && s.date>=baseline.date && s.date!==currentDate);
    snapshots.push({date:currentDate,season:now.season,rankings:now.rankings,phase:'live'});
    snapshots.sort((a,b)=>a.date.localeCompare(b.date));
    if(baseline?.season===now.season)snapshots.unshift({...baseline,phase:'baseline'});
    const points=snapshots.map(s=>({date:s.date,baseline:s.phase==='baseline',rank:s.rankings.find(x=>x.team===t.team)?.rank??null}));
    if(points.length<2){$('rankingHistory').innerHTML=`<div class="history-current"><strong>${rankLabel(t)}</strong><span>Current ranking</span></div><p class="empty-state">${failed?'Historical data could not be loaded.':'Ranking history builds with each live season update.'}</p>`;return;}
    const x=i=>45+i*(600/(points.length-1)),y=r=>24+(r-1)*2.8;
    let segments=[],segment=[];points.forEach((p,i)=>{if(p.rank!==null)segment.push(`${x(i)},${y(p.rank)}`);else if(segment.length){segments.push(segment);segment=[];}});if(segment.length)segments.push(segment);
    $('rankingHistory').innerHTML=`<svg viewBox="0 0 690 245" role="img" aria-label="Daily ranking history for ${esc(t.team)}. Rank one is at the top.">${[1,16,32,48,64].map(r=>`<line x1="45" y1="${y(r)}" x2="645" y2="${y(r)}" stroke="#25354b"/><text x="8" y="${y(r)+4}" fill="#94a3b8" font-size="12">${r}</text>`).join('')}${segments.map(s=>`<polyline points="${s.join(' ')}" fill="none" stroke="#53a5ff" stroke-width="3"/>`).join('')}${points.map((p,i)=>p.rank!==null?`<circle cx="${x(i)}" cy="${y(p.rank)}" r="4" fill="#8ac7ff"><title>${p.baseline?'Starting ranking':esc(p.date)}: #${p.rank}</title></circle>`:'').join('')}<text x="45" y="232" fill="#94a3b8" font-size="12">${points[0].baseline?'Start':esc(points[0].date)}</text><text x="645" y="232" text-anchor="end" fill="#94a3b8" font-size="12">${esc(points.at(-1).date)}</text></svg><details><summary>View ranking history as a list</summary>${points.map(p=>`<p>${p.baseline?'Starting ranking':esc(p.date)}: ${p.rank===null?'Outside the Top 64':'#'+p.rank}</p>`).join('')}</details>${failed?'<p class="empty-state">Some past updates could not load. Showing the starting and current rankings.</p>':''}`;
  }
  window.addEventListener('salas64:data',onData);
  window.addEventListener('salas64:favorites',applyFilters);
  if(window.salasPayload)onData();
})();
