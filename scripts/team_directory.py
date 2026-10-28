"""ESPN identity directory. CBBD IDs and ESPN IDs are never interchangeable."""
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?groups=50&limit=1000'

def normalized(name):
    return re.sub(r'[^a-z0-9]', '', str(name).lower().replace('&', 'and'))

def refresh(data_dir):
    path = Path(data_dir) / 'teams.json'
    try:
        req = urllib.request.Request(URL, headers={'User-Agent': 'Salas64/4.0'})
        with urllib.request.urlopen(req, timeout=35) as r:
            payload = json.load(r)
        entries = payload['sports'][0]['leagues'][0]['teams']
        teams = []
        for item in entries:
            t = item['team']
            if not t.get('isActive', True):
                continue
            teams.append({'espnId': str(t['id']), 'team': t.get('location') or t['displayName'],
                          'aliases': sorted({t[k] for k in ('location','displayName','shortDisplayName','abbreviation') if t.get(k)}),
                          'logo': (t.get('logos') or [{}])[0].get('href'), 'rank': None})
        if len(teams) < 300 or len({t['espnId'] for t in teams}) != len(teams):
            raise ValueError('Incomplete team directory')
        path.write_text(json.dumps({'updatedAt': datetime.now(timezone.utc).isoformat(), 'teams': teams}, indent=2) + '\n')
    except Exception:
        if not path.exists():
            raise
        print('Directory refresh unavailable; retaining cached directory.')
    return json.loads(path.read_text())['teams']

def enrich(payload, directory):
    by_id = {t['espnId']: t for t in directory}
    aliases = {}
    for t in directory:
        for alias in t.get('aliases', []) + [t['team']]:
            aliases.setdefault(normalized(alias), set()).add(t['espnId'])
    modeled = payload.get('allTeams') or payload.get('rankings', [])
    used = set()
    for t in modeled:
        tid = str(t.get('espnId') or '')
        if not tid:
            # Only use explicitly mapped logo IDs; updater no longer invents logos from CBBD IDs.
            match = re.search(r'/([0-9]+)\.(?:png|svg)', str(t.get('logo') or ''))
            tid = match[1] if match else ''
        if tid not in by_id:
            matches = aliases.get(normalized(t['team']), set())
            tid = next(iter(matches)) if len(matches) == 1 else ''
        if tid in by_id:
            t['espnId'] = tid
            t['logo'] = by_id[tid]['logo']
            t['aliases'] = by_id[tid]['aliases']
            used.add(tid)
    payload['allTeams'] = modeled + [{**t, 'record': None, 'salasScore': None,
        'offensiveRating': None, 'defensiveRating': None, 'pace': None,
        'dataStatus': 'awaiting-season-stats'} for t in directory if t['espnId'] not in used]
    return payload

if __name__ == '__main__':
    data = Path(__file__).resolve().parents[1] / 'data'
    directory = refresh(data)
    path = data / 'current.json'
    payload = enrich(json.loads(path.read_text()), directory)
    path.write_text(json.dumps(payload, indent=2) + '\n')
    print(f"Published {len(payload['allTeams'])} teams; Top 64 unchanged.")
