"""SEC 해석 · 저장 · 갱신 일정 · API (ROADMAP 3b-1).

SEC 응답 모양은 서버 진단(v0.23.2) 결과를 본떴다 — 알파벳·일라이 릴리·엔비디아·TSMC.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.models import FundamentalFact, FundamentalStatus, PriceDaily, StockSplit
from app.services import fundamentals
from app.services.providers import sec
from tests.factories import make_stock

D = dt.date


def entry(start, end, val, filed, form="10-Q"):
    item = {"end": end, "val": val, "filed": filed, "form": form, "fy": 2026, "fp": "Q2"}
    if start:
        item["start"] = start
    return item


def facts_json(**by_tag) -> dict:
    """{"us-gaap:Revenues": {"USD": [...]}} 모양을 companyfacts 모양으로."""
    facts: dict = {}
    for key, units in by_tag.items():
        taxonomy, name = key.split("__")
        facts.setdefault(taxonomy, {})[name] = {"units": units}
    return {"cik": 1, "entityName": "ACME", "facts": facts}


TODAY = D(2026, 9, 26)


# --- 해석 ------------------------------------------------------------------------

def test_same_period_filed_again_keeps_only_the_first_filing():
    data = facts_json(**{"us-gaap__Revenues": {"USD": [
        entry("2025-04-01", "2025-06-30", 100, "2025-07-24"),
        entry("2025-04-01", "2025-06-30", 100, "2025-07-23", form="8-K"),  # 실적 발표가 하루 먼저
        entry("2025-04-01", "2025-06-30", 100, "2026-07-23"),               # 이듬해 비교 기간
    ]}})
    rows = [r for r in sec.parse_companyfacts(data, TODAY).rows if r["metric"] == "revenue"]
    assert [(r["filed_at"], r["value"], r["form"]) for r in rows] == [(D(2025, 7, 23), 100.0, "8-K")]


def test_changed_value_is_kept_as_a_new_row():
    data = facts_json(**{"us-gaap__Revenues": {"USD": [
        entry("2025-04-01", "2025-06-30", 100, "2025-07-23"),
        entry("2025-04-01", "2025-06-30", 97, "2026-07-23"),
    ]}})
    rows = [r for r in sec.parse_companyfacts(data, TODAY).rows if r["metric"] == "revenue"]
    assert [(r["filed_at"], r["value"]) for r in rows] == [(D(2025, 7, 23), 100.0), (D(2026, 7, 23), 97.0)]


def test_tag_is_chosen_per_period_not_per_company():
    """엔비디아 — 설비투자 태그가 2020년까지만 있고 그 뒤는 다른 태그다."""
    data = facts_json(**{
        "us-gaap__PaymentsToAcquirePropertyPlantAndEquipment": {"USD": [
            entry("2020-01-27", "2020-04-26", 155, "2020-05-21"),
        ]},
        "us-gaap__PaymentsToAcquireProductiveAssets": {"USD": [
            entry("2020-01-27", "2020-04-26", 999, "2021-05-21"),  # 같은 기간이면 앞 태그가 이긴다
            entry("2026-01-26", "2026-04-26", 1200, "2026-05-20"),
        ]},
    })
    rows = sorted((r["period_end"], r["value"], r["tag"]) for r in sec.parse_companyfacts(data, TODAY).rows
                  if r["metric"] == "capex")
    assert rows == [
        (D(2020, 4, 26), 155.0, "PaymentsToAcquirePropertyPlantAndEquipment"),
        (D(2026, 4, 26), 1200.0, "PaymentsToAcquireProductiveAssets"),
    ]


def test_instants_have_start_equal_to_end_and_durations_need_a_start():
    data = facts_json(**{
        "us-gaap__StockholdersEquity": {"USD": [entry(None, "2026-06-30", 640, "2026-07-23")]},
        "us-gaap__NetIncomeLoss": {"USD": [entry(None, "2026-06-30", 1, "2026-07-23"),
                                          entry("2026-04-01", "2026-06-30", 112, "2026-07-23")]},
    })
    rows = {r["metric"]: r for r in sec.parse_companyfacts(data, TODAY).rows}
    assert rows["equity"]["period_start"] == rows["equity"]["period_end"] == D(2026, 6, 30)
    assert rows["net_income"]["value"] == 112


def test_missing_items_are_listed_like_eli_lilly():
    data = facts_json(**{
        "us-gaap__Revenues": {"USD": [entry("2026-04-01", "2026-06-30", 22974, "2026-08-05")]},
        "us-gaap__NetIncomeLoss": {"USD": [entry("2026-04-01", "2026-06-30", 7095, "2026-08-05")]},
    })
    parsed = sec.parse_companyfacts(data, TODAY)
    assert "operating_income" in parsed.missing and "capex" in parsed.missing
    assert "revenue" not in parsed.missing
    assert not parsed.empty and parsed.unsupported is None


def test_foreign_filer_is_unsupported_and_fund_is_empty():
    tsm = {"facts": {"dei": {}, "ifrs-full": {"Revenue": {"units": {"TWD": []}}}}}
    assert sec.parse_companyfacts(tsm, TODAY).unsupported
    fund = {"facts": {"dei": {"EntityPublicFloat": {}}}}
    assert sec.parse_companyfacts(fund, TODAY).empty
    no_income = facts_json(**{"us-gaap__Liabilities": {"USD": [entry(None, "2026-06-30", 5, "2026-07-23")]}})
    assert sec.parse_companyfacts(no_income, TODAY).empty


def test_old_periods_are_not_kept():
    data = facts_json(**{"us-gaap__Revenues": {"USD": [
        entry("2015-01-01", "2015-03-31", 1, "2015-04-30"),
        entry("2026-01-01", "2026-03-31", 2, "2026-04-30"),
    ]}})
    assert [r["value"] for r in sec.parse_companyfacts(data, TODAY).rows] == [2.0]


def test_ticker_map_and_user_agents(monkeypatch):
    assert sec.parse_ticker_map({"0": {"cik_str": 1045810, "ticker": "NVDA", "title": "NVIDIA"},
                                 "1": {"bad": 1}}) == {"NVDA": 1045810}
    assert sec.sec_ticker("brk.b") == "BRK-B"
    monkeypatch.setenv("OPERATOR_CONTACT", "https://open.kakao.com/o/x")
    monkeypatch.setenv("PUBLIC_URL", "https://example.org")
    assert sec.user_agents() == ["asset-hub/1.0 (+https://example.org)"]
    monkeypatch.setenv("OPERATOR_CONTACT", "help@example.org")
    assert sec.user_agents()[0] == "asset-hub help@example.org"


class Answer:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


def test_forbidden_agent_falls_back_and_the_working_one_is_remembered(monkeypatch):
    """서버 진단: 메일을 넣은 쪽이 403, 사이트 주소만 넣은 쪽이 통했다."""
    monkeypatch.setenv("OPERATOR_CONTACT", "help@example.org")
    monkeypatch.setattr(sec, "MIN_INTERVAL", 0)
    monkeypatch.setattr(sec, "_working_agent", None)
    used = []

    def fake_get(url, headers=None, timeout=None):
        used.append(headers["User-Agent"])
        return Answer(403) if "@" in headers["User-Agent"] else Answer(200, {})

    monkeypatch.setattr(sec.requests, "get", fake_get)
    sec._get("https://data.sec.gov/x")
    sec._get("https://data.sec.gov/y")
    assert used == ["asset-hub help@example.org", "asset-hub/1.0 (+https://asset-hub.duckdns.org)",
                    "asset-hub/1.0 (+https://asset-hub.duckdns.org)"]


def test_connection_error_is_a_sec_error(monkeypatch):
    import requests

    monkeypatch.setattr(sec, "MIN_INTERVAL", 0)

    def refuse(*a, **k):
        raise requests.ConnectionError("proxy said no")

    monkeypatch.setattr(sec.requests, "get", refuse)
    with pytest.raises(sec.SecError):
        sec._get("https://data.sec.gov/x")


# --- 저장 · 갱신 -------------------------------------------------------------------

def _quarterly_company() -> dict:
    """2025~2026 분기 EPS·매출 + 자본 — 저장과 요약을 보기 위한 모양."""
    revenue, eps = [], []
    quarters = [("2025-01-01", "2025-03-31", "2025-04-30"), ("2025-04-01", "2025-06-30", "2025-07-30"),
                ("2025-07-01", "2025-09-30", "2025-10-30"), ("2025-10-01", "2025-12-31", "2026-01-30"),
                ("2026-01-01", "2026-03-31", "2026-04-30"), ("2026-04-01", "2026-06-30", "2026-07-30")]
    for i, (start, end, filed) in enumerate(quarters):
        revenue.append(entry(start, end, 100 + i * 10, filed))
        eps.append(entry(start, end, 1.0, filed))
    return facts_json(**{
        "us-gaap__Revenues": {"USD": revenue},
        "us-gaap__EarningsPerShareDiluted": {"USD/shares": eps},
        "us-gaap__NetIncomeLoss": {"USD": [entry(s, e, 25, f) for s, e, f in quarters]},
        "us-gaap__StockholdersEquity": {"USD": [entry(None, "2026-06-30", 400, "2026-07-30")]},
    })


@pytest.fixture
def fake_sec(monkeypatch):
    state = {"data": _quarterly_company(), "calls": 0, "error": None, "splits": []}

    def cik_for(ticker):
        if ticker == "VOO":
            raise sec.NotListed("SEC 목록에 없습니다 — ETF 이거나 미국 상장사가 아닙니다")
        return 1

    def fetch(cik):
        state["calls"] += 1
        if state["error"]:
            raise sec.SecError(state["error"])
        return state["data"]

    monkeypatch.setattr(sec, "cik_for", cik_for)
    monkeypatch.setattr(sec, "fetch_companyfacts", fetch)
    monkeypatch.setattr(fundamentals, "fetch_splits", lambda ticker: state["splits"])
    return state


NOW = dt.datetime(2026, 9, 26, 23, 15)


def test_refresh_saves_facts_once(db_session, fake_sec):
    make_stock(db_session, "ACME")
    first = fundamentals.refresh_ticker(db_session, "ACME", NOW)
    assert first["state"] == "ok" and first["added"] > 0
    again = fundamentals.refresh_ticker(db_session, "ACME", NOW + dt.timedelta(days=7))
    assert again["added"] == 0
    status = db_session.get(FundamentalStatus, "ACME")
    assert status.state == "ok" and status.ok_at == NOW + dt.timedelta(days=7)
    assert "영업이익" in status.message  # 공시에 없는 항목을 알려준다


def test_failure_keeps_what_was_saved(db_session, fake_sec):
    make_stock(db_session, "ACME")
    fundamentals.refresh_ticker(db_session, "ACME", NOW)
    count = db_session.query(FundamentalFact).count()
    fake_sec["error"] = "SEC 재무 HTTP 503"
    result = fundamentals.refresh_ticker(db_session, "ACME", NOW + dt.timedelta(days=8))
    assert result["state"] == "error"
    assert db_session.query(FundamentalFact).count() == count
    status = db_session.get(FundamentalStatus, "ACME")
    assert status.state == "error" and status.ok_at == NOW  # 마지막으로 받은 때는 그대로


def test_etf_and_non_us_are_marked_without_facts(db_session, fake_sec):
    make_stock(db_session, "VOO")
    make_stock(db_session, "379800.KS")
    assert fundamentals.refresh_ticker(db_session, "VOO", NOW)["state"] == "none"
    assert fundamentals.refresh_ticker(db_session, "379800.KS", NOW)["state"] == "unsupported"
    assert fake_sec["calls"] == 0
    assert db_session.query(FundamentalFact).count() == 0


def test_splits_are_saved_once(db_session, fake_sec):
    make_stock(db_session, "ACME")
    fake_sec["splits"] = [(D(2024, 6, 10), 10.0)]
    fundamentals.refresh_ticker(db_session, "ACME", NOW)
    fundamentals.refresh_ticker(db_session, "ACME", NOW + dt.timedelta(days=7))
    assert [(s.date, s.ratio) for s in db_session.query(StockSplit)] == [(D(2024, 6, 10), 10.0)]


def test_split_fetch_failure_does_not_fail_the_refresh(db_session, fake_sec, monkeypatch):
    make_stock(db_session, "ACME")

    def boom(ticker):
        raise RuntimeError("yahoo down")

    monkeypatch.setattr(fundamentals, "fetch_splits", boom)
    assert fundamentals.refresh_ticker(db_session, "ACME", NOW)["state"] == "ok"


def _status(state, checked):
    return FundamentalStatus(ticker="X", state=state, checked_at=checked)


@pytest.mark.parametrize("state, checked_days_ago, latest_end, due", [
    ("ok", 0, D(2026, 6, 30), False),     # 오늘 이미 봤다
    ("ok", 0, D(2026, 5, 31), False),     # 시즌이어도 오늘 이미 봤으면 내일
    ("error", 0, None, False),            # 실패도 하루에 한 번만 다시
    ("ok", 3, D(2026, 6, 30), False),     # 평소 — 7일 안 됐다
    ("ok", 7, D(2026, 6, 30), True),      # 평소 — 7일
    ("ok", 1, D(2026, 5, 31), True),      # 분기 끝 118일 — 다음 공시를 기다리는 중: 매일
    ("ok", 1, D(2025, 12, 31), False),    # 270일 — 공시를 멈춘 회사를 매일 두드리지 않는다
    ("error", 1, None, True),             # 실패했으면 다음 날 다시
    ("none", 3, None, False),             # ETF 는 일주일에 한 번이면 된다
])
def test_when_to_check(state, checked_days_ago, latest_end, due):
    checked = NOW - dt.timedelta(days=checked_days_ago)
    assert fundamentals.is_due(_status(state, checked), latest_end, NOW) is due


def test_never_checked_is_due():
    assert fundamentals.is_due(None, None, NOW)


def test_refresh_due_skips_fresh_and_survives_one_bad_ticker(db_session, fake_sec, monkeypatch):
    make_stock(db_session, "ACME")
    make_stock(db_session, "BOOM")
    original = fundamentals.refresh_ticker

    def flaky(db, ticker, now=None):
        if ticker == "BOOM":
            raise RuntimeError("unexpected")
        return original(db, ticker, now)

    monkeypatch.setattr(fundamentals, "refresh_ticker", flaky)
    results = fundamentals.refresh_due(db_session, ["BOOM", "ACME"], NOW)
    assert [(r["ticker"], r["state"]) for r in results] == [("BOOM", "error"), ("ACME", "ok")]
    # 같은 날 다시 돌면 아무것도 안 한다
    monkeypatch.setattr(fundamentals, "refresh_ticker", original)
    assert [r["ticker"] for r in fundamentals.refresh_due(db_session, ["ACME"], NOW)] == []


def _prices(db, ticker, close=40.0):
    day = D(2026, 1, 2)
    while day <= D(2026, 9, 25):
        if day.weekday() < 5:
            db.add(PriceDaily(ticker=ticker, date=day, open=close, high=close, low=close, close=close, volume=1))
        day += dt.timedelta(days=1)
    db.commit()


def test_summaries_for_cards(db_session, fake_sec):
    make_stock(db_session, "ACME")
    make_stock(db_session, "VOO")
    fundamentals.refresh_ticker(db_session, "ACME", NOW)
    got = fundamentals.summaries(db_session, {"ACME": 40.0, "VOO": 500.0})
    assert got["VOO"] is None
    assert got["ACME"]["per"] == pytest.approx(10.0)       # TTM EPS 4
    assert got["ACME"]["roe"] == pytest.approx(100 / 400 * 100)
    assert got["ACME"]["revenue_yoy"] == pytest.approx((150 / 110 - 1) * 100)
    assert got["ACME"]["period_end"] == D(2026, 6, 30)


# --- API -------------------------------------------------------------------------

def test_api_detail_and_dashboard_line(api, fake_sec):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
        _prices(db, "ACME")
        fundamentals.refresh_ticker(db, "ACME", NOW)

    body = client.get("/api/fundamentals/ACME").json()
    assert body["state"] == "ok" and body["currency"] == "USD"
    metrics = {m["key"]: m for m in body["metrics"]}
    assert metrics["per"]["value"] == pytest.approx(10.0)
    assert metrics["per"]["filed_at"] == "2026-07-30"
    assert metrics["operating_margin"]["value"] is None
    assert [q["period_end"] for q in body["quarters"]][:2] == ["2026-06-30", "2026-03-31"]
    assert body["quarters"][0]["filed_at"] == "2026-07-30"

    card = next(c for c in client.get("/api/dashboard").json() if c["ticker"] == "ACME")
    assert card["fundamentals"]["per"] == pytest.approx(10.0)


def test_api_only_opens_my_stocks(api, fake_sec):
    client, Session = api
    assert client.get("/api/fundamentals/NVDA").status_code == 404


def test_api_before_first_fetch_says_nothing_yet(api, fake_sec):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    body = client.get("/api/fundamentals/ACME").json()
    assert body["state"] is None and body["metrics"] == [] and body["quarters"] == []
    card = next(c for c in client.get("/api/dashboard").json() if c["ticker"] == "ACME")
    assert card["fundamentals"] is None


def test_new_stock_fetches_fundamentals_in_the_background(api, fake_sec, monkeypatch):
    client, Session = api
    ran = []
    monkeypatch.setattr(fundamentals, "RUNNER", lambda work: (ran.append(1), work()))
    response = client.post("/api/stocks", json={"ticker": "ACME", "target_weight_pct": 0})
    assert response.status_code in (200, 201), response.text
    assert ran == [1]
    with Session() as db:
        assert db.get(FundamentalStatus, "ACME").state == "ok"
