"""국면 배지 — "지금 눈에 띄는 것이 있나"를 한 줄짜리 규칙 몇 개로.

**합성 점수는 만들지 않는다.** "매크로 점수 62점"을 만드는 순간 왜 62인지 아무도 모르게
되고, 근거가 안 보이는 숫자는 판단에 도움이 안 된다. 규칙을 따로 두면 배지마다 이유가
그대로 보이고, 하나가 틀렸을 때 그 하나만 고칠 수 있다.

**색으로 사라/팔아라를 말하지 않는다.** 배지는 전부 같은 색(amber)이다 — 빨강/초록을
쓰면 "역전됐으니 팔아라"로 읽히는데, 장단기 금리 역전은 과거에 침체보다 1~2년 앞섰고
그 사이 주가가 더 오른 적도 많다. 배지가 하는 말은 "이건 보고 가라"까지다.
(`services/macro.py` 맨 앞의 결정과 같은 선이다 — 매크로는 시그널 조건에 안 들어간다.)
"""

from __future__ import annotations

# --- 규칙별 경계 ------------------------------------------------------------

# VIX 가 이 위면 "공포 구간". 20이 장기 평균이고, 30 위는 2020년 3월·2022년 하락장
# 같은 때만 나온다. 25로 낮추면 배지가 자주 떠서 사람이 곧 안 보게 된다.
VIX_FEAR = 30.0

# 공포·탐욕 지수의 구간. **CNN 이 쓰는 경계 그대로다.**
#
# 경계를 정수로 두고 값을 반올림해서 고른다. 실제 값은 33.7143 같은 소수로 오는데,
# 44.9 를 "공포"로 볼지 "중립"으로 볼지 같은 자리를 소수로 따지면 정의가 지저분해지고
# 화면에 적는 범위(25~44)와도 어긋난다. CNN 자신이 정수 구간으로 발표한다.
FEAR_GREED_BANDS: list[tuple[int, int, str, bool]] = [
    # (아래, 위, 이름, 극단인가)
    (0, 24, "극단적 공포", True),
    (25, 44, "공포", False),
    (45, 55, "중립", False),
    (56, 75, "탐욕", False),
    (76, 100, "극단적 탐욕", True),
]

# 구간 이름이 있는 지표. **지표 대부분에는 이런 게 없다** — 금리 4.2%가 어느 "구간"인지는
# 아무도 정해놓지 않았고, 우리가 정하면 그건 출처가 없는 판정이 된다. 발표하는 쪽이
# 구간을 같이 내는 지표에만 붙인다.
ZONES: dict[str, list[tuple[int, int, str, bool]]] = {
    "FEARGREED": FEAR_GREED_BANDS,
}

# "물가가 예상을 상회" 규칙이 보는 지표.
#
# **주기로 가르지 않고 코드를 적는다.** 예상치를 넣을 수 있는 지표는 "월간이면 된다"로
# 가를 수 있지만(`macro.is_forecastable`), 이 배지가 하는 말은 "**물가**가 예상을
# 넘었다"이다. 나중에 실업률 같은 월간 지표가 들어왔을 때 주기로 갈랐으면 실업률
# 발표에 "물가 상회"라고 적히게 된다.
INFLATION_CODES = ["PCEPILFE", "PCEPI", "CPILFESL", "CPIAUCSL"]

# 실제와 예상을 **소수 첫째 자리에서** 비교한다.
#
# 발표도 예상도 그 자리까지만 말한다 ("2.9%", "예상 2.7%"). 그런데 우리가 화면에 쓰는
# 전년비는 지수에서 직접 계산한 값이라 2.8734... 처럼 나오고, 반올림 전 값으로 비교하면
# 예상 2.7 에 실제 2.7049 인 달에도 "상회" 배지가 뜬다. 그건 상회가 아니라 우리 계산의
# 꼬리다. 공포·탐욕 구간을 정수로 반올림해서 고르는 것(`zone_of`)과 같은 이유다.
FORECAST_DECIMALS = 1

# 배지 색은 하나뿐이다 (맨 위 설명 참고)
TONE = "amber"

# 아래 규칙들이 실제로 들여다보는 지표. (장단기 금리차는 계산값이라 여기 없다.)
#
# 홈은 고른 지표만 읽는데 배지는 **고르지 않은 지표도 봐야 한다** — VIX 를 홈에서
# 내렸다고 공포 구간 배지가 사라지면 안 된다. 그래서 규칙이 무엇을 보는지 여기 적어두고,
# 홈은 딱 그만큼만 더 읽는다. 규칙을 늘릴 때 이 목록도 같이 늘려야 하고, 잊으면
# `test_macro_api.py` 의 "홈과 매크로 탭이 같은 배지를 말한다"가 잡는다.
WATCHED_CODES = ["VIX", "FEARGREED", *INFLATION_CODES]


def zone_of(code: str, value: float | None) -> dict | None:
    """이 값이 어느 구간인가. 구간이 정의된 지표가 아니거나 값이 없으면 `None`.

    돌려주는 `range` 는 화면에 그대로 적는 문자열이다 — "공포"만 적으면 33.7이 왜
    공포인지 알 수 없고, "25~44"가 붙으면 다음부터는 숫자만 보고도 읽힌다.
    """
    bands = ZONES.get(code)
    if bands is None or value is None:
        return None

    score = round(value)
    for low, high, label, extreme in bands:
        if score <= high:
            return {"label": label, "range": f"{low}~{high}", "extreme": extreme}

    # 100을 넘는 값(있을 수 없지만)은 맨 위 구간으로 본다
    low, high, label, extreme = bands[-1]
    return {"label": label, "range": f"{low}~{high}", "extreme": extreme}


# --- 배지 -------------------------------------------------------------------


def _badge(key: str, label: str, detail: str, as_of) -> dict:
    return {"key": key, "label": label, "detail": detail, "tone": TONE, "as_of": as_of}


def badges(series: list[dict], spread: dict | None = None) -> list[dict]:
    """지금 걸리는 규칙들. 아무것도 안 걸리면 빈 목록이다.

    **이미 계산된 스냅샷을 받는다** (`macro.snapshot` 이 만든 것). DB 를 다시 읽지
    않으므로 화면 한 장을 그리는 데 쿼리가 늘지 않고, 무엇보다 배지가 카드에 뜬 값과
    **같은 값**을 보고 판정한다 — 따로 읽으면 언젠가 카드는 어제 값, 배지는 오늘 값을
    말하게 된다.

    규칙이 서로를 모른다는 점이 중요하다. 셋이 동시에 뜰 수도 있고 그때도 합쳐서 한
    마디로 만들지 않는다.
    """
    by_code = {item.get("code"): item for item in series}
    found: list[dict] = []

    # 1. 장단기 금리 역전 — 10년물이 2년물보다 낮다
    if spread is not None and spread.get("value") is not None and spread["value"] < 0:
        found.append(
            _badge(
                "inverted_curve",
                "장단기 금리 역전",
                f"{spread.get('long_code', '10년물')} − {spread.get('short_code', '2년물')} "
                f"{spread['value']:+.2f}%p",
                spread.get("as_of"),
            )
        )

    # 2. 공포 구간 — VIX 가 높다
    vix = by_code.get("VIX")
    if vix and vix.get("value") is not None and vix["value"] > VIX_FEAR:
        found.append(
            _badge(
                "vix_fear",
                "공포 구간",
                f"VIX {vix['value']:.1f} (기준 {VIX_FEAR:.0f} 초과)",
                vix.get("as_of"),
            )
        )

    # 3. 공포·탐욕 지수가 극단 — 이름이 그대로 배지가 된다
    fg = by_code.get("FEARGREED")
    if fg:
        zone = zone_of("FEARGREED", fg.get("value"))
        if zone and zone["extreme"]:
            found.append(
                _badge(
                    "fear_greed_extreme",
                    zone["label"],
                    f"공포·탐욕 지수 {fg['value']:.0f}점 ({zone['range']})",
                    fg.get("as_of"),
                )
            )

    # 4. 물가가 예상을 상회 — 예상치가 **들어와 있는 달에만** 판정한다
    #
    #    우리가 정한 기준(2% 목표 같은 것)과는 비교하지 않는다. 그건 출처가 없는
    #    판정이고, 화면이 그걸 출처인 척 말하게 된다. 비교 대상은 사람이 넣었거나
    #    받아온 예상치뿐이다 — 없으면 이 배지는 그냥 안 뜬다.
    #
    #    지표마다 따로 뜬다. CPI 와 근원 PCE 가 같은 달에 둘 다 예상을 넘었다면 그건
    #    두 개의 사실이고, 합쳐서 한 마디로 만들면 어느 쪽이 얼마나 넘었는지가 사라진다.
    for code in INFLATION_CODES:
        item = by_code.get(code)
        if not item:
            continue
        badge = _above_forecast(item)
        if badge:
            found.append(badge)

    return found


def beats_forecast(actual: float | None, forecast: float | None) -> bool:
    """실제가 예상보다 높은가. 둘 다 발표되는 자리(소수 첫째)까지만 보고 판정한다."""
    if actual is None or forecast is None:
        return False
    return round(actual, FORECAST_DECIMALS) > round(forecast, FORECAST_DECIMALS)


def _above_forecast(item: dict) -> dict | None:
    """한 지표가 예상을 넘었으면 배지 하나.

    `pending_forecast`(아직 안 나온 달의 예상치)는 보지 않는다. 비교할 실제값이 없는
    예상치로 판정하면 그건 예측이지 사실이 아니다.
    """
    forecast = item.get("forecast")
    if not forecast:
        return None

    actual = item.get("value")
    if not beats_forecast(actual, forecast.get("value")):
        return None

    return _badge(
        f"inflation_above_forecast:{item.get('code')}",
        "물가 상회",
        # 이름·실제·예상을 다 적는다. "물가 상회"만 있으면 어느 물가가 얼마나 넘었는지,
        # 무엇과 비교한 것인지가 전부 빠진다.
        f"{item.get('name') or item.get('code')} {actual:.1f}% "
        f"(예상 {forecast['value']:.1f}% · {forecast.get('source_label') or forecast.get('source')})",
        item.get("as_of"),
    )
