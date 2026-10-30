"""Publish the saved season baseline plus live updates; omit earlier preseason history."""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def build(data_dir):
    current = json.loads((data_dir / 'current.json').read_text())
    baseline_path = data_dir / 'ranking-baseline.json'
    baseline = json.loads(baseline_path.read_text()) if baseline_path.exists() else current.get('rankingBaseline')
    if not baseline or baseline.get('season') != current.get('season'):
        raise ValueError('Upload data/ranking-baseline.json for the current season before building history.')
    history_dir = data_dir / 'history'
    history_dir.mkdir(parents=True, exist_ok=True)
    start = {'date': baseline['date'], 'season': baseline['season'], 'phase': 'baseline',
             'baselineId': baseline['id'], 'rankings': baseline['rankings']}
    snapshots = {}
    # Until the model is live, only the starting point is published.
    if not current.get('preseason'):
        baseline_time = datetime.fromisoformat(baseline['updatedAt'].replace('Z', '+00:00'))
        for source in [*sorted(history_dir.glob('????-??-??.json')), data_dir / 'current.json']:
            payload = json.loads(source.read_text())
            if payload.get('season') != baseline['season'] or payload.get('preseason') or not payload.get('rankings'):
                continue
            timestamp = datetime.fromisoformat(payload['updatedAt'].replace('Z', '+00:00'))
            if timestamp < baseline_time:
                continue
            date = timestamp.astimezone(ZoneInfo('America/Los_Angeles')).date().isoformat()
            existing = snapshots.get(date)
            if existing and timestamp <= existing[0]:
                continue
            snapshots[date] = (timestamp, {'date': date, 'season': baseline['season'],
                'phase': 'live', 'baselineId': baseline['id'],
                'rankings': [{'team': t['team'], 'rank': t['rank']} for t in payload['rankings']]})
    result = [start] + [snapshots[d][1] for d in sorted(snapshots)]
    (history_dir / 'index.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    build(Path(__file__).resolve().parents[1] / 'data')
