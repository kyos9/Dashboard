"""시그널 정의를 바꾸기 전에 — 무엇이 달라지나 (SIGNAL_APP_SPEC.md 10장 4번).

저장된 판정(`signal_daily`, 지금 서버가 쓰는 정의)과 **이 코드의 정의**로 저장된 시세에서 다시 계산한 판정을
비교한다. DB 에 아무것도 쓰지 않는다.

    # 주인 PC — 서버 백업을 복사한 DB 를 가리키고, 정의를 고친 코드에서
    DATABASE_URL=sqlite:///./backup-copy.db python -m app.tools.signal_diff
    python -m app.tools.signal_diff --json     # 기계가 읽을 모양

보는 것: 종목별 지난 1·3·5년 매수·매도 시그널이 뜬 날 수(전→후), 오늘 판정이 바뀐 종목, 마지막 매수 시그널 날짜가
바뀐 종목, 배포 뒤 첫 알림 판정에서 **매수 알림이 새로 갈 사람·종목 수**(실제 알림 판정을 보내지 않고 돌린다).

보지 않는 것: 수익률·시그널 뒤의 가격 움직임. 이 앱은 그런 숫자를 만들지 않는다(ROADMAP 3절 규제).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from types import SimpleNamespace

import pandas as pd
from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from app.models import PriceDaily, PushSubscription, SignalDaily, User, UserSettings
from app.services import alerts, my_signals, signal_rules
from app.services.data_ingestion import load_price_frame
from app.services.indicators import compute_indicators
from app.services.signals import compute_signals
from app.services.users import STATUS_ACTIVE

YEARS = (1, 3, 5)


def _stored(db: Session, ticker: str) -> pd.DataFrame:
    rows = db.execute(
        select(SignalDaily.date, SignalDaily.knee_buy_v2, SignalDaily.shoulder_sell_ref).where(SignalDaily.ticker == ticker)
    ).all()
    frame = pd.DataFrame(rows, columns=["date", "knee_buy_v2", "shoulder_sell_ref"])
    return frame.set_index("date").sort_index()


def _counts(frame: pd.DataFrame, column: str, until: dt.date) -> dict[int, int]:
    out = {}
    for years in YEARS:
        since = until - dt.timedelta(days=365 * years)
        part = frame.loc[[d > since for d in frame.index], column] if len(frame) else frame.get(column, pd.Series(dtype=bool))
        out[years] = int(part.astype(bool).sum())
    return out


def _last_true(frame: pd.DataFrame, column: str) -> dt.date | None:
    if frame.empty:
        return None
    hits = frame.index[frame[column].astype(bool)]
    return hits.max() if len(hits) else None


def compare_ticker(db: Session, ticker: str) -> dict | None:
    prices = load_price_frame(db, ticker)
    if prices.empty:
        return None
    new = compute_signals(compute_indicators(prices))[["knee_buy_v2", "shoulder_sell_ref"]].astype(bool)
    old = _stored(db, ticker)
    last = new.index.max()
    old_today = old.loc[last] if last in old.index else None
    return {
        "ticker": ticker,
        "date": last.isoformat(),
        "buy": {"before": _counts(old, "knee_buy_v2", last), "after": _counts(new, "knee_buy_v2", last)},
        "sell": {"before": _counts(old, "shoulder_sell_ref", last), "after": _counts(new, "shoulder_sell_ref", last)},
        "today": {
            "buy": [None if old_today is None else bool(old_today["knee_buy_v2"]), bool(new.loc[last, "knee_buy_v2"])],
            "sell": [None if old_today is None else bool(old_today["shoulder_sell_ref"]), bool(new.loc[last, "shoulder_sell_ref"])],
        },
        "last_buy": [
            (d.isoformat() if (d := _last_true(old, "knee_buy_v2")) else None),
            (d.isoformat() if (d := _last_true(new, "knee_buy_v2")) else None),
        ],
        "_today_row": SimpleNamespace(date=last, knee_buy_v2=bool(new.loc[last, "knee_buy_v2"])),
    }


def _alert_effect(db: Session, today_rows: dict[str, SimpleNamespace]) -> dict:
    """배포 뒤 첫 알림 판정에서 매수 알림이 **새로**(정의가 바뀌어서) 갈 사람·종목.

    실제 판정(`alerts.current_values` → `pending_changes`)을 저장된 판정과 새 판정으로 한 번씩 돌려 차이만 센다.
    아무것도 적지 않는다.
    """
    users = [
        uid
        for (uid,) in db.query(PushSubscription.user_id)
        .join(User, User.id == PushSubscription.user_id)
        .filter(User.status == STATUS_ACTIVE)
        .distinct()
    ]
    affected: dict[int, list[str]] = {}
    own = 0
    for uid in sorted(users):
        kinds = alerts.kinds_for(db.get(User, uid), db.get(UserSettings, uid))
        if alerts.KIND_BUY not in kinds:
            continue
        # 내 기준을 쓰는 사람(0.42.0)은 공용 판정을 보지 않는다 — 공용 정의를 바꿔도 그 사람의 알림은 내 기준을 따른다
        if my_signals.thresholds_for(db, uid) != signal_rules.DEFAULT:
            own += 1
            continue
        overrides = {t: [row] for t, row in today_rows.items()}
        before = {s for s, _, _ in alerts.pending_changes(db, uid, alerts.current_values(db, uid))}
        after = alerts.pending_changes(db, uid, alerts.current_values(db, uid, overrides))
        new_buys = [label for subject, _, label in after if subject.startswith(f"{alerts.KIND_BUY}:") and subject not in before]
        if new_buys:
            affected[uid] = new_buys
    tickers = sorted({label for labels in affected.values() for label in labels})
    return {"users_with_alerts_on": len(users), "users": len(affected), "stocks": tickers, "users_with_own_thresholds": own}


def run(db: Session) -> dict:
    tickers = sorted(t for (t,) in db.execute(select(distinct(PriceDaily.ticker))))
    rows = [r for t in tickers if (r := compare_ticker(db, t)) is not None]
    today_rows = {r["ticker"]: r.pop("_today_row") for r in rows}
    return {
        "definition": signal_rules.fingerprint(),
        "tickers": rows,
        "today_changed": [r["ticker"] for r in rows if r["today"]["buy"][0] != r["today"]["buy"][1]
                          or r["today"]["sell"][0] != r["today"]["sell"][1]],
        "last_buy_changed": [r["ticker"] for r in rows if r["last_buy"][0] != r["last_buy"][1]],
        "alerts": _alert_effect(db, today_rows),
    }


def _arrow(before, after) -> str:
    return f"{before}" if before == after else f"{before}→{after}"


def render(report: dict) -> str:
    lines = [
        f"시그널 정의 {report['definition']} — 저장된 판정과 비교 (발동한 날 수, 지난 {'·'.join(map(str, YEARS))}년)",
        "",
        "| 종목 | 매수 1·3·5년 | 매도 1·3·5년 | 오늘 매수 | 마지막 매수 시그널 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in report["tickers"]:
        buy = " · ".join(_arrow(r["buy"]["before"][y], r["buy"]["after"][y]) for y in YEARS)
        sell = " · ".join(_arrow(r["sell"]["before"][y], r["sell"]["after"][y]) for y in YEARS)
        today = _arrow(*("예" if v else "아니오" if v is False else "없음" for v in r["today"]["buy"]))
        last = _arrow(*(v or "없음" for v in r["last_buy"]))
        lines.append(f"| {r['ticker']} | {buy} | {sell} | {today} | {last} |")
    a = report["alerts"]
    lines += [
        "",
        f"- 오늘 판정이 바뀐 종목: {', '.join(report['today_changed']) or '없음'}",
        f"- 마지막 매수 시그널 날짜가 바뀐 종목: {', '.join(report['last_buy_changed']) or '없음'}",
        f"- 배포 뒤 첫 알림 판정에서 매수 알림이 새로 갈 사람: {a['users']}명 (알림 켠 사람 {a['users_with_alerts_on']}명 중)"
        f", 종목: {', '.join(a['stocks']) or '없음'}"
        + (f" — 내 기준을 쓰는 {a['users_with_own_thresholds']}명은 세지 않았다(공용 판정을 보지 않는다)"
           if a.get("users_with_own_thresholds") else ""),
        "- 지난 날짜만 바뀐 것으로는 알림이 가지 않는다. 수익률은 보지 않는다.",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    from app.db import SessionLocal

    parser = argparse.ArgumentParser(description="시그널 정의를 바꾸기 전 전후 비교 (DB 에 쓰지 않는다)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    db = SessionLocal()
    try:
        report = run(db)
    finally:
        db.rollback()
        db.close()
    sys.stdout.write((json.dumps(report, ensure_ascii=False, indent=1) if args.json else render(report)) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
