"""시그널 규칙 — 무릎매수(v2)·어깨매도(참고)의 정의가 **여기 한 곳**에 있다 (SIGNAL_APP_SPEC.md 3·4·10·11장).

**왜 한 곳인가 (0.41.0).** 전에는 "ADX > 20" 같은 기준값과 조건 문구가 계산(두 군데)·화면·AI 지시문·
명세에 따로 적혀 있었다. 주인이 쓰면서 시그널 로직을 바꿀 수 있으므로, 하나만 고치면 화면·AI·알림이
서로 다른 기준을 말하게 된다. 그래서 정의를 데이터로 여기 두고 나머지는 모두 여기서 가져온다.

- 계산: `signals.compute_signals`(표 전체 — 저장하는 판정)와 `signals.knee_conditions`(오늘 한 줄 —
  화면의 조건 표시)가 **같은 평가 함수**를 쓴다. 평가는 한 벌뿐이다.
- 화면: `GET /api/signal-rules` 가 조건 목록·문구·기준값을 내려준다(`payload()`).
- AI: 지시문의 규칙 설명과 조건 줄을 `ai_rules_text()`·`ai_condition_line()` 이 만든다.

**정의를 바꿀 때** (명세 10장): 명세 → 이 파일(기준값·조건·`VERSION`) → 테스트 → `CHANGES` 에 한 줄.
평가 함수의 동작을 바꿨으면 `VERSION` 을 손으로 올린다 — 지문(`fingerprint()`)이 달라져야 서버가
켜질 때 지난 판정을 다시 계산한다. 문구만 고친 것은 지문에 들어가지 않는다(전 종목을 다시 셀 일이 아니다).

**바꾸지 않는 것**: API 필드 이름(`knee_buy_v2`, `shoulder_sell_ref`, `knee_conditions` 의 네 키)은
옛 화면이 쓴다. 뜻은 명세가 정하고, 바뀐 이력은 `CHANGES` 와 명세 11장에 남긴다.
"""

from __future__ import annotations

import datetime as dt
import functools
import hashlib
import json
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd

# ---------- 기준값 — 이 파일 밖에 같은 숫자를 다시 쓰지 않는다 ----------

ADX_TREND = 20.0  # ADX 가 이보다 커야 "추세가 있다"
VOL_RATIO_EXPAND = 1.1  # 거래량비(5일÷20일 평균)가 이보다 커야 "거래가 붙는다"
DISPARITY_BELOW = 0.0  # 이격도가 이보다 작아야 "MA20 아래"
LOOKBACK_DAYS = 5  # "N거래일 전" — 달력이 아니라 거래일 행

# 평가 함수의 동작을 바꾸면 손으로 올린다 (기준값은 지문에 따로 들어간다)
VERSION = "knee-v2.shoulder-ref"

# 지표 공식(`indicators.py`)의 판. 지표 정의를 바꾸면 올린다 — 그러면 지표까지 다시 계산한다.
INDICATOR_VERSION = "1"

# 정의가 바뀐 이력. 첫 줄은 처음 정의(바뀐 것이 아니다) — 화면은 둘째 줄부터 "바뀌었다"고 말한다.
CHANGES: list[dict] = [
    {
        "date": "2026-09-17",
        "what": "무릎매수(v2)·어깨매도(참고) — 코드에서 명세를 복원한 시점의 정의",
        "why": "처음 정의. 임계값의 근거는 복원하지 못했다(명세 1장)",
    },
]

# 정의를 바꾼 뒤 화면에 "바뀌었습니다"를 보이는 날 수 (주인 결정, 0.41.0)
CHANGE_NOTICE_DAYS = 30


def _num(value: float) -> str:
    """기준값을 글로 — 20.0 → "20", 1.1 → "1.1"."""
    return f"{value:g}"


# ---------- 평가 — 판정 불가(NA)를 갖는 참·거짓 ----------
#
# 평가 함수는 지표 표(날짜 오름차순)를 받아 날마다 True / False / NA 를 돌려준다.
# NA 는 "값이 없어 판정 불가"다. 저장하는 판정은 NA 를 거짓으로 접고(명세 3장 "값이 없으면 불충족"),
# 화면은 NA 를 "판정 불가"로 보인다.


def _floats(values, index: pd.Index) -> np.ndarray:
    if not isinstance(values, pd.Series):
        return np.full(len(index), float(values))
    return pd.to_numeric(values, errors="coerce").to_numpy(dtype="float64", na_value=np.nan)


def _compare(left: pd.Series, right: pd.Series | float, op: Callable) -> pd.Series:
    """비교 한 번 — 어느 쪽이든 값이 없으면 판정 불가(NA). (numpy 로 바로 — 대시보드가 매번 부른다)"""
    a, b = _floats(left, left.index), _floats(right, left.index)
    unknown = np.isnan(a) | np.isnan(b)
    with np.errstate(invalid="ignore"):
        met = op(a, b) & ~unknown
    return pd.Series(pd.arrays.BooleanArray(met, unknown), index=left.index)


def _gt(left, right) -> pd.Series:
    return _compare(left, right, lambda a, b: a > b)


def _lt(left, right) -> pd.Series:
    return _compare(left, right, lambda a, b: a < b)


def _ago(series: pd.Series) -> pd.Series:
    return series.shift(LOOKBACK_DAYS)


def any_of(*parts: pd.Series) -> pd.Series:
    """OR 묶음. **참이 하나라도 있으면 참, 모두 판정 불가면 판정 불가, 나머지는 거짓.**

    일반 3값 논리(Kleene)와 다르다 — 한쪽이 판정 불가이고 다른 쪽이 거짓이면 Kleene 은 NA 지만
    여기서는 거짓이다. 0.40.0 까지 화면이 그렇게 보였고(명세 3장 "둘 다 판정 불가면 그 칸이 판정 불가"),
    그대로 지킨다.
    """
    index = parts[0].index
    any_true = np.zeros(len(index), dtype=bool)
    all_na = np.ones(len(index), dtype=bool)
    for part in parts:
        unknown = part.isna().to_numpy()
        any_true |= part.to_numpy(dtype=bool, na_value=False)
        all_na &= unknown
    unknown = all_na & ~any_true
    return pd.Series(pd.arrays.BooleanArray(any_true & ~unknown, unknown), index=index)


# ---------- 조건 ----------


@dataclass(frozen=True)
class Condition:
    """조건 하나 = 화면·AI 가 쓰는 글 + 평가 함수."""

    key: str  # API 키. 무릎매수 넷은 옛 `knee_conditions` 필드 이름 그대로
    metric: str  # 화면에서 이 조건이 붙는 지표 칸 (disparity · adx · di · volume)
    label: str  # 칩에 쓰는 짧은 이름
    detail: str  # 풀이 (마우스를 올리면)
    header: str  # 열 머리에 한 번 적는 짧은 조건식
    formula: str  # 시그널 보기 설명 줄의 식
    ai_short: str  # AI 에 보내는 조건별 줄의 이름
    ai_long: str  # AI 지시문의 규칙 설명
    evaluate: Callable[[pd.DataFrame], pd.Series] = field(compare=False, repr=False)
    # 지문에 들어가는 평가의 모양 — 글이 아니라 무엇을 비교하는지
    logic: str = ""


@dataclass(frozen=True)
class Rule:
    key: str  # "buy" · "sell"
    column: str  # 저장하는 열 (`signal_daily`)
    name: str  # 화면 이름
    spec_name: str  # 명세의 이름
    conditions: tuple[Condition, ...]


_KOREAN_COUNT = {1: "한", 2: "두", 3: "세", 4: "네", 5: "다섯", 6: "여섯", 7: "일곱", 8: "여덟"}


def count_word(n: int) -> str:
    """조건 수를 글로 — 4 → "네" ("네 조건")."""
    return _KOREAN_COUNT.get(n, str(n))


BUY = Rule(
    key="buy",
    column="knee_buy_v2",
    name="매수 시그널",
    spec_name="무릎매수 v2",
    conditions=(
        Condition(
            key="di_bearish",
            metric="di",
            label="DI 약세",
            detail="-DI > +DI — 하락 방향이 우위",
            header="-DI > +DI",
            formula="-DI > +DI",
            ai_short="-DI>+DI",
            ai_long="-DI > +DI",
            evaluate=lambda df: _gt(df["minus_di"], df["plus_di"]),
            logic="minus_di > plus_di",
        ),
        Condition(
            key="disparity_negative",
            metric="disparity",
            label=f"이격도 < {_num(DISPARITY_BELOW)}",
            detail="종가가 MA20 아래",
            header=f"< {_num(DISPARITY_BELOW)}",
            formula=f"이격도 < {_num(DISPARITY_BELOW)}",
            ai_short=f"이격도<{_num(DISPARITY_BELOW)}",
            ai_long=f"이격도(종가÷MA20−1) < {_num(DISPARITY_BELOW)}",
            evaluate=lambda df: _lt(df["disparity"], DISPARITY_BELOW),
            logic=f"disparity < {DISPARITY_BELOW!r}",
        ),
        Condition(
            key="volatility_or_volume",
            metric="volume",
            label="변동성·거래량",
            detail=f"StdDev20 축소 또는 거래량비 > {_num(VOL_RATIO_EXPAND)}",
            header=f"변동성↓ 또는 >{_num(VOL_RATIO_EXPAND)}",
            formula=f"(StdDev20 축소 또는 거래량비 > {_num(VOL_RATIO_EXPAND)})",
            ai_short="변동성 축소 또는 거래량 증가",
            ai_long=(
                f"20일 표준편차가 {LOOKBACK_DAYS}거래일 전보다 작거나, "
                f"거래량비(5일÷20일 평균) > {_num(VOL_RATIO_EXPAND)}"
            ),
            evaluate=lambda df: any_of(
                _lt(df["stddev20"], _ago(df["stddev20"])),
                _gt(df["vol_ratio"], VOL_RATIO_EXPAND),
            ),
            logic=f"any(stddev20 < stddev20[-{LOOKBACK_DAYS}], vol_ratio > {VOL_RATIO_EXPAND!r})",
        ),
        Condition(
            key="adx_trending",
            metric="adx",
            label=f"ADX > {_num(ADX_TREND)}",
            detail="추세가 형성된 구간",
            header=f"> {_num(ADX_TREND)}",
            formula=f"ADX > {_num(ADX_TREND)}",
            ai_short=f"ADX>{_num(ADX_TREND)}",
            ai_long=f"ADX > {_num(ADX_TREND)}",
            evaluate=lambda df: _gt(df["adx"], ADX_TREND),
            logic=f"adx > {ADX_TREND!r}",
        ),
    ),
)

SELL = Rule(
    key="sell",
    column="shoulder_sell_ref",
    name="매도 시그널",
    spec_name="어깨매도 (참고)",
    conditions=(
        Condition(
            key="above_ma50",
            metric="ma50",
            label="MA50 위",
            detail="종가가 MA50 위",
            header="종가 > MA50",
            formula="종가 > MA50",
            ai_short="종가>MA50",
            ai_long="종가 > MA50",
            evaluate=lambda df: _gt(df["close"], df["ma50"]),
            logic="close > ma50",
        ),
        Condition(
            key="adx_rising",
            metric="adx",
            label="ADX 상승",
            detail=f"ADX 가 {LOOKBACK_DAYS}거래일 전보다 큼",
            header=f"ADX > {LOOKBACK_DAYS}일 전",
            formula=f"ADX > {LOOKBACK_DAYS}거래일 전 ADX",
            ai_short="ADX 상승",
            ai_long=f"ADX 가 {LOOKBACK_DAYS}거래일 전보다 큼",
            evaluate=lambda df: _gt(df["adx"], _ago(df["adx"])),
            logic=f"adx > adx[-{LOOKBACK_DAYS}]",
        ),
        Condition(
            key="volume_strong",
            metric="volume",
            label="거래량 받침",
            detail="5일 평균 거래량 > 20일 평균",
            header="거래량 MA5 > MA20",
            formula="거래량 MA5 > MA20",
            ai_short="거래량 MA5>MA20",
            ai_long="5일 평균 거래량 > 20일 평균",
            evaluate=lambda df: _gt(df["vol_ma5"], df["vol_ma20"]),
            logic="vol_ma5 > vol_ma20",
        ),
    ),
)

RULES: tuple[Rule, ...] = (BUY, SELL)


# ---------- 평가 ----------


def evaluate_conditions(rule: Rule, df: pd.DataFrame) -> pd.DataFrame:
    """조건마다 True / False / NA 인 표 (열 = 조건 키, 행 = 날짜)."""
    return pd.DataFrame({c.key: c.evaluate(df) for c in rule.conditions}, index=df.index)


def evaluate_rule(rule: Rule, df: pd.DataFrame) -> pd.Series:
    """규칙의 날마다 판정 — 조건이 **모두** 참인 날. 판정 불가는 거짓으로 접는다."""
    table = evaluate_conditions(rule, df)
    met = table.fillna(False).astype(bool)
    return met.all(axis=1) if len(rule.conditions) else pd.Series(False, index=df.index)


def latest_conditions(rule: Rule, df: pd.DataFrame) -> dict[str, bool | None]:
    """맨 마지막 행의 조건별 판정. NA 는 None (판정 불가 — 미충족이 아니다)."""
    if df.empty:
        return {c.key: None for c in rule.conditions}
    last = evaluate_conditions(rule, df).iloc[-1]
    return {key: (None if pd.isna(value) else bool(value)) for key, value in last.items()}


# ---------- 지문 · 판 · 바뀐 날 ----------


@functools.cache
def fingerprint() -> str:
    """판정이 달라지는 것만 담은 지문. 문구·이력은 넣지 않는다.

    평가의 모양(`logic`)·기준값·손으로 올리는 판·지표 판. 이것이 저장된 것과 다르면 서버가 켜질 때
    전 종목의 지난 판정을 저장된 시세로 다시 계산한다(`signal_recompute.py`).
    """
    body = {
        "version": VERSION,
        "indicator_version": INDICATOR_VERSION,
        "thresholds": thresholds(),
        "rules": [
            {"key": r.key, "column": r.column, "conditions": [[c.key, c.logic] for c in r.conditions]}
            for r in RULES
        ],
    }
    raw = json.dumps(body, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def thresholds() -> dict[str, float | int]:
    return {
        "adx_trend": ADX_TREND,
        "vol_ratio_expand": VOL_RATIO_EXPAND,
        "disparity_below": DISPARITY_BELOW,
        "lookback_days": LOOKBACK_DAYS,
    }


def changed_on() -> str | None:
    """정의가 마지막으로 **바뀐** 날 (처음 정의만 있으면 None)."""
    return CHANGES[-1]["date"] if len(CHANGES) > 1 else None


def change_notice(today: dt.date | None = None) -> str | None:
    """화면 신호 요약에 붙이는 한 줄. 바꾼 뒤 `CHANGE_NOTICE_DAYS` 일 동안만."""
    when = changed_on()
    if when is None:
        return None
    day = dt.date.fromisoformat(when)
    today = today or dt.date.today()
    if not (0 <= (today - day).days < CHANGE_NOTICE_DAYS):
        return None
    return f"시그널 계산 방식이 {when}에 바뀌었습니다"


# ---------- 화면 · AI ----------


def _condition_payload(c: Condition) -> dict:
    return {
        "key": c.key, "metric": c.metric, "label": c.label, "detail": c.detail,
        "header": c.header, "formula": c.formula,
    }


def payload(today: dt.date | None = None) -> dict:
    """`GET /api/signal-rules` 의 몸통."""
    return {
        "version": fingerprint(),
        "thresholds": thresholds(),
        "rules": [
            {
                "key": r.key, "column": r.column, "name": r.name, "spec_name": r.spec_name,
                "conditions": [_condition_payload(c) for c in r.conditions],
            }
            for r in RULES
        ],
        "changes": CHANGES,
        "changed_on": changed_on(),
        "change_notice": change_notice(today),
    }


_CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"


def ai_rules_text() -> str:
    """AI 지시문에 붙는 규칙 설명 (`ai_analysis.SIGNAL_RULES`)."""
    buy = [f"{_CIRCLED[i]} {c.ai_long}" for i, c in enumerate(BUY.conditions)]
    # 한 줄이 너무 길지 않게 둘째 조건 뒤에서 줄을 바꾼다 (0.40.0 의 글과 같게)
    head, tail = " ".join(buy[:2]), " ".join(buy[2:])
    buy_text = head + (f"\n  {tail}" if tail else "")
    sell = ", ".join(c.ai_long for c in SELL.conditions)
    return (
        "[시그널 규칙 — 사용자가 이 앱에서 쓰는 기계적 조건]\n"
        f"- {BUY.name}({BUY.spec_name}): {count_word(len(BUY.conditions))} 조건이 모두 참인 날. {buy_text}.\n"
        "  떨어지는 중에 적립식으로 사는 날을 고르는 보조 규칙이다. 기간 안에 안 뜨면 기간 마지막 날 산다.\n"
        f"- 매도 참고 시그널(어깨): {sell}.\n"
        "  참고용이며 매도는 정해 둔 리뷰일에만 한다."
    )


def ai_condition_line(conditions: dict[str, bool | None], yes: Callable[[bool | None], str]) -> str:
    """AI 에 보내는 "매수 시그널 조건별: ① -DI>+DI 예, …" 줄."""
    parts = [
        f"{_CIRCLED[i]} {c.ai_short} {yes(conditions.get(c.key))}" for i, c in enumerate(BUY.conditions)
    ]
    return "- 매수 시그널 조건별: " + ", ".join(parts)


def buy_count_phrase() -> str:
    """"네 조건" — AI 지시문·화면이 조건 수를 말할 때."""
    return f"{count_word(len(BUY.conditions))} 조건"
