"""미국 전체 상장목록 — 내장 목록(140여 개)에 없는 미국 종목도 이름으로 찾는가 (작은 일들).

받아오는 곳(나스닥 트레이더·SEC)은 테스트에서 부를 수 없으므로 **실제 파일과 같은 모양**의
가짜를 쓴다: `|` 로 나뉜 표, 첫 줄 머리글, 마지막 줄 "File Creation Time".
"""

import datetime as dt

import pytest
import requests

from app.models import UsListing
from app.services import symbols, us_listing

NASDAQ_LISTED = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
GOOG|Alphabet Inc. - Class C Capital Stock|Q|N|N|100|N|N
GOOGL|Alphabet Inc. - Class A Common Stock|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
PDD|PDD Holdings Inc. - American Depositary Shares, each representing four Class A Ordinary Shares|Q|N|N|100|N|N
APLE|Apple Hospitality REIT, Inc. - Common Shares|Q|N|N|100|N|N
ZAZZT|Tick Pilot Test Stock Class A Common Stock|G|Y|N|100|N|N
ACAHW|Atlantic Coastal Acquisition Corp - Warrant|S|N|N|100|N|N
ACAHU|Atlantic Coastal Acquisition Corp - Unit|S|N|N|100|N|N
ACAHR|Atlantic Coastal Acquisition Corp - Right|S|N|N|100|N|N
AGNCP|AGNC Investment Corp. - Depositary Shares Each Representing a 1/1,000th Interest in a Share of 6.125% Series F Preferred Stock|Q|N|N|100|N|N
File Creation Time: 0926202621:32|||||||
"""

OTHER_LISTED = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
A|Agilent Technologies, Inc. Common Stock|N|A|N|100|N|A
BRK.B|Berkshire Hathaway Inc. Class B Common Stock|N|BRK.B|N|100|N|BRK.B
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
DGRW|WisdomTree U.S. Quality Dividend Growth Fund|P|DGRW|Y|100|N|DGRW
BAC$K|Bank of America Corporation Depositary Shares Series KK|N|BACpK|N|100|N|BAC-K
IPOD.U|Social Capital Hedosophia Holdings Corp. IV Units, each consisting of one Class A share|N|IPOD.U|N|100|N|IPOD=
IPOD.WS|Social Capital Hedosophia Holdings Corp. IV Warrants|N|IPOD.WS|N|100|N|IPOD+
NTEST|NYSE Test Stock|N|NTEST|N|100|Y|NTEST
File Creation Time: 0926202621:32|||||||
"""

SEC_PAYLOAD = {
    "fields": ["cik", "name", "ticker", "exchange"],
    "data": [
        [320193, "Apple Inc.", "AAPL", "Nasdaq"],
        [1045810, "NVIDIA CORP", "NVDA", "Nasdaq"],
        [1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"],
        [9999999, "Pink Sheet Co", "PNKS", "OTC"],
        [8888888, "No Exchange Co", "NOEX", None],
        [7777777, "Weird Ticker Co", "WEIRD$A", "NYSE"],
    ],
}


class _Resp:
    def __init__(self, status=200, text="", payload=None):
        self.status_code = status
        self.text = text
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


@pytest.fixture()
def small_min(monkeypatch):
    """실제 목록은 1만 줄 가깝다. 가짜는 몇 줄이므로 '잘린 목록' 기준을 낮춘다."""
    monkeypatch.setattr(us_listing, "MIN_ROWS", 3)


def _serve(monkeypatch, routes: dict):
    asked = []

    def fake_get(url, headers=None, timeout=None, **kwargs):
        asked.append(url)
        answer = routes.get(url)
        if isinstance(answer, Exception):
            raise answer
        return answer if answer is not None else _Resp(404)

    monkeypatch.setattr(requests, "get", fake_get)
    return asked


def _nasdaq_ok():
    return {
        us_listing.NASDAQ_LISTED_URL: _Resp(text=NASDAQ_LISTED),
        us_listing.OTHER_LISTED_URL: _Resp(text=OTHER_LISTED),
    }


# ── 파일 읽기 ────────────────────────────────────────────────────────


def test_nasdaq_file_keeps_shares_and_etfs_with_clean_names():
    rows = {r["code"]: r for r in us_listing.parse_symbol_directory(NASDAQ_LISTED, fixed_exchange="NASDAQ")}
    assert set(rows) == {"AAPL", "GOOG", "GOOGL", "QQQ", "PDD", "APLE"}
    assert rows["AAPL"] == {"code": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "instrument": "STOCK"}
    # 클래스는 남긴다 — 알파벳 A 주와 C 주가 같은 이름이면 고를 수 없다
    assert rows["GOOG"]["name"] == "Alphabet Inc. Class C"
    assert rows["GOOGL"]["name"] == "Alphabet Inc. Class A"
    assert rows["QQQ"]["instrument"] == "ETF"
    assert rows["QQQ"]["name"] == "Invesco QQQ Trust, Series 1"
    assert rows["PDD"]["name"] == "PDD Holdings Inc."
    assert rows["APLE"]["name"] == "Apple Hospitality REIT, Inc."


def test_other_file_converts_class_tickers_and_drops_what_the_app_cannot_hold():
    rows = {r["code"]: r for r in us_listing.parse_symbol_directory(OTHER_LISTED)}
    # 시험 종목·우선주($)·유닛(.U)·워런트(.WS)는 빠진다
    assert set(rows) == {"A", "BRK-B", "SPY", "DGRW"}
    assert rows["BRK-B"]["name"] == "Berkshire Hathaway Inc. Class B"
    assert rows["A"]["name"] == "Agilent Technologies, Inc."
    assert rows["A"]["exchange"] == "NYSE"
    assert rows["SPY"]["exchange"] == "NYSE Arca"
    assert rows["SPY"]["instrument"] == "ETF"


def test_columns_are_found_by_name_not_position():
    text = "Security Name|ETF|Symbol\nApple Inc. - Common Stock|N|AAPL\nSPDR S&P 500 ETF Trust|Y|SPY\n"
    rows = us_listing.parse_symbol_directory(text, fixed_exchange="X")
    assert [(r["code"], r["name"], r["instrument"]) for r in rows] == [
        ("AAPL", "Apple Inc.", "STOCK"),
        ("SPY", "SPDR S&P 500 ETF Trust", "ETF"),
    ]


@pytest.mark.parametrize("text", ["", "Ticker|Name\nAAPL|Apple\n"])
def test_an_unexpected_file_is_refused(text):
    with pytest.raises(us_listing.UsListingUnavailable):
        us_listing.parse_symbol_directory(text)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Apple Inc. - Common Stock", "Apple Inc."),
        ("Alphabet Inc. - Class C Capital Stock", "Alphabet Inc. Class C"),
        ("Agilent Technologies, Inc. Common Stock", "Agilent Technologies, Inc."),
        ("Brown-Forman Corporation Class B Common Stock", "Brown-Forman Corporation Class B"),
        ("Taiwan Semiconductor Manufacturing Company Ltd.", "Taiwan Semiconductor Manufacturing Company Ltd."),
        ("SPDR S&P 500 ETF Trust", "SPDR S&P 500 ETF Trust"),
        ("Invesco QQQ Trust, Series 1", "Invesco QQQ Trust, Series 1"),
        ("Alibaba Group Holding Limited American Depositary Shares each representing eight Ordinary share",
         "Alibaba Group Holding Limited"),
        ("  Nu Holdings Ltd.   Class A Ordinary Shares ", "Nu Holdings Ltd. Class A"),
        # 떼고 나면 아무것도 안 남는 이름은 그대로 둔다
        ("Common Stock", "Common Stock"),
    ],
)
def test_clean_name(raw, expected):
    assert us_listing.clean_name(raw) == expected


def test_united_is_not_a_unit():
    """'유닛'을 단어로 거른다 — 'United' 가 들어간 회사까지 빠지면 안 된다."""
    text = "Symbol|Security Name|ETF\nUAL|United Airlines Holdings, Inc. - Common Stock|N\nUNH|UnitedHealth Group Incorporated Common Stock|N\n"
    assert [r["code"] for r in us_listing.parse_symbol_directory(text, "NASDAQ")] == ["UAL", "UNH"]


def test_sec_list_keeps_exchange_listed_companies():
    rows = {r["code"]: r for r in us_listing.parse_sec_exchange(SEC_PAYLOAD)}
    assert set(rows) == {"AAPL", "NVDA", "BRK-B"}  # 장외·거래소 없음·이상한 티커는 뺀다
    assert rows["NVDA"] == {"code": "NVDA", "name": "NVIDIA CORP", "exchange": "NASDAQ", "instrument": "STOCK"}


@pytest.mark.parametrize("payload", [{}, {"fields": ["cik"], "data": []}, {"fields": None}])
def test_sec_list_with_an_unexpected_shape_is_refused(payload):
    with pytest.raises(us_listing.UsListingUnavailable):
        us_listing.parse_sec_exchange(payload)


# ── 받기 ─────────────────────────────────────────────────────────────


def test_fetch_reads_both_nasdaq_files(monkeypatch, small_min):
    asked = _serve(monkeypatch, _nasdaq_ok())
    source, rows = us_listing.fetch_all(timeout=5)
    assert source == "nasdaqtrader"
    assert {"AAPL", "SPY", "BRK-B", "QQQ"} <= {r["code"] for r in rows}
    assert asked == [us_listing.NASDAQ_LISTED_URL, us_listing.OTHER_LISTED_URL]


def test_blocked_nasdaq_falls_back_to_sec(monkeypatch, small_min):
    """나스닥 트레이더가 막힌 서버에서도 **회사는** 이름으로 찾는다 (ETF 는 없다)."""
    _serve(monkeypatch, {
        us_listing.NASDAQ_LISTED_URL: _Resp(403),
        us_listing.SEC_EXCHANGE_URL: _Resp(payload=SEC_PAYLOAD),
    })
    source, rows = us_listing.fetch_all(timeout=5)
    assert source == "sec"
    assert {r["code"] for r in rows} == {"AAPL", "NVDA", "BRK-B"}


def test_an_unreachable_nasdaq_falls_back_too(monkeypatch, small_min):
    _serve(monkeypatch, {
        us_listing.NASDAQ_LISTED_URL: requests.ConnectionError("reset"),
        us_listing.SEC_EXCHANGE_URL: _Resp(payload=SEC_PAYLOAD),
    })
    assert us_listing.fetch_all(timeout=5)[0] == "sec"


def test_a_truncated_list_is_not_taken(monkeypatch):
    """1만 줄이 와야 할 자리에 몇 줄이 오면 **잘린 것**이다 — 받은 것으로 치면 멀쩡한 캐시를 덮는다."""
    _serve(monkeypatch, {**_nasdaq_ok(), us_listing.SEC_EXCHANGE_URL: _Resp(payload=SEC_PAYLOAD)})
    with pytest.raises(us_listing.UsListingUnavailable) as exc:
        us_listing.fetch_all(timeout=5)
    assert "잘린 목록" in str(exc.value)


def test_when_both_fail_both_reasons_are_kept(monkeypatch, small_min):
    _serve(monkeypatch, {us_listing.NASDAQ_LISTED_URL: _Resp(503), us_listing.SEC_EXCHANGE_URL: _Resp(403)})
    with pytest.raises(us_listing.UsListingUnavailable) as exc:
        us_listing.fetch_all(timeout=5)
    assert "HTTP 503" in str(exc.value)
    assert "HTTP 403" in str(exc.value)


# ── 저장 ─────────────────────────────────────────────────────────────


def test_refresh_replaces_the_whole_list(db_session, monkeypatch, small_min):
    """미국은 상장폐지가 잦다(스팩·소형주). 덧붙이기만 하면 사라진 종목이 검색에 남는다."""
    db_session.add(UsListing(code="GONE", name="Delisted Corp", instrument="STOCK", source="nasdaqtrader"))
    db_session.commit()

    _serve(monkeypatch, _nasdaq_ok())
    assert symbols.refresh_us_listing(db_session) == 10

    codes = {row.code for row in db_session.query(UsListing)}
    assert "GONE" not in codes
    assert db_session.get(UsListing, "SPY").source == "nasdaqtrader"


def test_a_failed_refresh_keeps_the_old_list(db_session, monkeypatch):
    db_session.add(UsListing(code="AGL", name="Agilent-ish", instrument="STOCK", source="nasdaqtrader"))
    db_session.commit()

    _serve(monkeypatch, {})  # 전부 404
    with pytest.raises(us_listing.UsListingUnavailable):
        symbols.refresh_us_listing(db_session)
    assert db_session.get(UsListing, "AGL") is not None


def test_refresh_if_stale_waits_a_week(db_session, monkeypatch):
    called = []
    monkeypatch.setattr(symbols, "refresh_us_listing", lambda db, timeout=30: called.append(1) or 1)

    assert symbols.refresh_us_listing_if_stale(db_session) == 1  # 비어 있으면 받는다
    db_session.add(UsListing(code="A", name="Agilent", instrument="STOCK", source="sec",
                             updated_at=dt.datetime.utcnow() - dt.timedelta(days=2)))
    db_session.commit()
    assert symbols.refresh_us_listing_if_stale(db_session) is None
    db_session.get(UsListing, "A").updated_at = dt.datetime.utcnow() - dt.timedelta(days=8)
    db_session.commit()
    assert symbols.refresh_us_listing_if_stale(db_session) == 1
    assert len(called) == 2


# ── 검색 ─────────────────────────────────────────────────────────────


@pytest.fixture()
def listed(db_session, monkeypatch, small_min):
    _serve(monkeypatch, _nasdaq_ok())
    symbols.refresh_us_listing(db_session)
    return db_session


def test_a_company_outside_the_seed_is_found_by_name(listed):
    matches = symbols.search("agilent", db=listed, allow_network=False)
    assert [(m.ticker, m.name, m.market.value) for m in matches[:1]] == [("A", "Agilent Technologies, Inc.", "US")]


def test_an_etf_outside_the_seed_is_found_by_name_and_marked(listed):
    assert "DGRW" not in {e["code"] for e in symbols.load_us_seed()}
    match = symbols.search("wisdomtree u.s. quality", db=listed, allow_network=False)[0]
    assert (match.ticker, match.instrument) == ("DGRW", "ETF")


def test_the_seed_still_wins_for_its_tickers(listed):
    """내장 목록의 이름과 한글 별칭이 그대로 — 받아온 목록이 "애플"을 지우면 안 된다."""
    seed = next(e for e in symbols.load_us_seed() if e["code"] == "AAPL")
    match = symbols.search("애플", db=listed, allow_network=False)[0]
    assert (match.ticker, match.name) == ("AAPL", seed["name"])
    assert [m.ticker for m in symbols.search("AAPL", db=listed, allow_network=False)].count("AAPL") == 1


def test_a_listed_name_that_differs_from_the_seed_still_finds_it(db_session, monkeypatch, small_min):
    """SEC 는 "NVIDIA CORP" 처럼 준다 — 화면 이름은 내장 목록 것, 그 표기로도 찾힌다."""
    _serve(monkeypatch, {
        us_listing.NASDAQ_LISTED_URL: _Resp(403),
        us_listing.SEC_EXCHANGE_URL: _Resp(payload=SEC_PAYLOAD),
    })
    symbols.refresh_us_listing(db_session)
    seed = next(e for e in symbols.load_us_seed() if e["code"] == "NVDA")
    assert seed["name"] != "NVIDIA CORP"
    match = symbols.search("nvidia corp", db=db_session, allow_network=False)[0]
    assert (match.ticker, match.name) == ("NVDA", seed["name"])


def test_a_known_ticker_is_no_longer_a_bare_guess(listed, monkeypatch):
    """목록에 있는 티커는 이름을 안다 — 야후에 물으러 가지 않는다."""
    monkeypatch.setattr(symbols, "_search_yahoo", lambda *a, **k: pytest.fail("야후를 불렀다"))
    match = symbols.search("DGRW", db=listed)[0]
    assert (match.ticker, match.name) == ("DGRW", "WisdomTree U.S. Quality Dividend Growth Fund")


def test_two_companies_with_the_same_start_are_not_picked_silently(listed):
    """'apple' 로 애플 호스피탈리티까지 뜬다. 사람이 고르는 목록에는 둘 다, 자동 선택은
    별칭이 정확히 맞는 쪽(내장 목록의 'apple')이 있을 때만."""
    tickers = [m.ticker for m in symbols.search("apple", db=listed, allow_network=False)]
    assert "AAPL" in tickers and "APLE" in tickers
    assert tickers.index("AAPL") < tickers.index("APLE")


def test_search_sees_a_new_list_without_restarting(db_session, monkeypatch, small_min):
    """읽어둔 목록은 다시 받으면 바뀐다 — 앱을 다시 띄워야 반영되면 버튼이 거짓말을 한다."""
    assert all(m.ticker != "A" for m in symbols.search("agilent", db=db_session, allow_network=False))
    _serve(monkeypatch, _nasdaq_ok())
    symbols.refresh_us_listing(db_session)
    assert symbols.search("agilent", db=db_session, allow_network=False)[0].ticker == "A"


def test_listing_status_reports_the_us_list(listed):
    status = symbols.listing_status(listed)
    assert status["us_count"] == 10
    assert status["us_source"] == "nasdaqtrader"
    assert status["us_updated_at"] is not None
    assert status["us_seed_count"] == len(symbols.load_us_seed())


def test_listing_status_without_a_us_list(db_session):
    status = symbols.listing_status(db_session)
    assert (status["us_count"], status["us_updated_at"], status["us_source"]) == (0, None, None)


# ── 검색 목록을 다시 만드는 때 ───────────────────────────────────────


def test_a_renamed_korean_company_is_searchable_right_after_refresh(db_session, monkeypatch):
    """검색은 만들어둔 목록을 쓴다. 국내 목록을 다시 받아 **이름만** 바뀐 경우(행 수 그대로)도
    알아채야 한다 — 그래서 받을 때마다 받은 시각을 모든 행에 찍는다."""
    from app.markets import Board
    from app.models import KrxListing
    from app.services import krx

    def serve(name):
        monkeypatch.setattr(krx, "fetch_all", lambda timeout=30: [
            {"code": "123456", "name": name, "board": Board.KOSPI.value, "instrument": "STOCK"},
        ])

    serve("옛이름전자")
    symbols.refresh_krx_listing(db_session)
    first = db_session.get(KrxListing, "123456").updated_at
    assert symbols.search("옛이름전자", db=db_session, allow_network=False)[0].ticker == "123456.KS"

    serve("새이름전자")
    symbols.refresh_krx_listing(db_session)
    assert db_session.get(KrxListing, "123456").updated_at > first
    assert symbols.search("새이름전자", db=db_session, allow_network=False)[0].ticker == "123456.KS"


def test_search_does_not_reread_the_lists_on_every_keystroke(listed, monkeypatch):
    calls = []
    real = symbols._build_entries
    monkeypatch.setattr(symbols, "_build_entries", lambda db: calls.append(1) or real(db))
    symbols.reset_entries_cache()
    for query in ("a", "ag", "agi", "agil"):
        symbols.search(query, db=listed, allow_network=False)
    assert len(calls) == 1
