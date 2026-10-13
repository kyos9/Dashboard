"""무릎매수(v2) / 어깨매도(참고) 시그널 판정 (SIGNAL_APP_SPEC.md 3~4장).

정의(조건·기준값)는 `signal_rules.py` 에 있다. 여기는 그 정의를 표 전체와 오늘 한 줄에 적용할 뿐이다 —
두 길이 **같은 평가 함수**를 쓰므로 저장된 판정과 화면의 조건 표시가 갈라지지 않는다.

입력 DataFrame은 services.indicators.compute_indicators()의 출력(원본 가격 컬럼 +
지표 컬럼을 모두 포함)이어야 한다.
"""

from collections.abc import Sequence

import pandas as pd

from app.models import IndicatorDaily
from app.schemas import KneeConditions
from app.services import signal_rules
from app.services.signal_rules import BUY, RULES

# 오늘 한 줄을 판정할 때 지표 표로 옮기는 열 (`indicator_daily` 의 열 전부)
_INDICATOR_FIELDS = (
    "ma5", "ma20", "ma50", "ma200", "stddev20",
    "vol_ma5", "vol_ma20", "vol_ratio", "roc5", "disparity",
    "plus_di", "minus_di", "adx",
)


def compute_signals(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for rule in RULES:
        out[rule.column] = signal_rules.evaluate_rule(rule, out)
    return out


def _frame(rows_oldest_first: Sequence[IndicatorDaily | None]) -> pd.DataFrame:
    """ORM 행들을 지표 표로. 빈 자리(None)는 값이 없는 행이 된다."""
    records = [
        {name: (getattr(row, name, None) if row is not None else None) for name in _INDICATOR_FIELDS}
        for row in rows_oldest_first
    ]
    return pd.DataFrame(records, columns=list(_INDICATOR_FIELDS), dtype="float64")


def buy_conditions(recent_desc: Sequence[IndicatorDaily]) -> dict[str, bool | None]:
    """최근 지표 행들(최신순)로 오늘의 매수 조건별 판정. 키는 규칙의 조건 키 그대로.

    "N거래일 전"은 N+1 번째 행이다 — 표 전체 계산의 `shift(N)` 과 같은 기준. 행이 모자라면 그 비교는
    판정 불가가 된다.
    """
    if not recent_desc or recent_desc[0] is None:
        return {c.key: None for c in BUY.conditions}
    rows = list(reversed(recent_desc[: signal_rules.LOOKBACK_DAYS + 1]))
    return signal_rules.latest_conditions(BUY, _frame(rows))


def buy_conditions_many(
    recent_by_ticker: dict[str, Sequence[IndicatorDaily]],
) -> dict[str, dict[str, bool | None]]:
    """여러 종목의 오늘 매수 조건을 **한 번에** — `buy_conditions` 를 종목마다 부른 것과 같은 답.

    작은 표를 종목마다 만들면 종목 하나에 5ms 쯤 든다(대시보드 20종목이면 0.1초). 그래서 종목마다
    N+1 행(모자라면 앞을 빈 행으로 채운다)을 이어 붙인 표 하나로 평가하고, 각 묶음의 마지막 행만 읽는다.
    묶음의 마지막 행에서 "N거래일 전"은 늘 같은 묶음의 첫 행이다. 다른 묶음으로 새는 것은 읽지 않는
    앞쪽 행들뿐이다 — 대시보드가 읽는 것이 원래 N+1 행이라 조건도 그 이상을 볼 수 없다.
    """
    size = signal_rules.LOOKBACK_DAYS + 1
    out: dict[str, dict[str, bool | None]] = {}
    blocks: list[IndicatorDaily | None] = []
    order: list[str] = []
    for ticker, recent_desc in recent_by_ticker.items():
        if not recent_desc or recent_desc[0] is None:
            out[ticker] = {c.key: None for c in BUY.conditions}
            continue
        rows = list(reversed(recent_desc[:size]))
        blocks += [None] * (size - len(rows)) + rows
        order.append(ticker)
    if order:
        table = signal_rules.evaluate_conditions(BUY, _frame(blocks))
        for i, ticker in enumerate(order):
            last = table.iloc[(i + 1) * size - 1]
            out[ticker] = {key: (None if pd.isna(value) else bool(value)) for key, value in last.items()}
    return out


def knee_conditions_from(met: dict[str, bool | None]) -> KneeConditions:
    """조건별 판정 → 옛 응답 모양(`knee_conditions` 네 칸). 규칙에 없는 칸은 None."""
    return KneeConditions(**{key: value for key, value in met.items() if key in KneeConditions.model_fields})


def knee_conditions(
    latest: IndicatorDaily | None, five_days_ago: IndicatorDaily | None
) -> KneeConditions:
    """무릎매수(v2) 조건의 개별 충족 여부 — 옛 응답 모양(`knee_conditions` 네 칸).

    오늘 행과 N거래일 전 행 둘만 받는다(그 사이는 비운다). 조건이 지금처럼 "오늘"과 "N거래일 전"만 보는
    동안은 `buy_conditions` 와 같은 답이다. 계산에 필요한 값이 없으면 해당 조건은 None(판정 불가).
    """
    if latest is None:
        return KneeConditions()
    gap: list[IndicatorDaily | None] = [None] * (signal_rules.LOOKBACK_DAYS - 1)
    rows = [five_days_ago, *gap, latest]
    return knee_conditions_from(signal_rules.latest_conditions(BUY, _frame(rows)))
