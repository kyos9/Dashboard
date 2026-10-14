"""정의가 바뀌면 지난 판정을 다시 계산한다 (0.41.0) — `services/signal_recompute.py`, `tools/signal_diff.py`.

정의를 "바꾸는" 것은 테스트에서 ADX 기준(20)을 25 로 바꿔 흉내 낸다. 평가 함수는 그 값을 부를 때마다 읽고,
지문(`fingerprint`)은 기준값을 담으므로 함께 달라진다.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import select

from app.models import SignalDaily
from app.services import alerts, app_settings, signal_recompute, signal_rules
from app.services.data_ingestion import refresh_ticker
from app.services.indicators import compute_indicators
from app.services.signals import compute_signals
from app.tools import signal_diff
from tests.factories import make_push_state, make_push_subscription, make_stock, new_device


def _prices(seed: int, n: int = 400) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.018, n)))
    spread = np.abs(rng.normal(0, 0.01, n)) + 0.002
    dates = pd.bdate_range(end=dt.date.today(), periods=n).date
    return pd.DataFrame(
        {"open": close, "high": close * (1 + spread), "low": close * (1 - spread), "close": close,
         "adj_close": close, "volume": rng.lognormal(14, 0.4, n)},
        index=pd.Index(dates, name="date"),
    )


TICKERS = {"AAA": 3, "BBB": 5, "CCC": 9}


@pytest.fixture()
def stored(db_session):
    """세 종목 — 저장된 판정은 지금 정의(ADX 20)로 계산돼 있다."""
    for ticker, seed in TICKERS.items():
        make_stock(db_session, ticker=ticker)
        refresh_ticker(db_session, ticker, price_df=_prices(seed))
    return db_session


@pytest.fixture(autouse=True)
def fresh_fingerprint():
    """지문은 한 번 계산해 기억한다 — 기준값을 바꾸는 테스트 앞뒤로 비운다."""
    signal_rules.fingerprint.cache_clear()
    yield
    signal_rules.fingerprint.cache_clear()


def _change_definition(monkeypatch):
    """정의를 바꾼 코드를 배포한 것처럼 — ADX 기준 20 → 25."""
    monkeypatch.setattr(signal_rules, "ADX_TREND", 25.0)
    signal_rules.fingerprint.cache_clear()


@pytest.fixture()
def adx_25(monkeypatch):
    _change_definition(monkeypatch)


def _buy_rows(db) -> dict[tuple[str, dt.date], bool]:
    rows = db.execute(select(SignalDaily.ticker, SignalDaily.date, SignalDaily.knee_buy_v2)).all()
    return {(t, d): bool(v) for t, d, v in rows}


def test_first_start_recomputes_once_and_changes_nothing(stored):
    before = _buy_rows(stored)
    summary = signal_recompute.run_if_changed(stored)
    assert summary["reason"] == "first"
    assert (summary["tickers"], summary["changed_rows"], summary["failed"]) == (3, 0, [])
    assert _buy_rows(stored) == before
    assert signal_recompute.stored_fingerprint(stored) == signal_rules.fingerprint()
    # 두 번째로 켤 때는 돌지 않는다
    assert signal_recompute.run_if_changed(stored) is None


def test_changed_definition_rewrites_past_signals_from_stored_prices(stored, monkeypatch):
    signal_recompute.run_if_changed(stored)  # 0.41.0 첫 배포 — 지금 정의의 지문을 적는다
    before = _buy_rows(stored)

    _change_definition(monkeypatch)
    # 네트워크를 쓰지 않는다 — 시세를 받으려 하면 실패한다
    monkeypatch.setattr("app.services.data_ingestion.fetch_price_history", lambda *a, **k: pytest.fail("network"))
    summary = signal_recompute.run_if_changed(stored)
    after = _buy_rows(stored)

    flipped = {key for key in before if before[key] != after[key]}
    assert summary["reason"] == "definition_changed"
    assert flipped and all(before[k] and not after[k] for k in flipped)  # 기준이 높아져 꺼지기만 한다
    assert summary["changed_rows"] == len(flipped)
    assert summary["changed_by_ticker"] == {
        t: n for t in TICKERS if (n := sum(1 for k in flipped if k[0] == t))
    }
    # 저장된 판정 = 새 정의로 처음부터 계산한 것
    for ticker, seed in TICKERS.items():
        expect = compute_signals(compute_indicators(_prices(seed)))["knee_buy_v2"]
        assert all(after[(ticker, d)] == bool(v) for d, v in expect.items())
    assert signal_recompute.stored_fingerprint(stored) == signal_rules.fingerprint()


def test_a_failed_ticker_keeps_the_old_fingerprint_so_it_retries(stored, monkeypatch):
    real = signal_recompute.recompute_signals

    def flaky(db, ticker, indicator_df=None):
        if ticker == "BBB":
            raise RuntimeError("boom")
        return real(db, ticker, indicator_df)

    monkeypatch.setattr(signal_recompute, "recompute_signals", flaky)
    summary = signal_recompute.run_if_changed(stored)
    assert summary["failed"] == ["BBB"]
    assert signal_recompute.stored_fingerprint(stored) is None
    assert signal_recompute.last_summary(stored)["failed"] == ["BBB"]

    monkeypatch.setattr(signal_recompute, "recompute_signals", real)
    assert signal_recompute.run_if_changed(stored)["failed"] == []
    assert signal_recompute.stored_fingerprint(stored) == signal_rules.fingerprint()


def test_indicator_version_change_recomputes_indicators_too(stored, monkeypatch):
    calls = []
    real = signal_recompute.recompute_indicators
    monkeypatch.setattr(signal_recompute, "recompute_indicators", lambda db, t: calls.append(t) or real(db, t))
    signal_recompute.run_if_changed(stored)
    assert calls == []  # 처음 올린 서버 — 적힌 판이 없으면 지금 판으로 본다

    signal_rules.fingerprint.cache_clear()
    monkeypatch.setattr(signal_rules, "INDICATOR_VERSION", "2")
    try:
        summary = signal_recompute.run_if_changed(stored)
    finally:
        signal_rules.fingerprint.cache_clear()
    assert summary["with_indicators"] is True
    assert calls == sorted(TICKERS)
    assert app_settings.get_value(stored, signal_recompute.INDICATOR_KEY) == "2"


def test_fingerprint_values_are_not_admin_flags(db_session):
    with pytest.raises(KeyError):
        app_settings.set_value(db_session, app_settings.AI_ADVICE_FOR_USERS, "x")


def test_startup_job_recomputes_before_catching_up(monkeypatch):
    """같은 job 안에서 재계산 → 따라잡기 갱신 (같은 종목을 동시에 쓰지 않게)."""
    from app.services import pipeline, scheduler

    order = []
    monkeypatch.setattr(signal_recompute, "run_if_changed", lambda db: order.append("recompute"))
    monkeypatch.setattr(pipeline, "refresh_stale_markets", lambda db: order.append("refresh") or {})
    scheduler._startup_refresh_job()
    assert order == ["recompute", "refresh"]


def test_startup_job_goes_on_when_recompute_fails(monkeypatch):
    from app.services import pipeline, scheduler

    order = []

    def boom(db):
        raise RuntimeError("boom")

    monkeypatch.setattr(signal_recompute, "run_if_changed", boom)
    monkeypatch.setattr(pipeline, "refresh_stale_markets", lambda db: order.append("refresh") or {})
    scheduler._startup_refresh_job()
    assert order == ["refresh"]


# ---------- 알림 ----------

def _latest_buy_on(db, ticker: str) -> dt.date:
    """마지막 날을 매수로 만든다 (저장된 판정만 — 알림이 무엇을 보는지 보려고)."""
    last = db.execute(select(SignalDaily).where(SignalDaily.ticker == ticker).order_by(SignalDaily.date.desc())).scalars().first()
    last.knee_buy_v2 = True
    db.commit()
    return last.date


def test_changing_only_past_dates_sends_no_alert(stored):
    today = _latest_buy_on(stored, "AAA")
    make_push_state(stored, f"{alerts.KIND_BUY}:AAA", today.isoformat())
    # 지난 날짜를 전부 뒤집어도 (정의 변경의 흉내) 가장 최근 행은 그대로
    for row in stored.execute(select(SignalDaily).where(SignalDaily.ticker == "AAA", SignalDaily.date < today)).scalars():
        row.knee_buy_v2 = not row.knee_buy_v2
    stored.commit()
    fired = alerts.pending_changes(stored, 1, alerts.current_values(stored, 1))
    assert f"{alerts.KIND_BUY}:AAA" not in {s for s, _, _ in fired}


def test_today_turning_on_alerts_once(stored):
    before = {s for s, _, _ in alerts.pending_changes(stored, 1, alerts.current_values(stored, 1))}
    _latest_buy_on(stored, "AAA")
    fired = alerts._changes(stored, 1, alerts.current_values(stored, 1))
    assert f"{alerts.KIND_BUY}:AAA" in {s for s, _, _ in fired} - before
    # 적었으니 다음 판정에서는 다시 안 간다
    again = alerts.pending_changes(stored, 1, alerts.current_values(stored, 1))
    assert f"{alerts.KIND_BUY}:AAA" not in {s for s, _, _ in again}


# ---------- 전후 비교 도구 ----------

def test_signal_diff_counts_the_change_without_writing(stored, adx_25):
    make_push_subscription(stored, new_device())
    before_rows = _buy_rows(stored)
    report = signal_diff.run(stored)
    assert _buy_rows(stored) == before_rows  # 아무것도 쓰지 않는다

    by = {r["ticker"]: r for r in report["tickers"]}
    assert set(by) == set(TICKERS)
    stored_buys = _buy_rows(stored)
    for ticker, seed in TICKERS.items():
        new = compute_signals(compute_indicators(_prices(seed)))  # 바꾼 정의(ADX 25)로
        last = new.index.max()
        since = last - dt.timedelta(days=365)
        r = by[ticker]
        assert r["buy"]["after"][1] == int(new.loc[[d > since for d in new.index], "knee_buy_v2"].sum())
        assert r["buy"]["before"][1] == sum(v for (t, d), v in stored_buys.items() if t == ticker and d > since)
        assert r["buy"]["after"][1] <= r["buy"]["before"][1]  # 기준이 높아져 줄기만 한다
        assert r["sell"]["before"] == r["sell"]["after"]  # 매도 정의는 그대로
    assert sum(r["buy"]["before"][5] - r["buy"]["after"][5] for r in by.values()) > 0
    text = signal_diff.render(report)
    assert "매수 1·3·5년" in text and "수익률은 보지 않는다" in text
    assert report["alerts"]["users_with_alerts_on"] == 1


def test_signal_diff_finds_a_new_buy_alert(stored, monkeypatch):
    """정의를 바꾸니 오늘 매수가 새로 켜지는 종목 — 알림이 갈 사람 1명, 그 종목."""
    make_push_subscription(stored, new_device())
    # 오늘 판정을 저장된 쪽에서 꺼 두고, 새 정의(여기서는 모든 조건을 참으로)가 켜게 한다
    # AAA·CCC 는 이미 오늘 매수였다(새 정의에서도) — 새로 켜진 것이 아니라 세지 않는다
    for ticker in TICKERS:
        last = stored.execute(
            select(SignalDaily).where(SignalDaily.ticker == ticker).order_by(SignalDaily.date.desc())
        ).scalars().first()
        last.knee_buy_v2 = ticker != "BBB"
    stored.commit()
    monkeypatch.setattr(signal_rules, "evaluate_rule", lambda rule, df: pd.Series(rule.key == "buy", index=df.index))
    report = signal_diff.run(stored)
    assert report["alerts"]["users"] == 1
    assert report["alerts"]["stocks"] == ["BBB"]
    assert "BBB" in report["today_changed"]


def test_admin_status_shows_the_last_recompute(api):
    client, Session = api
    before = client.get("/api/admin/signal-rules").json()
    assert before["up_to_date"] is False and before["stored_version"] is None and before["last_recompute"] is None
    with Session() as db:
        signal_recompute.recompute_all(db, reason="manual")
    body = client.get("/api/admin/signal-rules").json()
    assert body["version"] == signal_rules.fingerprint()
    assert body["up_to_date"] is True
    assert body["last_recompute"]["reason"] == "manual"
    assert body["changed_on"] is None
