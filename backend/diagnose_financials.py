"""재무 지표 출처 진단 (3b-0) — 받아올 수 있는지, 그리고 **어떤 모양으로 오는지.**

재무 지표를 붙이기 전에 한 번 돌린다. 개발 환경에서는 세 출처가 모두 막혀 있어서, 실제
응답의 모양(항목 이름·단위·공시일이 어디 붙는지)은 서버에서만 볼 수 있다. 이 출력을 보고
해석기를 만든다.

    미국  SEC EDGAR (companyfacts) — 값마다 공시일(filed)이 붙어 온다. 키 없음.
    한국  OpenDART                  — .env 의 DART_API_KEY 가 있어야 한다.
    일본  야후 (yfinance)           — 공시일이 없다. 다른 둘이 막혔을 때의 폴백이기도 하다.

사용법 (서버):
    docker compose exec app python diagnose_financials.py            # 등록된 종목 전부
    docker compose exec app python diagnose_financials.py AAPL 005930.KS 7203.T

출력 전체를 그대로 복사해 공유하면 된다. **키 값은 출력하지 않는다** — 오류 메시지에
주소째 섞여 나와도 지운다. 문의처(OPERATOR_CONTACT)도 값은 찍지 않는다.
"""

from __future__ import annotations

import collections
import datetime as dt
import io
import logging
import os
import sys
import time
import xml.etree.ElementTree as ET
import zipfile

import requests

LINE = "─" * 66
TIMEOUT = 30
MAX_TICKERS = 20
DEFAULT_TICKERS = ["AAPL", "JPM", "TSM", "005930.KS", "7203.T", "VOO"]

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
DART = "https://opendart.fss.or.kr/api/"

# 지표 하나에 회사마다 쓰는 이름이 여럿이다 — 앞의 것이 있으면 그것을 쓴다.
SEC_TAGS: dict[str, list[str]] = {
    "매출": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
            "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue"],
    "영업이익": ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
    "순이익": ["NetIncomeLoss", "ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
    "EPS(희석)": ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"],
    "자본": ["StockholdersEquity", "EquityAttributableToOwnersOfParent",
            "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"],
    "부채": ["Liabilities"],
    "영업현금흐름": ["NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"],
    "설비투자": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
             "PurchaseOfPropertyPlantAndEquipment",
             "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
    "주식수": ["EntityCommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding"],
    "주당배당": ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
}

DART_ACCOUNTS: dict[str, list[str]] = {
    "매출": ["ifrs-full_Revenue"],
    "영업이익": ["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"],
    "순이익(지배)": ["ifrs-full_ProfitLossAttributableToOwnersOfParent", "ifrs-full_ProfitLoss"],
    "EPS(기본)": ["ifrs-full_BasicEarningsLossPerShare"],
    "자본(지배)": ["ifrs-full_EquityAttributableToOwnersOfParent", "ifrs-full_Equity"],
    "부채": ["ifrs-full_Liabilities"],
    "영업현금흐름": ["ifrs-full_CashFlowsFromUsedInOperatingActivities"],
    "설비투자": ["ifrs-full_PurchaseOfPropertyPlantAndEquipment"],
}
# 사업보고서 · 반기 · 1분기 · 3분기
DART_REPORTS = {"11011": "사업보고서", "11012": "반기보고서", "11013": "1분기보고서", "11014": "3분기보고서"}

YAHOO_ROWS = {
    "손익": ("quarterly_income_stmt", ["Total Revenue", "Operating Income", "Net Income Common Stockholders",
                                       "Diluted EPS"]),
    "재무상태": ("quarterly_balance_sheet", ["Stockholders Equity", "Total Liabilities Net Minority Interest",
                                           "Ordinary Shares Number"]),
    "현금흐름": ("quarterly_cashflow", ["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow"]),
}

_SECRETS: list[str] = []


def section(title: str) -> None:
    print(f"\n{LINE}\n▶ {title}\n{LINE}")


def ok(msg: str) -> None:
    print(f"  [성공] {msg}")


def fail(msg: str) -> None:
    print(f"  [실패] {msg}")


def info(msg: str) -> None:
    print(f"         {msg}")


def scrub(text: str) -> str:
    """키가 오류 메시지에 주소째 섞여 나와도 지운다 (requests 는 실패한 주소를 그대로 적는다)."""
    for secret in _SECRETS:
        if secret:
            text = text.replace(secret, "***")
    return text


def brief(exc: BaseException, limit: int = 300) -> str:
    return scrub(f"{type(exc).__name__}: {str(exc)[:limit]}")


def market(ticker: str) -> str:
    if ticker.endswith((".KS", ".KQ")):
        return "KR"
    if ticker.endswith(".T"):
        return "JP"
    return "US"


def looks_like_email(value: str) -> bool:
    local, _, domain = value.strip().partition("@")
    return bool(local) and "." in domain and " " not in value.strip()


def sec_user_agents() -> list[tuple[str, str]]:
    """SEC 는 연락처가 든 User-Agent 를 요구한다. 문의처가 메일이면 그것을, 아니면 주소만."""
    contact = " ".join(os.environ.get("OPERATOR_CONTACT", "").split())
    site = os.environ.get("PUBLIC_URL", "").strip() or "https://asset-hub.duckdns.org"
    agents = []
    if looks_like_email(contact):
        agents.append(("문의처 메일", f"asset-hub {contact}"))
    agents.append(("사이트 주소만", f"asset-hub/1.0 (+{site})"))
    return agents


# ── 응답 요약 (순수 함수 — 테스트가 여기를 본다) ─────────────────────────────


def summarize_sec_fact(entries: list[dict]) -> dict:
    """한 태그의 값들을 요약한다: 몇 개, 어떤 서식, 같은 기간이 여러 번 공시됐는지, 최근 둘."""
    forms = collections.Counter(e.get("form", "?") for e in entries)
    filed_per_period: dict[tuple, set] = collections.defaultdict(set)
    for e in entries:
        filed_per_period[(e.get("start"), e.get("end"))].add(e.get("filed"))
    repeated = sum(1 for dates in filed_per_period.values() if len(dates) > 1)
    latest = sorted(entries, key=lambda e: (e.get("end") or "", e.get("filed") or ""))[-2:]
    return {"count": len(entries), "forms": dict(forms.most_common(4)), "repeated": repeated, "latest": latest}


def pick_sec_tag(facts: dict, names: list[str]) -> tuple[str, str, dict] | None:
    """(분류, 태그, 태그 내용). us-gaap → ifrs-full → dei 순서로 찾는다."""
    for name in names:
        for taxonomy in ("us-gaap", "ifrs-full", "dei"):
            node = facts.get(taxonomy, {}).get(name)
            if node:
                return taxonomy, name, node
    return None


# 항목이 없거나 낡았을 때 비슷한 태그를 찾을 실마리 (v0.23.2 결과: 릴리의 영업이익·부채·설비투자,
# 엔비디아의 설비투자가 2020년에 끊김)
SEC_HINTS = {
    "영업이익": "OperatingIncome", "부채": "Liabilities", "설비투자": "PaymentsToAcquire",
    "주당배당": "Dividend", "주식수": "SharesOutstanding", "매출": "Revenue",
}


def similar_tags(facts: dict, hint: str, limit: int = 6) -> list[tuple[str, str]]:
    """이름에 `hint` 가 든 us-gaap 태그와 그 마지막 결산일 — 최근 것부터."""
    found = []
    for name, node in facts.get("us-gaap", {}).items():
        if hint.lower() not in name.lower():
            continue
        ends = [e.get("end", "") for entries in node.get("units", {}).values() for e in entries]
        if ends:
            found.append((name, max(ends)))
    found.sort(key=lambda item: item[1], reverse=True)
    return found[:limit]


def latest_end(node: dict) -> str:
    return max((e.get("end", "") for entries in node.get("units", {}).values() for e in entries), default="")


def dart_filed_date(rcept_no: str) -> str:
    """접수번호 앞 8자리가 접수일이다 (20250311000123 → 2025-03-11)."""
    digits = (rcept_no or "")[:8]
    if len(digits) == 8 and digits.isdigit():
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"
    return "?"


def pick_dart_row(rows: list[dict], ids: list[str]) -> dict | None:
    for account_id in ids:
        for row in rows:
            if row.get("account_id") == account_id:
                return row
    return None


def parse_corp_codes(zipped: bytes) -> dict[str, tuple[str, str]]:
    """corpCode.xml(zip) → {종목코드 6자리: (고유번호, 회사명)}. 상장사만."""
    with zipfile.ZipFile(io.BytesIO(zipped)) as archive:
        xml = archive.read(archive.namelist()[0])
    codes = {}
    for item in ET.fromstring(xml).iter("list"):
        stock = (item.findtext("stock_code") or "").strip()
        if stock:
            codes[stock] = ((item.findtext("corp_code") or "").strip(), (item.findtext("corp_name") or "").strip())
    return codes


# ── 종목 고르기 ───────────────────────────────────────────────────────────


def tickers_to_check() -> list[str]:
    if len(sys.argv) > 1:
        return [t.strip().upper() for t in sys.argv[1:] if t.strip()]
    try:
        from app.db import SessionLocal
        from app.models import Instrument

        db = SessionLocal()
        try:
            found = sorted(t for (t,) in db.query(Instrument.ticker).all())
        finally:
            db.close()
        if found:
            if len(found) > MAX_TICKERS:
                print(f"  등록된 종목이 {len(found)}개라 앞의 {MAX_TICKERS}개만 봅니다")
            return found[:MAX_TICKERS]
        print("  등록된 종목이 없어 기본 목록으로 봅니다")
    except Exception as exc:
        print(f"  DB 를 못 읽어 기본 목록으로 봅니다 ({brief(exc, 120)})")
    return DEFAULT_TICKERS


# ── 1. SEC ────────────────────────────────────────────────────────────────


def check_sec(tickers: list[str]) -> None:
    section("1. 미국 — SEC EDGAR (companyfacts)")
    if not tickers:
        info("미국 종목이 없어 건너뜁니다")
        return
    session = requests.Session()
    mapping = None
    for label, agent in sec_user_agents():
        session.headers.update({"User-Agent": agent, "Accept-Encoding": "gzip, deflate"})
        try:
            response = session.get(SEC_TICKERS_URL, timeout=TIMEOUT)
            if response.status_code == 200:
                mapping = {row["ticker"].upper(): (row["cik_str"], row["title"])
                           for row in response.json().values()}
                ok(f"티커→CIK 목록 {len(mapping):,}개 (User-Agent: {label})")
                break
            fail(f"티커 목록 HTTP {response.status_code} (User-Agent: {label})")
        except Exception as exc:
            fail(f"티커 목록 — {brief(exc)} (User-Agent: {label})")
    if mapping is None:
        info("→ SEC 에 닿지 않습니다. 미국 종목은 야후(공시일 추정)로 받게 됩니다.")
        if not looks_like_email(os.environ.get("OPERATOR_CONTACT", "")):
            info("  SEC 는 연락처 메일이 든 User-Agent 를 요구합니다. .env 의 OPERATOR_CONTACT 가")
            info("  메일 주소가 아니라면, 그게 원인일 수 있습니다.")
        return

    for ticker in tickers:
        print(f"\n  ● {ticker}")
        hit = mapping.get(ticker.replace(".", "-")) or mapping.get(ticker)
        if not hit:
            info("SEC 목록에 없음 — ETF·펀드이거나 SEC 에 공시하지 않는 회사")
            continue
        cik, title = hit
        time.sleep(0.2)  # SEC 는 초당 10건까지
        try:
            response = session.get(SEC_FACTS_URL.format(cik=cik), timeout=TIMEOUT)
        except Exception as exc:
            fail(brief(exc))
            continue
        if response.status_code != 200:
            fail(f"companyfacts HTTP {response.status_code} — {title} (CIK {cik})")
            continue
        facts = response.json().get("facts", {})
        sizes = ", ".join(f"{k} {len(v)}" for k, v in facts.items())
        ok(f"{title} (CIK {cik}) — 태그 수: {sizes} / {len(response.content) / 1e6:.1f}MB")
        for metric, names in SEC_TAGS.items():
            picked = pick_sec_tag(facts, names)
            stale = picked is not None and latest_end(picked[2]) < f"{dt.date.today().year - 1}"
            if not picked or stale:
                info(f"{metric:<8} {'없음' if not picked else '최근 값 없음 (' + latest_end(picked[2]) + '까지)'}"
                     " — 비슷한 태그:")
                for tag, end in similar_tags(facts, SEC_HINTS.get(metric, "")) if metric in SEC_HINTS else []:
                    print(f"             us-gaap:{tag} (마지막 {end})")
                if not picked:
                    continue
            taxonomy, name, node = picked
            for unit, entries in node.get("units", {}).items():
                s = summarize_sec_fact(entries)
                print(f"         {metric:<8} {taxonomy}:{name} [{unit}] {s['count']}개 서식{s['forms']}"
                      f" 여러번공시 {s['repeated']}기간")
                for e in s["latest"]:
                    print(f"             start={e.get('start', '-')} end={e.get('end')} fy={e.get('fy')}"
                          f" fp={e.get('fp')} form={e.get('form')} filed={e.get('filed')}"
                          f" frame={e.get('frame', '-')} val={e.get('val')}")


# ── 2. DART ───────────────────────────────────────────────────────────────


def dart_get(path: str, key: str, **params) -> requests.Response:
    return requests.get(DART + path, params={"crtfc_key": key, **params}, timeout=TIMEOUT)


def check_dart(tickers: list[str]) -> None:
    section("2. 한국 — OpenDART")
    key = os.environ.get("DART_API_KEY", "").strip()
    _SECRETS.append(key)
    if not key:
        fail("DART_API_KEY 가 없습니다")
        info("→ https://opendart.fss.or.kr 에서 가입 → 인증키 신청(무료, 바로 발급)")
        info("  .env 에 DART_API_KEY=발급받은값 을 넣고 `docker compose up -d` 로 다시 띄운 뒤")
        info("  이 진단을 다시 돌려주세요. 키 값은 채팅에 붙이지 마세요.")
        return
    ok(f"키가 설정돼 있습니다 ({len(key)}자)")
    if not tickers:
        info("한국 종목이 없어 건너뜁니다")

    try:
        response = dart_get("corpCode.xml", key)
        if response.headers.get("Content-Type", "").startswith(("application/json", "text")):
            fail(f"고유번호 목록 대신 오류가 왔습니다: {scrub(response.text[:200])}")
            return
        codes = parse_corp_codes(response.content)
        ok(f"고유번호 목록 {len(codes):,}개 (상장사)")
    except Exception as exc:
        fail(f"고유번호 목록 — {brief(exc)}")
        return

    this_year = dt.date.today().year
    for ticker in tickers:
        print(f"\n  ● {ticker}")
        stock = ticker.split(".")[0]
        if stock not in codes:
            info("DART 목록에 없음 — ETF·ETN 이거나 상장사가 아님")
            continue
        corp, name = codes[stock]
        ok(f"{name} (고유번호 {corp})")

        # 가장 최근의 분기·반기 보고서와 지난해 사업보고서
        wanted = [(this_year, "11014"), (this_year, "11012"), (this_year, "11013"), (this_year - 1, "11014")]
        found_quarter = False
        for year, code in [(this_year - 1, "11011"), *wanted]:
            if code != "11011" and found_quarter:
                continue
            rows, fs = None, None
            for fs_div in ("CFS", "OFS"):
                try:
                    data = dart_get("fnlttSinglAcntAll.json", key, corp_code=corp, bsns_year=year,
                                    reprt_code=code, fs_div=fs_div).json()
                except Exception as exc:
                    fail(f"{year} {DART_REPORTS[code]} — {brief(exc)}")
                    break
                if data.get("status") == "000":
                    rows, fs = data.get("list", []), fs_div
                    break
                if data.get("status") not in ("013",):  # 013 = 자료 없음
                    fail(f"{year} {DART_REPORTS[code]} {fs_div} — {data.get('status')} {scrub(str(data.get('message')))}")
                    break
            if rows is None:
                continue
            if code != "11011":
                found_quarter = True
            sj = collections.Counter(r.get("sj_div") for r in rows)
            receipt = rows[0].get("rcept_no", "") if rows else ""
            print(f"         {year} {DART_REPORTS[code]} ({'연결' if fs == 'CFS' else '별도'}) {len(rows)}행"
                  f" {dict(sj)} 접수 {dart_filed_date(receipt)} 통화 {rows[0].get('currency') if rows else '?'}")
            for metric, ids in DART_ACCOUNTS.items():
                row = pick_dart_row(rows, ids)
                if not row:
                    print(f"             {metric:<10} 없음")
                    continue
                print(f"             {metric:<10} {row.get('sj_div')} {row.get('account_id')} "
                      f"당기={row.get('thstrm_amount')} 누적={row.get('thstrm_add_amount', '-')} "
                      f"기간={row.get('thstrm_nm')}")
            if not pick_dart_row(rows, DART_ACCOUNTS["매출"]):
                names = [r.get("account_id") for r in rows if r.get("sj_div") in ("IS", "CIS")][:12]
                info(f"손익 항목 이름들: {names}")

        # 정정 공시가 어떻게 보이는지 — 원래 공시일과 정정일을 가릴 수 있어야 한다
        try:
            data = dart_get("list.json", key, corp_code=corp, pblntf_ty="A", page_count=10,
                            bgn_de=f"{this_year - 1}0101", end_de=dt.date.today().strftime("%Y%m%d")).json()
            if data.get("status") == "000":
                for item in data.get("list", [])[:8]:
                    print(f"             공시목록 {item.get('rcept_dt')} {item.get('report_nm')}"
                          f" (접수번호 {item.get('rcept_no')})")
            else:
                fail(f"공시목록 — {data.get('status')} {scrub(str(data.get('message')))}")
        except Exception as exc:
            fail(f"공시목록 — {brief(exc)}")


# ── 3. 야후 ───────────────────────────────────────────────────────────────


def check_yahoo(tickers: list[str]) -> None:
    section("3. 야후 (일본 1순위, 나머지의 폴백)")
    try:
        import yfinance as yf

        print(f"  yfinance {yf.__version__}")
    except Exception as exc:
        fail(f"yfinance 임포트 불가 — {brief(exc)}")
        return

    for ticker in tickers:
        print(f"\n  ● {ticker}")
        handle = yf.Ticker(ticker)
        try:
            kind = (handle.get_info() or {}).get("quoteType", "?")
            print(f"         종류 {kind}")
        except Exception as exc:
            print(f"         종류 확인 실패 — {brief(exc, 120)}")
        for label, (attr, rows) in YAHOO_ROWS.items():
            try:
                frame = getattr(handle, attr)
            except Exception as exc:
                fail(f"{label} — {brief(exc, 160)}")
                continue
            if frame is None or frame.empty:
                fail(f"{label} — 비어 있음")
                continue
            dates = [str(c)[:10] for c in frame.columns]
            present = [r for r in rows if r in frame.index]
            missing = [r for r in rows if r not in frame.index]
            ok(f"{label} {len(dates)}분기 ({dates[-1]} ~ {dates[0]}) 있음 {present}"
               + (f" 없음 {missing}" if missing else ""))
            if present:
                series = frame.loc[present[0]]
                filled = int(series.notna().sum())
                print(f"             {present[0]}: 값 있는 분기 {filled}/{len(series)} 최근 {series.iloc[0]}")
        try:
            annual = handle.income_stmt
            if annual is not None and not annual.empty:
                print(f"         연간 손익 {len(annual.columns)}년 ({str(annual.columns[-1])[:10]} ~ "
                      f"{str(annual.columns[0])[:10]})")
        except Exception as exc:
            print(f"         연간 손익 실패 — {brief(exc, 120)}")
        # 실적 발표일 — 있으면 일본 종목의 '추정 공시일' 대신 쓸 수 있다
        try:
            dates = handle.get_earnings_dates(limit=12)
            if dates is None or dates.empty:
                print("         실적 발표일 없음")
            else:
                past = [str(d)[:10] for d in dates.index if d.to_pydatetime().date() <= dt.date.today()]
                print(f"         실적 발표일 (지난 것) {past[:6]}")
        except Exception as exc:
            print(f"         실적 발표일 실패 — {brief(exc, 120)}")


def main() -> None:
    # 앱과 yfinance 의 로그는 끈다 — 이 스크립트가 정리해서 찍으므로 겹치면 읽기 어렵다.
    # (불러오기만 할 때는 건드리지 않는다 — 테스트가 이 파일을 불러온다.)
    logging.getLogger("app").setLevel(logging.CRITICAL)
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    section("0. 설정")
    agents = sec_user_agents()
    print(f"  SEC User-Agent: {' → '.join(label for label, _ in agents)} 순서로 시도")
    print(f"  DART 키: {'있음' if os.environ.get('DART_API_KEY', '').strip() else '없음'}")
    tickers = tickers_to_check()
    print(f"  볼 종목 {len(tickers)}개: {', '.join(tickers)}")

    by_market: dict[str, list[str]] = collections.defaultdict(list)
    for ticker in tickers:
        by_market[market(ticker)].append(ticker)

    check_sec(by_market["US"])
    check_dart(by_market["KR"])
    check_yahoo(tickers)
    print(f"\n{LINE}\n끝. 위 출력 전체를 복사해 공유해주세요.\n")


if __name__ == "__main__":
    main()
