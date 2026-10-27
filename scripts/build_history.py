"""Publish a compact same-season-readable ranking history; no API key required."""
import json
from pathlib import Path


def build(data_dir):
    history_dir = data_dir / 'history'
    history_dir.mkdir(parents=True, exist_ok=True)
    snapshots = {}
    for source in [*sorted(history_dir.glob('????-??-??.json')), data_dir / 'current.json']:
        payload = json.loads(source.read_text())
        date = str(payload.get('updatedAt', ''))[:10]
        if date and payload.get('rankings'):
            snapshots[(payload.get('season'), date)] = {
                'date': date, 'season': payload.get('season'),
                'rankings': [{'team': t['team'], 'rank': t['rank']} for t in payload['rankings']]
            }
    result = sorted(snapshots.values(), key=lambda x: x['date'])
    (history_dir / 'index.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    build(Path(__file__).resolve().parents[1] / 'data')
