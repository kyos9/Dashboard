"""OpenDART — 한국 상장사 재무 (ROADMAP 3b-2).

운영자 키 하나(`DART_API_KEY`, 무료)로 부른다. 사용자의 키가 아니다 — 공용 데이터라서.
키가 없으면 한국 종목 재무는 비워 두고 그 이유를 화면에 적는다 (앱은 그대로 돈다).

**공시일은 접수번호 앞 8자리다** (20250514000123 → 2025-05-14). 보고서마다 하나.

SEC 와 다른 점 — 그래서 여기서 받는 방법이 다르다:

- 회사 전체를 한 번에 주지 않는다. **보고서 하나(연도 × 1분기·반기·3분기·사업)에 한 번씩**
  묻는다. 처음 받을 때 7년 × 4 = 28번, 그 뒤로는 최근 1년 남짓의 보고서만 다시 본다.
- 기간 날짜를 주지 않는다. 사업연도와 보고서 종류로 만든다 — 그래서 **12월 결산 회사만**
  읽는다. 결산월이 다른 회사는 "아직 못 읽음"으로 둔다.
- 손익은 3개월 값(`thstrm_amount`)과 누적 값(`thstrm_add_amount`)이 같이 오고, 현금흐름은
  누적만, 재무상태는 그 시점 값이다. 사업보고서의 손익은 1년 값이다.
- 비교 기간(전기) 값도 같이 오지만 쓰지 않는다. 그 값의 공시일은 **그 보고서**의 날이라,
  원래 공시된 날을 알려면 원래 보고서를 물어야 한다.
- 연결(CFS)이 있으면 연결, 없으면 별도(OFS). 한 회사 안에서는 하나로 맞춘다 — 섞으면
  작년 같은 분기 대비가 엉뚱해진다.
- 정정 공시가 나오면 이 API 는 정정된 값을 정정한 날의 접수번호로 준다. 원래 값을 이미
  받아 뒀으면 값이 바뀐 경우에만 새 줄이 생긴다(`fundamentals._save_facts`). 처음 받는 게
  정정 뒤라면 그 값은 정정일부터 알던 것이 된다 — 늦게 아는 쪽으로 틀린다(앞당기지 않는다).
- 표준 계정 이름(`ifrs-full_Revenue`)을 안 쓰는 회사가 있다(`-표준계정코드 미사용-`).
  그때는 계정 이름(매출액·영업수익…)으로 찾는다.
- 발행주식수와 배당은 재무제표 밖에 있다 — 주식 총수(`stockTotqySttus`), 배당에 관한
  사항(`alotMatter`)을 따로 묻는다. PBR·배당수익률에만 쓰므로 못 받아도 나머지는 낸다.

키는 주소의 `crtfc_key` 로 간다(DART 가 그렇게만 받는다). 그래서 **요청 주소를 오류 문장에
넣지 않는다** — requests 의 예외 문장에는 주소가 통째로 들어 있다.
"""

from __future__ import annotations

import datetime as dt
import io
import logging
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass

import requests

from app.services.providers.sec import ParsedFacts

logger = logging.getLogger(__name__)

SOURCE = "dart"
BASE = "https://opendart.fss.or.kr/api/"

# DART 는 분당 호출이 몰리면 막는다 — 띄워서 부른다
MIN_INTERVAL = 0.2
TIMEOUT = 30
# SEC 와 같다 — PER 5년 위치 + TTM 1년 + 전년 비교 1년
KEEP_YEARS = 7
# 처음 받은 뒤에는 기간이 이만큼 안쪽에서 끝난 보고서만 다시 본다 (새 공시와 정정)
RECENT_DAYS = 400
# 기간이 끝나고 이만큼은 보고서가 나올 수 없다 — 묻지 않는다
EARLIEST_FILING_DAYS = 20

# (보고서 코드, 이름, 끝나는 달)
REPORTS = [
    ("11013", "1분기보고서", 3),
    ("11012", "반기보고서", 6),
    ("11014", "3분기보고서", 9),
    ("11011", "사업보고서", 12),
]
REPORT_NAME = {code: name for code, name, _ in REPORTS}
FS_NAME = {"CFS": "연결", "OFS": "별도"}

IS = ("IS", "CIS")   # 손익계산서 · 포괄손익계산서
BS = ("BS",)
CF = ("CF",)

# 항목 → (어느 표, 기간 종류, 표준 계정 id(앞이 먼저), 계정 이름(표준 id 가 없을 때))
#   기간 종류: "flow" 손익(3개월·누적), "ytd" 현금흐름(누적만), "instant" 재무상태
ACCOUNTS: dict[str, tuple[tuple[str, ...], str, list[str], list[str]]] = {
    "revenue": (IS, "flow", ["ifrs-full_Revenue"], ["매출액", "수익(매출액)", "영업수익", "매출"]),
    "operating_income": (IS, "flow", ["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"],
                         ["영업이익", "영업이익(손실)"]),
    # 지배주주 몫 — EPS·ROE 와 같은 기준. 별도재무제표에는 없어서 당기순이익으로 간다.
    "net_income": (IS, "flow", ["ifrs-full_ProfitLossAttributableToOwnersOfParent", "ifrs-full_ProfitLoss"],
                   ["지배기업의소유주에게귀속되는당기순이익", "지배기업소유주지분", "당기순이익", "당기순이익(손실)"]),
    # 희석이 없으면 기본 (한국 회사는 대개 둘이 같다)
    "eps_diluted": (IS, "flow", ["ifrs-full_DilutedEarningsLossPerShare", "ifrs-full_BasicEarningsLossPerShare",
                                 "ifrs-full_BasicAndDilutedEarningsLossPerShare"],
                    ["희석주당이익", "희석주당이익(손실)", "기본주당이익", "기본주당이익(손실)",
                     "기본및희석주당이익", "기본및희석주당이익(손실)"]),
    "equity": (BS, "instant", ["ifrs-full_EquityAttributableToOwnersOfParent", "ifrs-full_Equity"],
               ["지배기업소유주지분", "지배기업의소유주에게귀속되는자본", "자본총계"]),
    "liabilities": (BS, "instant", ["ifrs-full_Liabilities"], ["부채총계"]),
    "operating_cf": (CF, "ytd", ["ifrs-full_CashFlowsFromUsedInOperatingActivities"],
                     ["영업활동현금흐름", "영업활동으로인한현금흐름"]),
    # 나가는 돈이라 음수로 적는 회사가 많다 — 크기만 쓴다 (SEC 의 Payments… 는 양수다)
    # 삼성전자는 앞의 이름으로 내지 않는다 (서버 진단 v0.26.0) — 투자활동 분류가 붙은 이름이 흔하다
    "capex": (CF, "ytd", ["ifrs-full_PurchaseOfPropertyPlantAndEquipment",
                          "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
              ["유형자산의취득", "유형자산취득"]),
}

UNIT = {"eps_diluted": "KRW/shares", "dps": "KRW/shares", "shares": "shares"}

# 없으면 "공시에 없는 항목"으로 알려줄 것들 (sec.REPORTED_METRICS 와 같다)
REPORTED_METRICS = ("revenue", "operating_income", "net_income", "eps_diluted", "equity",
                    "operating_cf", "capex")

# DART 의 상태 코드 → 사람이 읽는 한 줄. 013 은 "자료 없음"이라 오류가 아니다.
NO_DATA = "013"
STATUS_MESSAGES = {
    "010": "DART 키가 등록되지 않았습니다 — 키 값을 확인하세요",
    "011": "DART 키를 쓸 수 없습니다 (일시 중지·해지)",
    "012": "이 서버의 IP 로는 DART 를 부를 수 없습니다",
    "014": "DART 에 파일이 없습니다",
    "020": "DART 하루 호출 한도를 넘었습니다 — 내일 다시 받습니다",
    "021": "DART 조회 회사 수 한도를 넘었습니다",
    "100": "DART 요청 값이 잘못됐습니다",
    "101": "DART 가 이 접근을 막았습니다",
    "800": "DART 가 점검 중입니다",
    "900": "DART 에 알 수 없는 오류가 났습니다",
    "901": "DART 키의 개인정보 보유기간이 끝났습니다 — 키를 다시 받아야 합니다",
}


class DartError(Exception):
    """DART 에서 받지 못했다. 메시지는 사람이 읽는 한 줄이고 **키가 들어 있지 않다.**"""


class NotListed(DartError):
    """DART 상장사 목록에 없다 — ETF·ETN·우선주이거나 상장사가 아니다."""


class NoKey(DartError):
    """운영자가 DART 키를 넣지 않았다."""


NO_KEY_MESSAGE = "운영자가 DART 키를 넣지 않아 한국 종목 재무를 받지 못합니다"


def api_key() -> str:
    return (os.getenv("DART_API_KEY") or "").strip()


# --- 부르기 ---------------------------------------------------------------------

_lock = threading.Lock()
_last_call = 0.0


def _get(path: str, params: dict) -> requests.Response:
    """DART 에 한 번 묻는다. 테스트는 이것을 바꿔 끼운다."""
    global _last_call
    key = api_key()
    if not key:
        raise NoKey(NO_KEY_MESSAGE)
    with _lock:
        wait = MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
    try:
        return requests.get(BASE + path, params={"crtfc_key": key, **params}, timeout=TIMEOUT)
    except requests.RequestException as exc:
        # 예외 문장에는 키가 든 주소가 있다 — 이름만 올리고 원래 예외는 잇지 않는다
        raise DartError(f"DART 에 연결하지 못했습니다 ({type(exc).__name__})") from None


def _json(path: str, **params) -> dict | None:
    """JSON API 하나. 자료가 없으면(013) None."""
    response = _get(path, params)
    if response.status_code != 200:
        raise DartError(f"DART HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError:
        raise DartError("DART 가 알 수 없는 응답을 보냈습니다") from None
    status = str((data or {}).get("status", ""))
    if status == "000":
        return data
    if status == NO_DATA:
        return None
    raise DartError(STATUS_MESSAGES.get(status, f"DART 오류 {status}"))


# --- 회사 목록 -------------------------------------------------------------------

_corps: dict[str, str] | None = None
_corps_at = 0.0
CORPS_TTL = 24 * 3600
_fiscal_month: dict[str, int] = {}


def reset() -> None:
    """기억해 둔 회사 목록·결산월을 버린다 (테스트)."""
    global _corps, _corps_at
    _corps, _corps_at = None, 0.0
    _fiscal_month.clear()


def parse_corp_codes(zipped: bytes) -> dict[str, str]:
    """corpCode.xml(zip) → {종목코드 6자리: 고유번호 8자리}. 종목코드가 있는(상장) 회사만."""
    with zipfile.ZipFile(io.BytesIO(zipped)) as archive:
        xml = archive.read(archive.namelist()[0])
    codes: dict[str, str] = {}
    for item in ET.fromstring(xml).iter("list"):
        stock = (item.findtext("stock_code") or "").strip()
        corp = (item.findtext("corp_code") or "").strip()
        if stock and corp:
            codes[stock] = corp
    return codes


def _corp_codes() -> dict[str, str]:
    global _corps, _corps_at
    if _corps is None or time.monotonic() - _corps_at > CORPS_TTL:
        response = _get("corpCode.xml", {})
        if response.status_code != 200:
            raise DartError(f"DART 회사 목록 HTTP {response.status_code}")
        # 오류면 zip 대신 JSON/XML 로 상태 코드가 온다
        if not response.content.startswith(b"PK"):
            match = re.search(rb"<status>(\d+)</status>|\"status\"\s*:\s*\"(\d+)\"", response.content)
            status = (match.group(1) or match.group(2)).decode() if match else ""
            raise DartError(STATUS_MESSAGES.get(status, "DART 회사 목록 대신 오류가 왔습니다"))
        try:
            _corps = parse_corp_codes(response.content)
        except (zipfile.BadZipFile, ET.ParseError, IndexError, KeyError):
            raise DartError("DART 회사 목록을 읽지 못했습니다") from None
        _corps_at = time.monotonic()
    return _corps


def stock_code(ticker: str) -> str | None:
    """`005930.KS` → `005930`. 한국 종목 모양이 아니면 None."""
    match = re.match(r"^(\d{6})\.K[SQN]$", ticker.strip().upper())
    return match.group(1) if match else None


def corp_for(ticker: str) -> str:
    code = stock_code(ticker)
    corp = _corp_codes().get(code) if code else None
    if corp is None:
        raise NotListed("DART 상장사 목록에 없습니다 — ETF·ETN·우선주이거나 상장사가 아닙니다")
    return corp


def fiscal_month(corp: str) -> int:
    """결산월. 회사마다 한 번만 묻는다."""
    if corp not in _fiscal_month:
        data = _json("company.json", corp_code=corp) or {}
        try:
            _fiscal_month[corp] = int(str(data.get("acc_mt", "")).strip())
        except ValueError:
            raise DartError("DART 회사 정보에 결산월이 없습니다") from None
    return _fiscal_month[corp]


# --- 기간과 값 -------------------------------------------------------------------

@dataclass(frozen=True)
class Report:
    year: int
    code: str

    @property
    def name(self) -> str:
        return REPORT_NAME[self.code]

    @property
    def end_month(self) -> int:
        return next(month for code, _, month in REPORTS if code == self.code)

    @property
    def end(self) -> dt.date:
        month = self.end_month
        return dt.date(self.year, month, 30 if month in (6, 9) else 31)

    @property
    def ytd(self) -> tuple[dt.date, dt.date]:
        """사업연도 시작부터 (12월 결산)."""
        return dt.date(self.year, 1, 1), self.end

    @property
    def quarter(self) -> tuple[dt.date, dt.date]:
        """이 보고서의 마지막 3개월."""
        return dt.date(self.year, self.end_month - 2, 1), self.end


def wanted_reports(today: dt.date, backfill: bool) -> list[Report]:
    """물어볼 보고서 — 최근 것부터. 아직 나올 수 없는 것은 뺀다."""
    out = []
    for year in range(today.year, today.year - KEEP_YEARS, -1):
        for code, _, _ in reversed(REPORTS):
            report = Report(year, code)
            if (today - report.end).days < EARLIEST_FILING_DAYS:
                continue
            if not backfill and (today - report.end).days > RECENT_DAYS:
                continue
            out.append(report)
    return out


def amount(text) -> float | None:
    """"1,234" · "-1,234" · "(1,234)" → 숫자. 빈칸·"-" 는 None."""
    if text is None:
        return None
    s = str(text).strip().replace(",", "").replace(" ", "")
    negative = s.startswith("(") and s.endswith(")")
    if negative:
        s = s[1:-1]
    if s in ("", "-"):
        return None
    try:
        value = float(s)
    except ValueError:
        return None
    return -value if negative else value


def filed_date(rcept_no) -> dt.date | None:
    digits = str(rcept_no or "")[:8]
    try:
        return dt.datetime.strptime(digits, "%Y%m%d").date()
    except ValueError:
        return None


def _plain(name) -> str:
    return re.sub(r"\s+", "", str(name or ""))


def pick(rows: list[dict], statements: tuple[str, ...], ids: list[str], names: list[str]) -> dict | None:
    """표준 계정 id 가 먼저, 없으면 계정 이름. 같은 id 가 두 표에 있으면 앞 표(손익 → 포괄손익)."""
    candidates = sorted((r for r in rows if r.get("sj_div") in statements),
                        key=lambda r: statements.index(r.get("sj_div")))
    for account_id in ids:
        for alias in (account_id, account_id.replace("ifrs-full_", "ifrs_")):
            for row in candidates:
                if row.get("account_id") == alias:
                    return row
    wanted = [_plain(n) for n in names]
    for name in wanted:
        for row in candidates:
            if _plain(row.get("account_nm")) == name:
                return row
    return None


def parse_report(rows: list[dict], report: Report, fs_div: str) -> list[dict]:
    """보고서 하나(fnlttSinglAcntAll 의 list) → 저장할 행."""
    filed = next((d for d in (filed_date(r.get("rcept_no")) for r in rows) if d), None)
    if filed is None:
        return []
    form = f"{report.name}({FS_NAME.get(fs_div, fs_div)})"
    out: list[dict] = []

    def add(metric: str, period: tuple[dt.date, dt.date], value: float | None, tag: str) -> None:
        if value is None:
            return
        out.append({
            "metric": metric,
            "period_start": period[0],
            "period_end": period[1],
            "value": abs(value) if metric == "capex" else value,
            "unit": UNIT.get(metric, "KRW"),
            "filed_at": filed,
            "filed_estimated": False,
            "source": SOURCE,
            "form": form,
            "tag": tag,
        })

    for metric, (statements, kind, ids, names) in ACCOUNTS.items():
        row = pick(rows, statements, ids, names)
        if row is None:
            continue
        tag = str(row.get("account_id") or "")
        if tag.startswith("-") or not tag:
            tag = _plain(row.get("account_nm"))
        current = amount(row.get("thstrm_amount"))
        if kind == "instant":
            add(metric, (report.end, report.end), current, tag)
        elif kind == "ytd" or report.code in ("11011", "11013"):
            # 현금흐름은 늘 누적. 사업보고서는 1년, 1분기는 3개월이 곧 누적이다.
            add(metric, report.ytd, current, tag)
        else:
            cumulative = amount(row.get("thstrm_add_amount"))
            if cumulative is None:
                # 누적 칸이 비었으면 당기 칸을 누적으로 본다 — 3개월로 잘못 보면 분기가 부풀려진다
                add(metric, report.ytd, current, tag)
            else:
                add(metric, report.quarter, current, tag)
                add(metric, report.ytd, cumulative, tag)
    return out


def parse_shares(rows: list[dict], report: Report, filed: dt.date) -> list[dict]:
    """주식의 총수 → 유통주식수 (보통주 + 우선주, 자기주식 제외). 자본이 둘 다의 몫이라서."""
    by_kind = {_plain(r.get("se")): r for r in rows}
    row = by_kind.get("합계") or by_kind.get("보통주")
    if row is None:
        return []
    shares = amount(row.get("distb_stock_co"))
    if shares is None:
        issued, treasury = amount(row.get("istc_totqy")), amount(row.get("tesstk_co")) or 0.0
        shares = issued - treasury if issued is not None else None
    if not shares or shares <= 0:
        return []
    return [{
        "metric": "shares", "period_start": report.end, "period_end": report.end, "value": shares,
        "unit": "shares", "filed_at": filed, "filed_estimated": False, "source": SOURCE,
        "form": f"{report.name}(주식총수)", "tag": "distb_stock_co",
    }]


def parse_dividend(rows: list[dict], report: Report, filed: dt.date) -> list[dict]:
    """배당에 관한 사항(사업보고서) → 보통주 1주당 현금배당, 1년 값."""
    for row in rows:
        if _plain(row.get("se")).startswith("주당현금배당금") and _plain(row.get("stock_knd")) in ("보통주", ""):
            value = amount(row.get("thstrm"))
            if value is None or value < 0:
                return []
            start, end = report.ytd
            return [{
                "metric": "dps", "period_start": start, "period_end": end, "value": value,
                "unit": "KRW/shares", "filed_at": filed, "filed_estimated": False, "source": SOURCE,
                "form": f"{report.name}(배당)", "tag": "주당현금배당금",
            }]
    return []


# --- 한 종목 --------------------------------------------------------------------

def collect(ticker: str, today: dt.date, backfill: bool) -> ParsedFacts:
    """한 종목의 저장할 행. 네트워크·키 문제는 `DartError` 로 올린다 (받은 것을 반쯤 저장하지 않게)."""
    if not api_key():
        raise NoKey(NO_KEY_MESSAGE)
    corp = corp_for(ticker)
    month = fiscal_month(corp)
    parsed = ParsedFacts()
    if month != 12:
        parsed.unsupported = f"{month}월 결산 회사는 아직 읽지 못합니다 (12월 결산만)"
        return parsed

    fs_div: str | None = None
    answered = 0  # 자료가 온 보고서 수 (읽을 수 있었든 없었든)
    found: list[tuple[Report, dt.date]] = []
    for report in wanted_reports(today, backfill):
        rows = None
        for candidate in ([fs_div] if fs_div else ["CFS", "OFS"]):
            data = _json("fnlttSinglAcntAll.json", corp_code=corp, bsns_year=str(report.year),
                         reprt_code=report.code, fs_div=candidate)
            if data and data.get("list"):
                rows, fs_div = data["list"], candidate
                break
        if not rows:
            continue
        answered += 1
        facts = parse_report(rows, report, fs_div)
        if not facts:
            continue
        parsed.rows.extend(facts)
        found.append((report, facts[0]["filed_at"]))

    if not answered:
        parsed.empty = True
        return parsed
    if not found:
        parsed.unsupported = "DART 재무제표에서 매출·순이익·EPS 를 찾지 못했습니다"
        return parsed

    # 보조 항목 — 못 받아도 나머지는 낸다 (PBR·배당수익률만 빈다)
    latest, latest_filed = found[0]
    parsed.rows.extend(_soft(lambda: parse_shares(
        (_json("stockTotqySttus.json", corp_code=corp, bsns_year=str(latest.year), reprt_code=latest.code)
         or {}).get("list") or [], latest, latest_filed), "주식 총수"))
    for report, filed in found:
        if report.code == "11011":
            parsed.rows.extend(_soft(lambda r=report, f=filed: parse_dividend(
                (_json("alotMatter.json", corp_code=corp, bsns_year=str(r.year), reprt_code=r.code)
                 or {}).get("list") or [], r, f), "배당"))

    have = {row["metric"] for row in parsed.rows}
    if not have & {"revenue", "net_income", "eps_diluted"}:
        parsed.rows = []
        parsed.unsupported = "DART 재무제표에서 매출·순이익·EPS 를 찾지 못했습니다"
        return parsed
    parsed.missing = [m for m in REPORTED_METRICS if m not in have]
    return parsed


def _soft(work, what: str) -> list[dict]:
    try:
        return work()
    except DartError as exc:
        logger.info("DART %s 를 받지 못했습니다: %s", what, exc)
        return []
