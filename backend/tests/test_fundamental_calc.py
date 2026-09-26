"""재무 계산 — 공시 값에서 분기·TTM·비율을 만드는 부분 (ROADMAP 3b).

가장 중요한 경계는 **"공시일 전에는 그 분기가 계산에 안 들어간다"** 다. 이게 새면 과거 PER 이
그때 알 수 없던 실적으로 계산된다.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.services import fundamental_calc as calc
from app.services.fundamental_calc import Fact

D = dt.date


def q_ends(year: int) -> list[tuple[D, D]]:
    return [(D(year, 1, 1), D(year, 3, 31)), (D(year, 4, 1), D(year, 6, 30)),
            (D(year, 7, 1), D(year, 9, 30)), (D(year, 10, 1), D(year, 12, 31))]


def quarterly(metric: str, values: dict[tuple[int, int], float], lag: int = 30) -> list[Fact]:
    """분기 3개월 값을 그 분기 끝 + lag 일에 공시한 것처럼."""
    out = []
    for (year, q), value in values.items():
        start, end = q_ends(year)[q - 1]
        out.append(Fact(metric, start, end, value, end + dt.timedelta(days=lag)))
    return out


def ytd(metric: str, year: int, cumulative: list[float], lag: int = 30) -> list[Fact]:
    """누적 값만 (현금흐름처럼). cumulative[i] = 1분기부터 i+1 분기까지의 합."""
    out = []
    for i, value in enumerate(cumulative):
        end = q_ends(year)[i][1]
        out.append(Fact(metric, D(year, 1, 1), end, value, end + dt.timedelta(days=lag + (30 if i == 3 else 0))))
    return out


def test_quarters_come_from_year_to_date_differences():
    facts = ytd("operating_cf", 2025, [10, 25, 45, 70])
    qs = calc.quarters(calc.view(facts), "operating_cf")
    assert {end: p.value for end, p in qs.items()} == {
        D(2025, 3, 31): 10, D(2025, 6, 30): 15, D(2025, 9, 30): 20, D(2025, 12, 31): 25,
    }
    # 4분기 = 연간 − 9개월. 연간 보고서가 나온 날부터 알 수 있다.
    assert qs[D(2025, 12, 31)].filed == D(2025, 12, 31) + dt.timedelta(days=60)
    assert qs[D(2025, 12, 31)].start == D(2025, 10, 1)


def test_direct_quarter_is_preferred_over_the_difference():
    facts = ytd("revenue", 2025, [10, 25]) + [Fact("revenue", D(2025, 4, 1), D(2025, 6, 30), 16, D(2025, 7, 30))]
    assert calc.quarters(calc.view(facts), "revenue")[D(2025, 6, 30)].value == 16


def test_ttm_sums_four_quarters():
    facts = quarterly("eps_diluted", {(2025, 1): 1, (2025, 2): 2, (2025, 3): 3, (2025, 4): 4, (2026, 1): 5})
    got = calc.ttm(calc.view(facts), "eps_diluted")
    assert got.value == 14 and got.end == D(2026, 3, 31)


def test_ttm_needs_four_connected_quarters():
    facts = quarterly("eps_diluted", {(2025, 1): 1, (2025, 3): 3, (2025, 4): 4, (2026, 1): 5})
    assert calc.ttm(calc.view(facts), "eps_diluted") is None


def test_quarter_is_not_used_before_it_is_filed():
    """경계 — 2026년 1분기 EPS 는 4월 30일 공시. 그 전날의 PER 은 2025년 네 분기로 계산한다."""
    facts = quarterly("eps_diluted", {(2025, 1): 1, (2025, 2): 1, (2025, 3): 1, (2025, 4): 1, (2026, 1): 3})
    before = calc.ttm(calc.view(facts, D(2026, 4, 29)), "eps_diluted")
    on_the_day = calc.ttm(calc.view(facts, D(2026, 4, 30)), "eps_diluted")
    assert before.value == 4 and before.end == D(2025, 12, 31)
    assert on_the_day.value == 6 and on_the_day.end == D(2026, 3, 31)

    snap_before = calc.snapshot(facts, price=40, day=D(2026, 4, 29))
    snap_after = calc.snapshot(facts, price=40, day=D(2026, 4, 30))
    assert snap_before["per"]["value"] == pytest.approx(10)
    assert snap_after["per"]["value"] == pytest.approx(40 / 6)


def test_restated_value_is_used_only_after_the_restatement():
    original = Fact("revenue", D(2025, 1, 1), D(2025, 3, 31), 100, D(2025, 4, 30))
    restated = Fact("revenue", D(2025, 1, 1), D(2025, 3, 31), 90, D(2025, 8, 1))
    facts = [original, restated]
    assert calc.quarters(calc.view(facts, D(2025, 7, 1)), "revenue")[D(2025, 3, 31)].value == 100
    after = calc.quarters(calc.view(facts), "revenue")[D(2025, 3, 31)]
    assert after.value == 90
    # 공시일은 처음 나온 날, 정정됐다는 표시는 따로
    assert after.filed == D(2025, 4, 30) and after.revised


def test_split_after_filing_is_adjusted_but_not_before():
    """엔비디아처럼 10:1 분할. 분할 전에 공시된 EPS 는 나누고, 뒤에 공시된 것은 그대로."""
    splits = [(D(2024, 6, 10), 10.0)]
    old = Fact("eps_diluted", D(2024, 1, 1), D(2024, 3, 31), 6.0, D(2024, 5, 29))
    new = Fact("eps_diluted", D(2024, 4, 1), D(2024, 6, 30), 0.67, D(2024, 8, 28))
    shares = Fact("shares", D(2024, 5, 20), D(2024, 5, 20), 2.46e9, D(2024, 5, 29))
    adjusted = {f.metric + str(f.end): f.value for f in calc.adjust_for_splits([old, new, shares], splits)}
    assert adjusted["eps_diluted2024-03-31"] == pytest.approx(0.6)
    assert adjusted["eps_diluted2024-06-30"] == pytest.approx(0.67)
    assert adjusted["shares2024-05-20"] == pytest.approx(2.46e10)


def test_splits_do_not_touch_amounts():
    splits = [(D(2024, 6, 10), 10.0)]
    revenue = Fact("revenue", D(2024, 1, 1), D(2024, 3, 31), 26e9, D(2024, 5, 29))
    assert calc.adjust_for_splits([revenue], splits)[0].value == 26e9


def _company() -> list[Fact]:
    """2024~2025년 여덟 분기 + 재무상태 — 비율 계산을 보기 위한 가상의 회사."""
    facts = []
    facts += quarterly("revenue", {(y, q): 100 + 10 * (4 * (y - 2024) + q) for y in (2024, 2025) for q in (1, 2, 3, 4)})
    facts += quarterly("operating_income", {(y, q): 30 for y in (2024, 2025) for q in (1, 2, 3, 4)})
    facts += quarterly("net_income", {(y, q): 25 for y in (2024, 2025) for q in (1, 2, 3, 4)})
    facts += quarterly("eps_diluted", {(y, q): 0.5 * (1 + (y - 2024)) for y in (2024, 2025) for q in (1, 2, 3, 4)})
    facts += ytd("operating_cf", 2025, [40, 80, 120, 160])
    facts += ytd("capex", 2025, [10, 20, 30, 40])
    facts += quarterly("dps", {(2025, q): 0.25 for q in (1, 2, 3, 4)})
    end = D(2025, 12, 31)
    filed = D(2026, 2, 28)
    facts += [
        Fact("equity", end, end, 400, filed),
        Fact("liabilities_and_equity", end, end, 1000, filed),
        Fact("shares", D(2026, 2, 1), D(2026, 2, 1), 100, filed),
    ]
    return facts


def test_snapshot_ratios():
    snap = calc.snapshot(_company(), price=40)
    assert snap["per"]["value"] == pytest.approx(40 / 4.0)          # EPS 2025 = 1.0 × 4
    assert snap["pbr"]["value"] == pytest.approx(40 / (400 / 100))
    assert snap["dividend_yield"]["value"] == pytest.approx(1.0 / 40 * 100)
    assert snap["roe"]["value"] == pytest.approx(100 / 400 * 100)
    rev_2025 = sum(100 + 10 * (4 + q) for q in (1, 2, 3, 4))
    assert snap["operating_margin"]["value"] == pytest.approx(120 / rev_2025 * 100)
    assert snap["revenue_yoy"]["value"] == pytest.approx((180 / 140 - 1) * 100)
    assert snap["operating_income_yoy"]["value"] == pytest.approx(0)
    assert snap["eps_yoy"]["value"] == pytest.approx(100)
    # 부채 합계가 없으면 "부채와 자본 합계 − 자본"
    assert snap["debt_ratio"]["value"] == pytest.approx(600 / 400 * 100)
    assert snap["fcf"]["value"] == pytest.approx(160 - 40)
    assert snap["per"]["period_end"] == D(2025, 12, 31)


def test_loss_makes_per_meaningless_not_negative():
    facts = quarterly("eps_diluted", {(2025, q): -0.2 for q in (1, 2, 3, 4)})
    per = calc.snapshot(facts, price=10)["per"]
    assert per["value"] is None and per["note"] == "적자"


def test_growth_from_zero_is_meaningless_not_a_crash():
    facts = quarterly("operating_income", {(2025, 2): 0.0, (2026, 2): 5.0})
    assert calc.yoy(calc.view(facts), "operating_income")[0] is None


def test_missing_metric_is_none_not_zero():
    facts = quarterly("revenue", {(2025, q): 10 for q in (1, 2, 3, 4)})
    snap = calc.snapshot(facts, price=10)
    assert snap["operating_margin"]["value"] is None
    # 영업이익이 공시에 없으면 근거도 없다 — 화면에 "공시에 없음"으로 보인다
    assert snap["operating_margin"]["period_end"] is None
    assert snap["fcf"]["value"] is None and snap["fcf"]["period_end"] is None
    assert snap["per"]["value"] is None


def test_ttm_falls_back_to_year_to_date_when_a_quarter_is_missing():
    """1분기 배당을 전년 12월에 선언하는 회사(일라이 릴리)는 1분기 3개월 값이 없다."""
    facts = [
        Fact("dps", D(2025, 1, 1), D(2025, 12, 31), 6.0, D(2026, 2, 20)),   # 연간
        Fact("dps", D(2025, 1, 1), D(2025, 6, 30), 3.0, D(2025, 8, 1)),     # 작년 상반기
        Fact("dps", D(2026, 1, 1), D(2026, 6, 30), 3.46, D(2026, 8, 5)),    # 올해 상반기
        Fact("dps", D(2026, 4, 1), D(2026, 6, 30), 3.46, D(2026, 8, 5)),    # 2분기
    ]
    got = calc.ttm(calc.view(facts), "dps")
    assert got.value == pytest.approx(6.0 + 3.46 - 3.0)
    assert got.end == D(2026, 6, 30)


def test_fifty_two_week_quarters_connect():
    """엔비디아 — 1월 마지막 일요일 무렵에 끝나는 회계연도, 13주 분기."""
    ends = [D(2025, 4, 27), D(2025, 7, 27), D(2025, 10, 26), D(2026, 1, 25)]
    facts = []
    start = D(2025, 1, 27)
    for end in ends:
        facts.append(Fact("eps_diluted", start, end, 1.0, end + dt.timedelta(days=30)))
        start = end + dt.timedelta(days=1)
    assert calc.ttm(calc.view(facts), "eps_diluted").value == 4.0


def test_per_history_uses_eps_known_on_each_day():
    facts = quarterly("eps_diluted", {(y, q): 1.0 if y < 2025 else 2.0 for y in (2023, 2024, 2025) for q in (1, 2, 3, 4)})
    prices = []
    day = D(2024, 1, 1)
    while day <= D(2026, 3, 1):
        prices.append((day, 40.0))
        day += dt.timedelta(days=1)
    got = calc.per_history(facts, prices, current=5.0, today=D(2026, 3, 1))
    # 2025년 분기가 하나씩 공시될 때마다 TTM 이 5, 6, 7, 8 로 오른다 → PER 10 … 5
    assert got["max"] == pytest.approx(10.0)
    assert got["min"] == pytest.approx(5.0)
    assert 0 < got["position_pct"] < 50
    assert got["since"] >= D(2024, 1, 1)


def test_per_history_skips_loss_days_and_short_history():
    facts = quarterly("eps_diluted", {(2025, q): -1.0 for q in (1, 2, 3, 4)})
    prices = [(D(2026, 1, 1) + dt.timedelta(days=i), 10.0) for i in range(200)]
    assert calc.per_history(facts, prices, current=None, today=D(2026, 8, 1)) is None


def test_quarter_table_lists_latest_first_with_first_filing_date():
    rows = calc.quarter_table(_company(), limit=8)
    assert [r["period_end"] for r in rows][:2] == [D(2025, 12, 31), D(2025, 9, 30)]
    assert len(rows) == 8
    latest = rows[0]
    assert latest["revenue"] == 180
    assert latest["fcf"] == pytest.approx(40 - 10)
    # 매출은 분기 끝 + 30일, 현금흐름(연간)은 + 60일에 나왔다 — 먼저 나온 날
    assert latest["filed_at"] == D(2026, 1, 30)
    # 2024년은 현금흐름이 없다 — 빈칸이지 0 이 아니다
    assert rows[-1]["operating_cf"] is None and rows[-1]["fcf"] is None
