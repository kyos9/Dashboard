"""시세 수집 진단 — 어느 단계에서 막히는지 짚어낸다.

사용법 (backend 폴더에서, 가상환경 활성화 상태로):
    python diagnose.py            # VOO로 검사
    python diagnose.py QQQ        # 다른 티커로 검사

각 단계를 따로 검사하므로, 결과를 보면 원인이 네트워크 차단인지 / 백신·프록시의 TLS 간섭인지
/ 야후의 봇 차단인지 / 티커 오타인지 구분할 수 있다. 출력 전체를 그대로 복사해 공유하면 된다.
"""

from __future__ import annotations

import logging
import os
import platform
import socket
import sys
import traceback

# 앱과 yfinance의 로그는 끈다 — 이 스크립트가 직접 정리해서 출력하므로 중복이면 읽기 어렵다.
logging.getLogger("app").setLevel(logging.CRITICAL)
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

TICKER = sys.argv[1].upper() if len(sys.argv) > 1 else "VOO"
LINE = "─" * 66


def section(title: str) -> None:
    print(f"\n{LINE}\n▶ {title}\n{LINE}")


def ok(msg: str) -> None:
    print(f"  [성공] {msg}")


def fail(msg: str) -> None:
    print(f"  [실패] {msg}")


def info(msg: str) -> None:
    print(f"         {msg}")


def brief(exc: BaseException, limit: int = 300) -> str:
    return f"{type(exc).__name__}: {str(exc)[:limit]}"


# ── 1. 환경 ──────────────────────────────────────────────────────────
section("1. 실행 환경")
print(f"  파이썬 {sys.version.split()[0]}  /  {platform.system()} {platform.release()} {platform.machine()}")
net_env = {
    name: os.environ[name]
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY",
                 "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE", "CURL_CA_BUNDLE")
    if os.environ.get(name)
}
if net_env:
    for name, value in net_env.items():
        print(f"  환경변수 {name} = {value}")
else:
    print("  프록시/인증서 관련 환경변수 없음 (직접 연결)")

for package in ("yfinance", "curl_cffi", "requests", "pandas"):
    try:
        module = __import__(package)
        print(f"  {package} {getattr(module, '__version__', '?')}")
    except Exception as exc:
        fail(f"{package} 임포트 불가 — {brief(exc)}")


# ── 2. DNS ───────────────────────────────────────────────────────────
section("2. DNS 조회")
for host in ("query1.finance.yahoo.com", "fc.yahoo.com", "stooq.com"):
    try:
        ok(f"{host} → {socket.gethostbyname(host)}")
    except Exception as exc:
        fail(f"{host} — {brief(exc)}")


# ── 3. 평범한 HTTPS (requests) ───────────────────────────────────────
section("3. 평범한 HTTPS 연결 (requests)")
try:
    import requests

    for url in (
        "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d",
        "https://stooq.com/q/d/l/?s=voo.us&i=d",
    ):
        try:
            r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
            body = r.text[:80].replace("\n", " ")
            ok(f"HTTP {r.status_code}  {url.split('/')[2]}  본문앞부분={body!r}")
        except Exception as exc:
            fail(f"{url.split('/')[2]} — {brief(exc)}")
            info("→ TLS 오류(SSLError/CERTIFICATE_VERIFY_FAILED)라면 백신/방화벽이 통신을 가로채는 중일 수 있습니다.")
except Exception as exc:
    fail(f"requests 사용 불가 — {brief(exc)}")


# ── 4. curl_cffi (yfinance가 실제로 쓰는 통신 방식) ──────────────────
section("4. curl_cffi 연결 (yfinance가 쓰는 방식)")
try:
    from curl_cffi import requests as cffi_requests

    try:
        r = cffi_requests.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d",
            timeout=20,
            impersonate="chrome",
        )
        ok(f"HTTP {r.status_code}  본문 {len(r.text)}바이트")
        if r.status_code in (401, 403, 429):
            info("→ 야후가 차단/제한하고 있습니다 (IP 기준 rate limit 가능성).")
    except Exception as exc:
        fail(brief(exc))
        info("→ 여기서만 실패하고 3번이 성공했다면, 백신·방화벽이 브라우저 위장(TLS fingerprint) 통신을 막는 경우입니다.")
except Exception as exc:
    fail(f"curl_cffi 사용 불가 — {brief(exc)}")
    info("→ pip install --force-reinstall curl_cffi 로 재설치해보세요.")


# ── 5. yfinance 실제 호출 ────────────────────────────────────────────
section(f"5. yfinance로 {TICKER} 조회")
try:
    import yfinance as yf

    print("  5-1) yf.download() — 현재까지 쓰던 방식 (실패해도 예외를 안 냄)")
    try:
        df = yf.download(TICKER, period="1mo", interval="1d", auto_adjust=False, progress=False)
        if df is None or df.empty:
            fail("빈 결과 (이 방식으로는 원인을 알 수 없음 → 5-2 결과를 보세요)")
        else:
            ok(f"{len(df)}행, 마지막 날짜 {df.index[-1]}")
    except Exception as exc:
        fail(brief(exc))

    print("\n  5-2) Ticker.history(raise_errors=True) — 진짜 원인이 나오는 방식")
    try:
        df = yf.Ticker(TICKER).history(
            period="1mo", interval="1d", auto_adjust=False, actions=False,
            timeout=30, raise_errors=True,
        )
        if df is None or df.empty:
            fail("예외는 없지만 행이 0개 — 티커가 상장폐지됐거나 야후에 데이터가 없습니다.")
        else:
            ok(f"{len(df)}행, 마지막 날짜 {df.index[-1].date()}, 종가 {float(df['Close'].iloc[-1]):.2f}")
    except Exception as exc:
        fail(brief(exc, 500))
        print("\n  --- 전체 트레이스백 ---")
        traceback.print_exc()
except Exception as exc:
    fail(f"yfinance 사용 불가 — {brief(exc)}")


# ── 6. 앱이 실제로 쓰는 경로 (야후 → Stooq 폴백) ─────────────────────
section(f"6. 앱의 수집 경로로 {TICKER} 조회 (야후 실패 시 Stooq로 대체)")
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from app.services import providers

    print(f"  제공자 순서: {' → '.join(providers.configured_order())}")
    for provider in providers.build_providers():
        try:
            df = provider.fetch(TICKER, "6mo")
            ok(f"{provider.name}: {len(df)}행, 마지막 {df.index[-1]}, 종가 {df['close'].iloc[-1]:.2f}")
        except Exception as exc:
            fail(f"{provider.name}: {brief(exc, 400)}")

    print("\n  최종 결과 (폴백 포함):")
    try:
        df = providers.fetch_price_history(TICKER, "6mo")
        ok(f"{len(df)}행 확보 — 앱에서 정상 동작합니다.")
    except providers.AllProvidersFailed as exc:
        fail(str(exc)[:500])
        info(f"→ {exc.hint()}")
except Exception as exc:
    fail(f"앱 모듈을 불러오지 못했습니다 — {brief(exc)}")
    info("→ backend 폴더에서 실행했는지, 가상환경이 켜져 있는지 확인해주세요.")


print(f"\n{LINE}\n진단 완료 — 위 출력 전체를 복사해서 공유해주세요.\n{LINE}")
