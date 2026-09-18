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

# 지표가 실제로 쓰는 구간 (MA200 워밍업 포함). 이보다 오래된 데이터의 이상값은
# 지금의 시그널 판정에 영향을 주지 않는다.
INDICATOR_WINDOW_DAYS = 260

# 삼성전자 2018-05-04 액면분할(50:1) 직전 구간. 분할이 소급 반영된 종가라면 5만원대,
# 반영되지 않은 원본이라면 250만원대가 나온다.
SPLIT_CHECK = {
    "ticker": "005930.KS",
    "name": "삼성전자",
    "window": (dt.date(2018, 4, 1), dt.date(2018, 5, 3)),
    "adjusted_max": 200_000.0,
    "note": "2018-05-04 액면분할 50:1",
}

# 두 제공자의 종가를 "같은 기준"으로 볼 허용 오차. 소수점 반올림이나 체결 단위 차이는
# 이보다 훨씬 작고, 기준이 다르면(배당 조정 등) 이보다 크게 벌어진다.
SAME_BASIS_TOLERANCE_PCT = 0.1

# 모양이 다른 종목들 — 일반 보통주만 되고 나머지가 안 되는 경우를 잡는다
SHAPES = [
    ("069500.KS", "KODEX 200", "ETF"),
    ("005935.KS", "삼성전자우", "우선주"),
    ("247540.KQ", "에코프로비엠", "코스닥"),
    ("VOO", "Vanguard S&P 500", "해외 ETF"),
    ("7203.T", "도요타자동차", "일본 보통주"),
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

    # 2-2) 가격제한폭을 넘는 급변 — 아직 모르는 분할·병합을 찾는다.
    # 지표는 최근 구간만 쓰므로(MA200 워밍업 포함 약 260거래일), 아주 오래된 한두 날의
    # 이상값은 지금 판정에 영향을 주지 않는다. 둘을 나눠서 보여준다.
    changes = frame["close"].pct_change().abs() * 100
    spikes = changes[changes > MAX_DAILY_MOVE_PCT]
    recent_cutoff = frame.index[-INDICATOR_WINDOW_DAYS] if len(frame) > INDICATOR_WINDOW_DAYS else frame.index[0]
    recent_spikes = [(d, v) for d, v in spikes.items() if d >= recent_cutoff]
    old_spikes = [(d, v) for d, v in spikes.items() if d < recent_cutoff]

    if not recent_spikes:
        record("PASS", f"지표에 쓰이는 최근 구간({recent_cutoff} 이후)에 이상 급변이 없습니다")
    else:
        record("FAIL", f"최근 구간에 가격제한폭을 넘는 날이 {len(recent_spikes)}일 있습니다")
        for date, pct in recent_spikes[:5]:
            info(f"{date}: {pct:.1f}%")
        info("→ 반영되지 않은 분할·병합일 수 있습니다. 그 구간의 지표가 틀어집니다.")

    if old_spikes:
        info(
            f"참고: {recent_cutoff} 이전에도 {len(old_spikes)}일 있습니다 "
            f"(가장 이른 날 {old_spikes[0][0]}, {old_spikes[0][1]:.0f}%). "
            "지표는 최근 구간만 쓰므로 지금 판정에는 영향이 없습니다."
        )
except Exception as exc:
    record("FAIL", f"시세를 받지 못해 확인하지 못했습니다 — {brief(exc)}")


# ── 3. 제공자 간 종가 일치 ───────────────────────────────────────────
# 앱은 한 종목을 되도록 한 제공자에게서만 받지만, 그쪽이 막히면 다른 곳으로 넘어간다.
# 그때 종가 기준이 다르면 이어붙인 지점에서 지표가 튄다. 그래서 "얼마나 다른가"보다
# "언제 다른가"가 중요하다 — 마지막 날만 다르면 한쪽이 아직 장중/지연값인 것이고,
# 예전 날짜까지 다르면 기준 자체가 다른 것이다.
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
            diffs = []
            for date in common:
                a = float(naver_frame.loc[date, "close"])
                b = float(yahoo_frame.loc[date, "close"])
                if a:
                    diffs.append((date, abs(a - b) / a * 100, a, b))

            latest = diffs[-1]
            settled = diffs[:-1]  # 마지막 거래일을 뺀 나머지
            over = [d for d in settled if d[1] > SAME_BASIS_TOLERANCE_PCT]
            worst = max(settled, key=lambda d: d[1]) if settled else latest

            print(f"  겹치는 거래일 {len(diffs)}일")
            print(f"  마지막 거래일 {latest[0]}: 네이버 {latest[2]:,.0f} / 야후 {latest[3]:,.0f} "
                  f"({latest[1]:.3f}% 차이)")
            print(f"  그 이전 최대 차이: {worst[1]:.3f}% ({worst[0]})")

            if not over:
                record("PASS", f"마지막 거래일을 빼면 모든 날이 {SAME_BASIS_TOLERANCE_PCT}% 이내로 같습니다")
                if latest[1] > SAME_BASIS_TOLERANCE_PCT:
                    info("마지막 거래일만 다른 것은 한쪽이 아직 장중값이거나 반영이 늦은 경우로,")
                    info("다음 날 갱신하면 맞춰집니다. 기준이 다른 것이 아닙니다.")
            else:
                record("FAIL", f"지난 거래일 {len(over)}일이 {SAME_BASIS_TOLERANCE_PCT}% 넘게 다릅니다")
                for date, pct, a, b in over[:5]:
                    info(f"{date}: 네이버 {a:,.0f} / 야후 {b:,.0f} ({pct:.2f}%)")
                info("→ 종가 기준이 서로 다릅니다. 한 종목은 한 제공자로만 받아야 합니다.")
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
