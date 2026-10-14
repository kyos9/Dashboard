"""시그널 정의가 바뀌면 지난 판정을 다시 계산한다 (0.41.0, SIGNAL_APP_SPEC.md 10장).

**왜.** 정의(`signal_rules.py`)를 바꿔 배포해도, 저장된 판정(`signal_daily`)은 종목마다 다음 갱신 때에야 새 정의로
덮인다. 그 사이에는 화면의 오늘 조건(읽을 때 계산 — 새 정의)과 차트의 지난 점·마지막 매수 시그널 날짜·알림
(저장된 것 — 옛 정의)이 서로 다른 기준을 말한다. 아무도 보지 않아 갱신되지 않는 종목은 계속 옛 정의로 남는다.

**어떻게.** 정의의 지문(`signal_rules.fingerprint()`)을 `app_setting` 에 적어 둔다. 서버가 켜질 때 스케줄러를
맡은 프로세스가 켠 직후 job 에서 **따라잡기 갱신보다 먼저** 지문을 비교하고, 다르면 저장된 시세로 전 종목을
다시 계산한다(네트워크 없음). 같은 job 안에서 차례로 돌기 때문에 갱신과 같은 종목을 동시에 쓰지 않는다.

- 지문은 **전 종목이 성공했을 때만** 적는다. 하나라도 실패하면 다음에 켤 때 다시 돈다(실패 종목은 요약에 남는다).
- 지표 공식의 판(`INDICATOR_VERSION`)이 바뀌었으면 지표(`indicator_daily`)까지 다시 계산한다. 처음 올린 서버처럼
  적힌 판이 없으면 지금 판으로 본다 — 지표 공식은 0.41.0 에서 바뀌지 않았다.
- 바뀐 행 수·실패 종목·걸린 시간을 요약으로 남긴다. 진단(관리자)에서 본다.
- 리밸런싱 기록(`RebalanceSnapshot`)은 건드리지 않는다 — 그날의 사실이다(명세 6.6).
- 알림: 지난 날짜가 바뀌어도 알림은 가지 않는다(알림은 가장 최근 행만 본다). 오늘 판정이 새로 켜진 종목은
  다음 알림 판정 때 한 번 간다 — 몇 명·몇 종목인지는 배포 전에 `tools/signal_diff.py` 가 센다.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import time

from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from app.models import PriceDaily
from app.services import app_settings, signal_rules
from app.services.data_ingestion import recompute_indicators, recompute_signals

logger = logging.getLogger(__name__)

FINGERPRINT_KEY = "signal_rules_fingerprint"
INDICATOR_KEY = "signal_indicator_version"
SUMMARY_KEY = "signal_recompute_last"

# 요약에 남기는 "바뀐 종목" 수 (전부 적으면 300종목이 한 줄에 들어간다)
SUMMARY_TICKERS = 30


def stored_fingerprint(db: Session) -> str | None:
    return app_settings.get_value(db, FINGERPRINT_KEY)


def needs_recompute(db: Session) -> bool:
    return stored_fingerprint(db) != signal_rules.fingerprint()


def last_summary(db: Session) -> dict | None:
    raw = app_settings.get_value(db, SUMMARY_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _tickers(db: Session) -> list[str]:
    return sorted(t for (t,) in db.execute(select(distinct(PriceDaily.ticker))))


def recompute_all(db: Session, reason: str = "manual") -> dict:
    """전 종목의 지난 판정을 저장된 시세로 다시 계산한다. 요약을 적고 돌려준다."""
    started = time.perf_counter()
    stored_indicator = app_settings.get_value(db, INDICATOR_KEY)
    with_indicators = stored_indicator is not None and stored_indicator != signal_rules.INDICATOR_VERSION
    changed: dict[str, int] = {}
    failed: list[str] = []
    tickers = _tickers(db)
    for ticker in tickers:
        try:
            indicator_df = recompute_indicators(db, ticker) if with_indicators else None
            signal_df = recompute_signals(db, ticker, indicator_df)
            n = int(signal_df.attrs.get("updated_rows", 0))
            if n:
                changed[ticker] = n
        except Exception:
            db.rollback()
            failed.append(ticker)
            logger.warning("%s 의 시그널을 다시 계산하지 못했습니다", ticker, exc_info=True)

    biggest = sorted(changed.items(), key=lambda kv: (-kv[1], kv[0]))[:SUMMARY_TICKERS]
    summary = {
        "at": dt.datetime.utcnow().replace(microsecond=0).isoformat(),
        "reason": reason,
        "fingerprint": signal_rules.fingerprint(),
        "previous_fingerprint": stored_fingerprint(db),
        "with_indicators": with_indicators,
        "tickers": len(tickers),
        "changed_tickers": len(changed),
        "changed_rows": sum(changed.values()),
        "changed_by_ticker": dict(biggest),
        "failed": failed,
        "seconds": round(time.perf_counter() - started, 1),
    }
    app_settings.set_value(db, SUMMARY_KEY, json.dumps(summary, ensure_ascii=False))
    if not failed:
        app_settings.set_value(db, FINGERPRINT_KEY, signal_rules.fingerprint())
        app_settings.set_value(db, INDICATOR_KEY, signal_rules.INDICATOR_VERSION)
    logger.info(
        "시그널 다시 계산 (%s): %d종목 중 %d종목 %d줄 바뀜, 실패 %d, %.1f초",
        reason, len(tickers), len(changed), summary["changed_rows"], len(failed), summary["seconds"],
    )
    return summary


def run_if_changed(db: Session) -> dict | None:
    """정의의 지문이 저장된 것과 다르면 다시 계산한다. 같으면 None (아무것도 하지 않는다)."""
    if not needs_recompute(db):
        return None
    reason = "first" if stored_fingerprint(db) is None else "definition_changed"
    return recompute_all(db, reason=reason)
