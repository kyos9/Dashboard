"""시그널 규칙을 한 곳으로 (0.41.0) — 모은 뒤에도 판정·글이 그대로인지, 바꾸면 다 따라오는지.

`signal_rules.py` 가 정의를 갖고 계산·화면·AI 가 모두 거기서 가져온다. 여기서 보는 것:

1. **그대로** — 0.40.0 의 계산식(아래에 옛 코드를 그대로 옮겨 두었다)과 판정이 같고, AI 에 가는 글이
   글자 하나까지 같고, 화면이 옛 서버용으로 들고 있는 규칙(`signalRulesLegacy.json`)과 같다.
2. **따라온다** — 기준값 하나를 바꾸면(ADX 20→25) 판정·화면 문구·AI 글·지문이 함께 바뀐다.
3. **흩어지지 않는다** — 계산·AI 코드에 기준값이 다시 적히지 않는다.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.models import IndicatorDaily
from app.services import signal_rules
from app.services.indicators import compute_indicators
from app.services.signal_rules import BUY, SELL, any_of
from app.services.signals import buy_conditions, buy_conditions_many, compute_signals, knee_conditions

REPO = Path(__file__).resolve().parents[2]
RULES_SOURCE = REPO / "backend" / "app" / "services" / "signal_rules.py"
LEGACY = REPO / "frontend" / "src" / "lib" / "signalRulesLegacy.json"


# ---------- 0.40.0 의 계산식 (옮겨 둔 것 — 고치지 않는다) ----------

def _old_compute(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    stddev20_prev5 = out["stddev20"].shift(5)
    adx_prev5 = out["adx"].shift(5)
    di_weak = out["minus_di"] > out["plus_di"]
    disparity_cond = out["disparity"] < 0
    vol_or_volatility_cond = (out["stddev20"] < stddev20_prev5) | (out["vol_ratio"] > 1.1)
    trend_filter = out["adx"] > 20
    out["knee_buy_v2"] = (di_weak & disparity_cond & vol_or_volatility_cond & trend_filter).fillna(False)
    high_position = out["close"] > out["ma50"]
    adx_rising = out["adx"] > adx_prev5
    volume_strong = out["vol_ma5"] > out["vol_ma20"]
    out["shoulder_sell_ref"] = (high_position & adx_rising & volume_strong).fillna(False)
    return out


OLD_SIGNAL_RULES = """\
[시그널 규칙 — 사용자가 이 앱에서 쓰는 기계적 조건]
- 매수 시그널(무릎매수 v2): 네 조건이 모두 참인 날. ① -DI > +DI ② 이격도(종가÷MA20−1) < 0
  ③ 20일 표준편차가 5거래일 전보다 작거나, 거래량비(5일÷20일 평균) > 1.1 ④ ADX > 20.
  떨어지는 중에 적립식으로 사는 날을 고르는 보조 규칙이다. 기간 안에 안 뜨면 기간 마지막 날 산다.
- 매도 참고 시그널(어깨): 종가 > MA50, ADX 가 5거래일 전보다 큼, 5일 평균 거래량 > 20일 평균.
  참고용이며 매도는 정해 둔 리뷰일에만 한다."""


def _prices(n: int, seed: int, holes: bool = False) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.018, n)))
    spread = np.abs(rng.normal(0, 0.01, n)) + 0.002
    volume = rng.lognormal(14, 0.4, n)
    if holes:  # 거래량이 빈 날 — 지표에 결측이 생긴다
        volume[rng.choice(n, size=n // 15, replace=False)] = np.nan
    dates = pd.bdate_range(end=dt.date.today(), periods=n).date
    return pd.DataFrame(
        {"open": close, "high": close * (1 + spread), "low": close * (1 - spread), "close": close, "volume": volume},
        index=pd.Index(dates, name="date"),
    )


# ---------- 1. 그대로 ----------

@pytest.mark.parametrize("seed,holes", [(1, False), (7, False), (11, True), (23, True)])
def test_stored_signals_equal_the_old_formula(seed, holes):
    ind = compute_indicators(_prices(500, seed, holes))
    new, old = compute_signals(ind), _old_compute(ind)
    for column in ("knee_buy_v2", "shoulder_sell_ref"):
        assert new[column].astype(bool).tolist() == old[column].astype(bool).tolist(), column
    assert 0 < int(new["knee_buy_v2"].sum()) < len(new)
    assert 0 < int(new["shoulder_sell_ref"].sum()) < len(new)


def _orm_desc(ind: pd.DataFrame) -> list[IndicatorDaily]:
    fields = ("stddev20", "vol_ratio", "disparity", "plus_di", "minus_di", "adx", "ma50", "vol_ma5", "vol_ma20")
    rows = [
        IndicatorDaily(ticker="T", date=d, **{f: None if pd.isna(r[f]) else float(r[f]) for f in fields})
        for d, r in ind.iterrows()
    ]
    return list(reversed(rows))


@pytest.mark.parametrize("seed,holes", [(3, False), (5, True)])
def test_today_conditions_agree_with_stored_signal_every_day(seed, holes):
    """오늘 한 줄(화면) == 표 전체 계산(저장) — 결측이 있는 날, 앞쪽 6행 미만까지."""
    ind = compute_indicators(_prices(300, seed, holes))
    stored = compute_signals(ind)
    desc = _orm_desc(ind)
    for i in range(len(desc)):
        window = desc[i : i + 6]
        met = buy_conditions(window)
        assert all(v is True for v in met.values()) == bool(stored.loc[window[0].date, "knee_buy_v2"])
        # 옛 모양(두 행만 받는 쪽)도 같은 답
        five = window[5] if len(window) > 5 else None
        old_shape = knee_conditions(window[0], five).model_dump()
        assert old_shape == {k: met[k] for k in old_shape}, window[0].date


def test_many_tickers_at_once_equal_one_by_one():
    """대시보드는 종목을 한 번에 평가한다 — 행 수가 제각각(0·1·3·6행)이어도 종목마다 부른 답과 같다."""
    recent = {}
    for seed in range(12):
        desc = _orm_desc(compute_indicators(_prices(80, seed, holes=seed % 3 == 0)))
        recent[f"T{seed}"] = desc[seed % 7 : seed % 7 + [0, 1, 3, 6, 6, 6][seed % 6]]
    many = buy_conditions_many(recent)
    assert many == {t: buy_conditions(rows) for t, rows in recent.items()}
    # 판정 불가가 섞인 종목과 다 판정된 종목이 둘 다 있었다 (한쪽만이면 시험이 아니다)
    assert any(None in m.values() for m in many.values())
    assert any(None not in m.values() for m in many.values())


def test_few_rows_make_the_lookback_unknown_not_false():
    row = IndicatorDaily(ticker="T", date=dt.date.today(), stddev20=2.0, vol_ratio=None, adx=25.0,
                         disparity=-1.0, plus_di=10.0, minus_di=20.0)
    met = buy_conditions([row])  # 5거래일 전이 없다
    assert met["volatility_or_volume"] is None
    assert met["adx_trending"] is True
    assert buy_conditions([]) == {c.key: None for c in BUY.conditions}


@pytest.mark.parametrize(
    "a,b,expected",
    [
        (True, None, True), (None, True, True), (True, False, True),
        (False, False, False), (False, None, False), (None, False, False),  # Kleene 이면 NA — 여기선 거짓
        (None, None, None),
    ],
)
def test_or_group_keeps_the_040_meaning(a, b, expected):
    s = lambda v: pd.Series([pd.NA if v is None else v], dtype="boolean")  # noqa: E731
    got = any_of(s(a), s(b)).iloc[0]
    assert (None if pd.isna(got) else bool(got)) == expected


def test_ai_text_is_unchanged_to_the_letter():
    from app.services import ai_analysis

    assert signal_rules.ai_rules_text() == OLD_SIGNAL_RULES
    assert ai_analysis.SIGNAL_RULES == OLD_SIGNAL_RULES
    yes = lambda v: {True: "예", False: "아니오", None: "판정 불가"}[v]  # noqa: E731
    cond = {"di_bearish": True, "disparity_negative": False, "volatility_or_volume": None, "adx_trending": True}
    assert signal_rules.ai_condition_line(cond, yes) == (
        "- 매수 시그널 조건별: ① -DI>+DI 예, ② 이격도<0 아니오, "
        "③ 변동성 축소 또는 거래량 증가 판정 불가, ④ ADX>20 예"
    )
    assert signal_rules.buy_count_phrase() == "네 조건"
    assert "오늘 매수 시그널이 뜬 종목, 네 조건 중 몇 개가 충족된 상태인지" in ai_analysis.WATCHLIST_PROMPT


def test_screen_fallback_is_what_this_server_sends():
    """화면이 옛 서버(규칙 API 없음)일 때 쓰는 규칙 = 0.40.0 의 정의 = 지금 서버가 내려주는 것.

    정의를 바꾸면 지문이 달라지고 이 비교는 건너뛴다 — 그 파일은 0.40.0 서버를 위한 것이라 고치지 않는다.
    """
    legacy = json.loads(LEGACY.read_text(encoding="utf-8"))
    now = signal_rules.payload()
    if now["version"] != legacy["version"]:
        pytest.skip("정의가 바뀌었다 — 옛 서버용 규칙은 그대로 둔다")
    for key in ("version", "thresholds", "rules"):
        assert now[key] == legacy[key], key


def test_change_history_words_stay_inside_the_regulatory_line():
    """이력의 `what` 은 신호 요약에 그대로 보인다 — 권유·예측·수익률로 읽히는 말을 쓰지 않는다 (ROADMAP 3절)."""
    banned = ("추천", "사세요", "팔라", "팔아", "파세요", "저평가", "고평가", "예측", "수익률", "수익")
    for change in signal_rules.CHANGES:
        text = f"{change['what']} {change['why']}"
        assert not [w for w in banned if w in text], change


def test_no_change_notice_while_only_the_first_definition_exists():
    assert signal_rules.changed_on() is None
    assert signal_rules.change_notice() is None
    assert signal_rules.payload()["change_notice"] is None


# ---------- 2. 따라온다 ----------

def _load_rules(replace: dict[str, str]):
    """`signal_rules.py` 의 글을 바꿔 새 모듈로 읽는다 (원래 모듈은 건드리지 않는다)."""
    source = RULES_SOURCE.read_text(encoding="utf-8")
    for old, new in replace.items():
        assert old in source, old
        source = source.replace(old, new)
    spec = importlib.util.spec_from_loader("signal_rules_variant", loader=None)
    module = importlib.util.module_from_spec(spec)
    sys.modules["signal_rules_variant"] = module  # dataclass 가 모듈을 찾는다
    try:
        exec(compile(source, str(RULES_SOURCE), "exec"), module.__dict__)
    finally:
        sys.modules.pop("signal_rules_variant", None)
    return module


def test_changing_one_threshold_changes_everything_that_shows_it():
    m = _load_rules({"ADX_TREND = 20.0": "ADX_TREND = 25.0"})
    adx = next(c for c in m.BUY.conditions if c.key == "adx_trending")
    assert (adx.label, adx.header, adx.formula) == ("ADX > 25", "> 25", "ADX > 25")
    assert "④ ADX > 25." in m.ai_rules_text()
    assert m.payload()["thresholds"]["adx_trend"] == 25.0
    assert m.fingerprint() != signal_rules.fingerprint()
    # 판정도 — ADX 22 는 옛 기준(20)으론 추세, 새 기준(25)으론 아니다
    df = pd.DataFrame({"adx": [22.0]})
    assert bool(adx.evaluate(df).iloc[0]) is False
    assert bool(next(c for c in BUY.conditions if c.key == "adx_trending").evaluate(df).iloc[0]) is True


def test_adding_a_condition_changes_the_count_words():
    m = _load_rules({"VERSION = \"knee-v2.shoulder-ref\"": "VERSION = \"knee-v3\""})
    extra = m.Condition(key="x", metric="other", label="x", detail="x", header="x", formula="x",
                        ai_short="x", ai_long="x", evaluate=lambda df: pd.Series(True, index=df.index, dtype="boolean"))
    m.BUY = m.Rule(key="buy", column="knee_buy_v2", name="매수 시그널", spec_name="무릎매수 v3",
                   conditions=(*m.BUY.conditions, extra))
    assert m.buy_count_phrase() == "다섯 조건"
    assert "다섯 조건이 모두 참인 날" in m.ai_rules_text()


def test_fingerprint_ignores_wording_but_not_logic_or_version():
    same = _load_rules({'label="DI 약세"': 'label="DI 약세(하락 우위)"'})
    assert same.fingerprint() == signal_rules.fingerprint()
    bumped = _load_rules({'VERSION = "knee-v2.shoulder-ref"': 'VERSION = "knee-v2.1"'})
    assert bumped.fingerprint() != signal_rules.fingerprint()
    indicators = _load_rules({'INDICATOR_VERSION = "1"': 'INDICATOR_VERSION = "2"'})
    assert indicators.fingerprint() != signal_rules.fingerprint()


def test_change_notice_shows_for_thirty_days_after_a_change():
    m = _load_rules({})
    m.CHANGES = [*m.CHANGES, {"date": "2026-11-02", "what": "ADX 25", "why": "시험"}]
    assert m.changed_on() == "2026-11-02"
    assert m.change_notice(dt.date(2026, 11, 2)) == "시그널 계산 방식이 2026-11-02에 바뀌었습니다 — ADX 25"
    assert m.change_notice(dt.date(2026, 12, 1)) is not None  # 29일 뒤
    assert m.change_notice(dt.date(2026, 12, 2)) is None  # 30일 뒤
    assert m.change_notice(dt.date(2026, 11, 1)) is None  # 바꾸기 전 날


# ---------- 3. 흩어지지 않는다 ----------

SCATTERED = (
    "> 20", "&gt; 20", "> 1.1", ">1.1", "&gt; 1.1", "이격도 < 0", "이격도<0", "이격도 &lt; 0",
    "shift(5)", "네 조건", "ADX>20", "조건 4개",
)
WATCHED = (
    "backend/app/services/signals.py",
    "backend/app/services/ai_analysis.py",
    "backend/app/services/ai_portfolio.py",
    "backend/app/routers/dashboard.py",
    "frontend/src/pages/Dashboard.tsx",
    "frontend/src/components/AiPanel.tsx",
)


def test_thresholds_are_not_written_again_outside_the_rules():
    found = []
    for rel in WATCHED:
        text = (REPO / rel).read_text(encoding="utf-8")
        found += [f"{rel}: {pattern}" for pattern in SCATTERED if pattern in text]
    assert not found, "기준값·조건 수가 규칙 밖에 다시 적혔습니다: " + ", ".join(found)



# ---------- 읽는 쪽이 "N거래일 전"을 바르게 가져오나 (검토 조건 0.41.0) ----------

def _seed_many(db, n: int = 12) -> dict[str, pd.DataFrame]:
    from app.services.data_ingestion import refresh_ticker
    from tests.factories import make_stock

    frames = {}
    for i in range(n):
        ticker = f"S{i:02d}"
        prices = _prices(260, 100 + i)
        prices["adj_close"] = prices["close"]
        make_stock(db, ticker=ticker)
        refresh_ticker(db, ticker, price_df=prices)
        frames[ticker] = compute_indicators(prices)
    return frames


def test_dashboard_conditions_use_the_row_n_trading_days_ago(api):
    """대시보드가 읽는 행 수(N+1)가 하나라도 모자라면 변동성 조건(StdDev20 이 N거래일 전보다 작다)이 틀린다.

    변동성 조건이 **StdDev20 축소만으로** 참인 종목이 하나 이상 있어야 이 시험이 의미가 있다.
    """
    client, Session = api
    with Session() as db:
        frames = _seed_many(db)
    cards = {c["ticker"]: c for c in client.get("/api/dashboard").json()}
    only_by_shrink = 0
    for ticker, ind in frames.items():
        expected = signal_rules.latest_conditions(BUY, ind)
        assert cards[ticker]["buy_conditions"] == expected, ticker
        assert cards[ticker]["knee_conditions"] == expected, ticker
        last = ind.iloc[-1]
        if last["stddev20"] < ind["stddev20"].iloc[-1 - signal_rules.LOOKBACK_DAYS] and not last["vol_ratio"] > signal_rules.VOL_RATIO_EXPAND:
            only_by_shrink += 1
    assert only_by_shrink > 0


def test_ai_context_values_n_trading_days_ago(api):
    from app.services import ai_analysis

    _, Session = api
    with Session() as db:
        frames = _seed_many(db, n=2)
        for ticker, ind in frames.items():
            section = ai_analysis._indicator_section(db, ticker, None)
            back = ind.iloc[-1 - signal_rules.LOOKBACK_DAYS]
            assert section["adx_5d_ago"] == pytest.approx(back["adx"]), ticker
            assert section["stddev20_5d_ago"] == pytest.approx(back["stddev20"]), ticker
            assert section["knee_conditions"] == signal_rules.latest_conditions(BUY, ind)


def test_each_condition_has_one_name_on_screen():
    """B1 (0.42.0) — 설명 줄의 식이 칩 이름으로 시작한다. 예전에는 같은 조건이 "-DI > +DI"·"DI 약세"·"+DI / -DI" 셋이었다.
    내 기준을 바꿔도 그대로다."""
    for t in (signal_rules.DEFAULT, signal_rules.Thresholds(adx_trend=25.0, vol_ratio_expand=1.3, disparity_below=-2.0)):
        # 화면이 칩·설명 줄로 보이는 것은 매수 조건이다 (매도는 "참고" 한 줄)
        buy, _ = signal_rules.build_rules(t)
        for c in buy.conditions:
            assert c.formula.startswith(c.label), (c.key, c.label, c.formula)
