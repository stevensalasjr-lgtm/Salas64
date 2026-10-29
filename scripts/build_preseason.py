"""Apply the verified 2027 preseason snapshot. Manual use only; never replaces live rankings."""
import argparse
import copy
import html
import json
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from urllib.parse import quote


def validate_and_order(snapshot):
    sources = {s['id']: s for s in snapshot['sources']}
    if len(sources) != len(snapshot['sources']) or len(sources) != snapshot['sourceCount']:
        raise ValueError('Duplicate or inconsistent source list')
    if 'torvik' not in sources or any(s['season'] != snapshot['season'] or s['phase'] != 'preseason' or s['weight'] != 1 for s in sources.values()):
        raise ValueError('Sources must be same-season, equally weighted preseason rankings, including Torvik')
    teams = copy.deepcopy(snapshot['teams'])
    if len({t['espnId'] for t in teams}) != len(teams) or len({t['team'] for t in teams}) != len(teams):
        raise ValueError('Duplicate team identity')
    for source_id, source in sources.items():
        values = [t['sourceRanks'][source_id] for t in teams if source_id in t['sourceRanks']]
        if any(type(v) is not int for v in values) or sorted(values) != list(range(1, source['teamCount'] + 1)):
            raise ValueError(f'Incomplete, duplicated, or invalid ranks for {source_id}')
    for t in teams:
        ranks = t['sourceRanks']
        if not set(ranks) <= set(sources) or len(ranks) < snapshot['minimumSourceCoverage'] or 'torvik' not in ranks:
            raise ValueError(f"Insufficient or unknown source coverage for {t['team']}")
        t['sourceCount'] = len(ranks)
        t['averageRank'] = round(sum(ranks.values()) / len(ranks), 6)
    teams.sort(key=lambda t: (Fraction(sum(t['sourceRanks'].values()),len(t['sourceRanks'])), t['sourceRanks']['torvik'], t['team']))
    for i, t in enumerate(teams, 1):
        t.update(modelRank=i, rank=i if i <= 64 else None)
    return teams


def apply_snapshot(current, snapshot):
    if current.get('season') != snapshot['season'] or not current.get('preseason'):
        raise ValueError('Refusing to replace a different season or live model with a preseason snapshot')
    ordered = validate_and_order(snapshot)
    if len(ordered) != snapshot['teamCount'] or len(ordered) < 64:
        raise ValueError('Incomplete preseason field')
    existing = {str(t.get('espnId')): t for t in current.get('allTeams', current.get('rankings', []))}
    output = copy.deepcopy(current)
    teams = []
    for entry in ordered:
        t = copy.deepcopy(existing.get(entry['espnId'], {}))
        t.update({k: entry[k] for k in ('team','espnId','aliases','logo','conference','rank','modelRank')})
        t.update(record='0-0', last10='0-0', streak='—', bestWin='—', recentGames=[],
                 previousRank=None, change=0, salasScore=None, offensiveRating=None,
                 defensiveRating=None, netRating=None, pace=None, nationalAverageEfficiency=None,
                 preseasonAverageRank=entry['averageRank'], preseasonSourceCount=entry['sourceCount'],
                 dataStatus='preseason-consensus')
        # A published ordinal average is not a live Salas Score or efficiency rating.
        for k in ('powerScore','resumeScore','marchScore','formScore','swab'):
            t.pop(k, None)
        teams.append(t)
    count = snapshot['sourceCount']
    date_label = datetime.fromisoformat(snapshot['snapshotDate']).strftime('%b %d, %Y')
    output.update(rankings=teams[:64], allTeams=teams, updatedAt=snapshot['computedAt'],
        dataCheckedAt=snapshot['computedAt'], previousUpdatedAt=None,
        updatedLabel=f"2026–27 Preseason · {count}-source average · {date_label}",
        modelVersion=f"Preseason consensus 2026–27 ({count} sources)",
        message=f"Preseason baseline: an equal-weight average of {count} published 2026–27 ranking lists. Live Salas Scores and daily movement begin when enough current-season data is available.",
        preseasonConsensus={'snapshotDate':snapshot['snapshotDate'],'sourceCount':count,
          'sources':[s['name'] for s in snapshot['sources']], 'teamCount':len(teams),
          'auditFile':'data/preseason-consensus-2027.json', 'sourcesPage':'preseason-sources.html'})
    output['weeklySummary'] = {k:{'team':'—','note':'Available after the season starts.'}
        for k in ('hottestTeam','biggestRiser','biggestFaller','teamToWatch')}
    return output


def source_page(snapshot):
    esc = lambda s: html.escape(str(s), quote=True)
    sources = snapshot['sources']; teams = validate_and_order(snapshot)
    included = ''.join(f'<li><a href="{esc(s["url"])}">{esc(s["name"])}</a> · {s["teamCount"]} teams. {esc(s["note"])} <a href="{esc(s["dataUrl"])}">Source data</a></li>' for s in sources)
    excluded = ''.join(f'<li><a href="{esc(s["url"])}">{esc(s["name"])}</a>: {esc(s["reason"])}</li>' for s in snapshot['excludedSources'])
    headers = ''.join(f'<th scope="col">{esc(s["name"])}</th>' for s in sources)
    rows = ''.join(f'<tr data-name="{esc(t["team"].lower())}" data-ranked="{str(t["rank"] is not None).lower()}"><td>{t["rank"] or "NR"}</td><th scope="row"><a href="team.html?team={quote(t["team"])}">{esc(t["team"])}</a></th><td><strong>{t["averageRank"]:.2f}</strong></td>' + ''.join(f'<td>{t["sourceRanks"].get(s["id"],"—")}</td>' for s in sources) + f'<td>{t["sourceCount"]}</td></tr>' for t in teams)
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preseason Sources | Salas 64</title>
<style>:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#e8effa;background:#08111f}*{box-sizing:border-box}body{margin:0}main{max-width:1250px;margin:auto;padding:32px 20px 60px}a{color:#8dc5ff}h1{font-size:clamp(30px,5vw,48px);letter-spacing:-1px;line-height:1.1}h2{font-size:22px;margin-top:32px}.eyebrow{color:#e4c481;letter-spacing:2px;font-size:12px;margin-top:30px}p,li{line-height:1.7;color:#b8c9de}li{margin-bottom:12px}.summary{max-width:850px}.controls{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin:24px 0 16px}input[type=search]{background:#101e31;color:#fff;border:1px solid #334a66;padding:12px;border-radius:9px;max-width:100%;width:280px}.table-wrap{overflow:auto;border:1px solid #334a66;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:1050px;font-size:12px}td,th{padding:13px 10px;border-bottom:1px solid #24354b;text-align:right}th[scope=row]{text-align:left;min-width:150px;font-weight:600}thead th{background:#15263c;position:sticky;top:0}tbody tr:nth-child(even){background:#101d30}td strong{color:#e4c481}[hidden]{display:none!important}:focus-visible{outline:2px solid #8dc5ff;outline-offset:3px}.muted{font-size:12px;color:#9aaec8}.source-details{margin-top:25px}summary{cursor:pointer;font-size:18px}#count{color:#a7bad1;font-size:13px}</style></head><body><main><a href="index.html">← Salas 64 rankings</a><div class="eyebrow">2026–27 · PRESEASON BASELINE</div><h1>See where the rankings come from.</h1><div class="summary"><p>Snapshot: SNAPSHOT. An equal-weight average of six published preseason ranking lists covers all 365 teams. The Top 64 appear on the homepage; everyone else is NR.</p><p>Each team’s published ranks are added together and divided by its number of sources. Lower averages are better. Exact ties use Bart Torvik’s rank, then team name. Display rounding does not change the order.</p><p>COVERAGE The average is not a live Salas Score. The normal Salas model takes over once enough season data is available; this snapshot does not automatically pull new preseason lists.</p></div><div class="controls"><label><span class="muted">Find a team</span><br><input id="search" type="search" placeholder="Search teams"></label><label><input id="top64" type="checkbox" checked> Top 64 only</label><span id="count" role="status"></span></div><p class="muted">Swipe horizontally to see every source. A dash means no published rank was available; it is left out of the average.</p><div class="table-wrap" tabindex="0" aria-label="Preseason rankings by source, scroll horizontally"><table><thead><tr><th scope="col">Salas rank</th><th scope="col">Team</th><th scope="col">Avg rank</th>HEADERS<th scope="col">Sources</th></tr></thead><tbody>ROWS</tbody></table></div><details class="source-details"><summary>Included sources and assumptions</summary><ul>INCLUDED</ul></details><details class="source-details"><summary>Sites reviewed but not included</summary><ul>EXCLUDED</ul></details><p class="muted"><a href="data/preseason-consensus-2027.json">Download the calculation and source audit (JSON)</a></p></main><script>const search=document.getElementById('search'),top64=document.getElementById('top64');function filter(){let count=0;document.querySelectorAll('tbody tr').forEach(row=>{row.hidden=(top64.checked&&row.dataset.ranked!=='true')||!row.dataset.name.includes(search.value.trim().toLowerCase());if(!row.hidden)count++;});document.getElementById('count').textContent=count+' teams';}search.addEventListener('input',filter);top64.addEventListener('change',filter);filter();</script></body></html>'''.replace('SNAPSHOT',esc(snapshot['snapshotDate'])).replace('COVERAGE',esc(snapshot['coverageNote'])).replace('HEADERS',headers).replace('ROWS',rows).replace('INCLUDED',included).replace('EXCLUDED',excluded)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    args=parser.parse_args();data=args.root/'data'
    snapshot=json.loads((data/'preseason-consensus-2027.json').read_text())
    current=json.loads((data/'current.json').read_text())
    output=apply_snapshot(current,snapshot)
    page=source_page(snapshot)
    (data/'current.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    (args.root/'preseason-sources.html').write_text(page)
    print(f"Published {len(output['rankings'])} preseason rankings from {snapshot['sourceCount']} sources; {len(output['allTeams'])} teams retained.")

if __name__=='__main__':main()
