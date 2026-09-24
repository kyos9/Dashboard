"""코스피·코스닥 전체 목록을 네이버 금융 시가총액 목록에서 받는다.

서버에서는 한국거래소 KIND가 HTTP 403으로 막혀, 내장 목록(주요 종목 150여 개)에 없는 국내
주식은 이름으로 찾을 수 없었다. 네이버는 같은 서버에서 ETF 목록·시세가 받아진다.
쪽을 넘기며 받으므로 "어디서 멈추는가"와 "중간에 끊기면 어떻게 되는가"를 직접 확인한다.
"""

import pytest
import requests

from app.markets import Board
from app.services import krx, symbols


def _page(rows: list[tuple[str, str]], page: int, last: int, with_end_link: bool = True) -> bytes:
    """네이버 시가총액 목록 한 쪽 — 실제 화면의 뼈대만 옮겼다 (EUC-KR)."""
    body = "".join(
        '<tr onMouseOver="mouseOver(this)">'
        f'<td class="no">{i}</td>'
        f'<td><a href="/item/main.naver?code={code}" class="tltle">{name}</a></td>'
        '<td class="number">71,000</td></tr>'
        for i, (code, name) in enumerate(rows, start=1)
    )
    navi = "".join(
        f'<td><a href="/sise/sise_market_sum.naver?sosok=0&amp;page={n}">{n}</a></td>'
        for n in range(max(1, page - 2), min(last, page + 2) + 1)
    )
    if with_end_link:
        navi += f'<td class="pgRR"><a href="/sise/sise_market_sum.naver?sosok=0&amp;page={last}">맨뒤</a></td>'
    html = (
        '<html><head><meta charset="euc-kr"></head><body>'
        '<div class="aside"><a href="/item/main.naver?code=999999">사이드 광고 종목</a></div>'
        f'<table class="type_2"><tr><th>N</th><th>종목명</th></tr>{body}</table>'
        f'<table class="Nnavi"><tr>{navi}</tr></table>'
        "</body></html>"
    )
    return html.encode("cp949")


class _Raw:
    def __init__(self, status=200, content=b""):
        self.status_code = status
        self.content = content


KOSPI_PAGES = {
    1: [("005930", "삼성전자"), ("000660", "SK하이닉스")],
    2: [("005935", "삼성전자우"), ("069500", "KODEX 200")],
    3: [("0091P0", "새 코드 종목"), ("123456", "작은회사")],
}


@pytest.fixture()
def naver(monkeypatch):
    """쪽 번호로 답하는 가짜 네이버. `fail` 에 쪽 번호를 넣으면 그 쪽에서 실패한다."""
    state = {"asked": [], "fail": {}, "pages": KOSPI_PAGES}

    def fake_get(url, params=None, headers=None, timeout=None):
        assert url == krx.MARKET_SUM_URL
        page = params["page"]
        state["asked"].append((params["sosok"], page))
        failing = state["fail"].get(page, 0)
        if failing:
            state["fail"][page] = failing - 1
            raise requests.ConnectionError("끊김")
        pages = state["pages"]
        last = max(pages)
        return _Raw(content=_page(pages[min(page, last)], min(page, last), last))

    monkeypatch.setattr(requests, "get", fake_get)
    return state


# ── 한 쪽 읽기 ───────────────────────────────────────────────────────


def test_page_reads_codes_names_and_the_last_page():
    rows, last = krx.parse_market_sum_page(
        _page(KOSPI_PAGES[1], 1, 41).decode("cp949"), Board.KOSDAQ
    )
    assert rows == [
        {"code": "005930", "name": "삼성전자", "board": "KOSDAQ"},
        {"code": "000660", "name": "SK하이닉스", "board": "KOSDAQ"},
    ]
    assert last == 41  # 사이드의 다른 종목 링크(999999)는 목록이 아니다


def test_last_page_without_the_end_link_uses_the_largest_page_number():
    """마지막 쪽 근처에서는 "맨뒤" 칸이 없다."""
    _, last = krx.parse_market_sum_page(_page(KOSPI_PAGES[1], 40, 41, with_end_link=False).decode("cp949"), Board.KOSPI)
    assert last == 41


# ── 시장 하나를 끝까지 ───────────────────────────────────────────────


def test_board_walks_every_page_and_keeps_registrable_codes(naver):
    rows = krx.fetch_board_naver(Board.KOSPI)
    assert [r["code"] for r in rows] == ["005930", "000660", "005935", "069500", "123456"]
    # 우선주도 따로 — KIND는 회사 단위라 이게 없었다
    assert {"code": "005935", "name": "삼성전자우", "board": "KOSPI"} in rows
    assert [p for _, p in naver["asked"]] == [1, 2, 3]
    assert {s for s, _ in naver["asked"]} == {0}


def test_kosdaq_asks_the_kosdaq_list(naver):
    rows = krx.fetch_board_naver(Board.KOSDAQ)
    assert {s for s, _ in naver["asked"]} == {1}
    assert all(r["board"] == "KOSDAQ" for r in rows)


def test_a_page_past_the_end_does_not_loop(naver, monkeypatch):
    """마지막 쪽 번호를 크게 잘못 읽어도, 네이버가 같은 쪽을 다시 주면 거기서 멈춘다."""
    real = krx.parse_market_sum_page
    monkeypatch.setattr(krx, "parse_market_sum_page", lambda html, board: (real(html, board)[0], 999))
    krx.fetch_board_naver(Board.KOSPI)
    assert [p for _, p in naver["asked"]] == [1, 2, 3, 4]


def test_a_blip_is_retried_once(naver):
    naver["fail"] = {2: 1}
    assert len(krx.fetch_board_naver(Board.KOSPI)) == 5


def test_a_page_that_stays_down_fails_the_whole_board(naver):
    """뒤쪽이 빠진 목록(= 중소형주만 빠진 목록)을 "받았음"으로 저장하지 않는다."""
    naver["fail"] = {3: 2}
    with pytest.raises(krx.KrxUnavailable, match="3쪽"):
        krx.fetch_board_naver(Board.KOSPI)


def test_an_unrecognisable_page_is_a_failure_not_an_empty_list(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: _Raw(content="<html>점검 중</html>".encode("cp949")))
    with pytest.raises(krx.KrxUnavailable, match="하나도"):
        krx.fetch_board_naver(Board.KOSPI)


def test_http_error_is_reported(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: _Raw(status=403))
    with pytest.raises(krx.KrxUnavailable, match="403"):
        krx.fetch_board_naver(Board.KOSPI)


# ── 네이버가 안 되면 한국거래소 ──────────────────────────────────────


def test_board_falls_back_to_kind_and_reports_both_when_both_fail(monkeypatch):
    kind_rows = [{"code": "005930", "name": "삼성전자", "board": "KOSPI"}]

    def naver_down(board, timeout=30):
        raise krx.KrxUnavailable("HTTP 503")

    monkeypatch.setattr(krx, "fetch_board_naver", naver_down)
    monkeypatch.setattr(krx, "fetch_board_kind", lambda board, timeout=30: kind_rows)
    assert krx.fetch_board(Board.KOSPI) == kind_rows

    def kind_down(board, timeout=30):
        raise krx.KrxUnavailable("HTTP 403")

    monkeypatch.setattr(krx, "fetch_board_kind", kind_down)
    with pytest.raises(krx.KrxUnavailable) as excinfo:
        krx.fetch_board(Board.KOSPI)
    assert "503" in str(excinfo.value) and "403" in str(excinfo.value)


def test_naver_wins_when_it_works(monkeypatch):
    monkeypatch.setattr(krx, "fetch_board_naver", lambda board, timeout=30: [{"code": "005935", "name": "삼성전자우", "board": "KOSPI"}])

    def kind_should_not_run(board, timeout=30):
        raise AssertionError("네이버가 됐는데 한국거래소를 불렀습니다")

    monkeypatch.setattr(krx, "fetch_board_kind", kind_should_not_run)
    assert krx.fetch_board(Board.KOSPI)[0]["name"] == "삼성전자우"


# ── 합치기·저장 ──────────────────────────────────────────────────────


def test_etfs_in_the_market_list_are_stored_once_as_etf(monkeypatch, db_session):
    """시가총액 목록에도 ETF가 섞여 있다. 두 번 저장하려 들면 키가 겹쳐 목록 전체가 실패한다."""
    from app.models import KrxListing

    kospi = [
        {"code": "005930", "name": "삼성전자", "board": "KOSPI"},
        {"code": "069500", "name": "KODEX 200", "board": "KOSPI"},
    ]
    monkeypatch.setattr(krx, "fetch_board", lambda board, timeout=30: kospi if board is Board.KOSPI else [])
    monkeypatch.setattr(
        krx, "fetch_etfs",
        lambda timeout=30: [{"code": "069500", "name": "KODEX 200", "board": "KOSPI", "instrument": "ETF"}],
    )

    assert symbols.refresh_krx_listing(db_session) == 2
    kinds = {row.code: row.instrument for row in db_session.query(KrxListing).all()}
    assert kinds == {"005930": "STOCK", "069500": "ETF"}


def test_a_small_cap_outside_the_seed_is_found_by_name_after_refresh(naver, db_session, monkeypatch):
    """이번 일의 목적 — 내장 목록에 없는 종목도 이름으로 찾는다."""
    monkeypatch.setattr(krx, "fetch_etfs", lambda timeout=30: [])
    before = symbols.resolve("작은회사", db=db_session, allow_network=False)
    assert before is None or before.ticker != "123456.KS"

    symbols.refresh_krx_listing(db_session)

    match = symbols.resolve("작은회사", db=db_session, allow_network=False)
    assert (match.ticker, match.name) == ("123456.KS", "작은회사")
