"""공시 값 → 분기 값 → 비율. **DB 도 네트워크도 모른다** (ROADMAP 3b).

여기의 모든 계산은 "어느 날 기준으로 **그날까지 공시된 값**만 쓴다"를 지킨다. 그래서 과거
어느 날의 PER 도 그때 알 수 있던 것으로 다시 만들어진다 — 이 경계가 틀리면 PER 5년 위치가
실제보다 좋게(또는 나쁘게) 나온다. 테스트가 고정한다.

용어
- 사실(Fact): 공시된 값 하나. 기간(시작~끝)과 공시일이 있다.
- 보기(view): 어느 날 기준으로 기간마다 **그날까지 나온 최신판** 하나씩.
- 분기: 3개월 값. 공시가 3개월 값을 직접 주면 그대로, 누적(6·9·12개월)만 주면 뺀다.
  4분기는 대개 연간 − 9개월 누적이다.
- TTM: 최근 네 분기 합.
"""

from __future__ import annotations

import bisect
import datetime as dt
import statistics
from dataclasses import dataclass

# 주당 값 (분할되면 나눈다)과 주식 수 (분할되면 곱한다)
PER_SHARE = frozenset({"eps_diluted", "dps"})
SHARE_COUNTS = frozenset({"shares", "shares_diluted"})

QUARTER_DAYS = (80, 100)  # 13주·14주·3개월을 다 받는다
YEAR_DAYS = (350, 380)    # 52·53주 회계연도 포함
PER_YEARS = 5
# 이보다 적은 날이면 "5년 중 어디쯤"이 뜻이 없다
PER_MIN_DAYS = 120


@dataclass(frozen=True)
class Fact:
    metric: str
    start: dt.date
    end: dt.date
    value: float
    filed: dt.date
    estimated: bool = False

    @property
    def key(self) -> tuple[str, dt.date, dt.date]:
        return (self.metric, self.start, self.end)

    @property
    def is_duration(self) -> bool:
        return self.start < self.end


@dataclass(frozen=True)
class Period:
    """분기 값이나 TTM 처럼 **계산해서 나온 값**과 그 근거."""

    value: float
    end: dt.date
    # 이 값을 이루는 공시가 **처음** 나온 날 중 가장 늦은 날 — 이날부터 알 수 있었다
    filed: dt.date
    estimated: bool = False
    revised: bool = False
    start: dt.date | None = None


# --- 분할 ------------------------------------------------------------------------

def split_factor(splits: list[tuple[dt.date, float]], filed: dt.date) -> float:
    """공시일 **뒤에** 있었던 분할을 다 곱한 값. 공시는 그날의 주식 기준으로 적혀 있다."""
    factor = 1.0
    for day, ratio in splits:
        if day > filed and ratio and ratio > 0:
            factor *= ratio
    return factor


def adjust_for_splits(facts: list[Fact], splits: list[tuple[dt.date, float]]) -> list[Fact]:
    """주당 값·주식 수를 **지금 주식 기준**으로 맞춘다 (시세가 그 기준이라서)."""
    if not splits:
        return list(facts)
    out = []
    for fact in facts:
        factor = split_factor(splits, fact.filed)
        if factor == 1.0 or (fact.metric not in PER_SHARE and fact.metric not in SHARE_COUNTS):
            out.append(fact)
            continue
        value = fact.value / factor if fact.metric in PER_SHARE else fact.value * factor
        out.append(Fact(fact.metric, fact.start, fact.end, value, fact.filed, fact.estimated))
    return out


# --- 그날의 보기 --------------------------------------------------------------------

@dataclass
class View:
    """어느 날 기준으로 알 수 있던 것."""

    latest: dict[tuple, Fact]
    # 기간마다 처음 공시된 날과 그게 추정인지
    first: dict[tuple, tuple[dt.date, bool]]
    # 그날까지 값이 한 번 이상 바뀐 기간
    revised: set[tuple]

    def of(self, metric: str) -> list[Fact]:
        return [f for (m, _, _), f in self.latest.items() if m == metric]


def view(facts: list[Fact], day: dt.date | None = None) -> View:
    """`day` 까지 공시된 것만 본다. None 이면 전부."""
    latest: dict[tuple, Fact] = {}
    first: dict[tuple, tuple[dt.date, bool]] = {}
    counts: dict[tuple, int] = {}
    for fact in facts:
        if day is not None and fact.filed > day:
            continue
        key = fact.key
        counts[key] = counts.get(key, 0) + 1
        if key not in latest or fact.filed > latest[key].filed:
            latest[key] = fact
        if key not in first or fact.filed < first[key][0]:
            first[key] = (fact.filed, fact.estimated)
    return View(latest, first, {k for k, n in counts.items() if n > 1})


def _days(start: dt.date, end: dt.date) -> int:
    return (end - start).days + 1


def _is_quarter(start: dt.date, end: dt.date) -> bool:
    return QUARTER_DAYS[0] <= _days(start, end) <= QUARTER_DAYS[1]


def _is_year(start: dt.date, end: dt.date) -> bool:
    return YEAR_DAYS[0] <= _days(start, end) <= YEAR_DAYS[1]


def _period(v: View, parts: list[Fact], value: float, start: dt.date, end: dt.date) -> Period:
    firsts = [v.first[p.key] for p in parts]
    return Period(
        value=value,
        end=end,
        start=start,
        filed=max(f[0] for f in firsts),
        estimated=any(f[1] for f in firsts),
        revised=any(p.key in v.revised for p in parts),
    )


def quarters(v: View, metric: str) -> dict[dt.date, Period]:
    """분기(3개월) 값 — 끝나는 날로 찾는다.

    공시가 3개월 값을 주면 그대로 쓰고, 없으면 **같은 날 시작한 누적 값끼리** 뺀다
    (6개월 − 3개월 = 2분기, 연간 − 9개월 = 4분기). 현금흐름은 누적으로만 오므로 이게 없으면
    분기 표가 비고 TTM 도 안 된다.
    """
    items = [f for f in v.of(metric) if f.is_duration]
    direct: dict[dt.date, Period] = {}
    for fact in items:
        if _is_quarter(fact.start, fact.end) and fact.end not in direct:
            direct[fact.end] = _period(v, [fact], fact.value, fact.start, fact.end)

    derived: dict[dt.date, Period] = {}
    by_start: dict[dt.date, list[Fact]] = {}
    for fact in items:
        by_start.setdefault(fact.start, []).append(fact)
    for group in by_start.values():
        group.sort(key=lambda f: f.end)
        for before, after in zip(group, group[1:]):
            start = before.end + dt.timedelta(days=1)
            if not _is_quarter(start, after.end) or after.end in derived:
                continue
            derived[after.end] = _period(v, [before, after], after.value - before.value, start, after.end)

    return {**derived, **direct}


def _near(target: dt.date, candidates, tolerance: int = 12):
    """`target` 에서 며칠 안쪽의 날짜 하나 (52·53주 회계연도는 분기 끝이 달마다 조금씩 밀린다)."""
    best = None
    for day in candidates:
        gap = abs((day - target).days)
        if gap <= tolerance and (best is None or gap < abs((best - target).days)):
            best = day
    return best


def ttm(v: View, metric: str) -> Period | None:
    """최근 1년 합. 네 분기가 이어져 있으면 그 합, 아니면 연간 + 올해 누적 − 작년 같은 누적."""
    qs = quarters(v, metric)
    if qs:
        latest = max(qs)
        chain = [qs[latest]]
        for k in (1, 2, 3):
            found = _near(latest - dt.timedelta(days=91 * k), qs.keys())
            if found is None or qs[found] in chain:
                break
            chain.append(qs[found])
        if len(chain) == 4:
            return Period(
                value=sum(p.value for p in chain),
                end=latest,
                start=chain[-1].start,
                filed=max(p.filed for p in chain),
                estimated=any(p.estimated for p in chain),
                revised=any(p.revised for p in chain),
            )
    return _ttm_from_ytd(v, metric)


def _ttm_from_ytd(v: View, metric: str) -> Period | None:
    """분기가 비어 있을 때 (한 분기에 배당을 두 번 선언해 3개월 값이 없는 회사 같은 경우)."""
    items = [f for f in v.of(metric) if f.is_duration]
    if not items:
        return None
    end = max(f.end for f in items)
    current = max((f for f in items if f.end == end), key=lambda f: _days(f.start, f.end))
    if _is_year(current.start, current.end):
        return _period(v, [current], current.value, current.start, current.end)
    years = [f for f in items if _is_year(f.start, f.end)]
    fiscal = next((f for f in years if abs((current.start - f.end).days - 1) <= 7), None)
    if fiscal is None:
        return None
    last_year_end = _near(end - dt.timedelta(days=365), [f.end for f in items if f.start == fiscal.start])
    before = next((f for f in items if f.start == fiscal.start and f.end == last_year_end), None)
    if before is None:
        return None
    parts = [fiscal, current, before]
    return _period(v, parts, fiscal.value + current.value - before.value, before.end, end)


def latest_instant(v: View, metric: str) -> Period | None:
    items = [f for f in v.of(metric) if not f.is_duration]
    if not items:
        return None
    fact = max(items, key=lambda f: f.end)
    return _period(v, [fact], fact.value, fact.end, fact.end)


def instant_at(v: View, metric: str, end: dt.date) -> Period | None:
    fact = v.latest.get((metric, end, end))
    return _period(v, [fact], fact.value, end, end) if fact else None


def yoy(v: View, metric: str) -> tuple[float | None, Period | None]:
    """최근 분기 vs 1년 전 같은 분기 (%). 1년 전이 0 이하면 비율이 뜻이 없어 None."""
    qs = quarters(v, metric)
    if not qs:
        return None, None
    latest = qs[max(qs)]
    before_end = _near(latest.end - dt.timedelta(days=365), qs.keys())
    if before_end is None:
        return None, latest
    before = qs[before_end]
    if before.value <= 0:
        return None, latest
    return (latest.value / before.value - 1) * 100, latest


def shares_now(v: View, near: dt.date | None) -> float | None:
    """주당 순자산에 쓸 주식 수. 표지의 발행주식수가 있으면 그것, 없으면 최근 분기 희석 가중평균."""
    instant = latest_instant(v, "shares")
    if instant is not None and (near is None or abs((instant.end - near).days) <= 200):
        return instant.value
    qs = quarters(v, "shares_diluted")
    if qs:
        return qs[max(qs)].value
    return instant.value if instant else None


# --- 지표 -----------------------------------------------------------------------

def _metric(key: str, value: float | None, basis: Period | None, note: str | None = None) -> dict:
    return {
        "key": key,
        "value": value,
        "period_end": basis.end if basis else None,
        "filed_at": basis.filed if basis else None,
        "estimated": bool(basis and basis.estimated),
        "note": note,
    }


def snapshot(facts: list[Fact], price: float | None, day: dt.date | None = None) -> dict:
    """그날의 지표 10개. `facts` 는 이미 분할 보정된 것이어야 한다 (`adjust_for_splits`).

    가치(PER·PBR·배당수익률)만 주가를 쓴다. 나머지는 공시 값끼리의 비율이다.
    """
    v = view(facts, day)
    out: dict[str, dict] = {}

    eps = ttm(v, "eps_diluted")
    if eps is None:
        out["per"] = _metric("per", None, None)
    elif eps.value <= 0:
        out["per"] = _metric("per", None, eps, "적자")
    else:
        out["per"] = _metric("per", price / eps.value if price else None, eps)

    equity = latest_instant(v, "equity")
    shares = shares_now(v, equity.end if equity else None)
    if equity is None or not shares:
        out["pbr"] = _metric("pbr", None, equity)
    elif equity.value <= 0:
        out["pbr"] = _metric("pbr", None, equity, "자본잠식")
    else:
        out["pbr"] = _metric("pbr", price / (equity.value / shares) if price else None, equity)

    dps = ttm(v, "dps")
    if dps is not None and price:
        out["dividend_yield"] = _metric("dividend_yield", dps.value / price * 100, dps)
    else:
        out["dividend_yield"] = _metric("dividend_yield", None, dps)

    net = ttm(v, "net_income")
    if net is not None and equity is not None and equity.value > 0:
        out["roe"] = _metric("roe", net.value / equity.value * 100, net)
    else:
        out["roe"] = _metric("roe", None, net)

    revenue = ttm(v, "revenue")
    operating = ttm(v, "operating_income")
    if revenue is not None and operating is not None and revenue.value > 0 and revenue.end == operating.end:
        out["operating_margin"] = _metric("operating_margin", operating.value / revenue.value * 100, operating)
    else:
        # 영업이익을 공시하지 않는 회사(일라이 릴리)면 근거도 비운다 — "공시에 없음"으로 보인다
        out["operating_margin"] = _metric("operating_margin", None, operating)

    for metric, key in (("revenue", "revenue_yoy"), ("operating_income", "operating_income_yoy"),
                        ("eps_diluted", "eps_yoy")):
        growth, basis = yoy(v, metric)
        out[key] = _metric(key, growth, basis)

    debt = None
    if equity is not None and equity.value > 0:
        liabilities = instant_at(v, "liabilities", equity.end)
        if liabilities is None:
            total = instant_at(v, "liabilities_and_equity", equity.end)
            if total is not None:
                liabilities = Period(total.value - equity.value, equity.end, total.filed, total.estimated,
                                     total.revised, equity.end)
        if liabilities is not None:
            debt = liabilities.value / equity.value * 100
    out["debt_ratio"] = _metric("debt_ratio", debt, equity)

    ocf = ttm(v, "operating_cf")
    capex = ttm(v, "capex")
    if ocf is not None and capex is not None and ocf.end == capex.end:
        out["fcf"] = _metric("fcf", ocf.value - capex.value, ocf)
    else:
        out["fcf"] = _metric("fcf", None, None)

    return out


def per_history(facts: list[Fact], prices: list[tuple[dt.date, float]], current: float | None,
                today: dt.date, years: int = PER_YEARS) -> dict | None:
    """지난 몇 년 동안 날마다의 PER — **그날까지 공시된 EPS** 로 — 과 지금이 그중 어디쯤인지.

    공시는 1년에 몇 번뿐이라 TTM EPS 는 공시일마다 한 번씩만 다시 계산하고, 그 사이 날들은
    직전 값을 이어 쓴다. 적자였던 날(PER 이 뜻이 없는 날)은 뺀다.
    """
    eps_facts = [f for f in facts if f.metric == "eps_diluted"]
    if not eps_facts or not prices:
        return None
    events = sorted({f.filed for f in eps_facts})
    values_at: list[float | None] = []
    for event in events:
        found = ttm(view(eps_facts, event), "eps_diluted")
        # 1년 넘게 새 분기가 없으면 그 값으로 PER 을 만들지 않는다
        stale = found is not None and (event - found.end).days > 200
        values_at.append(found.value if found is not None and not stale else None)

    since = today - dt.timedelta(days=round(365.25 * years))
    series: list[float] = []
    first_day = None
    for day, close in prices:
        if day < since or not close:
            continue
        i = bisect.bisect_right(events, day) - 1
        if i < 0:
            continue
        eps = values_at[i]
        if eps is None or eps <= 0:
            continue
        series.append(close / eps)
        first_day = first_day or day
    if len(series) < PER_MIN_DAYS:
        return None
    ordered = sorted(series)
    position = None
    if current is not None:
        position = bisect.bisect_right(ordered, current) / len(ordered) * 100
    return {
        "min": ordered[0],
        "max": ordered[-1],
        "median": statistics.median(ordered),
        "current": current,
        "position_pct": position,
        "since": first_day,
        "days": len(series),
    }


TABLE_METRICS = ("revenue", "operating_income", "net_income", "eps_diluted", "operating_cf", "capex")


def quarter_table(facts: list[Fact], limit: int = 8) -> list[dict]:
    """최근 분기 표. 행마다 **처음 공시된 날**과, 뒤에 정정됐는지를 붙인다."""
    v = view(facts)
    series = {metric: quarters(v, metric) for metric in TABLE_METRICS}
    ends = sorted(set(series["revenue"]) | set(series["net_income"]) | set(series["eps_diluted"]),
                  reverse=True)[:limit]
    rows = []
    for end in ends:
        cells = {metric: series[metric].get(end) for metric in TABLE_METRICS}
        present = [p for p in cells.values() if p is not None]
        ocf, capex = cells["operating_cf"], cells["capex"]
        rows.append({
            "period_end": end,
            "filed_at": min(p.filed for p in present),
            "estimated": any(p.estimated for p in present),
            "revised": any(p.revised for p in present),
            **{metric: (p.value if p else None) for metric, p in cells.items()},
            "fcf": (ocf.value - capex.value) if ocf and capex else None,
        })
    return rows
