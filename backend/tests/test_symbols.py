"""종목명 -> 티커 해석.

핵심 요구사항: **확정할 수 없으면 조용히 하나를 고르지 않는다.** 종목코드를 잘못 짚으면
다른 회사의 시세를 받아오는데, 그건 실패보다 나쁘다.

네트워크는 쓰지 않는다 (allow_network=False 또는 가짜 응답).
"""

import pytest

from app.markets import Board, Market
from app.models import KrxListing
from app.services import krx, symbols

# KIND 상장법인 목록이 실제로 내려주는 모양 (EUC-KR HTML 표)
KIND_HTML = """
<html><body><table>
<tr><th>회사명</th><th>종목코드</th><th>업종</th><th>주요제품</th></tr>
<tr><td>삼성전자</td><td>005930</td><td>통신 및 방송 장비 제조업</td><td>휴대폰</td></tr>
<tr><td>테스트기업</td><td>123456</td><td>소프트웨어 개발</td><td>솔루션</td></tr>
</table></body></html>
"""


# ── 이미 티커인 입력 ─────────────────────────────────────────────────

def test_full_korean_ticker_passes_through():
    match = symbols.resolve("005930.KS", allow_network=False)
    assert match.ticker == "005930.KS"
    assert match.market == Market.KR
    assert match.board == Board.KOSPI
    # 시드에 있으므로 이름까지 붙어야 한다
    assert match.name == "삼성전자"


def test_us_ticker_passes_through():
    match = symbols.resolve("voo", allow_network=False)
    assert match.ticker == "VOO"
    assert match.market == Market.US


# ── 이름으로 찾기 ────────────────────────────────────────────────────

def test_korean_name_resolves_to_ticker():
    match = symbols.resolve("삼성전자", allow_network=False)
    assert match.ticker == "005930.KS"
    assert match.market == Market.KR


def test_kosdaq_name_gets_kq_suffix():
    match = symbols.resolve("에코프로비엠", allow_network=False)
    assert match.ticker == "247540.KQ"
    assert match.board == Board.KOSDAQ


def test_english_alias_resolves():
    assert symbols.resolve("samsung electronics", allow_network=False).ticker == "005930.KS"


def test_spacing_is_ignored():
    """"삼성 전자"처럼 띄어 써도 찾아야 한다."""
    assert symbols.resolve("삼성 전자", allow_network=False).ticker == "005930.KS"


def test_bare_six_digit_code_resolves_when_known():
    assert symbols.resolve("005930", allow_network=False).ticker == "005930.KS"


def test_etf_name_resolves():
    match = symbols.resolve("KODEX 200", allow_network=False)
    assert match.ticker == "069500.KS"
    assert match.instrument == "ETF"


def test_partial_name_returns_ranked_candidates():
    matches = symbols.search("삼성", allow_network=False, limit=10)
    tickers = [m.ticker for m in matches]
    assert "005930.KS" in tickers  # 삼성전자
    assert len(tickers) > 1  # 삼성물산, 삼성SDI 등도 함께
    # 정확히 일치하는 이름이 없으면 접두사 일치가 앞에 온다
    assert all(m.score > 0 for m in matches)


def test_unknown_name_resolves_to_nothing():
    assert symbols.resolve("없는회사이름입니다", allow_network=False) is None


# ── 확정 불가 상황 ───────────────────────────────────────────────────

def test_unknown_six_digit_code_offers_both_boards_but_does_not_resolve():
    """모르는 6자리 코드는 코스피/코스닥 중 어느 쪽인지 알 수 없다.

    후보는 보여주되(사용자가 고를 수 있게) resolve는 None이어야 한다 —
    한쪽을 임의로 고르면 다른 회사의 시세를 받게 된다.
    """
    matches = symbols.search("999999", allow_network=False)
    assert {m.ticker for m in matches} == {"999999.KS", "999999.KQ"}
    assert all(m.confident is False for m in matches)
    assert symbols.resolve("999999", allow_network=False) is None


# ── KRX 상장목록 파싱/캐시 ───────────────────────────────────────────

def test_parse_kind_corp_list():
    rows = krx.parse_corp_list(KIND_HTML, Board.KOSPI)
    assert rows == [
        {"code": "005930", "name": "삼성전자", "board": "KOSPI"},
        {"code": "123456", "name": "테스트기업", "board": "KOSPI"},
    ]


def test_parse_keeps_leading_zeros():
    """종목코드를 숫자로 읽으면 "005930"의 앞자리 0이 날아간다."""
    html = KIND_HTML.replace("<td>005930</td>", "<td>5930</td>")
    rows = krx.parse_corp_list(html, Board.KOSPI)
    assert rows[0]["code"] == "005930"


def test_parse_rejects_non_table_response():
    with pytest.raises(krx.KrxUnavailable):
        krx.parse_corp_list("<html><body>점검 중입니다</body></html>", Board.KOSPI)


def test_cached_listing_makes_new_names_searchable(db_session):
    """시드에 없는 종목도 KRX 목록을 한 번 받아두면 오프라인에서 찾을 수 있다."""
    assert symbols.resolve("테스트기업", db=db_session, allow_network=False) is None

    db_session.add(KrxListing(code="123456", name="테스트기업", board="KOSPI"))
    db_session.commit()

    match = symbols.resolve("테스트기업", db=db_session, allow_network=False)
    assert match.ticker == "123456.KS"


def test_cached_listing_name_overrides_seed_but_keeps_aliases(db_session):
    """회사명이 바뀌면 KRX 목록이 정답이다. 단 시드의 영문 별칭은 계속 쓸 수 있어야 한다."""
    db_session.add(KrxListing(code="005930", name="삼성전자우선주식회사", board="KOSPI"))
    db_session.commit()

    assert symbols.resolve("삼성전자우선주식회사", db=db_session, allow_network=False).ticker == "005930.KS"
    # 시드 별칭(영문명)과 옛 이름으로도 여전히 찾힌다
    assert symbols.resolve("samsung electronics", db=db_session, allow_network=False).ticker == "005930.KS"


def test_refresh_krx_listing_upserts(db_session, monkeypatch):
    monkeypatch.setattr(
        krx, "fetch_all", lambda timeout=30: [
            {"code": "005930", "name": "삼성전자", "board": "KOSPI"},
            {"code": "123456", "name": "테스트기업", "board": "KOSPI"},
        ]
    )
    count = symbols.refresh_krx_listing(db_session)
    assert count == 2
    assert db_session.query(KrxListing).count() == 2

    # 다시 돌려도 중복 행이 생기지 않는다
    symbols.refresh_krx_listing(db_session)
    assert db_session.query(KrxListing).count() == 2


def test_search_survives_broken_seed(monkeypatch):
    """시드 파일이 깨져도 앱이 죽지 않고 티커 입력은 계속 동작해야 한다."""
    monkeypatch.setattr(symbols, "load_seed", lambda: [])
    assert symbols.resolve("VOO", allow_network=False).ticker == "VOO"
    assert symbols.resolve("삼성전자", allow_network=False) is None
