"""국내 ETF — 이름으로 찾고, 증권사 앱과 같은 이름으로 보이는가.

예전에는 한국거래소 상장법인 목록(ETF 없음)과 손으로 적은 ETF 19개뿐이라, "KODEX 미국S&P500"
같은 대표 ETF도 이름으로 못 찾았다. 코드로 넣으면 이름 자리에 코드가, 야후로 찾으면 영문
이름이 붙었다. 네이버 ETF 목록으로 전체를 받는다.
"""

import datetime as dt
import json

import pytest
import requests

from app.models import Instrument, KrxListing, UserStock
from app.services import krx, symbols
from tests.factories import make_stock

NAVER_PAYLOAD = {
    "resultCode": "success",
    "result": {
        "etfItemList": [
            {"itemcode": "379800", "etfTabCode": 4, "itemname": "KODEX 미국S&P500", "nowVal": 21000},
            {"itemcode": "449180", "etfTabCode": 4, "itemname": "KODEX 미국S&P500(H)", "nowVal": 13000},
            {"itemcode": "360750", "etfTabCode": 4, "itemname": "TIGER 미국S&P500", "nowVal": 22000},
            # 2024년부터 나온 영문 섞인 코드 — 아직 등록할 수 없는 모양이라 뺀다
            {"itemcode": "0091P0", "etfTabCode": 4, "itemname": "새 코드 ETF"},
            {"itemcode": "379800", "itemname": "KODEX 미국S&P500"},  # 중복
            {"itemcode": "", "itemname": "코드 없음"},
            "이상한 줄",
        ]
    },
}


class _Raw:
    def __init__(self, status=200, content=b""):
        self.status_code = status
        self.content = content


# ── 목록 읽기 ────────────────────────────────────────────────────────


def test_parse_keeps_registrable_etfs_with_their_korean_names():
    rows = krx.parse_etf_list(NAVER_PAYLOAD)
    assert rows == [
        {"code": "379800", "name": "KODEX 미국S&P500", "board": "KOSPI", "instrument": "ETF"},
        {"code": "449180", "name": "KODEX 미국S&P500(H)", "board": "KOSPI", "instrument": "ETF"},
        {"code": "360750", "name": "TIGER 미국S&P500", "board": "KOSPI", "instrument": "ETF"},
    ]


@pytest.mark.parametrize("payload", [{}, {"result": None}, {"result": {"etfItemList": []}}, []])
def test_parse_refuses_an_unexpected_shape(payload):
    with pytest.raises(krx.KrxUnavailable):
        krx.parse_etf_list(payload)


@pytest.mark.parametrize("encoding", ["utf-8", "cp949"])
def test_fetch_reads_either_encoding(monkeypatch, encoding):
    """네이버는 이 목록을 EUC-KR로 줄 때가 있다. 잘못 읽으면 이름이 전부 깨진다."""
    captured = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured.update(url=url, params=params)
        return _Raw(content=json.dumps(NAVER_PAYLOAD, ensure_ascii=False).encode(encoding))

    monkeypatch.setattr(requests, "get", fake_get)
    rows = krx.fetch_etfs()
    assert captured["url"] == krx.ETF_LIST_URL
    assert captured["params"]["etfType"] == 0
    assert rows[0]["name"] == "KODEX 미국S&P500"


def test_fetch_reports_http_errors(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: _Raw(status=403))
    with pytest.raises(krx.KrxUnavailable, match="403"):
        krx.fetch_etfs()


def test_fetch_all_adds_etfs_and_survives_either_side_failing(monkeypatch):
    stock = {"code": "005930", "name": "삼성전자", "board": "KOSPI"}
    etf = {"code": "379800", "name": "KODEX 미국S&P500", "board": "KOSPI", "instrument": "ETF"}
    monkeypatch.setattr(krx, "fetch_board", lambda board, timeout=30: [stock] if board.value == "KOSPI" else [])
    monkeypatch.setattr(krx, "fetch_etfs", lambda timeout=30: [etf])
    assert krx.fetch_all() == [stock, etf]

    def etf_down(timeout=30):
        raise krx.KrxUnavailable("점검 중")

    monkeypatch.setattr(krx, "fetch_etfs", etf_down)
    assert krx.fetch_all() == [stock]


# ── 검색·등록 ────────────────────────────────────────────────────────


@pytest.fixture()
def listed(db_session, monkeypatch):
    rows = [{"code": "005930", "name": "삼성전자", "board": "KOSPI"}, *krx.parse_etf_list(NAVER_PAYLOAD)]
    monkeypatch.setattr(krx, "fetch_all", lambda timeout=30: rows)
    return db_session


def test_etf_is_found_by_the_name_the_brokerage_uses(listed):
    symbols.refresh_krx_listing(listed)
    match = symbols.resolve("kodex 미국s&p500", db=listed, allow_network=False)
    assert (match.ticker, match.name) == ("379800.KS", "KODEX 미국S&P500")
    # 비슷한 이름(환헤지)은 후보로는 뜨지만 자동으로 고르지 않는다
    tickers = [m.ticker for m in symbols.search("kodex 미국s&p", db=listed, allow_network=False)]
    assert {"379800.KS", "449180.KS"} <= set(tickers)


def test_registering_by_code_gets_the_korean_name(listed):
    symbols.refresh_krx_listing(listed)
    match = symbols.resolve("379800.KS", db=listed, allow_network=False)
    assert match.name == "KODEX 미국S&P500"


def test_cache_without_etfs_is_refetched_even_if_recent(listed):
    """ETF를 받기 전에 채운 캐시는 날짜로는 최신이다. 그대로 두면 일주일 동안 못 찾는다."""
    listed.add(KrxListing(code="005930", name="삼성전자", board="KOSPI", instrument="STOCK",
                          updated_at=dt.datetime.utcnow()))
    listed.commit()
    assert symbols.refresh_krx_listing_if_stale(listed) is not None
    # 한 번 받은 뒤에는 평소 주기대로
    assert symbols.refresh_krx_listing_if_stale(listed) is None


# ── 이미 담긴 종목의 이름 ────────────────────────────────────────────


def test_auto_names_are_replaced_but_hand_written_ones_are_kept(listed):
    make_stock(listed, "379800.KS", name="Samsung KODEX US S&P500 ETF")  # 야후로 들어온 영문
    instrument = listed.get(Instrument, "379800.KS")
    instrument.name = "Samsung KODEX US S&P500 ETF"
    make_stock(listed, "360750.KS", name="360750")  # 코드로 들어와 이름 자리에 코드
    listed.get(Instrument, "360750.KS").name = "360750"
    make_stock(listed, "449180.KS", name="내 S&P 환헤지")  # 사람이 고친 이름
    listed.get(Instrument, "449180.KS").name = "KODEX US S&P500(H)"
    listed.commit()

    symbols.refresh_krx_listing(listed)

    names = {s.ticker: s.name for s in listed.query(UserStock).all()}
    assert names["379800.KS"] == "KODEX 미국S&P500"
    assert names["360750.KS"] == "TIGER 미국S&P500"
    assert names["449180.KS"] == "내 S&P 환헤지"
    # 공용 행은 정식 이름으로 — 다음에 담는 사람은 처음부터 이 이름을 본다
    assert listed.get(Instrument, "449180.KS").name == "KODEX 미국S&P500(H)"
