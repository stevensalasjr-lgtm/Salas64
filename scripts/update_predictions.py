"""Build an auditable, frozen daily challenge; standard library only."""
import json, math, os, re, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT = Path(__file__).resolve().parents[1]
PT = ZoneInfo('America/Los_Angeles')

def instant(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))

def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s).lower().replace(' state', ' st'))

def team_match(c, rankings):
    t = c['team']; tid = str(t['id'])
    for r in rankings:
        if str(r.get('espnId', r.get('teamId', r.get('id', '')))) == tid or re.search(r'/' + re.escape(tid) + r'\.(?:png|svg)', str(r.get('logo', ''))):
            return r
    names = {norm(t.get(k, '')) for k in ('location', 'shortDisplayName', 'displayName', 'abbreviation')} - {''}
    matches = [r for r in rankings if norm(r['team']) in names]
    return matches[0] if len(matches) == 1 else None

def usable(r):
    return r and all(isinstance(r.get(k), (int, float)) and math.isfinite(r[k]) and r[k] > 0 for k in ('offensiveRating', 'defensiveRating', 'pace'))

def project(a, b, neutral):
    # a=away, b=home; same efficiency formula as the existing simulator.
    nat = float(a.get('nationalAverageEfficiency') or b.get('nationalAverageEfficiency') or 110)
    pace = max(58, min(80, (a['pace'] + b['pace']) / 2))
    sa = pace * (a['offensiveRating'] + b['defensiveRating'] - nat) / 100
    sb = pace * (b['offensiveRating'] + a['defensiveRating'] - nat) / 100 + (0 if neutral else 3)
    return sa, sb, 1 / (1 + math.exp(-(sa-sb)/7))

def scoreboard(day):
    url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=1000&dates=' + day.replace('-', '')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'Salas64/1.0'}), timeout=35) as response:
        payload = json.load(response)
    if not isinstance(payload.get('events'), list):
        raise ValueError('Invalid schedule response; preserving previous challenge data')
    return payload['events']

def candidates(events, rankings, now, day):
    games = []
    for e in events:
        c = e['competitions'][0]; status = e['status']['type']
        if status['state'] != 'pre' or status['name'] != 'STATUS_SCHEDULED' or c.get('timeValid') is False: continue
        tip = instant(e['date'])
        if tip <= now or tip.astimezone(PT).date().isoformat() != day: continue
        competitors = c['competitors']
        if len(competitors) != 2: continue
        away = next((x for x in competitors if x['homeAway'] == 'away'), None)
        home = next((x for x in competitors if x['homeAway'] == 'home'), None)
        if not away or not home: continue
        a, b = team_match(away, rankings), team_match(home, rankings)
        if not usable(a) or not usable(b): continue
        if min(a['rank'], b['rank']) > 25: continue
        sa, sb, pa = project(a, b, c.get('neutralSite', False))
        sides = [{'id':str(x['team']['id']), 'name':r['team'], 'rank':r['rank']} for x,r in ((away,a),(home,b))]
        game = {'id':str(e['id']), 'day':day, 'start':e['date'], 'teams':sides, 'neutral':bool(c.get('neutralSite')), 'status':'scheduled', 'winner':None,
                'model':{'pick':sides[0 if pa >= .5 else 1]['id'], 'probability':round(max(pa,1-pa)*100,1), 'scores':[round(sa,1),round(sb,1)], 'frozenAt':now.isoformat(), 'version':'efficiency-v1-home3'}}
        # Both Top 25 first, then highest-ranked pair, then closest matchup.
        priority = (0 if max(a['rank'],b['rank']) <= 25 else 1, a['rank']+b['rank'], abs(sa-sb), e['date'],str(e['id']))
        games.append((priority,game))
    return [g for _,g in sorted(games,key=lambda x:x[0])[:3]]

def grade(game, event):
    c=event['competitions'][0]; status=event['status']['type']; name=status['name']
    if any(x in name for x in ('CANCEL','POSTPONE')):
        game['status']='void'; game['winner']=None; return
    if status.get('completed'):
        wins=[x for x in c['competitors'] if x.get('winner')]
        ids={x['id'] for x in game['teams']}
        if len(wins)==1 and str(wins[0]['team']['id']) in ids:
            game['status']='final';game['winner']=str(wins[0]['team']['id'])
            scores={str(x['team']['id']):x.get('score','—') for x in c['competitors']}
            game['scores']=[scores[t['id']] for t in game['teams']]
    elif status['state']=='in': game['status']='live'
    elif event['date'] != game['start']:
        # Never reopen picks or alter the frozen slate after a schedule change.
        game['status']='void';game['winner']=None

def main():
    now=datetime.now(timezone.utc);day=now.astimezone(PT).date().isoformat()
    year=now.astimezone(PT).year-(now.astimezone(PT).month<7); season=f'{year}-{str(year+1)[-2:]}'
    path=ROOT/'data/predictions.json'; path.parent.mkdir(exist_ok=True)
    data=json.loads(path.read_text()) if path.exists() else {'seasons':{}}
    bucket=data['seasons'].setdefault(season,{'days':{},'games':{}})
    cache={}
    def fetch(d):
        if d not in cache: cache[d]=scoreboard(d)
        return cache[d]
    current=json.loads((ROOT/'data/current.json').read_text())
    for g in bucket['games'].values():
        if g['status'] in ('final','void'): continue
        # An unresolved feed is left pending, never invented as a win/loss.
        event=next((e for e in fetch(g['day']) if str(e['id'])==g['id']),None)
        if event: grade(g,event)
    if day not in bucket['days']:
        picks=[] if current.get('preseason') else candidates(fetch(day),current.get('rankings',[]),now,day)
        # Empty slates may be retried later if model data becomes available.
        if picks:
            bucket['days'][day]=[g['id'] for g in picks]
            bucket['games'].update({g['id']:g for g in picks})
    data.update({'season':season,'day':day,'updatedAt':now.isoformat(),'schemaVersion':1})
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2)+'\n');os.replace(temp,path)
    print(f"{season} / {day}: {len(bucket['days'].get(day,[]))} featured games; {len(bucket['games'])} archived")
if __name__=='__main__': main()
