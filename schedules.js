/* Team schedules are refreshed by GitHub Actions, not by the visitor's browser. */
(() => {
  if(document.body.dataset.page !== 'team')return;
  const escape = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id = t => String(t.espnId || t.logo?.match(/\/([0-9]+)\.(?:png|svg)/)?.[1] || '');
  const dateText = g => {
    const d=new Date(g.date);if(!Number.isFinite(d.getTime()))return 'Date TBD';
    // An unknown tipoff must not shift to the previous date in the viewer's zone.
    if(!g.timeKnown)return new Date(String(g.date).slice(0,10)+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})+' · Time TBD';
    return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  };
  async function load(){
    const box=document.getElementById('upcomingGames');
    const recent=document.getElementById('recentGames');
    const name=new URLSearchParams(location.search).get('team');
    const current=window.salasPayload;
    const team=current?.rankings.find(t=>t.team.toLowerCase()===String(name).toLowerCase());
    if(!box||!team)return;
    box.innerHTML='<p class="empty-state" role="status">Loading the published schedule…</p>';
    try{
      const response=await fetch('data/schedules.json',{cache:'no-cache'});
      if(!response.ok)throw Error('Schedule not available');
      const data=await response.json();
      if(data.season!==current.season)throw Error('Schedule season mismatch');
      const entry=data.teams?.[team.team];
      if(!entry||!Array.isArray(entry.games))throw Error('Team schedule unavailable');
      const games=entry.games;
      const updated=entry.updatedAt?new Date(entry.updatedAt).toLocaleString():null;
      const notice=`<p class="schedule-note">${entry.stale?'Refresh failed; showing the last saved schedule. ':''}ESPN · Refreshes approximately every 6 hours.${updated?' Updated '+escape(updated)+'.':''} Times shown in your local time zone. Scores are periodic snapshots, not live updates.</p>`;
      const render=g=>{
        const opponent=current.rankings.find(t=>id(t)===g.opponentEspnId);
        const label=g.location==='away'?'at':g.location==='neutral'?'vs (neutral)':'vs';
        const title=opponent?`<a href="team.html?team=${encodeURIComponent(opponent.team)}">${escape(g.opponent)}</a>`:escape(g.opponent);
        const status=g.status==='final'?`${escape(g.result||'Final')} ${escape(g.teamScore??'—')}–${escape(g.opponentScore??'—')}`:g.status==='scheduled'?'Scheduled':escape(g.statusLabel);
        const compare=opponent&&g.status==='scheduled'?`<a class="schedule-compare" href="index.html?teamA=${encodeURIComponent(team.team)}&teamB=${encodeURIComponent(opponent.team)}#simulator">Compare →</a>`:'';
        return `<div class="schedule-game"><div class="schedule-date">${escape(dateText(g))}</div><div class="schedule-opponent"><span>${label}</span> <strong>${title}</strong></div><div class="schedule-venue">${escape(g.venue)}</div><div class="schedule-bottom"><span class="schedule-status ${g.result==='W'?'schedule-win':g.result==='L'?'schedule-loss':''}">${status}</span>${compare}</div></div>`;
      };
      const upcoming=games.filter(g=>g.status!=='final'&&g.status!=='canceled');
      const finals=games.filter(g=>g.status==='final').sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      box.innerHTML=notice+(upcoming.length?upcoming.map(render).join(''):`<p class="empty-state">${entry.stale&&!updated?'The schedule could not be loaded yet.':'No remaining games are currently published for this season. Future matchups will appear when the source adds them.'}</p>`);
      if(finals.length)recent.innerHTML=notice+finals.slice(0,10).map(render).join('');
      const all=document.createElement('details');all.className='schedule-all';all.innerHTML=`<summary>Full published schedule (${games.length} games)</summary>`+games.map(render).join('');box.append(all);
    }catch{
      box.innerHTML='<p class="empty-state" role="status">Schedules are not available yet. They will appear after the automatic schedule updater completes successfully.</p>';
    }
  }
  window.addEventListener('salas64:data',load);
  if(window.salasPayload)load();
})();
