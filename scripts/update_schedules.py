"""Refresh published ESPN schedules for current Salas 64 teams; standard library only."""
import concurrent.futures
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def espn_id(team):
    # In-season teamId comes from CBBD, so it must NOT be used as an ESPN ID.
    if team.get('espnId'):
        return str(team['espnId'])
    match = re.search(r'/([0-9]+)\.(?:png|svg)', str(team.get('logo', '')))
    return match.group(1) if match else None


def score(competitor):
    value = competitor.get('score')
    if isinstance(value, dict):
        value = value.get('displayValue', value.get('value'))
    return str(value) if value is not None else None


def parse_event(event, team_id, season):
    # ESPN's top-level season can be the current season even for archived requests.
    if int(event.get('season', {}).get('year', 0)) != season:
        return None
    competitions = event.get('competitions', [])
    if not competitions:
        return None
    c = competitions[0]
    sides = c.get('competitors', [])
    own = next((x for x in sides if str(x.get('team', {}).get('id')) == team_id), None)
    other = next((x for x in sides if str(x.get('team', {}).get('id')) != team_id), None)
    if not own or not other or len(sides) != 2:
        return None
    status = (c.get('status') or event.get('status') or {}).get('type', {})
    name = str(status.get('name', ''))
    if 'CANCEL' in name:
        state = 'canceled'
    elif 'POSTPON' in name:
        state = 'postponed'
    elif status.get('completed'):
        state = 'final'
    elif status.get('state') == 'in':
        state = 'in-progress'
    else:
        state = 'scheduled'
    opponent = other['team']
    return {'id': str(event['id']), 'date': c.get('date') or event.get('date'),
            'timeKnown': c.get('timeValid', event.get('timeValid', False)) is True,
            'opponent': opponent.get('shortDisplayName') or opponent.get('displayName') or 'TBD',
            'opponentEspnId': str(opponent.get('id', '')),
            'location': 'neutral' if c.get('neutralSite') else own.get('homeAway', ''),
            'venue': c.get('venue', {}).get('fullName', ''),
            'status': state, 'statusLabel': status.get('detail') or status.get('description') or state,
            'teamScore': score(own) if state in ('final', 'in-progress') else None,
            'opponentScore': score(other) if state in ('final', 'in-progress') else None,
            'result': ('W' if own.get('winner') else 'L' if other.get('winner') else None) if state == 'final' else None}


def fetch_team(team, season):
    tid = espn_id(team)
    if not tid:
        raise ValueError('No verified ESPN ID in the team logo or espnId field')
    games = {}
    for phase in (2, 3):  # Regular season and published postseason matchups.
        url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/{tid}/schedule?season={season}&seasontype={phase}'
        req = urllib.request.Request(url, headers={'User-Agent': 'Salas64/3.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=25) as response:
            payload = json.load(response)
        if str(payload.get('team', {}).get('id')) != tid or not isinstance(payload.get('events'), list):
            raise ValueError('Unexpected team schedule response')
        events = payload['events']
        if any(int(e.get('season', {}).get('year', 0)) != season for e in events):
            raise ValueError('Provider returned a different season; preserving previous schedule')
        for event in events:
            game = parse_event(event, tid, season)
            if game:
                games[game['id']] = game
    return {'espnId': tid, 'updatedAt': datetime.now(timezone.utc).isoformat(),
            'stale': False, 'games': sorted(games.values(), key=lambda g: (g['date'] or '', g['id']))}


def main():
    current = json.loads((ROOT / 'data/current.json').read_text())
    season = int(current['season'])
    teams = current.get('rankings', [])
    if not teams:
        raise RuntimeError('No ranked teams; preserving previous schedule file')
    path = ROOT / 'data/schedules.json'
    previous = json.loads(path.read_text()) if path.exists() else {}
    previous_teams = previous.get('teams', {}) if previous.get('season') == season else {}
    results, successes = {}, 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_team, team, season): team for team in teams}
        for future in concurrent.futures.as_completed(futures):
            team = futures[future]
            try:
                results[team['team']] = future.result()
                successes += 1
            except Exception as exc:
                old = previous_teams.get(team['team'], {'espnId': espn_id(team), 'updatedAt': None, 'games': []})
                results[team['team']] = {**old, 'stale': True}
                print(f"Could not refresh {team['team']}: {exc}")
    if not successes:
        raise RuntimeError('All schedule requests failed. Previous data was not replaced.')
    output = {'season': season, 'source': 'ESPN', 'refreshHours': 6,
              'updatedAt': datetime.now(timezone.utc).isoformat(), 'teams': dict(sorted(results.items()))}
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(output, indent=2) + '\n')
    temp.replace(path)
    print(f'Refreshed {successes}/{len(teams)} schedules for season {season}.')


if __name__ == '__main__':
    main()
