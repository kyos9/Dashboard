"""실제 시세가 들어오는 환경에서 "값이 맞는지"까지 확인하는 검증 스크립트.

`diagnose.py`는 **연결이 되는지**를 본다. 이 스크립트는 연결이 된 다음 문제인
**받은 값이 쓸 수 있는 값인지**를 본다. 둘은 다르다 — 화면에 숫자가 뜨는 것과
그 숫자가 맞는 것은 별개다.

사용법 (backend 폴더에서, 가상환경 활성화 상태로):
    python verify_live.py

자동 테스트로는 덮을 수 없는 것만 검사한다. 파싱 규칙이나 지표 공식은 이미
`pytest`가 고정하고 있으므로 여기서 다시 보지 않는다. 여기서 보는 것은
**바깥 서비스가 실제로 무엇을 돌려주는가**뿐이다:

  1. 네이버 응답의 컬럼 이름이 코드의 가정과 같은가
  2. 종가가 액면분할을 소급 반영한 값인가 (스펙이 요구하는 기준)
  3. 네이버와 야후가 같은 날 같은 종가를 주는가 (섞였을 때 지표가 튀지 않게)
  4. ETF·우선주·코스닥처럼 모양이 다른 종목도 받아지는가
  5. 환율이 실제로 받아지는가

출력 전체를 복사해서 공유하면 된다.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import sys

logging.getLogger("app").setLevel(logging.CRITICAL)
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

LINE = "─" * 70

# 한국 증시 일간 가격제한폭은 ±30%다. 이보다 크게 튀는 날이 있으면 실제 등락이 아니라
# 액면분할·병합이 종가에 반영되지 않았다는 뜻이다.
MAX_DAILY_MOVE_PCT = 35.0

# 삼성전자 2018-05-04 액면분할(50:1) 직전 구간. 분할이 소급 반영된 종가라면 5만원대,
# 반영되지 않은 원본이라면 250만원대가 나온다.
SPLIT_CHECK = {
    "ticker": "005930.KS",
    "name": "삼성전자",
    "window": (dt.date(2018, 4, 1), dt.date(2018, 5, 3)),
    "adjusted_max": 200_000.0,
    "note": "2018-05-04 액면분할 50:1",
}

# 모양이 다른 종목들 — 일반 보통주만 되고 나머지가 안 되는 경우를 잡는다
SHAPES = [
    ("069500.KS", "KODEX 200", "ETF"),
    ("005935.KS", "삼성전자우", "우선주"),
    ("247540.KQ", "에코프로비엠", "코스닥"),
    ("VOO", "Vanguard S&P 500", "해외 ETF"),
]

results: list[tuple[str, str]] = []  # (상태, 설명)


def section(title: str) -> None:
    print(f"\n{LINE}\n▶ {title}\n{LINE}")


def record(status: str, message: str) -> None:
    mark = {"PASS": "[통과]", "WARN": "[주의]", "FAIL": "[실패]"}[status]
    print(f"  {mark} {message}")
    results.append((status, message))


def info(message: str) -> None:
    print(f"         {message}")


def brief(exc: BaseException, limit: int = 220) -> str:
    return f"{type(exc).__name__}: {str(exc)[:limit]}"


try:
    from app.markets import krx_code
    from app.services import fx, providers
    from app.services.providers.naver import BASE_URL, COLUMN_MAP, HEADERS, NaverProvider
except Exception as exc:  # pragma: no cover - 실행 환경 문제
    print(f"앱 모듈을 불러오지 못했습니다 — {brief(exc)}")
    print("backend 폴더에서, 가상환경을 켠 상태로 실행해주세요.")
    raise SystemExit(1)


# ── 1. 네이버 응답 형식 ──────────────────────────────────────────────
# 코드는 한글 컬럼명으로 값을 찾는다(순서가 아니라 이름 기준). 그래서 컬럼이 늘거나
# 순서가 바뀌는 건 안전하지만, 이름이 바뀌면 조용히 깨진다. 실제 헤더를 눈으로 본다.
section("1. 네이버 응답의 컬럼 이름 확인")
try:
    import ast

    import requests

    end = dt.date.today()
    response = requests.get(
        BASE_URL,
        params={
            "symbol": "005930",
            "requestType": "1",
            "startTime": (end - dt.timedelta(days=10)).strftime("%Y%m%d"),
            "endTime": end.strftime("%Y%m%d"),
            "timeframe": "day",
        },
        headers=HEADERS,
        timeout=20,
    )
    rows = ast.literal_eval(response.text.strip())
    header = [str(c).strip() for c in rows[0]]
    print(f"  실제 헤더: {header}")
    print(f"  코드가 찾는 컬럼: {list(COLUMN_MAP)}")

    missing = [ko for ko in COLUMN_MAP if ko not in header]
    if missing:
        record("FAIL", f"컬럼 이름이 바뀌었습니다 — 없는 컬럼: {missing}")
        info("→ naver.py의 COLUMN_MAP을 실제 헤더에 맞춰야 합니다.")
    else:
        record("PASS", "코드가 찾는 컬럼이 모두 있습니다")
except Exception as exc:
    record("FAIL", f"응답을 받지 못했습니다 — {brief(exc)}")
    info("→ 먼저 `python diagnose.py 005930.KS`로 연결부터 확인해주세요.")


# ── 2. 액면분할 반영 여부 ────────────────────────────────────────────
# 스펙은 "분할 반영 + 배당 미조정" 종가를 요구한다. 분할이 반영되지 않으면 분할일에
# 가짜 급락이 생기고, MA·이격도·StdDev가 그 구간 내내 틀어진다.
section("2. 종가가 액면분할을 반영한 값인가")
try:
    frame = providers.fetch_price_history(SPLIT_CHECK["ticker"], "max")
    print(f"  {SPLIT_CHECK['name']} {len(frame):,}행 ({frame.index[0]} ~ {frame.index[-1]})")

    # 2-1) 알려진 분할 구간의 실제 값
    start, stop = SPLIT_CHECK["window"]
    window = frame.loc[[d for d in frame.index if start <= d <= stop]]
    if window.empty:
        record("WARN", f"{start}~{stop} 구간 데이터가 없어 분할 확인을 건너뜁니다")
    else:
        peak = float(window["close"].max())
        print(f"  {SPLIT_CHECK['note']} 직전 구간 최고 종가: {peak:,.0f}원")
        if peak <= SPLIT_CHECK["adjusted_max"]:
            record("PASS", "분할이 소급 반영된 종가입니다 (스펙 기준과 일치)")
        else:
            record("FAIL", f"분할 미반영 원본 종가로 보입니다 ({peak:,.0f}원)")
            info("→ 분할일에 가짜 급락이 생겨 그 구간의 지표가 전부 틀어집니다.")

    # 2-2) 전 구간에서 가격제한폭을 넘는 급변 — 아직 모르는 분할·병합을 찾는다
    changes = frame["close"].pct_change().abs() * 100
    spikes = changes[changes > MAX_DAILY_MOVE_PCT]
    if spikes.empty:
        record("PASS", f"전 구간에 일간 ±{MAX_DAILY_MOVE_PCT:.0f}% 초과 급변이 없습니다")
    else:
        record("WARN", f"가격제한폭을 넘는 날이 {len(spikes)}일 있습니다")
        for date, pct in list(spikes.items())[:5]:
            info(f"{date}: {pct:.1f}%")
        info("→ 실제 등락이 아니라 반영되지 않은 분할·병합일 수 있습니다.")
except Exception as exc:
    record("FAIL", f"시세를 받지 못해 확인하지 못했습니다 — {brief(exc)}")


# ── 3. 제공자 간 종가 일치 ───────────────────────────────────────────
# 백필은 네이버, 이후 갱신은 야후로 붙을 수 있다. 두 곳의 종가 기준이 다르면 한 시계열에
# 서로 다른 기준이 섞이고, 이어붙인 지점에서 지표가 튄다.
section("3. 네이버와 야후가 같은 종가를 주는가")
try:
    ticker = "005930.KS"
    naver_frame = NaverProvider(timeout=20).fetch(ticker, "6mo")
    yahoo_frame = None
    for provider in providers.build_providers(ticker):
        if provider.name == "yahoo":
            yahoo_frame = provider.fetch(ticker, "6mo")

    if yahoo_frame is None:
        record("WARN", "야후 제공자가 순서에 없어 비교를 건너뜁니다")
    else:
        common = sorted(set(naver_frame.index) & set(yahoo_frame.index))
        if not common:
            record("WARN", "겹치는 날짜가 없어 비교하지 못했습니다")
        else:
            worst_date, worst_pct = None, 0.0
            for date in common:
                a = float(naver_frame.loc[date, "close"])
                b = float(yahoo_frame.loc[date, "close"])
                if a:
                    diff = abs(a - b) / a * 100
                    if diff > worst_pct:
                        worst_date, worst_pct = date, diff
            print(f"  겹치는 거래일 {len(common)}일, 최대 차이 {worst_pct:.3f}% ({worst_date})")
            if worst_pct < 0.5:
                record("PASS", "두 제공자의 종가 기준이 같습니다 (섞여도 안전)")
            else:
                record("FAIL", f"종가 기준이 다릅니다 (최대 {worst_pct:.2f}% 차이)")
                info("→ 한 종목의 히스토리를 한 제공자로만 채우도록 고정해야 합니다.")
except Exception as exc:
    record("FAIL", f"비교하지 못했습니다 — {brief(exc)}")


# ── 4. 모양이 다른 종목 ──────────────────────────────────────────────
# 보통주만 되고 ETF·우선주가 안 되는 경우를 잡는다. 200거래일이 안 되는 종목은
# MA200이 비는 게 정상이므로, 그것도 같이 알려준다.
section("4. ETF·우선주·코스닥·해외 종목")
for ticker, name, kind in SHAPES:
    try:
        frame = providers.fetch_price_history(ticker, "2y")
        last_close = float(frame["close"].iloc[-1])
        unit = "원" if krx_code(ticker) else "달러"
        digits = 0 if krx_code(ticker) else 2
        record("PASS", f"{kind} {name} ({ticker}): {len(frame):,}행, 최근 종가 {last_close:,.{digits}f}{unit}")
        if len(frame) < 200:
            info(f"거래일이 {len(frame)}일뿐이라 MA200은 아직 계산되지 않습니다 (정상)")
    except Exception as exc:
        record("FAIL", f"{kind} {name} ({ticker}): {brief(exc, 160)}")


# ── 5. 환율 ──────────────────────────────────────────────────────────
section("5. 원/달러 환율")
try:
    rate = fx.fetch_usd_krw(timeout=15)
    if rate is None:
        record("WARN", f"환율을 받지 못했습니다 — 화면은 추정치({fx.FALLBACK_USD_KRW:,.0f}원)로 계산합니다")
        info("→ 리밸런싱 화면에서 직접 입력하면 정확한 비중으로 계산됩니다.")
    else:
        record("PASS", f"1달러 = {rate:,.2f}원")
except Exception as exc:
    record("FAIL", f"환율 조회 중 오류 — {brief(exc)}")


# ── 요약 ─────────────────────────────────────────────────────────────
section("검증 요약")
counts = {"PASS": 0, "WARN": 0, "FAIL": 0}
for status, _ in results:
    counts[status] += 1
print(f"  통과 {counts['PASS']} · 주의 {counts['WARN']} · 실패 {counts['FAIL']}")

if counts["PASS"] == 0 and counts["FAIL"]:
    # 하나도 못 받았다면 값의 문제가 아니라 연결의 문제다. 똑같은 프록시 오류를
    # 일곱 번 나열해봐야 읽을 수 없으므로 할 일 한 줄만 남긴다.
    print("\n  바깥 서비스에서 아무것도 받지 못해 검증을 시작하지 못했습니다.")
    print("  → 먼저 `python diagnose.py 005930.KS`로 어디서 막히는지 확인해주세요.")
elif counts["FAIL"]:
    print("\n  실패 항목:")
    for status, message in results:
        if status == "FAIL":
            print(f"    · {message}")
    print("\n  → 이 출력 전체를 복사해서 공유해주세요.")
elif counts["WARN"]:
    print("\n  치명적인 문제는 없습니다. 주의 항목만 확인해주세요.")
else:
    print("\n  전부 통과 — 받아온 값을 그대로 믿고 써도 됩니다.")

print(LINE)
raise SystemExit(1 if counts["FAIL"] else 0)
