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
    met = signal_rules.latest_conditions(BUY, _frame(rows))
    return KneeConditions(**{key: value for key, value in met.items() if key in KneeConditions.model_fields})
