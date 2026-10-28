
    let salasRankings = [];
    let allTeams = [];
    const rankLabel = t => t.rank ? `#${t.rank}` : "NR";
    const hasModel = t => t && [t.offensiveRating,t.defensiveRating,t.pace,t.nationalAverageEfficiency].every(v => Number.isFinite(Number(v)) && Number(v)>0);
    let weeklySummary = {};
    let isPreseason = false;
    let currentSortKey = "rank";

    const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
    const parseRecord = (rec)=>{const [w,l]=String(rec||"0-0").replace(/–/g,"-").split("-").map(x=>parseInt(x,10)||0);return{wins:w,losses:l}};
    const formatScore = (value)=>value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(1);
    const changeText = (t)=>{
      if(isPreseason || !t.rank) return {text:"—",cls:"same"};
      if(t.previousRank == null) return {text:"NEW",cls:"new"};
      if(t.change > 0) return {text:`↑${t.change}`,cls:"up"};
      if(t.change < 0) return {text:`↓${Math.abs(t.change)}`,cls:"down"};
      return {text:"—",cls:"same"};
    };

    async function loadData(){
      try{
        const res = await fetch(`data/current.json?v=${Date.now()}`,{cache:"no-store"});
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        window.salasPayload = payload;
        salasRankings = Array.isArray(payload.rankings) ? payload.rankings : [];
        allTeams = payload.allTeams?.length ? payload.allTeams : salasRankings;
        weeklySummary = payload.weeklySummary || {};
        isPreseason = Boolean(payload.preseason);
        document.getElementById("asOfText").textContent = payload.updatedLabel || "Daily rankings";
        if(payload.message) showStatus(payload.message);
        else if(!salasRankings.length) showStatus("The 2026–27 Salas 64 will populate automatically when the season model begins.");
      }catch(err){
        showStatus("Rankings could not be loaded. Please refresh the page to try again.");
        document.getElementById("asOfText").textContent = "Data unavailable";
      }
      renderAll();
    }

    function showStatus(message){const el=document.getElementById("statusBanner");el.textContent=message;el.style.display="block"}

    function sortedData(){
      const data=[...salasRankings];
      if(currentSortKey==="rank") return data.sort((a,b)=>a.rank-b.rank);
      if(currentSortKey==="score") return data.sort((a,b)=>{const as=Number(a.salasScore),bs=Number(b.salasScore);if(!Number.isFinite(as)||!Number.isFinite(bs))return a.rank-b.rank;return bs-as||a.rank-b.rank});
      if(currentSortKey==="team") return data.sort((a,b)=>a.team.localeCompare(b.team));
      if(currentSortKey==="record") return data.sort((a,b)=>{const ar=parseRecord(a.record),br=parseRecord(b.record);const ap=ar.wins/Math.max(1,ar.wins+ar.losses),bp=br.wins/Math.max(1,br.wins+br.losses);return bp-ap || br.wins-ar.wins});
      return data;
    }

    function renderRankings(){
      const container=document.getElementById("rankingsList");container.innerHTML="";
      sortedData().forEach(item=>{
        const row=document.createElement("button");row.type="button";row.className="ranking-row";row.dataset.team=item.team.toLowerCase();
        const c=changeText(item);
        row.innerHTML=`<span class="rank-num">${item.rank}</span><span class="team-name">${escapeHtml(item.team)}</span><span class="record">${escapeHtml(item.record||"—")}</span><span class="score">${formatScore(item.salasScore)}</span><span class="change ${c.cls}">${c.text}</span>`;
        row.addEventListener("click",()=>openTeamCard(item));container.appendChild(row);
      });
    }

    function renderWeekly(){
      const set=(id,value)=>document.getElementById(id).textContent=value||"—";
      set("hottestTeam",weeklySummary.hottestTeam?.team);set("hottestNote",weeklySummary.hottestTeam?.note);
      set("biggestRiser",weeklySummary.biggestRiser?.team);set("riserNote",weeklySummary.biggestRiser?.note);
      set("biggestFaller",weeklySummary.biggestFaller?.team);set("fallerNote",weeklySummary.biggestFaller?.note);
      set("teamToWatch",weeklySummary.teamToWatch?.team);set("watchNote",weeklySummary.teamToWatch?.note);
    }

    function teamInitials(name){
      const words=String(name||"").replace(/[^A-Za-z0-9 ]/g," ").split(/\s+/).filter(Boolean);
      if(!words.length) return "S64";
      if(words.length===1) return words[0].slice(0,3).toUpperCase();
      return words.slice(0,3).map(w=>w[0]).join("").toUpperCase();
    }

    function setTeamLogo(t){
      const img=document.getElementById("modalLogo");
      const fallback=document.getElementById("modalLogoFallback");
      const showFallback=()=>{
        img.style.display="none";
        fallback.textContent=teamInitials(t.team);
        fallback.style.display="flex";
      };
      fallback.style.display="none";
      img.style.display="none";
      img.onerror=showFallback;
      if(t.logo){
        img.alt=`${t.team} logo`;
        img.src=t.logo;
        img.style.display="block";
      }else{
        img.removeAttribute("src");
        showFallback();
      }
    }

    function openTeamCard(t){
      if(document.body.dataset.page !== "team"){location.href="team.html?team="+encodeURIComponent(t.team);return;}
      const c=changeText(t);
      setTeamLogo(t);
      document.getElementById("modalRank").textContent=`${rankLabel(t)} · Salas 64`;
      document.getElementById("modalTeamName").textContent=t.team;
      document.getElementById("modalScore").textContent=formatScore(t.salasScore);
      document.getElementById("modalRecord").textContent=t.record||"—";
      document.getElementById("modalLast10").textContent=t.last10||"—";
      document.getElementById("modalStreak").textContent=t.streak||"—";
      document.getElementById("modalLastWeek").textContent=isPreseason?"—":(t.previousRank==null?"Not ranked":"#"+t.previousRank);
      document.getElementById("modalChange").textContent=c.text;
      document.getElementById("modalBestWin").textContent=t.bestWin||"—";
      document.getElementById("teamModal").classList.add("open");
      document.body.style.overflow="";
    }
    function closeTeamCard(){document.getElementById("teamModal").classList.remove("open");document.body.style.overflow=""}

    function updateSearchResults(){
      const input=document.getElementById("teamSearchInput"),box=document.getElementById("searchResults"),q=input.value.trim().toLowerCase();box.innerHTML="";
      if(!q){box.style.display="none";return}
      const matches=allTeams.filter(t=>t.team.toLowerCase().includes(q)).slice(0,10);
      if(!matches.length){box.style.display="none";return}
      matches.forEach(t=>{const item=document.createElement("button");item.type="button";item.className="search-result-item";item.innerHTML=`<span class="team">${escapeHtml(t.team)}</span><span class="rank">${rankLabel(t)}${isPreseason?"":" • "+formatScore(t.salasScore)}</span>`;item.addEventListener("click",()=>{input.value=t.team;box.style.display="none";openTeamCard(t)});box.appendChild(item)});box.style.display="block";
    }

    function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]))}

    function randn(){let u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
    function getTeamByName(name){return allTeams.find(t=>t.team===name)}
    function buildTeamSelects(){
      const a=document.getElementById("teamASelect"),b=document.getElementById("teamBSelect"),btn=document.getElementById("runSimBtn");a.innerHTML="";b.innerHTML="";
      const requested=new URLSearchParams(location.search);
      for(const key of ["teamA","teamB"]){const name=requested.get(key);if(name&&!getTeamByName(name))allTeams.push({team:name,rank:null,dataStatus:"not-in-directory"});}
      allTeams.slice().sort((x,y)=>x.team.localeCompare(y.team)).forEach(t=>{const label=`${rankLabel(t)} ${t.team}${hasModel(t)?'':' · Stats pending'}`;[a,b].forEach(sel=>{const o=document.createElement("option");o.value=t.team;o.textContent=label;sel.appendChild(o)})});
      const params=new URLSearchParams(location.search);
      a.value=getTeamByName(params.get('teamA'))?.team || allTeams[0]?.team || '';
      b.value=getTeamByName(params.get('teamB'))?.team || allTeams[1]?.team || '';
      updateSimulatorAvailability();
    }
    function updateSimulatorAvailability(){
      const a=getTeamByName(document.getElementById('teamASelect').value),b=getTeamByName(document.getElementById('teamBSelect').value);
      const ready=hasModel(a)&&hasModel(b)&&a!==b;
      const btn=document.getElementById('runSimBtn');btn.disabled=!ready;btn.textContent='Run simulations';
      let note=document.getElementById('simAvailability');
      if(!note){note=document.createElement('p');note.id='simAvailability';note.className='meta';note.setAttribute('role','status');document.getElementById('simulator').append(note);}
      note.textContent=a===b?'Choose two different teams.':ready?'Both teams have season model data.':'These teams are selected. Simulation unlocks when both have season efficiency and pace data.';
      document.getElementById('simResult').style.display='none';
    }
    function simulatorProjection(A,B){
      const natAvg=Number(A.nationalAverageEfficiency||B.nationalAverageEfficiency||110);
      const pace=clamp(((Number(A.pace)||68)+(Number(B.pace)||68))/2,58,80);
      const effA=(Number(A.offensiveRating)||natAvg)+((Number(B.defensiveRating)||natAvg)-natAvg);
      const effB=(Number(B.offensiveRating)||natAvg)+((Number(A.defensiveRating)||natAvg)-natAvg);
      const expA=pace*effA/100,expB=pace*effB/100,margin=expA-expB;
      const pA=1/(1+Math.exp(-margin/7));
      return{pace,expA,expB,pA,margin};
    }
    function runSimulations(){
      const A=getTeamByName(document.getElementById("teamASelect").value),B=getTeamByName(document.getElementById("teamBSelect").value);if(!hasModel(A)||!hasModel(B)||A===B)return;
      const sims=clamp(parseInt(document.getElementById("simsInput").value,10)||100,1,5000),base=simulatorProjection(A,B);let sumA=0,sumB=0,winsA=0,lastA=0,lastB=0;
      for(let i=0;i<sims;i++){let a=base.expA+randn()*8.4,b=base.expB+randn()*8.4;lastA=Math.round(clamp(a,45,120));lastB=Math.round(clamp(b,45,120));if(lastA===lastB){Math.random()<base.pA?lastA++:lastB++}sumA+=lastA;sumB+=lastB;if(lastA>lastB)winsA++}
      const avgA=sumA/sims,avgB=sumB/sims,pctA=Math.round(winsA/sims*100),margin=avgA-avgB;
      document.getElementById("lastScoreline").textContent=`Latest sim: ${A.team} ${lastA} — ${B.team} ${lastB}`;
      document.getElementById("simMeta").textContent=`Neutral court • ~${Math.round(base.pace)} possessions • model win probability: ${A.team} ${Math.round(base.pA*100)}%`;
      document.getElementById("simCount").textContent=sims.toLocaleString();document.getElementById("avgScore").textContent=`${A.team} ${avgA.toFixed(1)} — ${B.team} ${avgB.toFixed(1)}`;document.getElementById("winPct").textContent=`${A.team} ${pctA}% / ${B.team} ${100-pctA}%`;document.getElementById("avgMargin").textContent=margin>=0?`${A.team} +${margin.toFixed(1)}`:`${B.team} +${Math.abs(margin).toFixed(1)}`;document.getElementById("barLabelA").textContent=`${A.team} ${pctA}%`;document.getElementById("barLabelB").textContent=`${B.team} ${100-pctA}%`;document.getElementById("barFillA").style.width=`${clamp(pctA,1,99)}%`;document.getElementById("simResult").style.display="block";
    }

    function renderAll(){renderRankings();renderWeekly();buildTeamSelects();window.dispatchEvent(new Event("salas64:data"))}
    function init(){
      document.getElementById("year").textContent=new Date().getFullYear();
      document.getElementById("sortSelect").addEventListener("change",e=>{currentSortKey=e.target.value;renderRankings()});
      document.getElementById("teamSearchInput").addEventListener("input",updateSearchResults);
      document.getElementById("runSimBtn").addEventListener("click",runSimulations);
      document.getElementById("closeModal").addEventListener("click",closeTeamCard);
      document.getElementById("teamModal").addEventListener("click",e=>{if(e.target.id==="teamModal")closeTeamCard()});
      document.addEventListener("keydown",e=>{if(e.key==="Escape")closeTeamCard()});
      document.addEventListener("click",e=>{const w=document.querySelector(".search-wrapper"),box=document.getElementById("searchResults");if(w&&!w.contains(e.target))box.style.display="none"});
      ["teamASelect","teamBSelect"].forEach(id=>document.getElementById(id).addEventListener("change",updateSimulatorAvailability));
      loadData();
    }
        document.addEventListener("DOMContentLoaded",init);
