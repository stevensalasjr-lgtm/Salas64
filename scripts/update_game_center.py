"""Full daily slate and results, with frozen pregame forecasts. Standard library only."""
import json
import math
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from team_directory import normalized

ROOT = Path(__file__).resolve().parents[1]
PT = ZoneInfo('America/Los_Angeles')

def fetch(url, data=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
        headers={'User-Agent':'Salas64/4.0','Content-Type':'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
    return json.loads(raw) if raw else None

def instant(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z','+00:00')).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None

def ready(t):
    return t and all(isinstance(t.get(k),(int,float)) and math.isfinite(t[k]) and t[k]>0
        for k in ('offensiveRating','defensiveRating','pace','nationalAverageEfficiency'))

def forecast(a,b,neutral):
    if not (ready(a) and ready(b)):
        return None
    nat = a['nationalAverageEfficiency']
    pace = max(58,min(80,(a['pace']+b['pace'])/2))
    away = pace*(a['offensiveRating']+b['defensiveRating']-nat)/100
    home = pace*(b['offensiveRating']+a['defensiveRating']-nat)/100+(0 if neutral else 3)
    p = 1/(1+math.exp(-(away-home)/7))
    return {'winnerId':a['espnId'] if p>=.5 else b['espnId'], 'awayProbability':round(p,4),
            'awayScore':round(away,1),'homeScore':round(home,1),'version':'efficiency-1'}

def parse(event, teams, season, now, previous=None):
    if event.get('season',{}).get('year') != season:
        return None
    competitions = event.get('competitions',[])
    if not competitions:
        return None
    c=competitions[0]; sides=c.get('competitors',[])
    if len(sides)!=2:
        return None
    away=next((s for s in sides if s.get('homeAway')=='away'),None)
    home=next((s for s in sides if s.get('homeAway')=='home'),None)
    if not away or not home:
        return None
    def team(side):
        source=side['team']; tid=str(source['id']); t=teams.get(tid)
        # Unknown opponents can be picked, but never get an invented rating.
        return {'espnId':tid,'team':t['team'] if t else source.get('location') or source.get('displayName','TBD'),
                'rank': t.get('rank') if t else None,'logo':t.get('logo') if t else source.get('logo'),
                'inDirectory': t is not None, 'score':side.get('score')}
    a,b=team(away),team(home)
    if previous and (previous['away']['espnId'],previous['home']['espnId']) != (a['espnId'],b['espnId']):
        raise ValueError('Game identity changed; refusing to reassign existing picks')
    status=(c.get('status') or event.get('status') or {}).get('type',{})
    name=status.get('name','')
    state='canceled' if 'CANCEL' in name else 'postponed' if 'POSTPON' in name else 'final' if status.get('completed') else 'in-progress' if status.get('state')=='in' else 'scheduled'
    start=instant(c.get('date') or event.get('date'))
    known=c.get('timeValid',event.get('timeValid',False)) is True
    lock=start if known else None
    if previous and instant(previous.get('lockAt')):
        lock=min(lock,instant(previous['lockAt'])) if lock else instant(previous['lockAt'])
    model=previous.get('model') if previous else None
    if not model and lock and now<lock and state=='scheduled':
        model=forecast(teams.get(a['espnId']),teams.get(b['espnId']),bool(c.get('neutralSite')))
    winner=next((str(s['team']['id']) for s in sides if s.get('winner')),None) if state=='final' else None
    return {'id':str(event['id']),'season':season,'startAt':start.isoformat() if start else None,
            'day':start.astimezone(PT).date().isoformat() if start else None,
            'lockAt':lock.isoformat() if lock else None,'timeKnown':known,'state':state,
            'statusLabel':status.get('detail') or state, 'away':a,'home':b,'winnerId':winner,
            'neutral':bool(c.get('neutralSite')),'model':model}

def sync(games):
    url=os.environ.get('SUPABASE_URL','').rstrip('/')
    key=os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
    if not url or not key:
        raise RuntimeError('Set SUPABASE_URL and SUPABASE_SECRET_KEY in GitHub Actions secrets. Never put the service key in website files.')
    headers={'apikey':key,'Prefer':'resolution=merge-duplicates,return=representation'}
    if not key.startswith('sb_secret_'):
        headers['Authorization']='Bearer '+key
    for offset in range(0,len(games),150):
        rows=[{'id':g['id'],'season':g['season'],'start_at':g['startAt'],'lock_at':g['lockAt'],
            'state':g['state'],'away_id':g['away']['espnId'],'home_id':g['home']['espnId'],
            'winner_id':g['winnerId'],'payload':g} for g in games[offset:offset+150]]
        saved=fetch(url+'/rest/v1/s64_games?on_conflict=id',rows,headers)
        by_id={r['id']:r for r in saved}
        for g in games[offset:offset+150]:
            g['model']=by_id[g['id']]['payload'].get('model')
            g['lockAt']=by_id[g['id']]['lock_at']

def main():
    current=json.loads((ROOT/'data/current.json').read_text())
    season=int(current['season']); now=datetime.now(timezone.utc);today=now.astimezone(PT).date()
    path=ROOT/'data/game-center.json'
    old=json.loads(path.read_text()) if path.exists() else {}
    games={g['id']:g for g in old.get('games',[]) if g['season']==season}
    teams={str(t['espnId']):t for t in current.get('allTeams',current['rankings']) if t.get('espnId')}
    days={today+timedelta(days=i) for i in (-1,0,1,2)}
    # Revisit unfinished games and recent finals for provider result corrections.
    for g in games.values():
        dt=instant(g.get('startAt'))
        if dt and (g['state'] in ('scheduled','in-progress','postponed') or (now-dt).days<7):
            days.add(dt.astimezone(PT).date())
    touched={}
    for day in sorted(days):
        data=fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=1000&dates='+day.strftime('%Y%m%d'))
        if not isinstance(data.get('events'),list):
            raise ValueError('Invalid scoreboard; existing slate preserved')
        for event in data['events']:
            g=parse(event,teams,season,now,games.get(str(event['id'])))
            if g:
                games[g['id']]=g;touched[g['id']]=g
    sync(list(touched.values()))
    output={'season':season,'updatedAt':now.isoformat(),'dayTimezone':'America/Los_Angeles',
            'games':sorted(games.values(),key=lambda g:(g['startAt'] or '',g['id']))}
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(output,indent=2)+'\n');temp.replace(path)
    print(f'Updated {len(touched)} games; retained {len(games)} season games.')

if __name__=='__main__':
    main()
