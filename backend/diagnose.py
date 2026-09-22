"""시세 수집 진단 — 어느 단계에서 막히는지 짚어낸다.

사용법 (backend 폴더에서, 가상환경 활성화 상태로):
    python diagnose.py            # VOO로 검사
    python diagnose.py QQQ        # 다른 해외 종목
    python diagnose.py 005930.KS  # 국내 종목 (종목명 검색·환율까지 같이 검사)
    python diagnose.py 7203.T     # 일본 종목 (도요타)

각 단계를 따로 검사하므로, 결과를 보면 원인이 네트워크 차단인지 / 백신·프록시의 TLS 간섭인지
/ 야후의 봇 차단인지 / 티커 오타인지 구분할 수 있다. 출력 전체를 그대로 복사해 공유하면 된다.

마지막 9번은 매크로 지표(FRED)다. 시세와 다른 서버라 따로 막힐 수 있다.

서버(도커)에서 돌릴 때는:
    docker compose exec app python diagnose.py
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
for host in (
    "query1.finance.yahoo.com",
    "fc.yahoo.com",
    "stooq.com",
    "api.finance.naver.com",  # 국내주식 시세
    "kind.krx.co.kr",  # 국내 상장목록(종목명 검색)
):
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
        "https://api.finance.naver.com/siseJson.naver"
        "?symbol=005930&requestType=1&startTime=20260101&endTime=20260201&timeframe=day",
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




# ── 6. 앱이 실제로 쓰는 경로 ─────────────────────────────────────────
# 제공자 순서는 시장마다 다르다. 국내 종목은 네이버를 먼저 쓰므로, 여기서 티커의 시장을
# 판정한 다음 그 시장의 순서로 시도해야 앱과 같은 경로를 재현할 수 있다.
section(f"6. 앱의 수집 경로로 {TICKER} 조회")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app_modules = None
try:
    from app.markets import MARKET_LABEL, Market, market_of
    from app.services import providers

    app_modules = True
except Exception as exc:
    fail(f"앱 모듈을 불러오지 못했습니다 — {brief(exc)}")
    info("→ backend 폴더에서 실행했는지, 가상환경이 켜져 있는지 확인해주세요.")

market = None
if app_modules:
    market = market_of(TICKER)
    print(f"  시장 판정: {MARKET_LABEL.get(market, '해외')} ({market.value})")

    chain = providers.build_providers(TICKER)
    print(f"  설정된 순서: {' → '.join(providers.configured_order(market))}")
    print(f"  실제 시도 순서: {' → '.join(p.name for p in chain) if chain else '없음'}")
    if not chain:
        fail("이 티커를 다룰 수 있는 제공자가 없습니다 — 티커 형식을 확인해주세요.")

    for provider in chain:
        try:
            df = provider.fetch(TICKER, "6mo")
            ok(f"{provider.name}: {len(df)}행, 마지막 {df.index[-1]}, 종가 {df['close'].iloc[-1]:,.2f}")
        except Exception as exc:
            fail(f"{provider.name}: {brief(exc, 400)}")

    print("\n  최종 결과 (폴백 포함):")
    try:
        df = providers.fetch_price_history(TICKER, "6mo")
        ok(f"{len(df)}행 확보 — 앱에서 정상 동작합니다.")
    except providers.AllProvidersFailed as exc:
        fail(str(exc)[:500])
        # 앱의 안내는 "진단을 돌려보라"로 끝나는데, 지금이 바로 그 진단이라 빼고 보여준다
        info("→ " + exc.hint().split("backend 폴더에서")[0].strip())
    except Exception as exc:
        fail(f"예상치 못한 오류 — {brief(exc, 400)}")


# ── 7. 국내주식 전용 점검 ────────────────────────────────────────────
# 시세가 들어와도 종목을 못 찾으면 등록 자체가 안 된다. 검색 경로는 시세와 별개로 막힐
# 수 있으므로 (한국거래소 목록은 다른 서버다) 따로 확인한다.
if app_modules and market is Market.KR:
    section("7. 국내주식 전용 점검 (종목명 검색)")

    from app.markets import krx_code
    from app.services import symbols

    code = krx_code(TICKER)

    print("  7-1) 내장 목록에서 이 종목을 찾는지 (네트워크 없이)")
    try:
        found = [m for m in symbols.search(code, allow_network=False, limit=5) if m.ticker == TICKER]
        if found:
            ok(f"{found[0].name} ({found[0].ticker}) — 내장 목록에 있습니다")
        else:
            fail(f"{code}가 내장 목록에 없습니다 — 아래 7-2로 상장목록을 받아야 이름으로 검색됩니다")
    except Exception as exc:
        fail(brief(exc, 300))

    print("\n  7-2) 한국거래소 상장목록 받기 (신규 상장·사명 변경 반영용)")
    try:
        from app.services import krx

        listings = krx.fetch_all(timeout=30)
        boards = {}
        for item in listings:
            boards[item["board"]] = boards.get(item["board"], 0) + 1
        ok(f"{len(listings):,}종목 — {', '.join(f'{k} {v:,}' for k, v in sorted(boards.items()))}")
        sample = next((i for i in listings if i["code"] == code), None)
        if sample:
            ok(f"{code} → {sample['name']} ({sample['board']})")
    except Exception as exc:
        fail(brief(exc, 300))
        info("→ 실패해도 내장 목록(주요 종목)으로는 검색됩니다. 중소형주만 못 찾게 됩니다.")


# ── 8. 환율 ──────────────────────────────────────────────────────────
# 원화와 외화 종목을 같이 담으면 비중 계산에 환율이 필요하다. 못 받으면 화면이
# 추정치로 계산하므로, 여기서 실제로 받아지는지 확인한다.
#
# **통화별로 따로 본다.** 달러는 되는데 엔이 막히는 경우가 실제로 있다 (심볼이 다르다).
# 하나로 뭉뚱그리면 엔 종목만 비중이 틀린 채로 지나간다.
if app_modules:
    section("8. 환율 조회")
    try:
        from app.services import fx

        for currency in fx.tracked_currencies():
            try:
                rate = fx.fetch_krw_rate(currency, timeout=15)
            except Exception as exc:
                fail(f"{currency.value}: {brief(exc, 200)}")
                continue

            if rate is None:
                estimate = fx.FALLBACK_KRW.get(currency)
                fail(f"1{currency.value} 환율을 받지 못했습니다 — 화면은 추정치({estimate:,.0f}원)로 계산합니다")
                info("→ 리밸런싱 화면에서 직접 입력하면 정확한 비중으로 계산됩니다.")
            else:
                ok(f"1{currency.value} = {rate:,.2f}원")
    except Exception as exc:
        fail(brief(exc, 300))


# ── 9. 매크로 지표 ───────────────────────────────────────────────────
# 시세와 **다른 서버**(FRED)라 따로 막힐 수 있다. 화면에 지표가 안 뜰 때 원인이
# 네트워크인지 / 키인지 / 아직 받을 때가 안 된 것인지를 여기서 가른다.
if app_modules:
    section("9. 매크로 지표 (FRED)")

    import datetime as dt
    import time

    from app.services import macro, regime, providers
    from app.services.providers import fred

    print("  9-1) FRED API 키")
    if fred.api_key():
        ok("키가 설정돼 있습니다 — 값의 '발표일'까지 받아옵니다")
    else:
        info("키가 없습니다. 보통은 **문제가 아닙니다** — 아래 CSV 경로로 값은 그대로 받아옵니다.")
        info("→ 키를 넣으면 '그 값이 언제 발표됐나'가 더해집니다.")
        info("  그리고 **가는 서버가 바뀝니다**: api.stlouisfed.org (키) vs")
        info("  fred.stlouisfed.org (CSV). 아래 9-2 가 ReadTimeout 으로 막히는데")
        info("  다른 사이트는 멀쩡하다면, 키를 넣는 것이 그 자체로 해결책일 수 있습니다.")
        info("  https://fredaccount.stlouisfed.org/apikeys (무료) → .env 의 FRED_API_KEY")

    # **기간을 끊어서 묻는다.** 그냥 물으면 1962년부터 전부 달라는 뜻이 되는데,
    # `fredgraph.csv` 는 그래프 화면이 쓰는 주소라 범위가 넓을수록 서버가 느려진다.
    # "닿긴 하는가"를 보려고 60년치를 받다가 시간이 넘으면, 막힌 것도 아닌데
    # 막혔다고 읽힌다. 실제로 그 모습으로 한 번 헷갈렸다.
    print("\n  9-2) 키 없이 받는 길 (fred.stlouisfed.org CSV)")
    reachable = False
    try:
        began = time.monotonic()
        points = fred.FredCsvProvider(timeout=30).fetch(
            "DGS10", start=dt.date.today() - dt.timedelta(days=60)
        )
        took = time.monotonic() - began
        last = points[-1]
        ok(f"{len(points):,}행 ({took:.1f}초) — 가장 최근 {last.as_of} 미 국채 10년물 {last.value}%")
        reachable = True
    except Exception as exc:
        fail(brief(exc, 400))
        info("→ 위 2·3번(네트워크)이 전부 성공인데 여기만 막힌다면, 네트워크가 아니라")
        info("  **이 서버가 우리 쪽 IP 를 안 받아주는 것**입니다 (클라우드 IP 는 흔히 막힙니다).")
        info("  그때는 키를 받아 넣으세요 — 공식 API 는 주소가 달라 따로 열려 있는 경우가 많습니다.")

    # 닿는 건 확인했으니, 이번엔 **앱이 실제로 받는 만큼** 받아본다. 처음 한 번은
    # 20년치를 받으므로 여기서 시간이 넘치면 첫 수집만 실패한다 — 닿는 것과 다른 문제다.
    if reachable:
        # 앱이 실제로 쓰는 제한으로 재본다 — 여기만 다른 값을 쓰면 진단이 거짓말을 한다.
        macro_limit = providers._macro_timeout()
        print(f"\n  9-3) 앱이 처음 받는 만큼 ({macro.BACKFILL_YEARS}년치, 제한 {macro_limit}초)")
        try:
            began = time.monotonic()
            points = fred.FredCsvProvider(timeout=macro_limit).fetch(
                "DGS10", start=dt.date.today() - dt.timedelta(days=365 * macro.BACKFILL_YEARS)
            )
            took = time.monotonic() - began
            ok(f"{len(points):,}행 ({took:.1f}초)")
            if took > macro_limit * 0.8:
                info(f"→ 느립니다. 앱의 제한은 {macro_limit}초라 첫 수집이 아슬아슬합니다.")
                info("  .env 에 SIGNAL_DASHBOARD_HTTP_TIMEOUT=120 을 넣으면 넉넉해집니다.")
        except Exception as exc:
            fail(brief(exc, 300))
            info("→ 닿긴 하는데 20년치는 못 받습니다. .env 에"
                 " SIGNAL_DASHBOARD_HTTP_TIMEOUT=120 을 넣고 다시 띄워보세요.")

    if fred.api_key():
        print("\n  9-4) 공식 API (api.stlouisfed.org)")
        try:
            points = fred.FredApiProvider(timeout=20).fetch("DGS10")
            ok(f"{len(points):,}행 — 가장 최근 {points[-1].as_of}")
        except Exception as exc:
            fail(brief(exc, 400))
            info("→ API 가 막혀도 9-2 가 되면 값은 들어옵니다 (발표일만 못 받습니다).")

    print("\n  9-5) 지금 저장돼 있는 상태")
    try:
        from app.db import SessionLocal

        db = SessionLocal()
        try:
            rows = macro.active_series(db)
            if not rows:
                fail("지표 목록이 비어 있습니다 — 앱이 한 번도 안 떴거나 마이그레이션 전입니다")
            empty = 0
            for item in rows:
                last = macro.latest_as_of(db, item.code)
                if last is None:
                    empty += 1
                    state = "아직 받은 적 없음"
                elif macro.is_stale(db, item):
                    state = f"{last} (주기에 비해 오래됨)"
                else:
                    state = str(last)
                due = "받을 때가 됨" if macro.is_due(item) else "대기"
                # 한글은 화면에서 두 칸을 먹으므로 자릿수 패딩으로는 열이 안 맞는다.
                # 억지로 맞추는 대신 가운뎃점으로 나눈다.
                print(f"         {item.code:10s} {state} · {due}")
                if item.last_error:
                    fail(f"{item.code}: {item.last_error[:200]}")

            if empty == len(rows):
                if any(item.last_error for item in rows):
                    info("→ 받으러 가기는 했고 전부 실패했습니다. 위 [실패] 줄이 그 이유입니다.")
                else:
                    info("→ 아직 받으러 간 적이 없습니다. 앱을 켜고 1분쯤 기다리면 한 번 갑니다.")
        finally:
            db.close()
    except Exception as exc:
        fail(brief(exc, 300))
        info("→ 앱을 한 번 띄우면 표가 만들어지고 목록이 채워집니다.")

    # 9-5 가 "값이 들어와 있나"라면 이쪽은 **"화면이 그 값으로 무슨 말을 하나"**다.
    # 둘은 따로 틀릴 수 있다 — 값은 멀쩡한데 배지가 안 뜨거나(경계가 잘못됐거나),
    # 값이 없어서 안 뜨거나. 화면만 보고는 이 둘을 가릴 수 없다.
    print("\n  9-6) 지금 화면에 뜰 국면 배지")
    try:
        from app.db import SessionLocal

        db = SessionLocal()
        try:
            view = macro.overview(db)
            if view["badges"]:
                for badge in view["badges"]:
                    ok(f"{badge['label']} — {badge['detail']}")
            else:
                info("걸리는 규칙이 없습니다 (화면에도 '눈에 띄는 국면 없음'으로 뜹니다).")
                info(f"→ 기준: 금리차 < 0 · VIX > {regime.VIX_FEAR:.0f} · 공포·탐욕 지수가 양 극단")

            zones = [c for c in view["series"] if c.get("zone")]
            for card in zones:
                print(f"         {card['code']:10s} {card['value']} → {card['zone']['label']} 구간 ({card['zone']['range']})")

            pinned = view["pinned"]
            print(f"         홈 화면: {', '.join(pinned) if pinned else '(다 꺼둠)'}")
        finally:
            db.close()
    except Exception as exc:
        fail(brief(exc, 300))


# ── 10. 공포·탐욕 지수 ───────────────────────────────────────────────
# FRED 와 **또 다른 서버**(CNN)라 따로 막힌다. 게다가 문서 없는 주소라 어느 날 모양이
# 바뀔 수 있고, 그때 화면에는 "받지 못했습니다" 한 줄만 뜬다. 여기서 원인을 가른다.
if app_modules:
    section("10. 공포·탐욕 지수 (CNN)")

    from app.services.providers import cnn

    spec = next((s for s in macro.SEED_SERIES if s["code"] == "FEARGREED"), None)
    if spec is None:
        fail("지표 목록에 FEARGREED 가 없습니다 — 코드가 오래된 버전입니다")
    else:
        # **앱이 실제로 묻는 범위로 잰다.** 짧게만 물어보면 안 되는 상황에서도 성공이
        # 뜬다. 실제로 그랬다 — 여기서 60일치를 물어 성공했는데 앱은 처음 받을 때
        # 20년치를 물어 HTTP 500 을 받고 있었고, 진단만 보면 멀쩡해 보였다.
        # (FRED 9-2/9-3 에서 이미 한 번 배운 것을 여기에 적용하지 않았다.)
        provider = cnn.FearGreedProvider(timeout=providers._macro_timeout())
        windows = [
            ("최근 60일", dt.date.today() - dt.timedelta(days=60)),
            (f"앱이 처음 받는 만큼 ({macro.BACKFILL_YEARS}년치)",
             dt.date.today() - dt.timedelta(days=365 * macro.BACKFILL_YEARS)),
        ]
        failed = False
        for label, start in windows:
            try:
                began = time.monotonic()
                points = provider.fetch(spec["source_code"], start=start)
                took = time.monotonic() - began
                last = points[-1]
                ok(f"{label}: {len(points):,}행 ({took:.1f}초) — "
                   f"가장 최근 {last.as_of} {last.value:g}점 (처음 {points[0].as_of})")
            except Exception as exc:
                failed = True
                fail(f"{label}: {brief(exc, 400)}")

        if not failed:
            info("  (0 극단적 공포 ~ 100 극단적 탐욕)")
        else:
            info("→ **이것 하나만 안 되는 것은 큰 문제가 아닙니다.** 나머지 지표는 FRED 에서")
            info("  따로 받아오므로 그대로 들어옵니다.")
            info("  공식 API 가 아니라 CNN 지수 화면이 쓰는 주소를 그대로 부르는 것이라,")
            info("  저쪽이 모양을 바꾸거나 막으면 여기만 조용히 멈춥니다. 그때는 이 지표를")
            info("  꺼두고(macro_series.active) 나머지를 쓰면 됩니다.")


print(f"\n{LINE}\n진단 완료 — 위 출력 전체를 복사해서 공유해주세요.\n{LINE}")
