"""야후 재무 — 일본 종목 (ROADMAP 3b-3).

야후 재무는 개발 환경에서 막혀 있다. 모양은 서버 진단(v0.26.1, 삼성전자의 야후 부분)을 본떴다 —
분기 표는 최근 5~6분기(빈 분기 섞임), 연간 표는 4년, 칸 이름은 결산일, 실적 발표일 목록.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from app.models import FundamentalFact, FundamentalStatus, PriceDaily, StockSplit
from app.services import fundamentals
from app.services.providers import yahoo_fin
from tests.factories import make_stock

D = dt.date
TODAY = D(2026, 9, 26)
NOW = dt.datetime(2026, 9, 26, 23, 15)
TICKER = "7203.T"

# 3월 결산 — 분기 끝은 6·9·12·3월
Q_ENDS = [D(2026, 6, 30), D(2026, 3, 31), D(2025, 12, 31), D(2025, 9, 30), D(2025, 6, 30), D(2025, 3, 31)]
Y_ENDS = [D(2026, 3, 31), D(2025, 3, 31), D(2024, 3, 31), D(2023, 3, 31)]
# 야후가 아는 발표일 — 최근 것만 (옛 연간은 추정으로)
EARNINGS = [D(2025, 5, 8), D(2025, 8, 7), D(2025, 11, 6), D(2026, 2, 6), D(2026, 5, 8), D(2026, 8, 6),
            D(2026, 11, 5)]  # 앞으로의 발표일도 섞여 온다


def frame(rows: dict[str, list], ends: list[dt.date]) -> pd.DataFrame:
    return pd.DataFrame(rows, index=[pd.Timestamp(e) for e in ends]).T


def q_eps(i):  # i=0 이 가장 최근 분기
    return 100.0 - 5 * i


def handle(**overrides) -> yahoo_fin.Handle:
    nan = float("nan")
    frames = {
        "quarterly_income_stmt": frame({
            "Total Revenue": [12e12, 11e12, 11.5e12, 10e12, 10.5e12, nan],   # 가장 옛 분기는 빈 값
            "Operating Income": [1.2e12, 1.1e12, 1.2e12, 1.0e12, 1.0e12, nan],
            "Net Income Common Stockholders": [1e12, 0.9e12, 1e12, 0.8e12, 0.85e12, nan],
            "Diluted EPS": [q_eps(i) for i in range(5)] + [nan],
        }, Q_ENDS),
        "income_stmt": frame({
            "Total Revenue": [45e12, 42e12, 40e12, 37e12],
            "Operating Income": [4.5e12, 4.2e12, 4e12, 3e12],
            "Net Income Common Stockholders": [3.6e12, 3.4e12, 3e12, 2.5e12],
            "Diluted EPS": [360.0, 330.0, 300.0, 250.0],
        }, Y_ENDS),
        "quarterly_balance_sheet": frame({
            "Stockholders Equity": [36e12, 35e12, 34e12, 33e12, 32e12, 31e12],
            "Total Liabilities Net Minority Interest": [54e12] * 6,
            "Ordinary Shares Number": [13e9] * 6,
        }, Q_ENDS),
        "balance_sheet": frame({
            "Stockholders Equity": [35e12, 31e12, 28e12, 25e12],
            "Total Liabilities Net Minority Interest": [50e12] * 4,
            "Ordinary Shares Number": [13e9] * 4,
        }, Y_ENDS),
        "quarterly_cashflow": frame({
            "Operating Cash Flow": [1.5e12, 1.4e12, 1.3e12, 1.2e12, 1.1e12, 1.0e12],
            "Capital Expenditure": [-0.5e12] * 6,
        }, Q_ENDS),
        "cashflow": frame({
            "Operating Cash Flow": [5e12, 4.6e12, 4e12, 3.5e12],
            "Capital Expenditure": [-2e12] * 4,
        }, Y_ENDS),
    }
    base = dict(
        info={"quoteType": "EQUITY", "financialCurrency": "JPY"},
        frames=frames,
        earnings=EARNINGS,
        dividends=[(D(2025, 9, 29), 45.0), (D(2026, 3, 30), 50.0), (D(2024, 9, 27), 40.0)],
    )
    base.update(overrides)
    return yahoo_fin.Handle(**base)


def rows_of(parsed, metric):
    return sorted((r["period_start"], r["period_end"], r["value"], r["filed_at"], r["filed_estimated"])
                  for r in parsed.rows if r["metric"] == metric)


# --- 해석 -----------------------------------------------------------------------

@pytest.mark.parametrize("end, months, start", [
    (D(2026, 6, 30), 3, D(2026, 4, 1)),
    (D(2026, 3, 31), 12, D(2025, 4, 1)),
    (D(2026, 2, 28), 3, D(2025, 12, 1)),
    (D(2025, 12, 31), 12, D(2025, 1, 1)),
    (D(2026, 6, 20), 3, D(2026, 3, 21)),   # 월말이 아닌 결산
])
def test_period_start(end, months, start):
    assert yahoo_fin.period_start(end, months) == start


def test_filed_date_is_the_first_earnings_date_after_the_period_or_an_estimate():
    assert yahoo_fin.filed_for(D(2026, 6, 30), EARNINGS) == (D(2026, 8, 6), False)
    assert yahoo_fin.filed_for(D(2023, 3, 31), EARNINGS) == (D(2023, 5, 15), True)  # 목록에 없음 → +45일
    # 너무 멀리 떨어진 발표일은 그 기간의 것이 아니다
    assert yahoo_fin.filed_for(D(2025, 3, 31), [D(2025, 12, 1)]) == (D(2025, 5, 15), True)


def test_quarters_and_years_with_their_dates():
    parsed = yahoo_fin.parse(handle(), TODAY)
    revenue = rows_of(parsed, "revenue")
    # 빈 분기(2025.03)는 빠지고, 연간 4년은 들어간다
    assert (D(2025, 1, 1), D(2025, 3, 31)) not in [(s, e) for s, e, *_ in revenue]
    assert (D(2026, 4, 1), D(2026, 6, 30), 12e12, D(2026, 8, 6), False) in revenue
    assert (D(2022, 4, 1), D(2023, 3, 31), 37e12, D(2023, 5, 15), True) in revenue
    assert len(revenue) == 5 + 4
    # 재무상태는 그 시점 하나 — 분기 표와 연간 표에 같은 날이 와도 한 번
    equity = rows_of(parsed, "equity")
    assert [e for _, e, *_ in equity].count(D(2026, 3, 31)) == 1
    # 설비투자는 크기로
    assert {v for _, _, v, _, _ in rows_of(parsed, "capex")} == {0.5e12, 2e12}
    eps = next(r for r in parsed.rows if r["metric"] == "eps_diluted")
    assert (eps["unit"], eps["source"], eps["form"], eps["tag"]) == ("JPY/shares", "yahoo", "분기", "Diluted EPS")
    assert parsed.missing == []


def test_dividends_are_summed_per_fiscal_year():
    parsed = yahoo_fin.parse(handle(), TODAY)
    dps = {e: v for _, e, v, *_ in rows_of(parsed, "dps")}
    assert dps[D(2026, 3, 31)] == 95.0          # 2025.09 + 2026.03
    assert dps[D(2025, 3, 31)] == 40.0
    # 배당 이력을 못 받았으면 0 으로 적지 않는다
    assert rows_of(yahoo_fin.parse(handle(dividends=[]), TODAY), "dps") == []


def test_future_filings_are_not_known_yet():
    parsed = yahoo_fin.parse(handle(), D(2026, 8, 1))  # 2026.06 분기 발표(8/6) 전
    assert D(2026, 6, 30) not in {r["period_end"] for r in parsed.rows}


def test_fallback_row_names():
    h = handle()
    h.frames["quarterly_income_stmt"] = h.frames["quarterly_income_stmt"].rename(
        index={"Diluted EPS": "Basic EPS", "Net Income Common Stockholders": "Net Income"})
    parsed = yahoo_fin.parse(h, TODAY)
    assert next(r for r in parsed.rows if r["metric"] == "eps_diluted" and r["form"] == "분기")["tag"] == "Basic EPS"


def test_missing_items_are_listed():
    h = handle()
    for attr in ("quarterly_cashflow", "cashflow"):
        h.frames[attr] = pd.DataFrame()
    assert yahoo_fin.parse(h, TODAY).missing == ["operating_cf", "capex"]


def test_etf_is_not_listed():
    with pytest.raises(yahoo_fin.NotListed, match="ETF"):
        yahoo_fin.parse(handle(info={"quoteType": "ETF"}), TODAY)


def test_statements_in_another_currency_are_not_read():
    parsed = yahoo_fin.parse(handle(info={"quoteType": "EQUITY", "financialCurrency": "USD"}), TODAY)
    assert parsed.unsupported and "USD" in parsed.unsupported and parsed.rows == []


def test_nothing_at_all_is_empty():
    assert yahoo_fin.parse(handle(frames={}), TODAY).empty


# --- 저장과 화면 -------------------------------------------------------------------

@pytest.fixture
def fake_yahoo(monkeypatch):
    state = {"handle": handle(), "calls": 0, "error": None}

    def fetch(ticker):
        state["calls"] += 1
        if state["error"]:
            raise yahoo_fin.YahooError(state["error"])
        return state["handle"]

    monkeypatch.setattr(yahoo_fin, "fetch", fetch)
    monkeypatch.setattr(fundamentals, "fetch_splits", lambda ticker: [(D(2024, 4, 1), 5.0)])
    return state


def _prices(db, close):
    day = D(2022, 1, 3)
    while day <= TODAY:
        if day.weekday() < 5:
            db.add(PriceDaily(ticker=TICKER, date=day, open=close, high=close, low=close, close=close, volume=1))
        day += dt.timedelta(days=1)
    db.commit()


def test_refresh_saves_yahoo_facts_and_computes_ratios(db_session, fake_yahoo):
    make_stock(db_session, TICKER)
    result = fundamentals.refresh_ticker(db_session, TICKER, NOW)
    assert result["state"] == "ok"
    status = db_session.get(FundamentalStatus, TICKER)
    assert (status.state, status.source) == ("ok", "yahoo")

    _prices(db_session, 3000.0)
    out = fundamentals.detail(db_session, TICKER, "JPY", today=TODAY)
    metrics = {m["key"]: m for m in out["metrics"]}
    ttm_eps = sum(q_eps(i) for i in range(4))
    # 분할(2024-04)이 있어도 야후 값은 이미 지금 주식 기준 — 다시 나누지 않는다
    assert db_session.query(StockSplit).count() == 1
    assert metrics["per"]["value"] == pytest.approx(3000 / ttm_eps)
    assert metrics["per"]["filed_at"] == D(2026, 8, 6) and not metrics["per"]["estimated"]
    assert metrics["pbr"]["value"] == pytest.approx(3000 / (36e12 / 13e9))
    assert metrics["dividend_yield"]["value"] == pytest.approx(95 / 3000 * 100)
    # PER 위치는 연간 EPS 로 앞쪽을 채운다 — 추정 공시일부터
    assert out["per_range"] is not None and out["per_range"]["since"] <= D(2023, 6, 1)
    assert metrics["fcf"]["value"] == pytest.approx((1.5e12 + 1.4e12 + 1.3e12 + 1.2e12) - 4 * 0.5e12)
    assert [q["period_end"] for q in out["quarters"]][:2] == [D(2026, 6, 30), D(2026, 3, 31)]


def test_moving_earnings_dates_do_not_add_rows(db_session, fake_yahoo):
    make_stock(db_session, TICKER)
    fundamentals.refresh_ticker(db_session, TICKER, NOW)
    count = db_session.query(FundamentalFact).count()
    # 발표일 목록이 밀려 옛 분기가 추정(+45일)으로 바뀌어도 같은 값이면 새 줄이 아니다
    fake_yahoo["handle"] = handle(earnings=EARNINGS[3:])
    again = fundamentals.refresh_ticker(db_session, TICKER, NOW + dt.timedelta(days=7))
    assert again["added"] == 0 and db_session.query(FundamentalFact).count() == count
    # 값이 바뀌면 새 줄 — 옛 발표일이 아니라 바뀐 걸 안 날(오늘)로
    h = handle()
    h.frames["quarterly_income_stmt"].iloc[0, 0] = 12.5e12
    fake_yahoo["handle"] = h
    later = NOW + dt.timedelta(days=14)
    assert fundamentals.refresh_ticker(db_session, TICKER, later)["added"] == 1
    new = db_session.query(FundamentalFact).filter(FundamentalFact.value == 12.5e12).one()
    assert new.filed_at == later.date() and new.filed_estimated
    # 야후가 원래 값으로 되돌리면 그것도 새 줄 — 지금 값은 되돌린 값이다
    fake_yahoo["handle"] = handle()
    assert fundamentals.refresh_ticker(db_session, TICKER, later + dt.timedelta(days=7))["added"] == 1
    snap = fundamentals.detail(db_session, TICKER, "JPY", today=TODAY + dt.timedelta(days=30))["quarters"][0]
    assert snap["revenue"] == 12e12 and snap["revised"]


def test_japanese_etf_is_hidden(db_session, fake_yahoo):
    make_stock(db_session, "1321.T")
    fake_yahoo["handle"] = handle(info={"quoteType": "ETF"})
    assert fundamentals.refresh_ticker(db_session, "1321.T", NOW)["state"] == "none"
    status = db_session.get(FundamentalStatus, "1321.T")
    assert status.source == "yahoo" and "ETF" in status.message


def test_yahoo_failure_keeps_what_was_saved(db_session, fake_yahoo):
    make_stock(db_session, TICKER)
    fundamentals.refresh_ticker(db_session, TICKER, NOW)
    count = db_session.query(FundamentalFact).count()
    fake_yahoo["error"] = "야후 종목 정보를 받지 못했습니다 (HTTPError)"
    result = fundamentals.refresh_ticker(db_session, TICKER, NOW + dt.timedelta(days=8))
    assert result["state"] == "error" and db_session.query(FundamentalFact).count() == count


def test_sec_facts_are_still_adjusted_for_splits(db_session):
    """야후만 빼고 나누지 않는다 — 같은 종목에 SEC 값이 섞여도 SEC 쪽은 그대로 나눈다."""
    make_stock(db_session, "ACME")
    db_session.add(FundamentalFact(ticker="ACME", metric="eps_diluted", period_start=D(2023, 1, 1),
                                   period_end=D(2023, 3, 31), value=10.0, unit="USD/shares",
                                   filed_at=D(2023, 5, 1), source="sec"))
    db_session.add(FundamentalFact(ticker="ACME", metric="eps_diluted", period_start=D(2023, 4, 1),
                                   period_end=D(2023, 6, 30), value=1.0, unit="USD/shares",
                                   filed_at=D(2023, 8, 1), source="yahoo"))
    db_session.add(StockSplit(ticker="ACME", date=D(2024, 1, 2), ratio=10.0))
    db_session.commit()
    facts = fundamentals._facts_by_ticker(db_session, ["ACME"])["ACME"]
    assert sorted(f.value for f in facts) == [1.0, 1.0]
