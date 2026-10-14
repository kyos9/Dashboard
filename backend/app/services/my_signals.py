"""사람마다의 시그널 판정 — "내 기준" (0.42.0, SIGNAL_APP_SPEC.md 12장).

시그널 기준값(ADX·거래량비·이격도·비교 기간)을 바꾼 사람은 **읽을 때** 자기 기준으로 다시 판정한다.
공용 판정(`signal_daily`)은 늘 기본 기준이고 이 모듈은 그것을 건드리지 않는다(ROADMAP 1절 "싼 개인화").

- 기본인 사람: 지금 길 그대로 — `signal_daily` 를 읽는다(쿼리 수도 그대로).
- 바꾼 사람: 공용 지표(`indicator_daily`)와 종가(`price_daily`, 매도 "종가 > MA50")를 읽어 그 기준으로 표 전체를
  판정한다. 결과는 (기준, 종목, 마지막 지표 날짜, 행 수, 판정이 읽는 지표의 합)을 키로 메모리에 둔다 — 같은 기준인 사람끼리 나눠 쓰고,
  시세가 갱신되면 키가 달라져 저절로 새로 센다.

카드·차트 점·알림·리밸런싱(이번 기간 어깨매도)·AI 가 모두 `source(db, user_id)` 하나로 읽는다 — 한 사람 화면 안에서
자리마다 다른 기준을 말하지 않게(주인 결정, 0.42.0).
"""

from __future__ import annotations

import datetime as dt
import threading
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np
import pandas as pd
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models import IndicatorDaily, PriceDaily, SignalDaily, UserSettings
from app.services import queries, signal_rules
from app.services.signal_rules import Thresholds
from app.services.signals import _INDICATOR_FIELDS, compute_signals

# 판정이 읽는 지표 (`signal_rules` 의 조건들) — 캐시 키의 합에 쓴다
_JUDGED_FIELDS = ("ma50", "stddev20", "vol_ratio", "disparity", "plus_di", "minus_di", "adx")

# 메모리에 두는 종목 판정의 수. 한 벌이 10년이면 수십 KB 라, 이만큼이면 수십 MB 를 넘지 않는다.
CACHE_SIZE = 512


def thresholds_for(db: Session, user_id: int) -> Thresholds:
    """그 사람의 기준. 한 요청(세션) 안에서는 한 번만 읽는다 — 대시보드는 카드·리밸런싱이 각각 묻는다.

    설정 줄이 아직 없는 사람은 `db.get` 이 None 을 기억하지 못해 물을 때마다 쿼리가 나간다. 그래서 세션에 둔다.
    바꾸는 쪽(`PUT /api/signal-thresholds`)은 `forget` 으로 지운다.
    """
    known = db.info.setdefault("signal_thresholds", {})
    if user_id not in known:
        settings = db.get(UserSettings, user_id)
        known[user_id] = Thresholds.from_stored(settings.signal_thresholds if settings else None)
    return known[user_id]


def forget(db: Session, user_id: int) -> None:
    db.info.get("signal_thresholds", {}).pop(user_id, None)


@dataclass(frozen=True)
class Judged:
    """한 종목의 날마다 판정 (날짜 오름차순)."""

    dates: tuple[dt.date, ...]
    buy: np.ndarray
    sell: np.ndarray

    def last(self) -> SimpleNamespace | None:
        if not self.dates:
            return None
        return SimpleNamespace(
            date=self.dates[-1], knee_buy_v2=bool(self.buy[-1]), shoulder_sell_ref=bool(self.sell[-1])
        )

    def last_buy(self) -> dt.date | None:
        hits = np.flatnonzero(self.buy)
        return self.dates[hits[-1]] if len(hits) else None

    def days(self, column: str, since: dt.date | None = None) -> list[dt.date]:
        values = self.buy if column == "buy" else self.sell
        return [d for d, on in zip(self.dates, values) if on and (since is None or d >= since)]


_cache: OrderedDict[tuple, Judged] = OrderedDict()
_lock = threading.Lock()


def _remember(key: tuple, judged: Judged) -> None:
    with _lock:
        _cache[key] = judged
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def _recall(key: tuple) -> Judged | None:
    with _lock:
        judged = _cache.get(key)
        if judged is not None:
            _cache.move_to_end(key)
        return judged


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _frames(db: Session, tickers: Sequence[str]) -> dict[str, pd.DataFrame]:
    """지표 행 전부 + 그날 종가, 종목별 날짜 오름차순. 쿼리 하나.

    ORM 이 아니라 표(Core)로 읽는다 — 20종목 × 10년이면 ORM 행 만들기만 0.5초가 넘었다.
    """
    ind, px = IndicatorDaily.__table__, PriceDaily.__table__
    stmt = (
        select(ind.c.ticker, ind.c.date, px.c.close, *[ind.c[name] for name in _INDICATOR_FIELDS])
        .select_from(ind.outerjoin(px, and_(px.c.ticker == ind.c.ticker, px.c.date == ind.c.date)))
        .where(ind.c.ticker.in_(list(tickers)))
        .order_by(ind.c.ticker, ind.c.date)
    )
    rows = db.connection().execute(stmt).all()
    frame = pd.DataFrame.from_records(rows, columns=["ticker", "date", "close", *_INDICATOR_FIELDS])
    out = {}
    for ticker, part in frame.groupby("ticker", sort=False):
        out[ticker] = part.drop(columns="ticker").set_index("date").astype("float64")
    return out


def _judge_frames(frames: dict[str, pd.DataFrame], t: Thresholds) -> dict[str, Judged]:
    """여러 종목을 **표 하나로** 판정한다 — 종목마다 따로 하면 20종목에 0.3초.

    종목 사이에 빈 행을 "비교 기간"만큼 끼워 둔다. 조건의 "N거래일 전"이 앞 종목의 행을 읽지 않고 빈 행을
    읽어 판정 불가가 된다 — 종목 하나만 판정할 때 첫 N 행이 판정 불가인 것과 같다.
    """
    if not frames:
        return {}
    gap = t.lookback_days
    columns = next(iter(frames.values())).columns
    parts, spans = [], {}
    at = 0
    for ticker, frame in frames.items():
        parts.append(frame.reset_index(drop=True))
        spans[ticker] = (at, at + len(frame))
        at += len(frame)
        parts.append(pd.DataFrame(np.nan, index=range(gap), columns=columns))
        at += gap
    judged = compute_signals(pd.concat(parts, ignore_index=True), t)
    buy = judged["knee_buy_v2"].to_numpy(dtype=bool)
    sell = judged["shoulder_sell_ref"].to_numpy(dtype=bool)
    return {
        ticker: Judged(dates=tuple(frames[ticker].index), buy=buy[start:end].copy(), sell=sell[start:end].copy())
        for ticker, (start, end) in spans.items()
    }


def judge(db: Session, tickers: Sequence[str], t: Thresholds) -> dict[str, Judged]:
    """종목마다 `t` 기준의 날마다 판정. 지표가 없는 종목은 키가 없다."""
    if not tickers:
        return {}
    # 갱신은 이미 있는 날의 시세·지표를 그 자리에서 고치기도 한다(`data_ingestion`) — 날짜·행 수만으로는 그것을
    # 모른다. 판정이 읽는 지표의 합을 키에 넣어 값이 고쳐지면 새로 센다(0.42.0 A 검토). 종가가 고쳐지면
    # MA20·MA50·이격도가 따라 바뀌므로 지표 합에 드러난다. 처리기가 여럿이어도 맞다(메모리 표시가 아니라 DB 값이다).
    ind = IndicatorDaily.__table__
    marks = db.execute(
        select(
            ind.c.ticker, func.max(ind.c.date), func.count(),
            *[func.sum(ind.c[name]) for name in _JUDGED_FIELDS],
        )
        .where(ind.c.ticker.in_(list(tickers)))
        .group_by(ind.c.ticker)
    ).all()
    out: dict[str, Judged] = {}
    missing: dict[str, tuple] = {}
    for ticker, last, count, *sums in marks:
        key = (t, ticker, last, count, *(None if v is None else round(float(v), 9) for v in sums))
        judged = _recall(key)
        if judged is None:
            missing[ticker] = key
        else:
            out[ticker] = judged
    if missing:
        for ticker, judged in _judge_frames(_frames(db, list(missing)), t).items():
            _remember(missing[ticker], judged)
            out[ticker] = judged
    return out


class Source:
    """한 사람이 보는 시그널. 기본 기준이면 `signal_daily`, 바꿨으면 그 기준으로 읽을 때 판정한다."""

    def __init__(self, db: Session, t: Thresholds | None = None):
        self.db = db
        t = t or signal_rules.DEFAULT
        self.thresholds = t
        self.custom = not t.is_default
        self._judged: dict[str, Judged] = {}

    def _get(self, tickers: Sequence[str]) -> dict[str, Judged]:
        want = [t for t in tickers if t not in self._judged]
        if want:
            self._judged.update(judge(self.db, want, self.thresholds))
        return {t: self._judged[t] for t in tickers if t in self._judged}

    def today(self, tickers: Sequence[str]) -> dict[str, list]:
        """종목별 최근 판정 한 행 — `queries.recent_signals(limit=1)` 과 같은 모양(`date`·`knee_buy_v2`·`shoulder_sell_ref`)."""
        if not self.custom:
            return queries.recent_signals(self.db, tickers, limit=1)
        return {t: [row] for t, j in self._get(tickers).items() if (row := j.last()) is not None}

    def last_buy_dates(self, tickers: Sequence[str]) -> dict[str, dt.date]:
        if not self.custom:
            return queries.last_buy_signal_dates(self.db, tickers)
        return {t: d for t, j in self._get(tickers).items() if (d := j.last_buy()) is not None}

    def markers(self, ticker: str, since: dt.date | None) -> list[tuple[dt.date, bool, bool]]:
        """차트에 찍을 날 `(날짜, 매수, 매도)` — 둘 중 하나라도 뜬 날만, 날짜 오름차순."""
        if not self.custom:
            query = self.db.query(SignalDaily).filter(
                SignalDaily.ticker == ticker,
                (SignalDaily.knee_buy_v2.is_(True)) | (SignalDaily.shoulder_sell_ref.is_(True)),
            )
            if since is not None:
                query = query.filter(SignalDaily.date >= since)
            return [
                (row.date, bool(row.knee_buy_v2), bool(row.shoulder_sell_ref))
                for row in query.order_by(SignalDaily.date.asc()).all()
            ]
        judged = self._get([ticker]).get(ticker)
        if judged is None:
            return []
        return [
            (d, bool(b), bool(s))
            for d, b, s in zip(judged.dates, judged.buy, judged.sell)
            if (b or s) and (since is None or d >= since)
        ]

    def sell_days(self, tickers: Sequence[str], since: dt.date) -> list[tuple[str, dt.date]]:
        """`since` 부터 어깨매도(참고)가 뜬 (종목, 날짜)."""
        if not self.custom:
            return (
                self.db.query(SignalDaily.ticker, SignalDaily.date)
                .filter(
                    SignalDaily.ticker.in_(list(tickers)),
                    SignalDaily.date >= since,
                    SignalDaily.shoulder_sell_ref.is_(True),
                )
                .all()
            )
        return [(t, d) for t, j in self._get(tickers).items() for d in j.days("sell", since)]

    def buy_count_after(self, ticker: str, after: dt.date) -> int:
        """`after` 다음 날부터 매수 시그널이 뜬 날 수."""
        if not self.custom:
            return int(
                self.db.query(func.count()).select_from(SignalDaily).filter(
                    SignalDaily.ticker == ticker, SignalDaily.knee_buy_v2.is_(True), SignalDaily.date > after,
                ).scalar() or 0
            )
        judged = self._get([ticker]).get(ticker)
        return 0 if judged is None else sum(1 for d in judged.days("buy") if d > after)


def source(db: Session, user_id: int | None) -> Source:
    return Source(db, None if user_id is None else thresholds_for(db, user_id))
