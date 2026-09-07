#!/usr/bin/env python3
"""Generate the weekly Salas 64 data file from College Basketball Data.

Required environment variable:
    CBBD_API_KEY

Optional environment variables:
    CBBD_SEASON   e.g. 2026 for the 2026-27 season
    DATA_DIR      defaults to ./data

The script uses only Python's standard library so GitHub Actions needs no pip install.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import statistics
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

BASE_URL = "https://api.collegebasketballdata.com"
HOME_COURT_POINTS = 3.0
POINTS_PER_100_TO_GAME = 0.70
BUBBLE_REFERENCE_RANK = 45
WIN_PROB_SCALE = 6.5
TOP_N = 64


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def season_year(today: date) -> int:
    # College basketball seasons begin in the fall. September 2026 => season=2026.
    return today.year if today.month >= 7 else today.year - 1


def api_get(path: str, params: dict[str, Any], api_key: str) -> list[dict[str, Any]]:
    clean = {k: v for k, v in params.items() if v is not None}
    query = urllib.parse.urlencode(clean)
    url = f"{BASE_URL}{path}?{query}" if query else f"{BASE_URL}{path}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json", "User-Agent": "Salas64/2.0"},
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected response from {path}: expected a list")
    return data


def fetch_season_games(season: int, api_key: str) -> list[dict[str, Any]]:
    """Fetch final games in monthly chunks to stay safely under API result caps."""
    start = date(season, 10, 15)
    end = date(season + 1, 4, 20)
    today = datetime.now(timezone.utc).date()
    end = min(end, today + timedelta(days=1))
    if end < start:
        return []

    seen: dict[Any, dict[str, Any]] = {}
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=27), end)
        rows = api_get(
            "/games",
            {
                "season": season,
                "status": "final",
                "startDateRange": f"{cursor.isoformat()}T00:00:00Z",
                "endDateRange": f"{chunk_end.isoformat()}T23:59:59Z",
            },
            api_key,
        )
        for row in rows:
            seen[row.get("id", f"{row.get('startDate')}-{row.get('homeTeam')}-{row.get('awayTeam')}")] = row
        cursor = chunk_end + timedelta(days=1)
    return sorted(seen.values(), key=lambda g: g.get("startDate") or "")


def percentile_map(values: dict[int, float], higher_is_better: bool = True) -> dict[int, float]:
    """Percentile rank on a 1-100 scale with average ranks for ties."""
    valid = [(team_id, float(v)) for team_id, v in values.items() if v is not None and math.isfinite(float(v))]
    if not valid:
        return {}
    ordered = sorted(valid, key=lambda x: x[1], reverse=not higher_is_better)
    # ordered is worst -> best regardless of metric direction
    if higher_is_better:
        ordered = sorted(valid, key=lambda x: x[1])
    else:
        ordered = sorted(valid, key=lambda x: x[1], reverse=True)

    n = len(ordered)
    result: dict[int, float] = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and ordered[j + 1][1] == ordered[i][1]:
            j += 1
        avg_index = (i + j) / 2
        pct = 100.0 if n == 1 else 1.0 + 99.0 * (avg_index / (n - 1))
        for k in range(i, j + 1):
            result[ordered[k][0]] = pct
        i = j + 1
    return result


def safe_num(value: Any, default: float = 0.0) -> float:
    try:
        x = float(value)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError):
        return default


def team_game_rows(games: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    by_team: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for g in games:
        if g.get("homePoints") is None or g.get("awayPoints") is None:
            continue
        for side in ("home", "away"):
            is_home = side == "home"
            team_id = g.get("homeTeamId" if is_home else "awayTeamId")
            if team_id is None:
                continue
            points = safe_num(g.get("homePoints" if is_home else "awayPoints"))
            opp_points = safe_num(g.get("awayPoints" if is_home else "homePoints"))
            neutral = bool(g.get("neutralSite"))
            location = "neutral" if neutral else ("home" if is_home else "away")
            by_team[int(team_id)].append(
                {
                    "date": g.get("startDate") or "",
                    "opponentId": int(g.get("awayTeamId" if is_home else "homeTeamId")),
                    "opponent": g.get("awayTeam" if is_home else "homeTeam") or "Unknown",
                    "win": points > opp_points,
                    "margin": points - opp_points,
                    "location": location,
                }
            )
    for rows in by_team.values():
        rows.sort(key=lambda r: r["date"])
    return by_team


def location_edge(location: str) -> float:
    if location == "home":
        return HOME_COURT_POINTS
    if location == "away":
        return -HOME_COURT_POINTS
    return 0.0


def logistic_win_probability(expected_margin: float) -> float:
    return 1.0 / (1.0 + math.exp(-expected_margin / WIN_PROB_SCALE))


def last_ten_record(rows: list[dict[str, Any]]) -> str:
    recent = rows[-10:]
    wins = sum(1 for r in recent if r["win"])
    return f"{wins}-{len(recent)-wins}"


def current_streak(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "—"
    last_result = rows[-1]["win"]
    count = 0
    for row in reversed(rows):
        if row["win"] != last_result:
            break
        count += 1
    return f"{'W' if last_result else 'L'}{count}"


def best_win(rows: list[dict[str, Any]], net_by_id: dict[int, float]) -> str:
    wins = [r for r in rows if r["win"]]
    if not wins:
        return "—"
    def quality(r: dict[str, Any]) -> float:
        # Opponent quality plus extra credit for winning away from home.
        site_bonus = 3.0 if r["location"] == "away" else (1.5 if r["location"] == "neutral" else 0.0)
        return net_by_id.get(r["opponentId"], -50.0) + site_bonus
    chosen = max(wins, key=quality)
    if chosen["location"] == "away":
        return f"at {chosen['opponent']}"
    if chosen["location"] == "neutral":
        return f"vs {chosen['opponent']} (neutral)"
    return f"vs {chosen['opponent']}"


def load_manual_adjustments(data_dir: Path) -> dict[str, float]:
    path = data_dir / "manual_adjustments.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
        teams = payload.get("teams", {})
        return {str(k): safe_num(v) for k, v in teams.items()}
    except Exception:
        return {}


def build_rankings(season: int, api_key: str, data_dir: Path) -> dict[str, Any]:
    ratings = api_get("/ratings/adjusted", {"season": season}, api_key)
    stats = api_get("/stats/team/season", {"season": season}, api_key)
    games = fetch_season_games(season, api_key)

    ratings_by_id = {int(r["teamId"]): r for r in ratings if r.get("teamId") is not None}
    stats_by_id = {int(s["teamId"]): s for s in stats if s.get("teamId") is not None}
    game_rows = team_game_rows(games)

    eligible_ids = [
        tid for tid, r in ratings_by_id.items()
        if tid in stats_by_id and safe_num(stats_by_id[tid].get("games")) > 0
    ]
    if len(eligible_ids) < TOP_N:
        raise RuntimeError(f"Only {len(eligible_ids)} eligible teams returned; expected at least {TOP_N}.")

    net = {tid: safe_num(ratings_by_id[tid].get("netRating")) for tid in eligible_ids}
    offense = {tid: safe_num(ratings_by_id[tid].get("offensiveRating")) for tid in eligible_ids}
    defense = {tid: safe_num(ratings_by_id[tid].get("defensiveRating")) for tid in eligible_ids}
    power_score = percentile_map(net, higher_is_better=True)

    # Bubble reference uses the 45th-best adjusted net rating.
    net_sorted = sorted(net.values(), reverse=True)
    bubble_net = net_sorted[min(BUBBLE_REFERENCE_RANK - 1, len(net_sorted) - 1)]

    swab: dict[int, float] = {}
    form_rating: dict[int, float] = {}
    for tid in eligible_ids:
        rows = game_rows.get(tid, [])
        expected_wins = 0.0
        for row in rows:
            opp_net = net.get(row["opponentId"], 0.0)
            neutral_margin = POINTS_PER_100_TO_GAME * (bubble_net - opp_net)
            expected_margin = neutral_margin + location_edge(row["location"])
            expected_wins += logistic_win_probability(expected_margin)
        actual_wins = sum(1 for r in rows if r["win"])
        swab[tid] = actual_wins - expected_wins

        recent = rows[-8:]
        performances = []
        for row in recent:
            opp_net = net.get(row["opponentId"], 0.0)
            adjusted_game_margin = row["margin"] + POINTS_PER_100_TO_GAME * opp_net - location_edge(row["location"])
            performances.append(adjusted_game_margin)
        form_rating[tid] = statistics.mean(performances) if performances else -99.0

    resume_score = percentile_map(swab, higher_is_better=True)
    form_score = percentile_map(form_rating, higher_is_better=True)

    # March Profile raw inputs.
    off_efg: dict[int, float] = {}
    def_efg: dict[int, float] = {}
    off_tov: dict[int, float] = {}
    def_tov: dict[int, float] = {}
    off_orb: dict[int, float] = {}
    def_orb: dict[int, float] = {}
    off_ftr: dict[int, float] = {}
    def_ftr: dict[int, float] = {}
    ft_pct: dict[int, float] = {}

    for tid in eligible_ids:
        s = stats_by_id[tid]
        ts = s.get("teamStats") or {}
        os_ = s.get("opponentStats") or {}
        tf = ts.get("fourFactors") or {}
        of = os_.get("fourFactors") or {}
        off_efg[tid] = safe_num(tf.get("effectiveFieldGoalPct"))
        def_efg[tid] = safe_num(of.get("effectiveFieldGoalPct"))
        off_tov[tid] = safe_num(tf.get("turnoverRatio"))
        def_tov[tid] = safe_num(of.get("turnoverRatio"))
        off_orb[tid] = safe_num(tf.get("offensiveReboundPct"))
        def_orb[tid] = safe_num(of.get("offensiveReboundPct"))
        off_ftr[tid] = safe_num(tf.get("freeThrowRate"))
        def_ftr[tid] = safe_num(of.get("freeThrowRate"))
        ft_pct[tid] = safe_num((ts.get("freeThrows") or {}).get("pct"))

    p_off_efg = percentile_map(off_efg, True)
    p_def_efg = percentile_map(def_efg, False)
    p_off_tov = percentile_map(off_tov, False)
    p_def_tov = percentile_map(def_tov, True)
    p_off_orb = percentile_map(off_orb, True)
    p_def_orb = percentile_map(def_orb, False)
    p_off_ftr = percentile_map(off_ftr, True)
    p_def_ftr = percentile_map(def_ftr, False)
    p_ft = percentile_map(ft_pct, True)

    march_score: dict[int, float] = {}
    for tid in eligible_ids:
        shooting = 0.50 * p_off_efg.get(tid, 50) + 0.50 * p_def_efg.get(tid, 50)
        turnovers = 0.50 * p_off_tov.get(tid, 50) + 0.50 * p_def_tov.get(tid, 50)
        rebounding = 0.50 * p_off_orb.get(tid, 50) + 0.50 * p_def_orb.get(tid, 50)
        free_throws = 0.40 * p_off_ftr.get(tid, 50) + 0.40 * p_def_ftr.get(tid, 50) + 0.20 * p_ft.get(tid, 50)
        base = 0.40 * shooting + 0.25 * turnovers + 0.20 * rebounding + 0.15 * free_throws

        ranks = ratings_by_id[tid].get("rankings") or {}
        off_rank = int(safe_num(ranks.get("offense"), 999))
        def_rank = int(safe_num(ranks.get("defense"), 999))
        worst = max(off_rank, def_rank)
        if off_rank <= 10 and def_rank <= 10:
            balance = 3.0
        elif off_rank <= 25 and def_rank <= 25:
            balance = 2.0
        elif off_rank <= 40 and def_rank <= 40:
            balance = 1.0
        elif worst > 100:
            balance = -4.0
        elif worst > 75:
            balance = -2.0
        else:
            balance = 0.0
        march_score[tid] = clamp(base + balance, 1.0, 100.0)

    manual = load_manual_adjustments(data_dir)
    national_avg_efficiency = statistics.mean(offense.values()) if offense else 110.0

    teams: list[dict[str, Any]] = []
    for tid in eligible_ids:
        s = stats_by_id[tid]
        r = ratings_by_id[tid]
        name = str(r.get("team") or s.get("team") or tid)
        adjustment = manual.get(name, 0.0)
        total = (
            0.50 * power_score.get(tid, 50.0)
            + 0.25 * resume_score.get(tid, 50.0)
            + 0.20 * march_score.get(tid, 50.0)
            + 0.05 * form_score.get(tid, 50.0)
            + adjustment
        )
        rows = game_rows.get(tid, [])
        wins = int(round(safe_num(s.get("wins"), sum(1 for x in rows if x["win"]))))
        losses = int(round(safe_num(s.get("losses"), sum(1 for x in rows if not x["win"]))))
        teams.append(
            {
                "teamId": tid,
                "team": name,
                "conference": r.get("conference") or s.get("conference"),
                "salasScore": round(clamp(total, 1.0, 100.0), 1),
                "record": f"{wins}-{losses}",
                "last10": last_ten_record(rows),
                "streak": current_streak(rows),
                "bestWin": best_win(rows, net),
                "powerScore": round(power_score.get(tid, 50.0), 2),
                "resumeScore": round(resume_score.get(tid, 50.0), 2),
                "marchScore": round(march_score.get(tid, 50.0), 2),
                "formScore": round(form_score.get(tid, 50.0), 2),
                "swab": round(swab.get(tid, 0.0), 3),
                "offensiveRating": round(offense.get(tid, national_avg_efficiency), 2),
                "defensiveRating": round(defense.get(tid, national_avg_efficiency), 2),
                "netRating": round(net.get(tid, 0.0), 2),
                "pace": round(safe_num(s.get("pace"), 68.0), 2),
                "nationalAverageEfficiency": round(national_avg_efficiency, 2),
            }
        )

    teams.sort(key=lambda t: (-t["salasScore"], -t["powerScore"], -t["resumeScore"], t["team"]))
    top = teams[:TOP_N]

    previous_path = data_dir / "current.json"
    previous_payload: dict[str, Any] = {}
    if previous_path.exists():
        try:
            previous_payload = json.loads(previous_path.read_text())
        except Exception:
            previous_payload = {}
    previous_rank = {str(t.get("team")): t.get("rank") for t in previous_payload.get("rankings", []) if t.get("rank")}

    for idx, t in enumerate(top, start=1):
        t["rank"] = idx
        prev = previous_rank.get(t["team"])
        t["previousRank"] = int(prev) if prev is not None else None
        t["change"] = (int(prev) - idx) if prev is not None else 0

    # Archive the previous official ranking only when it actually contains rankings.
    if previous_payload.get("rankings"):
        history_dir = data_dir / "history"
        history_dir.mkdir(parents=True, exist_ok=True)
        previous_date = str(previous_payload.get("updatedAt") or datetime.now(timezone.utc).date().isoformat())[:10]
        archive = history_dir / f"{previous_date}.json"
        if not archive.exists():
            shutil.copy2(previous_path, archive)

    def summary_entry(team: dict[str, Any] | None, note: str) -> dict[str, Any]:
        return {"team": team["team"] if team else "—", "note": note}

    hottest = max(top, key=lambda t: t["formScore"], default=None)
    with_previous = [t for t in top if t["previousRank"] is not None]
    riser = max(with_previous, key=lambda t: t["change"], default=None)
    faller = min(with_previous, key=lambda t: t["change"], default=None)

    excluded_watch = {x["team"] for x in (hottest, riser) if x}
    watch_pool = [t for t in top if 16 <= t["rank"] <= 64 and t["team"] not in excluded_watch]
    watch = max(watch_pool, key=lambda t: 0.58 * t["formScore"] + 0.37 * t["salasScore"] + 0.05 * max(t["change"], 0) * 5, default=None)

    if riser and riser["change"] > 0:
        riser_note = f"Up {riser['change']} spots from last Monday."
    elif riser:
        riser_note = "No team moved up from the previous official ranking."
    else:
        riser_note = "First official ranking of the season."

    if faller and faller["change"] < 0:
        faller_note = f"Down {abs(faller['change'])} spots from last Monday."
    elif faller:
        faller_note = "No team moved down from the previous official ranking."
    else:
        faller_note = "First official ranking of the season."

    now = datetime.now(timezone.utc)
    payload = {
        "season": season,
        "updatedAt": now.isoformat().replace("+00:00", "Z"),
        "updatedLabel": f"Week of {now.strftime('%b %d, %Y')} • Monday model update",
        "modelVersion": "Salas Score 1.0",
        "weights": {"strength": 0.50, "resume": 0.25, "march": 0.20, "form": 0.05},
        "rankings": top,
        "weeklySummary": {
            "hottestTeam": summary_entry(hottest, "Best recent adjusted form among this week's Salas 64." if hottest else "—"),
            "biggestRiser": summary_entry(riser, riser_note),
            "biggestFaller": summary_entry(faller, faller_note),
            "teamToWatch": summary_entry(watch, f"#{watch['rank']} with a {watch['salasScore']:.1f} Salas Score and strong recent form." if watch else "—"),
        },
    }
    return payload


def main() -> int:
    api_key = os.getenv("CBBD_API_KEY", "").strip()
    if not api_key:
        print("ERROR: CBBD_API_KEY is not set.", file=sys.stderr)
        return 2

    today = datetime.now(timezone.utc).date()
    season = int(os.getenv("CBBD_SEASON") or season_year(today))
    data_dir = Path(os.getenv("DATA_DIR") or Path(__file__).resolve().parents[1] / "data")
    data_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating Salas 64 for season {season}…")
    payload = build_rankings(season, api_key, data_dir)
    out = data_dir / "current.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {out} with {len(payload['rankings'])} ranked teams.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
