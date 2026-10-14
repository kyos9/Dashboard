"""시그널 기준 내 설정 (0.42.0) — `services/my_signals.py`, `PUT/DELETE /api/signal-thresholds`.

- 기본인 사람은 저장된 판정(`signal_daily`) 그대로 — 응답 사진·쿼리 수가 0.41.0 과 같다.
- 바꾼 사람은 읽을 때 그 기준으로 다시 판정한다. **카드·차트 점·알림·리밸런싱(이번 기간 어깨매도)·AI 가 같은 기준**이어야
  한다 — 한 자리만 빠지면 "카드는 매수인데 차트엔 점이 없다"가 된다. 그래서 네 길을 한 테스트에서 시세로부터 따로 센
  답과 맞춘다.
- 사람의 기준은 공용 판정·지문·재계산에 닿지 않는다.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest
from sqlalchemy import select

from app.models import PushState, SignalDaily, UserSettings, UserStock
from app.services import alerts, my_signals, rebalance, signal_recompute, signal_rules
from app.services.data_ingestion import refresh_ticker
from app.services.indicators import compute_indicators
from app.services.trading_calendar import period_trading_bounds
from app.services.signal_rules import Thresholds
from app.services.signals import compute_signals
from tests.factories import make_push_state, make_push_subscription, make_settings, make_stock, new_device
from tests.test_signal_recompute import _prices

# ADX 15 · 비교 3거래일 — 기본(20 · 5일)과 매수·매도가 둘 다 갈린다
MINE = Thresholds(adx_trend=15.0, lookback_days=3)


def _today_ending(prices: pd.DataFrame) -> pd.DataFrame:
    """잘라 낸 시세의 날짜를 오늘까지로 다시 붙인다 (알림은 오늘 판정만 본다)."""
    out = prices.copy()
    out.index = pd.Index(pd.bdate_range(end=dt.date.today(), periods=len(out)).date, name="date")
    return out


# FLIP 은 마지막 날(오늘)에 내 기준으로만 매수가 뜨도록 자른 시세다 (seed 31 의 398행 — 397번째 날)
PRICES = {
    "AAA": _prices(3),
    "BBB": _prices(5),
    "FLIP": _today_ending(_prices(31)[:398]),
}


# 날짜가 정해진 시세 — 리밸런싱의 "이번 기간(분기)"은 달력을 따라 움직여서, 오늘까지인 시세로는 날마다 답이 바뀐다.
# seed 51 은 2026년 2분기에 기본 기준으로는 어깨매도가 없고 내 기준(비교 3거래일)으로는 있다.
QUARTER_END = dt.date(2026, 6, 30)
SELL_IN_Q2 = _prices(51).set_axis(pd.Index(pd.bdate_range(end=QUARTER_END, periods=400).date, name="date"))


@pytest.fixture(autouse=True)
def fresh_cache():
    my_signals.clear_cache()
    yield
    my_signals.clear_cache()


def _expected(ticker: str, t: Thresholds) -> pd.DataFrame:
    """시세에서 바로 — 저장된 지표·판정을 거치지 않는 따로 센 답."""
    return compute_signals(compute_indicators(PRICES[ticker]), t)


@pytest.fixture()
def world(api):
    client, Session = api
    with Session() as db:
        for ticker, prices in PRICES.items():
            make_stock(db, ticker=ticker)
            refresh_ticker(db, ticker, price_df=prices)
        db.commit()
    return client, Session


def _set_mine(Session, t: Thresholds | None) -> None:
    with Session() as db:
        settings = db.get(UserSettings, 1) or make_settings(db, user_id=1)
        settings.signal_thresholds = None if t is None else t.as_dict()
        db.commit()


def test_the_data_really_differs_between_default_and_mine():
    """아래 테스트들이 헛돌지 않게 — 두 기준의 답이 정말 갈린다."""
    for column in ("knee_buy_v2", "shoulder_sell_ref"):
        assert any(
            (_expected(t, MINE)[column] != _expected(t, signal_rules.DEFAULT)[column]).any() for t in PRICES
        ), column
    flip_default, flip_mine = _expected("FLIP", signal_rules.DEFAULT), _expected("FLIP", MINE)
    assert (bool(flip_default["knee_buy_v2"].iloc[-1]), bool(flip_mine["knee_buy_v2"].iloc[-1])) == (False, True)


def test_judging_with_the_default_values_reproduces_every_stored_signal(world):
    """읽을 때 계산하는 길을 기본값으로 **강제로** 타면 저장된 판정 전체와 같아야 한다 (빈 값·판정 불가 접기까지)."""
    _, Session = world
    with Session() as db:
        forced = my_signals.Source(db, signal_rules.DEFAULT)
        forced.custom = True
        for ticker in PRICES:
            stored = {
                d: (bool(b), bool(s))
                for d, b, s in db.execute(
                    select(SignalDaily.date, SignalDaily.knee_buy_v2, SignalDaily.shoulder_sell_ref)
                    .where(SignalDaily.ticker == ticker)
                )
            }
            judged = my_signals.judge(db, [ticker], signal_rules.DEFAULT)[ticker]
            assert dict(zip(judged.dates, zip(map(bool, judged.buy), map(bool, judged.sell)))) == stored
        default = my_signals.Source(db)
        tickers = list(PRICES)
        assert forced.last_buy_dates(tickers) == default.last_buy_dates(tickers)
        assert forced.markers("AAA", None) == default.markers("AAA", None)
        since = dt.date.today() - dt.timedelta(days=200)
        assert sorted(forced.sell_days(tickers, since)) == sorted(default.sell_days(tickers, since))
        assert forced.buy_count_after("BBB", since) == default.buy_count_after("BBB", since)


# 값 **하나만** 바꾼 사람도 — 기본인지 가르는 것이 한 값만 보면 나머지 셋을 바꾼 사람이 공용 판정을 본다(A 검토 R6).
# 비교 기간 10 은 카드가 읽는 지표 행 수(공용 5+1)를 넘는다(R2). 셋 다 이 시세에서 기본과 판정이 갈린다.
ONE_VALUE = [
    Thresholds(lookback_days=10),
    Thresholds(vol_ratio_expand=0.8),
    Thresholds(disparity_below=-2.0),
]


@pytest.mark.parametrize("mine", [MINE, *ONE_VALUE], ids=["adx15-lookback3", "lookback10", "vol0.8", "disparity-2"])
def test_all_four_paths_follow_my_thresholds(world, mine):
    """카드·차트 점·알림·리밸런싱이 모두 내 기준 — 시세에서 따로 센 답과 같다."""
    client, Session = world
    _set_mine(Session, mine)

    cards = {c["ticker"]: c for c in client.get("/api/dashboard").json()}
    for ticker in PRICES:
        exp = _expected(ticker, mine)
        card = cards[ticker]
        assert card["knee_buy_v2"] is bool(exp["knee_buy_v2"].iloc[-1]), ticker
        assert card["shoulder_sell_ref"] is bool(exp["shoulder_sell_ref"].iloc[-1]), ticker
        buys = exp.index[exp["knee_buy_v2"]]
        assert card["last_buy_signal_date"] == (buys.max().isoformat() if len(buys) else None), ticker
        assert card["buy_conditions"] == signal_rules.latest_conditions(
            signal_rules.build_rules(mine)[0], compute_indicators(PRICES[ticker])
        ), ticker

        markers = client.get(f"/api/history/{ticker}", params={"range": "max"}).json()["markers"]
        got = {(m["date"], m["kind"]) for m in markers}
        want = {(d.isoformat(), "buy") for d in exp.index[exp["knee_buy_v2"]]}
        want |= {(d.isoformat(), "sell") for d in exp.index[exp["shoulder_sell_ref"]]}
        assert got == want, ticker

    with Session() as db:
        values = alerts.current_values(db, 1)
        today = dt.date.today().isoformat()
        for ticker in PRICES:
            on = bool(_expected(ticker, mine)["knee_buy_v2"].iloc[-1])
            assert (values[f"buy:{ticker}"][0] == today) is on, ticker
        if mine == MINE:
            assert values["buy:FLIP"][0] == today  # 기본 기준이면 오늘 매수가 아니다
        stocks = db.query(UserStock).filter_by(user_id=1).all()
        for stock in stocks:
            exp = _expected(stock.ticker, mine)
            start, end = period_trading_bounds(exp.index[-1], "quarterly", "US")
            want = any(start <= d <= end for d in exp.index[exp["shoulder_sell_ref"]])
            got = rebalance.shoulder_fired_in_current_period(db, stock, exp.index[-1])
            assert got is want, stock.ticker


def test_this_periods_shoulder_follows_my_thresholds(api):
    """리밸런싱 "이번 기간 어깨매도"가 내 기준 — 기본으로는 없고 내 기준으로는 있는 분기에서."""
    client, Session = api
    with Session() as db:
        make_stock(db, ticker="SELL")
        refresh_ticker(db, "SELL", price_df=SELL_IN_Q2)
        db.commit()
        stock = db.query(UserStock).filter_by(user_id=1, ticker="SELL").one()
        assert rebalance.shoulder_fired_in_current_period(db, stock, QUARTER_END) is False
    _set_mine(Session, MINE)
    with Session() as db:
        stock = db.query(UserStock).filter_by(user_id=1, ticker="SELL").one()
        assert rebalance.shoulder_fired_in_current_period(db, stock, QUARTER_END) is True


def test_judging_many_tickers_together_is_the_same_as_one_by_one(world):
    """종목을 표 하나로 이어 판정할 때 "N거래일 전"이 앞 종목의 행을 읽지 않는다 — 비교 기간이 지표가 채워지는 기간(20일)
    보다 길 때 드러난다."""
    _, Session = world
    t = Thresholds(lookback_days=20)
    with Session() as db:
        together = my_signals.judge(db, list(PRICES), t)
        my_signals.clear_cache()
        for ticker in PRICES:
            alone = my_signals.judge(db, [ticker], t)[ticker]
            assert (together[ticker].buy == alone.buy).all() and (together[ticker].sell == alone.sell).all(), ticker
            exp = _expected(ticker, t)
            assert (alone.buy == exp["knee_buy_v2"].to_numpy(dtype=bool)).all(), ticker


def test_default_people_still_read_the_stored_signals(world):
    client, Session = world
    cards = {c["ticker"]: c for c in client.get("/api/dashboard").json()}
    assert cards["FLIP"]["knee_buy_v2"] is False
    assert cards["FLIP"]["signal_rules_version"] == signal_rules.fingerprint()
    with Session() as db:
        assert my_signals.Source(db).custom is False


def test_my_rules_text_and_version(world):
    client, Session = world
    plain = client.get("/api/signal-rules").json()
    assert (plain["custom"], plain["version"]) == (False, signal_rules.fingerprint())
    assert plain["defaults"] == plain["thresholds"] == signal_rules.thresholds()

    res = client.put("/api/signal-thresholds", json={"adx_trend": 15, "lookback_days": 3})
    assert res.status_code == 200, res.text
    mine = res.json()
    assert mine["custom"] is True
    assert mine["thresholds"] == {**signal_rules.thresholds(), "adx_trend": 15.0, "lookback_days": 3}
    labels = [c["label"] for c in mine["rules"][0]["conditions"]]
    assert "ADX > 15" in labels
    assert any("3거래일 전" in c["detail"] for c in mine["rules"][1]["conditions"])
    # 저장 응답의 판 = 카드의 판 = 다시 받은 규칙의 판 (어긋나면 화면이 그릴 때마다 다시 받는다)
    cards = client.get("/api/dashboard").json()
    assert {c["signal_rules_version"] for c in cards} == {mine["version"]}
    assert client.get("/api/signal-rules").json()["version"] == mine["version"] != plain["version"]

    # 기본값과 같은 값만 넣으면 저장하지 않는다(NULL) — 기본인 사람과 같다
    assert client.put("/api/signal-thresholds", json=signal_rules.thresholds()).json()["custom"] is False
    with Session() as db:
        assert db.get(UserSettings, 1).signal_thresholds is None

    client.put("/api/signal-thresholds", json={"adx_trend": 30})
    back = client.delete("/api/signal-thresholds").json()
    assert back == plain


@pytest.mark.parametrize(
    "body",
    [
        {"adx_trend": 9.5},  # 범위 밖
        {"adx_trend": 40.5},
        {"adx_trend": 20.3},  # 0.5 단위가 아니다 — 반올림하지 않는다
        {"vol_ratio_expand": 1.12},
        {"disparity_below": 1},  # 0 보다 크면 "MA20 아래"의 뜻이 바뀐다
        {"lookback_days": 0},
        {"lookback_days": 21},
        {"lookback_days": 2.5},  # 거래일은 정수
        {"lookback_days": True},  # 참거짓이 1일로 바뀌지 않게
        {"adx_trend": "25"},
        {"adx_trend": [25]},
        {"something": 1},  # 모르는 키
    ],
)
def test_bad_thresholds_are_refused(api, body):
    client, Session = api
    assert client.put("/api/signal-thresholds", json=body).status_code == 422
    with Session() as db:
        settings = db.get(UserSettings, 1)
        assert settings is None or settings.signal_thresholds is None


def test_non_finite_numbers_are_refused(api):
    client, _ = api
    for raw in ('{"adx_trend": NaN}', '{"adx_trend": Infinity}'):
        res = client.put("/api/signal-thresholds", content=raw, headers={"content-type": "application/json"})
        assert res.status_code == 422, raw


def test_whole_number_days_sent_as_float_are_kept_as_days(api):
    client, Session = api
    assert client.put("/api/signal-thresholds", json={"lookback_days": 3.0}).status_code == 200
    with Session() as db:
        assert db.get(UserSettings, 1).signal_thresholds == {"lookback_days": 3}


def _stored_counts(db) -> tuple[int, int, int]:
    return (
        db.query(SignalDaily).count(),
        db.query(SignalDaily).filter(SignalDaily.knee_buy_v2.is_(True)).count(),
        db.query(SignalDaily).filter(SignalDaily.shoulder_sell_ref.is_(True)).count(),
    )


def test_my_thresholds_never_touch_the_shared_definition(world):
    """사람의 기준은 공용 판정·지문·재계산에 닿지 않는다."""
    client, Session = world
    with Session() as db:
        signal_recompute.run_if_changed(db)  # 처음 켠 것처럼 지문을 적어 둔다
        before = _stored_counts(db)
    fingerprint = signal_rules.fingerprint()
    assert client.put("/api/signal-thresholds", json={"adx_trend": 15, "lookback_days": 3}).status_code == 200
    client.get("/api/dashboard")
    assert signal_rules.fingerprint() == fingerprint
    with Session() as db:
        assert signal_recompute.needs_recompute(db) is False
        assert _stored_counts(db) == before


def test_changing_thresholds_records_buy_state_without_alerting(world):
    """기준을 낮춰 오늘 매수가 새로 켜져도, 바꾼 순간의 상태는 알림 없이 적고 그 뒤 새로 켜지는 것부터 알린다 (주인 결정)."""
    client, Session = world
    with Session() as db:
        make_push_subscription(db, new_device(), user_id=1)
        make_push_state(db, "buy:AAA", "2020-01-01", user_id=1)  # 다른 종목 상태는 그대로 둔다
        assert "buy:FLIP" not in {s for s, _, _ in alerts.pending_changes(db, 1, alerts.current_values(db, 1))}

    assert client.put("/api/signal-thresholds", json={"adx_trend": 15, "lookback_days": 3}).status_code == 200
    with Session() as db:
        assert db.get(PushState, (1, "buy:FLIP")).value == dt.date.today().isoformat()
        fired = alerts.pending_changes(db, 1, alerts.current_values(db, 1))
        assert "buy:FLIP" not in {s for s, _, _ in fired}


def test_people_without_alerts_get_no_push_state(world):
    client, Session = world
    client.put("/api/signal-thresholds", json={"adx_trend": 15, "lookback_days": 3})
    with Session() as db:
        assert db.query(PushState).count() == 0


def test_judged_history_is_shared_from_memory_until_prices_change(world):
    _, Session = world
    with Session() as db:
        first = my_signals.judge(db, ["AAA"], MINE)["AAA"]
        again = my_signals.judge(db, ["AAA"], MINE)["AAA"]
        assert again is first
        # 시세가 하루 늘면(마지막 지표 날짜·행 수가 바뀌면) 새로 센다
        refresh_ticker(db, "AAA", price_df=_today_ending(_prices(3, 401)))
        db.commit()
        assert my_signals.judge(db, ["AAA"], MINE)["AAA"] is not first


def test_memory_has_a_size_limit(world, monkeypatch):
    _, Session = world
    monkeypatch.setattr(my_signals, "CACHE_SIZE", 2)
    with Session() as db:
        for adx in (15.0, 16.0, 17.0):
            my_signals.judge(db, ["AAA"], Thresholds(adx_trend=adx))
    assert len(my_signals._cache) == 2


def test_stored_values_out_of_range_fall_back_to_default():
    t = Thresholds.from_stored({"adx_trend": 999, "lookback_days": 3, "x": 1, "vol_ratio_expand": True})
    assert t == Thresholds(lookback_days=3)
    assert Thresholds.from_stored(None) is signal_rules.DEFAULT


def test_ai_sees_my_thresholds_in_all_three_jobs(world):
    """AI 분석·전체 정리·진단 모두 내 기준 — 규칙 설명도 판정도 (주인 결정). 새로 가는 것은 기준 숫자뿐."""
    from app.services import ai_analysis, ai_portfolio
    from tests.factories import make_holding

    client, Session = world
    with Session() as db:
        make_holding(db, "FLIP", 10)
        stock = db.query(UserStock).filter_by(user_id=1, ticker="FLIP").one()
        default_prompts = [
            ai_analysis.stock_job(db, stock, None).prompt,
            ai_analysis.watchlist_job(db, 1, None).prompt,
            ai_portfolio.portfolio_job(db, 1, None).prompt,
        ]
    for prompt in default_prompts:
        assert ai_analysis.SIGNAL_RULES in prompt

    _set_mine(Session, MINE)
    with Session() as db:
        stock = db.query(UserStock).filter_by(user_id=1, ticker="FLIP").one()
        prompts = [
            ai_analysis.stock_job(db, stock, None).prompt,
            ai_analysis.watchlist_job(db, 1, None).prompt,
            ai_portfolio.portfolio_job(db, 1, None).prompt,
        ]
    mine_rules = signal_rules.ai_rules_text(MINE)
    for prompt in prompts:
        assert mine_rules in prompt and ai_analysis.SIGNAL_RULES not in prompt
        assert "ADX > 15" in prompt
    stock_prompt, watch_prompt, portfolio_prompt = prompts
    # 판정도 내 기준 — 오늘 FLIP 매수 (기본이면 아니오)
    assert ": 매수 시그널 충족" in stock_prompt and ": 매수 시그널 미충족" in default_prompts[0]
    assert "ADX > 3거래일 전" not in stock_prompt  # 규칙 글귀가 아니라 지표 줄의 N 을 본다
    assert "3거래일 전" in stock_prompt
    assert "① -DI>+DI" in stock_prompt and "ADX>15" in stock_prompt
    assert "FLIP" in watch_prompt
    assert "오늘 매수 시그널 충족" in portfolio_prompt and "오늘 매수 시그널 미충족" in default_prompts[2]


def test_cards_tell_my_people_what_the_default_would_say(world):
    client, Session = world
    plain = {c["ticker"]: c for c in client.get("/api/dashboard").json()}
    assert {c["knee_buy_v2_default"] for c in plain.values()} == {None}
    _set_mine(Session, MINE)
    mine = {c["ticker"]: c for c in client.get("/api/dashboard").json()}
    assert (mine["FLIP"]["knee_buy_v2"], mine["FLIP"]["knee_buy_v2_default"]) == (True, False)
    for ticker, card in mine.items():
        assert card["knee_buy_v2_default"] is plain[ticker]["knee_buy_v2"]


def test_a_stock_without_my_name_shows_the_shared_name(api):
    """B9 — 내가 이름을 비워 둔 종목은 공용 종목명으로 (0.41.0 사용자 확인: 지인 카드에 "7203.T" 만). 알림과 같은 규칙."""
    from app.models import Instrument

    client, Session = api
    with Session() as db:
        make_stock(db, ticker="7203.T", name=None)
        db.get(Instrument, "7203.T").name = "トヨタ自動車"
        make_stock(db, ticker="005930.KS", name="내 삼성")
        make_stock(db, ticker="000660.KS", name="   ")  # 공백뿐인 이름도 비운 것으로 본다
        db.get(Instrument, "000660.KS").name = "SK하이닉스"
        db.commit()
    names = {c["ticker"]: c["name"] for c in client.get("/api/dashboard").json()}
    assert names == {"7203.T": "トヨタ自動車", "005930.KS": "내 삼성", "000660.KS": "SK하이닉스"}
    rows = {r["ticker"]: r["name"] for r in client.get("/api/rebalance/current").json()["rows"]}
    assert rows["7203.T"] == "トヨタ自動車"
    assert client.get("/api/fundamentals/7203.T").json()["name"] == "トヨタ自動車"
    listed = {r["ticker"]: r["name"] for r in client.get("/api/fundamentals").json()}
    assert listed["7203.T"] == "トヨタ自動車"


def test_the_stock_list_also_carries_the_shown_name(api):
    """B9 — 종목 목록(`/api/stocks`)도 보일 이름을 준다. 고치는 칸의 값(`name`)은 내가 적은 그대로(비어 있으면 비어 있다)."""
    from app.models import Instrument

    client, Session = api
    with Session() as db:
        make_stock(db, ticker="7203.T", name=None)
        db.get(Instrument, "7203.T").name = "トヨタ自動車"
        db.commit()
    got = {s["ticker"]: s for s in client.get("/api/stocks").json()}
    assert (got["7203.T"]["name"], got["7203.T"]["shown_name"]) == (None, "トヨタ自動車")


def test_every_single_value_gives_its_own_version(world):
    """판(`version`)이 값마다 다르다 — 한 값만 넣으면 그 값만 바꾼 다른 기기 화면이 규칙을 다시 받지 않는다 (A 검토 R4)."""
    versions = {signal_rules.rules_version(t) for t in [signal_rules.DEFAULT, MINE, *ONE_VALUE, Thresholds(adx_trend=15.0)]}
    assert len(versions) == 6
    assert signal_rules.rules_version(signal_rules.DEFAULT) == signal_rules.fingerprint()


def test_chart_markers_keep_to_the_chosen_range(world):
    """`range=1y` 차트에는 1년 안의 점만 — 내 기준도 기간을 지킨다 (A 검토 R5)."""
    client, Session = world
    _set_mine(Session, MINE)
    cutoff = dt.date.today() - dt.timedelta(days=365)
    for ticker in PRICES:
        exp = _expected(ticker, MINE)
        markers = client.get(f"/api/history/{ticker}", params={"range": "1y"}).json()["markers"]
        got = {(m["date"], m["kind"]) for m in markers}
        want = {(d.isoformat(), "buy") for d in exp.index[exp["knee_buy_v2"]] if d >= cutoff}
        want |= {(d.isoformat(), "sell") for d in exp.index[exp["shoulder_sell_ref"]] if d >= cutoff}
        assert got == want, ticker
        assert want, ticker  # 1년 안에도 점이 있어야 이 테스트가 헛돌지 않는다
        everything = client.get(f"/api/history/{ticker}", params={"range": "max"}).json()["markers"]
        assert len(everything) > len(markers), ticker


def test_ai_names_my_lookback_and_reads_that_many_days_back(world):
    """AI 지표 줄의 "N거래일 전"은 내 N 이고, 그 값도 N 거래일 전의 것 (A 검토 R3·R7)."""
    from app.services import ai_analysis

    _, Session = world
    mine = Thresholds(lookback_days=10)
    _set_mine(Session, mine)
    ind = compute_indicators(PRICES["FLIP"])
    ago = ind.iloc[-11]
    with Session() as db:
        stock = db.query(UserStock).filter_by(user_id=1, ticker="FLIP").one()
        prompt = ai_analysis.stock_job(db, stock, None).prompt
    assert f"(10거래일 전 {ai_analysis._num(ago['adx'], 1)})" in prompt
    assert f"(10거래일 전 {ai_analysis._num(ago['stddev20'], 2)})" in prompt
    # 공용 5거래일 전 값과 정말 다르다 — 같으면 이 테스트가 헛돈다
    assert ai_analysis._num(ind.iloc[-6]["adx"], 1) != ai_analysis._num(ago["adx"], 1)
    assert "5거래일 전" not in prompt


def test_huge_whole_numbers_are_refused_not_crashed(api):
    """10**400 은 float 로 못 바꾼다 — 500 이 아니라 422 (A 검토)."""
    client, _ = api
    for raw in ('{"adx_trend": 1' + "0" * 400 + "}", '{"adx_trend": -1' + "0" * 400 + "}", '{"lookback_days": 1' + "0" * 400 + "}"):
        res = client.put("/api/signal-thresholds", content=raw, headers={"content-type": "application/json"})
        assert res.status_code == 422, res.text[:200]


def test_memory_notices_values_fixed_on_the_same_day(world):
    """갱신은 이미 있는 날의 지표를 그 자리에서 고치기도 한다 — 날짜·행 수가 같아도 새로 센다 (A 검토)."""
    from app.models import IndicatorDaily

    _, Session = world
    with Session() as db:
        first = my_signals.judge(db, ["FLIP"], MINE)["FLIP"]
        assert first.last().knee_buy_v2 is True
        last = db.query(IndicatorDaily).filter_by(ticker="FLIP").order_by(IndicatorDaily.date.desc()).first()
        last.adx = 1.0  # 추세 없음 — 내 기준(ADX > 15)으로도 매수가 아니다
        db.commit()
        again = my_signals.judge(db, ["FLIP"], MINE)["FLIP"]
        assert again is not first
        assert again.last().knee_buy_v2 is False


def test_card_conditions_read_my_lookback_days_back(api):
    """비교 기간이 공용(5)보다 길면 카드는 그만큼 지표 행을 더 읽어야 한다 — 모자라면 "변동성 축소"가 판정 불가로
    빠져 조건 ✓ 가 매수 판정과 어긋난다 (A 검토 R2). seed 3 의 300행은 마지막 날 10거래일 비교로만 ✓ 다."""
    client, Session = api
    prices = _today_ending(_prices(3)[:300])
    mine = Thresholds(lookback_days=10)
    with Session() as db:
        make_stock(db, ticker="SQZ")
        refresh_ticker(db, "SQZ", price_df=prices)
        db.commit()
    _set_mine(Session, mine)
    ind = compute_indicators(prices)
    buy = signal_rules.build_rules(mine)[0]
    want = signal_rules.latest_conditions(buy, ind)
    assert want["volatility_or_volume"] is True
    assert signal_rules.latest_conditions(buy, ind.iloc[-6:])["volatility_or_volume"] is not True  # 헛돌지 않게
    card = client.get("/api/dashboard").json()[0]
    assert card["buy_conditions"] == want
