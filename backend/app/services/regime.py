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

# 배지 색은 하나뿐이다 (맨 위 설명 참고)
TONE = "amber"

# 아래 규칙들이 실제로 들여다보는 지표. (장단기 금리차는 계산값이라 여기 없다.)
#
# 홈은 고른 지표만 읽는데 배지는 **고르지 않은 지표도 봐야 한다** — VIX 를 홈에서
# 내렸다고 공포 구간 배지가 사라지면 안 된다. 그래서 규칙이 무엇을 보는지 여기 적어두고,
# 홈은 딱 그만큼만 더 읽는다. 규칙을 늘릴 때 이 목록도 같이 늘려야 하고, 잊으면
# `test_macro_api.py` 의 "홈과 매크로 탭이 같은 배지를 말한다"가 잡는다.
WATCHED_CODES = ["VIX", "FEARGREED"]


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

    # 4. "물가가 예상을 상회" 는 예측치(ROADMAP 3a-4)가 들어온 뒤에 붙인다. 지금은
    #    비교할 예상치가 없어서, 넣으면 우리가 정한 기준(2% 목표 같은 것)을 출처인 척
    #    말하게 된다.

    return found
