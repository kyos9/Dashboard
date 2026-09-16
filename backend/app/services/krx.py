"""한국거래소 상장법인 목록 조회.

KIND(kind.krx.co.kr)가 공개하는 상장법인 목록을 받아 종목코드↔회사명 대응표를 만든다.
API 키가 필요 없고 응답이 단순한 HTML 표라서 의존성이 가볍다.

한계: 이 목록은 "상장법인"만 담고 있어 ETF/ETN은 포함되지 않는다. ETF는 번들 시드
(`app/data/krx_seed.json`)와 야후 검색으로 보완한다.
"""

from __future__ import annotations

import logging

from bs4 import BeautifulSoup

from app.markets import Board

logger = logging.getLogger(__name__)

BASE_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do"

# marketType 파라미터 <-> 시장 구분
MARKET_TYPES: dict[Board, str] = {
    Board.KOSPI: "stockMkt",
    Board.KOSDAQ: "kosdaqMkt",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*",
}


class KrxUnavailable(Exception):
    """KRX 목록을 받지 못했다. 로컬 시드로도 동작해야 하므로 치명적 오류는 아니다."""


def parse_corp_list(html: str, board: Board) -> list[dict]:
    """KIND 상장법인 목록 HTML을 [{code, name, board}] 로 바꾼다.

    표의 첫 두 열이 회사명·종목코드다. 종목코드는 반드시 문자열로 다뤄야 한다 —
    숫자로 읽으면 "005930"의 앞자리 0이 날아간다.
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        raise KrxUnavailable("상장법인 목록에서 표를 찾지 못했습니다")

    rows = table.find_all("tr")
    if not rows:
        raise KrxUnavailable("상장법인 목록이 비어 있습니다")

    # 헤더에서 회사명/종목코드 열 위치를 찾는다 (열 순서가 바뀌어도 견디도록)
    header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
    try:
        name_idx = header_cells.index("회사명")
        code_idx = header_cells.index("종목코드")
    except ValueError:
        name_idx, code_idx = 0, 1

    out: list[dict] = []
    seen: set[str] = set()
    for row in rows[1:]:
        cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) <= max(name_idx, code_idx):
            continue
        name = cells[name_idx]
        code = cells[code_idx].strip().zfill(6)
        if not name or not code.isdigit() or len(code) != 6 or code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "name": name, "board": board.value})

    if not out:
        raise KrxUnavailable("상장법인 목록에서 종목을 하나도 읽지 못했습니다")
    return out


def fetch_board(board: Board, timeout: int = 30) -> list[dict]:
    """한 시장(코스피/코스닥)의 상장법인 목록을 받아온다."""
    import requests

    market_type = MARKET_TYPES.get(board)
    if market_type is None:
        raise KrxUnavailable(f"{board.value}는 목록 조회를 지원하지 않습니다")

    try:
        response = requests.get(
            BASE_URL,
            params={"method": "download", "marketType": market_type},
            headers=HEADERS,
            timeout=timeout,
        )
    except Exception as exc:
        raise KrxUnavailable(f"요청 실패 — {type(exc).__name__}: {exc}") from exc

    if response.status_code != 200:
        raise KrxUnavailable(f"HTTP {response.status_code}")

    # 이 파일은 EUC-KR로 내려온다. requests의 자동 추론에 맡기면 한글이 깨진다.
    response.encoding = "euc-kr"
    return parse_corp_list(response.text, board)


def fetch_all(timeout: int = 30) -> list[dict]:
    """코스피+코스닥 전체 목록. 한쪽이 실패해도 다른 쪽은 살린다."""
    listings: list[dict] = []
    errors: list[str] = []
    for board in MARKET_TYPES:
        try:
            listings.extend(fetch_board(board, timeout=timeout))
        except KrxUnavailable as exc:
            errors.append(f"{board.value}: {exc}")
            logger.warning("KRX %s 목록 조회 실패: %s", board.value, exc)

    if not listings:
        raise KrxUnavailable(" | ".join(errors) or "목록을 받지 못했습니다")
    return listings
