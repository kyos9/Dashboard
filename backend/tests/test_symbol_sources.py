"""종목 목록/검색의 외부 조회 경로. 실제 네트워크 대신 가짜 응답을 넣는다.

여기가 조용히 틀리면 "검색은 되는데 엉뚱한 종목"이 되므로, 응답 매핑과 실패 분류를
직접 확인한다.
"""

import datetime as dt

import pytest
import requests

from app.markets import Board, Market
from app.services import krx, symbols

KIND_HTML = """
<html><body><table>
<tr><th>회사명</th><th>종목코드</th><th>업종</th></tr>
<tr><td>삼성전자</td><td>005930</td><td>반도체</td></tr>
</table></body></html>
"""


class _Response:
    def __init__(self, status=200, text="", encoding=None):
        self.status_code = status
        self.text = text
        self.encoding = encoding


# ── 한국거래소(KIND) 목록 조회 — 네이버가 안 될 때의 대안 ─────────────────────────────────────────────

def test_fetch_board_requests_right_market_and_decodes_euckr(monkeypatch):
    """이 파일은 EUC-KR로 내려온다. 인코딩을 지정하지 않으면 한글이 깨진다."""
    captured = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured.update(url=url, params=params)
        return _Response(text=KIND_HTML)

    monkeypatch.setattr(requests, "get", fake_get)

    rows = krx.fetch_board_kind(Board.KOSDAQ)

    assert captured["params"] == {"method": "download", "marketType": "kosdaqMkt"}
    assert rows == [{"code": "005930", "name": "삼성전자", "board": "KOSDAQ"}]


def test_fetch_board_reports_http_error(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: _Response(status=503))
    with pytest.raises(krx.KrxUnavailable) as excinfo:
        krx.fetch_board_kind(Board.KOSPI)
    assert "503" in str(excinfo.value)


def test_fetch_board_reports_connection_failure(monkeypatch):
    def blocked(*a, **k):
        raise ConnectionError("CONNECT tunnel failed, 403")

    monkeypatch.setattr(requests, "get", blocked)
    with pytest.raises(krx.KrxUnavailable) as excinfo:
        krx.fetch_board_kind(Board.KOSPI)
    assert "ConnectionError" in str(excinfo.value)


def test_fetch_all_keeps_one_board_when_the_other_fails(monkeypatch):
    """코스닥이 막혀도 코스피는 살려야 검색이 반쪽이라도 동작한다."""
    def one_sided(board, timeout=30):
        if board is Board.KOSPI:
            return [{"code": "005930", "name": "삼성전자", "board": "KOSPI"}]
        raise krx.KrxUnavailable("점검 중")

    monkeypatch.setattr(krx, "fetch_board", one_sided)
    assert krx.fetch_all() == [{"code": "005930", "name": "삼성전자", "board": "KOSPI"}]


def test_fetch_all_fails_only_when_every_board_fails(monkeypatch):
    def blocked(board, timeout=30):
        raise krx.KrxUnavailable(f"{board.value} 점검 중")

    monkeypatch.setattr(krx, "fetch_board", blocked)
    with pytest.raises(krx.KrxUnavailable) as excinfo:
        krx.fetch_all()
    assert "KOSPI" in str(excinfo.value) and "KOSDAQ" in str(excinfo.value)


# ── 야후 검색 ────────────────────────────────────────────────────────

def _yahoo_payload():
    class R:
        status_code = 200

        @staticmethod
        def json():
            return {
                "quotes": [
                    {"symbol": "AAPL", "longname": "Apple Inc.", "quoteType": "EQUITY"},
                    {"symbol": "005930.KS", "shortname": "Samsung Electronics", "quoteType": "EQUITY"},
                    {"symbol": "", "longname": "이름만 있고 심볼 없음"},
                ]
            }

    return R()


def test_yahoo_search_maps_symbols_and_markets(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: _yahoo_payload())

    matches = symbols._search_yahoo("apple", limit=5)

    by_ticker = {m.ticker: m for m in matches}
    assert by_ticker["AAPL"].name == "Apple Inc."
    assert by_ticker["AAPL"].market == Market.US
    # 국내 심볼이면 시장/세부시장까지 채워져야 한다
    assert by_ticker["005930.KS"].market == Market.KR
    assert by_ticker["005930.KS"].board == Board.KOSPI
    # 심볼 없는 항목은 후보가 될 수 없다
    assert "" not in by_ticker


def test_yahoo_search_returns_nothing_when_blocked(monkeypatch):
    """검색이 막혀도 예외를 올리면 안 된다 — 내장 목록으로 계속 동작해야 한다."""
    def blocked(*a, **k):
        raise ConnectionError("CONNECT tunnel failed, 403")

    monkeypatch.setattr(requests, "get", blocked)
    assert symbols._search_yahoo("apple", limit=5) == []


def test_yahoo_search_ignores_error_status(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: _Response(status=429))
    assert symbols._search_yahoo("apple", limit=5) == []


def test_search_falls_back_to_yahoo_when_nothing_local(monkeypatch, db_session):
    """내장 목록에도 캐시에도 없으면 야후 검색까지 간다."""
    monkeypatch.setattr(symbols, "refresh_krx_listing", lambda db, timeout=30: 0)
    monkeypatch.setattr(requests, "get", lambda *a, **k: _yahoo_payload())

    matches = symbols.search("apple inc", db=db_session, allow_network=True)
    assert any(m.ticker == "AAPL" for m in matches)


def test_ticker_shaped_input_is_treated_as_a_ticker(db_session):
    """공백 없는 영문 한 단어는 티커로도 본다 — 야후 검색을 기다리지 않기 위해서다.

    **다만 그 추측이 이름을 이기지는 않는다.** 예전에는 이 규칙 때문에 "apple"이
    `APPLE` 이라는 없는 종목으로 해석됐다. 영문 열 자 이하는 전부 티커 모양이라,
    회사 이름을 친 사람이 시세가 붙지 않는 빈 종목을 등록하게 됐다.
    """
    assert symbols.resolve("VOO", db=db_session, allow_network=False).ticker == "VOO"
    # 이름을 아는 종목이 있으면 그쪽이 이긴다
    assert symbols.resolve("apple", db=db_session, allow_network=False).ticker == "AAPL"
    # 아무 데도 없는 티커 모양은 여전히 티커로 — 그래야 목록에 없는 종목을 넣을 수 있다
    assert symbols.resolve("ZZZZ", db=db_session, allow_network=False).ticker == "ZZZZ"


def test_local_hit_does_not_touch_network(monkeypatch, db_session):
    """평소 검색이 매번 외부로 나가면 느리고 차단 환경에서 멈춘다."""
    def should_not_be_called(*a, **k):
        raise AssertionError("로컬에서 찾았는데 네트워크를 썼다")

    monkeypatch.setattr(requests, "get", should_not_be_called)
    assert symbols.resolve("삼성전자", db=db_session).ticker == "005930.KS"


def test_listing_refresh_is_skipped_while_cache_is_fresh(db_session, monkeypatch):
    """상장목록은 자주 바뀌지 않는다. 앱을 켤 때마다 받으면 낭비다."""
    from app.models import KrxListing

    db_session.add(
        KrxListing(code="005930", name="삼성전자", board="KOSPI", updated_at=dt.datetime.utcnow())
    )
    # ETF까지 받은 캐시여야 "최신"이다 — ETF가 없는 캐시는 날짜와 상관없이 다시 받는다
    # (test_krx_etf.py::test_cache_without_etfs_is_refetched_even_if_recent)
    db_session.add(
        KrxListing(code="379800", name="KODEX 미국S&P500", board="KOSPI", instrument="ETF",
                   updated_at=dt.datetime.utcnow())
    )
    db_session.commit()

    def should_not_run(timeout=30):
        raise AssertionError("최신 캐시가 있는데 다시 받았습니다")

    monkeypatch.setattr(krx, "fetch_all", should_not_run)
    assert symbols.refresh_krx_listing_if_stale(db_session) is None


def test_listing_refresh_runs_when_cache_is_empty(db_session, monkeypatch):
    """캐시가 비어 있으면 (= 첫 실행) 받아와야 한다."""
    monkeypatch.setattr(
        krx, "fetch_all", lambda timeout=30: [{"code": "005930", "name": "삼성전자", "board": "KOSPI"}]
    )
    assert symbols.refresh_krx_listing_if_stale(db_session) == 1


def test_listing_refresh_runs_when_cache_is_old(db_session, monkeypatch):
    from app.models import KrxListing

    stale = dt.datetime.utcnow() - symbols.LISTING_STALE_AFTER - dt.timedelta(days=1)
    db_session.add(KrxListing(code="005930", name="옛이름", board="KOSPI", updated_at=stale))
    db_session.commit()

    monkeypatch.setattr(
        krx, "fetch_all", lambda timeout=30: [{"code": "005930", "name": "삼성전자", "board": "KOSPI"}]
    )
    assert symbols.refresh_krx_listing_if_stale(db_session) == 1
    assert db_session.query(KrxListing).filter_by(code="005930").one().name == "삼성전자"


# ── 못 찾았을 때 목록 다시 받기 — 검색을 붙잡지 않는다 ──────────────


@pytest.fixture()
def slow_listing(monkeypatch):
    """받는 데 5초 걸리는 상장목록. 서버에서 거래소 한 곳이 응답을 안 할 때의 모습이다."""
    import threading
    import time

    started = threading.Event()
    calls: list[int] = []

    def slow(db, timeout=30):
        calls.append(1)
        started.set()
        time.sleep(5)
        return 0

    monkeypatch.setattr(symbols, "refresh_krx_listing", slow)
    monkeypatch.setattr(symbols, "_miss_refresh_at", None)
    return started, calls


def test_a_miss_does_not_wait_for_the_listing(db_session, slow_listing):
    """예전에는 이 자리에서 목록을 기다리며 받아, 종목 추가 한 번이 1분 넘게 걸렸다."""
    import time

    started, calls = slow_listing
    began = time.perf_counter()
    assert symbols.search("없는이름종목", db=db_session, allow_network=True) == []
    assert time.perf_counter() - began < 1.0
    # 그래도 받기는 한다 — 뒤에서
    assert started.wait(2)


def test_misses_refresh_the_listing_at_most_once_an_hour(db_session, slow_listing):
    started, calls = slow_listing
    for query in ("없는이름하나", "없는이름둘", "999999"):
        symbols.search(query, db=db_session, allow_network=True)
    started.wait(2)
    assert calls == [1]
