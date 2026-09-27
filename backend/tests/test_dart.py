"""OpenDART 해석 · 받기 · 저장 (ROADMAP 3b-2).

개발 환경에서는 DART 가 프록시 정책으로 막혀 있다. 응답 모양은 OpenDART 개발가이드와
`diagnose_financials.py` 가 찍는 칸(thstrm_amount · thstrm_add_amount · rcept_no · sj_div ·
account_id)을 본떴다. 가짜 DART 를 `dart._get` 자리에 끼운다.
"""

from __future__ import annotations

import datetime as dt
import io
import zipfile

import pytest
import requests

from app.models import FundamentalFact, FundamentalStatus, PriceDaily
from app.services import fundamentals
from app.services.providers import dart
from tests.factories import make_stock

D = dt.date
KEY = "0123456789abcdef0123456789abcdef01234567"
TODAY = D(2026, 9, 26)
NOW = dt.datetime(2026, 9, 26, 23, 15)
TICKER = "005930.KS"
CORP = "00126380"

# 보고서가 접수되는 날 (12월 결산)
FILED = {"11013": (5, 15), "11012": (8, 14), "11014": (11, 14), "11011": (3, 10)}
QUARTER_OF = {"11013": 0, "11012": 1, "11014": 2}


def filed_of(year: int, code: str) -> dt.date:
    month, day = FILED[code]
    return D(year + 1 if code == "11011" else year, month, day)


def rev(year, q):  # 분기 매출
    return 1_000_000 * (10 + (year - 2019) + q)


def eps(year, q):  # 분기 EPS
    return 100 * (year - 2019) + 10 * q


def is_row(account_id, nm, current, cumulative=None, rcept="", sj="IS"):
    row = {"rcept_no": rcept, "sj_div": sj, "account_id": account_id, "account_nm": nm,
           "thstrm_amount": str(current), "currency": "KRW"}
    if cumulative is not None:
        row["thstrm_add_amount"] = str(cumulative)
    return row


def report_rows(year: int, code: str) -> list[dict]:
    rcept = f"{filed_of(year, code):%Y%m%d}000123"
    if code == "11011":
        quarters = range(4)
        current = lambda f: sum(f(year, q) for q in quarters)  # noqa: E731
        cumulative = lambda f: None  # noqa: E731
        ytd_quarters = 4
    else:
        qi = QUARTER_OF[code]
        current = lambda f: f(year, qi)  # noqa: E731
        cumulative = lambda f: sum(f(year, q) for q in range(qi + 1))  # noqa: E731
        ytd_quarters = qi + 1
    net = lambda y, q: rev(y, q) // 10  # noqa: E731
    op = lambda y, q: rev(y, q) // 5  # noqa: E731
    return [
        is_row("ifrs-full_Revenue", "매출액", current(rev), cumulative(rev), rcept),
        is_row("dart_OperatingIncomeLoss", "영업이익", current(op), cumulative(op), rcept),
        # 순이익은 포괄손익(아래)보다 손익계산서 쪽을 — 응답에서 어느 쪽이 먼저 오든
        is_row("ifrs-full_ProfitLossAttributableToOwnersOfParent", "지배기업 소유주지분",
               999, 999 if cumulative(net) is not None else None, rcept, sj="CIS"),
        is_row("ifrs-full_ProfitLossAttributableToOwnersOfParent", "지배기업의 소유주에게 귀속되는 당기순이익",
               current(net), cumulative(net), rcept),
        is_row("ifrs-full_BasicEarningsLossPerShare", "기본주당이익", current(eps), cumulative(eps), rcept),
        is_row("ifrs-full_DilutedEarningsLossPerShare", "희석주당이익", current(eps), cumulative(eps), rcept),
        {"rcept_no": rcept, "sj_div": "BS", "account_id": "ifrs-full_EquityAttributableToOwnersOfParent",
         "account_nm": "지배기업 소유주지분", "thstrm_amount": "300000000", "currency": "KRW"},
        {"rcept_no": rcept, "sj_div": "BS", "account_id": "ifrs-full_Equity",
         "account_nm": "자본총계", "thstrm_amount": "310000000", "currency": "KRW"},
        {"rcept_no": rcept, "sj_div": "BS", "account_id": "ifrs-full_Liabilities",
         "account_nm": "부채총계", "thstrm_amount": "90000000", "currency": "KRW"},
        # 현금흐름은 누적만
        {"rcept_no": rcept, "sj_div": "CF", "account_id": "ifrs-full_CashFlowsFromUsedInOperatingActivities",
         "account_nm": "영업활동 현금흐름", "thstrm_amount": str(2_000_000 * ytd_quarters), "currency": "KRW"},
        {"rcept_no": rcept, "sj_div": "CF", "account_id": "ifrs-full_PurchaseOfPropertyPlantAndEquipment",
         "account_nm": "유형자산의 취득", "thstrm_amount": str(-500_000 * ytd_quarters), "currency": "KRW"},
    ]


class Reply:
    def __init__(self, data=None, status=200, content=None):
        self._data = data
        self.status_code = status
        self.content = content if content is not None else b"{}"

    def json(self):
        if self._data is None:
            raise ValueError("not json")
        return self._data


def corp_zip(entries: list[tuple[str, str, str]]) -> bytes:
    items = "".join(
        f"<list><corp_code>{corp}</corp_code><corp_name>{name}</corp_name>"
        f"<stock_code>{stock}</stock_code><modify_date>20250101</modify_date></list>"
        for corp, name, stock in entries
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("CORPCODE.xml", f"<result>{items}</result>")
    return buffer.getvalue()


class FakeDart:
    """보고서마다 한 번씩 묻는 DART. `reports[(year, code, fs)]` 에 있는 것만 준다."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.acc_mt = "12"
        self.reports: dict[tuple[int, str, str], list[dict]] = {}
        self.fail: dict[str, str] = {}  # 경로 → DART 상태 코드
        self.corps = [(CORP, "삼성전자", "005930"), ("00000001", "상장폐지사", " ")]
        for year in range(2020, 2027):
            for code in ("11013", "11012", "11014", "11011"):
                if filed_of(year, code) <= TODAY:
                    self.reports[(year, code, "CFS")] = report_rows(year, code)

    def __call__(self, path, params):
        self.calls.append((path, dict(params)))
        if path in self.fail:
            return Reply({"status": self.fail[path], "message": "막힘"})
        if path == "corpCode.xml":
            return Reply(content=corp_zip(self.corps))
        if path == "company.json":
            return Reply({"status": "000", "acc_mt": self.acc_mt, "corp_name": "삼성전자"})
        if path == "fnlttSinglAcntAll.json":
            rows = self.reports.get((int(params["bsns_year"]), params["reprt_code"], params["fs_div"]))
            if rows is None:
                return Reply({"status": "013", "message": "조회된 데이타가 없습니다."})
            return Reply({"status": "000", "message": "정상", "list": rows})
        if path == "stockTotqySttus.json":
            return Reply({"status": "000", "list": [
                {"se": "보통주", "istc_totqy": "5,969,782,550", "tesstk_co": "0", "distb_stock_co": "5,919,637,922"},
                {"se": "우선주", "istc_totqy": "822,886,700", "tesstk_co": "0", "distb_stock_co": "815,974,664"},
                {"se": "합계", "istc_totqy": "6,792,669,250", "tesstk_co": "0", "distb_stock_co": "6,735,612,586"},
            ]})
        if path == "alotMatter.json":
            return Reply({"status": "000", "list": [
                {"se": "주당액면가액(원)", "stock_knd": "", "thstrm": "100"},
                {"se": "주당 현금배당금(원)", "stock_knd": "보통주", "thstrm": "1,446"},
                {"se": "주당 현금배당금(원)", "stock_knd": "우선주", "thstrm": "1,447"},
            ]})
        raise AssertionError(f"모르는 경로 {path}")

    def paths(self, name):
        return [params for path, params in self.calls if path == name]


@pytest.fixture
def fake_dart(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", KEY)
    fake = FakeDart()
    monkeypatch.setattr(dart, "_get", fake)
    monkeypatch.setattr(dart, "MIN_INTERVAL", 0)
    monkeypatch.setattr(fundamentals, "fetch_splits", lambda ticker: [])
    return fake


# --- 값 읽기 ---------------------------------------------------------------------

@pytest.mark.parametrize("text, value", [
    ("1,234", 1234.0), ("-1,234", -1234.0), ("(1,234)", -1234.0), (" 12 ", 12.0),
    ("", None), ("-", None), (None, None), ("abc", None),
])
def test_amount(text, value):
    assert dart.amount(text) == value


def test_filed_date_is_the_first_eight_digits_of_the_receipt_number():
    assert dart.filed_date("20250514000123") == D(2025, 5, 14)
    assert dart.filed_date("") is None
    assert dart.filed_date("2025") is None


def test_stock_code():
    assert dart.stock_code("005930.KS") == "005930"
    assert dart.stock_code("247540.kq") == "247540"
    assert dart.stock_code("AAPL") is None


def test_half_year_report_gives_three_months_and_year_to_date():
    rows = {(r["metric"], r["period_start"], r["period_end"]): r
            for r in dart.parse_report(report_rows(2025, "11012"), dart.Report(2025, "11012"), "CFS")}
    # 손익: 3개월(4~6월)과 누적(1~6월)
    assert rows[("revenue", D(2025, 4, 1), D(2025, 6, 30))]["value"] == rev(2025, 1)
    assert rows[("revenue", D(2025, 1, 1), D(2025, 6, 30))]["value"] == rev(2025, 0) + rev(2025, 1)
    # 순이익은 손익계산서 쪽 (포괄손익의 999 가 아니라)
    assert rows[("net_income", D(2025, 4, 1), D(2025, 6, 30))]["value"] == rev(2025, 1) // 10
    # 희석 EPS 가 기본보다 먼저
    assert rows[("eps_diluted", D(2025, 4, 1), D(2025, 6, 30))]["tag"] == "ifrs-full_DilutedEarningsLossPerShare"
    # 현금흐름은 누적 하나뿐, 설비투자는 크기로
    assert ("operating_cf", D(2025, 4, 1), D(2025, 6, 30)) not in rows
    assert rows[("capex", D(2025, 1, 1), D(2025, 6, 30))]["value"] == 1_000_000
    # 재무상태는 그 시점, 지배주주 몫이 먼저
    assert rows[("equity", D(2025, 6, 30), D(2025, 6, 30))]["value"] == 300_000_000
    first = rows[("revenue", D(2025, 4, 1), D(2025, 6, 30))]
    assert first["filed_at"] == D(2025, 8, 14) and first["source"] == "dart"
    assert first["form"] == "반기보고서(연결)" and first["unit"] == "KRW"
    assert rows[("eps_diluted", D(2025, 4, 1), D(2025, 6, 30))]["unit"] == "KRW/shares"


def test_annual_and_first_quarter_reports_are_one_period_each():
    annual = dart.parse_report(report_rows(2025, "11011"), dart.Report(2025, "11011"), "CFS")
    assert {(r["period_start"], r["period_end"]) for r in annual if r["metric"] == "revenue"} == {
        (D(2025, 1, 1), D(2025, 12, 31))}
    q1 = dart.parse_report(report_rows(2025, "11013"), dart.Report(2025, "11013"), "CFS")
    assert {(r["period_start"], r["period_end"]) for r in q1 if r["metric"] == "revenue"} == {
        (D(2025, 1, 1), D(2025, 3, 31))}


def test_without_a_cumulative_column_the_value_is_taken_as_year_to_date():
    rows = [is_row("ifrs-full_Revenue", "매출액", 500, None, "20250814000001")]
    parsed = dart.parse_report(rows, dart.Report(2025, "11012"), "OFS")
    assert [(r["period_start"], r["period_end"], r["value"]) for r in parsed] == [
        (D(2025, 1, 1), D(2025, 6, 30), 500.0)]
    assert parsed[0]["form"] == "반기보고서(별도)"


def test_cash_flow_is_cumulative_even_if_a_cumulative_column_comes_along():
    # 현금흐름표는 누적만 있다 — 누적 칸이 같이 와도 당기 칸을 3개월로 읽으면 분기가 부풀려진다
    rows = [{"rcept_no": "20251114000001", "sj_div": "CF",
             "account_id": "ifrs-full_CashFlowsFromUsedInOperatingActivities", "account_nm": "영업활동현금흐름",
             "thstrm_amount": "900", "thstrm_add_amount": "900"}]
    parsed = dart.parse_report(rows, dart.Report(2025, "11014"), "CFS")
    assert [(r["period_start"], r["period_end"], r["value"]) for r in parsed] == [
        (D(2025, 1, 1), D(2025, 9, 30), 900.0)]


def test_non_standard_accounts_are_found_by_name():
    rows = [
        is_row("-표준계정코드 미사용-", "영업수익", 700, 1400, "20250814000001"),
        is_row("ifrs_BasicEarningsLossPerShare", "기본주당순이익", 70, 140, "20250814000001"),  # 옛 접두어
    ]
    parsed = {r["metric"]: r for r in dart.parse_report(rows, dart.Report(2025, "11012"), "CFS")
              if r["period_start"] == D(2025, 4, 1)}
    assert parsed["revenue"]["value"] == 700 and parsed["revenue"]["tag"] == "영업수익"
    assert parsed["eps_diluted"]["value"] == 70


def test_capex_under_the_investing_activities_name():
    # 서버 진단(v0.26.0): 삼성전자는 앞의 표준 이름으로 설비투자를 내지 않는다
    rows = [{"rcept_no": "20260814000001", "sj_div": "CF",
             "account_id": "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
             "account_nm": "유형자산 취득", "thstrm_amount": "-24,000"}]
    [fact] = dart.parse_report(rows, dart.Report(2026, "11012"), "CFS")
    assert (fact["metric"], fact["value"], fact["period_start"]) == ("capex", 24000.0, D(2026, 1, 1))


def test_report_without_receipt_number_is_skipped():
    assert dart.parse_report([is_row("ifrs-full_Revenue", "매출액", 1, 2, "")], dart.Report(2025, "11012"),
                             "CFS") == []


def test_shares_use_outstanding_common_plus_preferred():
    rows = FakeDart()("stockTotqySttus.json", {}).json()["list"]
    [fact] = dart.parse_shares(rows, dart.Report(2026, "11012"), D(2026, 8, 14))
    assert fact["value"] == 6_735_612_586 and fact["period_end"] == D(2026, 6, 30)
    # 유통주식수 칸이 비면 발행 − 자기주식
    [fact] = dart.parse_shares([{"se": "합계", "istc_totqy": "100", "tesstk_co": "10", "distb_stock_co": "-"}],
                               dart.Report(2026, "11012"), D(2026, 8, 14))
    assert fact["value"] == 90


def test_dividend_is_the_common_share_cash_dividend_for_the_year():
    rows = FakeDart()("alotMatter.json", {}).json()["list"]
    [fact] = dart.parse_dividend(rows, dart.Report(2025, "11011"), D(2026, 3, 10))
    assert (fact["metric"], fact["value"], fact["period_start"], fact["period_end"]) == (
        "dps", 1446.0, D(2025, 1, 1), D(2025, 12, 31))


def test_wanted_reports_skip_what_cannot_be_filed_yet():
    reports = dart.wanted_reports(TODAY, backfill=True)
    assert reports[0] == dart.Report(2026, "11012")          # 3분기(9/30)는 아직
    assert len(reports) == 7 * 4 - 2                           # 올해 3분기·사업보고서 빼고
    assert reports[-1] == dart.Report(2020, "11013")
    recent = dart.wanted_reports(TODAY, backfill=False)
    assert recent == [dart.Report(2026, "11012"), dart.Report(2026, "11013"), dart.Report(2025, "11011"),
                      dart.Report(2025, "11014")]


def test_corp_codes_keep_only_listed_companies():
    codes = dart.parse_corp_codes(corp_zip([(CORP, "삼성전자", "005930"), ("00000002", "비상장", " ")]))
    assert codes == {"005930": CORP}


# --- 받기 ------------------------------------------------------------------------

def test_first_collection_goes_back_seven_years(fake_dart):
    parsed = dart.collect(TICKER, TODAY, backfill=True)
    assert not parsed.unsupported and not parsed.empty and parsed.missing == []
    statements = fake_dart.paths("fnlttSinglAcntAll.json")
    assert len(statements) == 26 and all(p["fs_div"] == "CFS" for p in statements)
    # 주식 총수는 가장 최근 보고서 하나, 배당은 사업보고서마다
    assert fake_dart.paths("stockTotqySttus.json") == [
        {"corp_code": CORP, "bsns_year": "2026", "reprt_code": "11012"}]
    assert len(fake_dart.paths("alotMatter.json")) == 6
    metrics = {r["metric"] for r in parsed.rows}
    assert {"revenue", "eps_diluted", "equity", "operating_cf", "capex", "shares", "dps"} <= metrics


def test_later_collections_only_ask_recent_reports(fake_dart):
    dart.collect(TICKER, TODAY, backfill=False)
    asked = [(p["bsns_year"], p["reprt_code"]) for p in fake_dart.paths("fnlttSinglAcntAll.json")]
    assert asked == [("2026", "11012"), ("2026", "11013"), ("2025", "11011"), ("2025", "11014")]
    # 회사 목록·결산월은 기억해 두고 다시 묻지 않는다
    dart.collect(TICKER, TODAY, backfill=False)
    assert len(fake_dart.paths("corpCode.xml")) == 1 and len(fake_dart.paths("company.json")) == 1


def test_company_without_subsidiaries_uses_separate_statements_throughout(fake_dart):
    fake_dart.reports = {(y, c, "OFS"): rows for (y, c, _), rows in fake_dart.reports.items()}
    # 한 해만 연결이 있어도 섞지 않는다 — 가장 최근에 맞은 쪽으로 간다
    fake_dart.reports[(2021, "11011", "CFS")] = report_rows(2021, "11011")
    parsed = dart.collect(TICKER, TODAY, backfill=True)
    statements = fake_dart.paths("fnlttSinglAcntAll.json")
    assert statements[0]["fs_div"] == "CFS" and statements[1]["fs_div"] == "OFS"
    assert all(p["fs_div"] == "OFS" for p in statements[2:])
    assert {r["form"].split("(")[1] for r in parsed.rows if r["metric"] == "revenue"} == {"별도)"}


def test_etf_and_preferred_shares_are_not_listed(fake_dart):
    for ticker in ("379800.KS", "005935.KS"):
        with pytest.raises(dart.NotListed):
            dart.collect(ticker, TODAY, backfill=True)
    assert fake_dart.paths("fnlttSinglAcntAll.json") == []


def test_non_december_fiscal_year_is_not_read_yet(fake_dart):
    fake_dart.acc_mt = "03"
    parsed = dart.collect(TICKER, TODAY, backfill=True)
    assert parsed.unsupported and "3월 결산" in parsed.unsupported and parsed.rows == []
    assert fake_dart.paths("fnlttSinglAcntAll.json") == []


def test_no_reports_at_all_is_empty(fake_dart):
    fake_dart.reports = {}
    parsed = dart.collect(TICKER, TODAY, backfill=True)
    assert parsed.empty and parsed.rows == []
    # 연결·별도를 둘 다 물어본다 (어느 쪽인지 아직 모른다)
    assert len(fake_dart.paths("fnlttSinglAcntAll.json")) == 26 * 2


def test_reports_without_known_accounts_are_unsupported(fake_dart):
    fake_dart.reports = {k: [{"rcept_no": "20260814000001", "sj_div": "IS", "account_id": "x",
                              "account_nm": "이자수익", "thstrm_amount": "1"}] for k in fake_dart.reports}
    parsed = dart.collect(TICKER, TODAY, backfill=False)
    assert parsed.unsupported and parsed.rows == []


@pytest.mark.parametrize("status, text", [("020", "하루 호출 한도"), ("010", "등록되지 않았습니다"),
                                          ("800", "점검"), ("999", "DART 오류 999")])
def test_dart_status_codes_become_one_readable_line(fake_dart, status, text):
    fake_dart.fail["fnlttSinglAcntAll.json"] = status
    with pytest.raises(dart.DartError, match=text):
        dart.collect(TICKER, TODAY, backfill=True)


def test_extra_items_failing_do_not_fail_the_collection(fake_dart):
    fake_dart.fail["stockTotqySttus.json"] = "020"
    fake_dart.fail["alotMatter.json"] = "800"
    parsed = dart.collect(TICKER, TODAY, backfill=False)
    metrics = {r["metric"] for r in parsed.rows}
    assert "revenue" in metrics and "shares" not in metrics and "dps" not in metrics


def test_company_list_error_comes_as_xml(monkeypatch, fake_dart):
    monkeypatch.setattr(dart, "_get", lambda path, params: Reply(
        content=b'<?xml version="1.0"?><result><status>011</status><message>x</message></result>'))
    with pytest.raises(dart.DartError, match="쓸 수 없습니다"):
        dart.corp_for(TICKER)


def test_without_a_key_nothing_is_sent(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("키 없이 DART 를 불렀다")

    monkeypatch.setattr(dart.requests, "get", refuse)
    with pytest.raises(dart.NoKey):
        dart.collect(TICKER, TODAY, backfill=True)


def test_network_errors_never_carry_the_key(monkeypatch):
    monkeypatch.setenv("DART_API_KEY", KEY)
    monkeypatch.setattr(dart, "MIN_INTERVAL", 0)

    def broken(url, params, timeout):
        assert params["crtfc_key"] == KEY
        raise requests.ConnectionError(f"Max retries exceeded with url: /api/corpCode.xml?crtfc_key={KEY}")

    monkeypatch.setattr(dart.requests, "get", broken)
    with pytest.raises(dart.DartError) as caught:
        dart.corp_for(TICKER)
    assert KEY not in str(caught.value) and "ConnectionError" in str(caught.value)
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


# --- 저장과 화면 -------------------------------------------------------------------

def _prices(db, ticker, close):
    day = D(2021, 1, 4)
    while day <= TODAY:
        if day.weekday() < 5:
            db.add(PriceDaily(ticker=ticker, date=day, open=close, high=close, low=close, close=close, volume=1))
        day += dt.timedelta(days=1)
    db.commit()


def test_refresh_saves_dart_facts_and_computes_ratios(db_session, fake_dart):
    make_stock(db_session, TICKER)
    result = fundamentals.refresh_ticker(db_session, TICKER, NOW)
    assert result["state"] == "ok" and result["added"] > 0
    status = db_session.get(FundamentalStatus, TICKER)
    assert (status.state, status.source, status.message) == ("ok", "dart", None)

    _prices(db_session, TICKER, 60_000.0)
    out = fundamentals.detail(db_session, TICKER, "KRW", today=TODAY)
    metrics = {m["key"]: m for m in out["metrics"]}
    # 최근 네 분기: 2025 3분기·4분기(연간 − 9개월 누적), 2026 1·2분기
    ttm_eps = eps(2025, 2) + eps(2025, 3) + eps(2026, 0) + eps(2026, 1)
    assert metrics["per"]["value"] == pytest.approx(60_000 / ttm_eps)
    assert metrics["per"]["filed_at"] == D(2026, 8, 14)
    assert metrics["pbr"]["value"] == pytest.approx(60_000 / (300_000_000 / 6_735_612_586))
    assert metrics["dividend_yield"]["value"] == pytest.approx(1446 / 60_000 * 100)
    assert metrics["debt_ratio"]["value"] == pytest.approx(30.0)
    assert out["per_range"] is not None
    # 분기 표: 4분기는 누적에서 빼서
    q4 = next(q for q in out["quarters"] if q["period_end"] == D(2025, 12, 31))
    assert q4["revenue"] == rev(2025, 3) and q4["filed_at"] == D(2026, 3, 10)
    assert q4["operating_cf"] == 2_000_000 and q4["fcf"] == 1_500_000


def test_second_refresh_asks_only_recent_reports_and_adds_nothing(db_session, fake_dart):
    make_stock(db_session, TICKER)
    fundamentals.refresh_ticker(db_session, TICKER, NOW)
    before = len(fake_dart.paths("fnlttSinglAcntAll.json"))
    again = fundamentals.refresh_ticker(db_session, TICKER, NOW + dt.timedelta(days=7))
    assert again == {"ticker": TICKER, "state": "ok", "added": 0}
    assert len(fake_dart.paths("fnlttSinglAcntAll.json")) - before == 4


def test_correction_adds_a_row_only_when_the_value_changed(db_session, fake_dart):
    make_stock(db_session, TICKER)
    fundamentals.refresh_ticker(db_session, TICKER, NOW)
    count = db_session.query(FundamentalFact).count()

    # 반기보고서 정정 — 접수번호(공시일)가 바뀌고 매출 3개월 값만 달라졌다
    corrected = report_rows(2026, "11012")
    for row in corrected:
        row["rcept_no"] = "20260920000999"
    corrected[0]["thstrm_amount"] = str(rev(2026, 1) + 5)
    fake_dart.reports[(2026, "11012", "CFS")] = corrected
    fundamentals.refresh_ticker(db_session, TICKER, NOW + dt.timedelta(days=7))

    new = db_session.query(FundamentalFact).filter(FundamentalFact.filed_at == D(2026, 9, 20)).all()
    assert [(f.metric, f.period_start, f.value) for f in new] == [("revenue", D(2026, 4, 1), rev(2026, 1) + 5)]
    assert db_session.query(FundamentalFact).count() == count + 1
    quarters = fundamentals.detail(db_session, TICKER, "KRW", today=TODAY)["quarters"]
    latest = next(q for q in quarters if q["period_end"] == D(2026, 6, 30))
    assert latest["revised"] and latest["filed_at"] == D(2026, 8, 14)


def test_without_a_key_korean_stocks_say_so(db_session, monkeypatch):
    make_stock(db_session, TICKER)
    result = fundamentals.refresh_ticker(db_session, TICKER, NOW)
    status = db_session.get(FundamentalStatus, TICKER)
    assert result["state"] == "unsupported" and "DART 키" in status.message
    assert db_session.query(FundamentalFact).count() == 0
    # 설정 문제라 오류처럼 매일 되묻지 않는다
    later = NOW + dt.timedelta(days=3)
    assert not fundamentals.is_due(status, None, later)
    assert fundamentals.refresh_due(db_session, [TICKER], later) == []


def test_key_added_later_is_picked_up_the_next_night(db_session, fake_dart, monkeypatch):
    make_stock(db_session, TICKER)
    monkeypatch.delenv("DART_API_KEY")
    fundamentals.refresh_ticker(db_session, TICKER, NOW)
    monkeypatch.setenv("DART_API_KEY", KEY)
    [result] = fundamentals.refresh_due(db_session, [TICKER], NOW + dt.timedelta(days=1))
    assert result["state"] == "ok"


def test_korean_etf_is_hidden(db_session, fake_dart):
    make_stock(db_session, "379800.KS")
    assert fundamentals.refresh_ticker(db_session, "379800.KS", NOW)["state"] == "none"
    status = db_session.get(FundamentalStatus, "379800.KS")
    assert status.source == "dart" and "ETF" in status.message


def test_company_with_no_reports_yet_is_hidden_with_its_own_reason(db_session, fake_dart):
    fake_dart.reports = {}
    make_stock(db_session, TICKER)
    assert fundamentals.refresh_ticker(db_session, TICKER, NOW)["state"] == "none"
    assert "정기보고서" in db_session.get(FundamentalStatus, TICKER).message


def test_dart_failure_keeps_what_was_saved(db_session, fake_dart):
    make_stock(db_session, TICKER)
    fundamentals.refresh_ticker(db_session, TICKER, NOW)
    count = db_session.query(FundamentalFact).count()
    fake_dart.fail["fnlttSinglAcntAll.json"] = "020"
    result = fundamentals.refresh_ticker(db_session, TICKER, NOW + dt.timedelta(days=8))
    assert result["state"] == "error" and "한도" in result["error"]
    assert db_session.query(FundamentalFact).count() == count
    status = db_session.get(FundamentalStatus, TICKER)
    assert status.state == "error" and status.ok_at == NOW


def test_failure_logs_never_carry_the_key(db_session, monkeypatch, caplog):
    monkeypatch.setenv("DART_API_KEY", KEY)
    monkeypatch.setattr(dart, "MIN_INTERVAL", 0)

    def broken(url, params, timeout):
        raise requests.ConnectionError(f"url: /api/corpCode.xml?crtfc_key={params['crtfc_key']}")

    monkeypatch.setattr(dart.requests, "get", broken)
    make_stock(db_session, TICKER)
    with caplog.at_level("DEBUG"):
        fundamentals.refresh_due(db_session, [TICKER], NOW)
    status = db_session.get(FundamentalStatus, TICKER)
    assert status.state == "error"
    assert KEY not in caplog.text and KEY not in (status.message or "")
