"""한국거래소 상장법인 목록 조회.

KIND(kind.krx.co.kr)가 공개하는 상장법인 목록을 받아 종목코드↔회사명 대응표를 만든다.
API 키가 필요 없고 응답이 단순한 HTML 표라서 의존성이 가볍다.

한계: 이 목록은 "상장법인"만 담고 있어 ETF/ETN은 포함되지 않는다. ETF는 네이버 금융의
ETF 목록(`fetch_etfs`)에서 따로 받는다 — 증권사 앱과 같은 한글 정식 이름이 온다.
예전에는 손으로 적은 19개와 야후 검색뿐이라, 나머지 ETF는 이름으로 못 찾았고 야후가 주는
영문 이름("Samsung KODEX ...")으로 등록됐다.
"""

from __future__ import annotations

import json
import logging
import re

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


# 네이버 금융 ETF 전체 목록 (키 필요 없음). etfType=0 이 "전체"다.
ETF_LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn"

# 지금 앱의 한국 티커는 여섯 자리 숫자만 받는다(`markets.KRX_TICKER_RE`). 2024년부터
# 영문이 섞인 새 코드도 나오는데, 그런 종목은 등록할 수 없으므로 목록에서도 뺀다.
_ETF_CODE_RE = re.compile(r"^\d{6}$")


def parse_etf_list(payload: dict) -> list[dict]:
    """네이버 ETF 목록 JSON을 [{code, name, board, instrument}] 로 바꾼다.

    ETF는 전부 유가증권시장(코스피)에 상장된다 — 티커 끝이 `.KS`다.
    """
    try:
        items = payload["result"]["etfItemList"]
    except (KeyError, TypeError) as exc:
        raise KrxUnavailable(f"ETF 목록 모양이 예상과 다릅니다 ({type(exc).__name__}: {exc})") from exc

    out: list[dict] = []
    seen: set[str] = set()
    for item in items or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("itemcode") or "").strip()
        name = str(item.get("itemname") or "").strip()
        if not name or not _ETF_CODE_RE.match(code) or code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "name": name, "board": Board.KOSPI.value, "instrument": "ETF"})

    if not out:
        raise KrxUnavailable("ETF 목록에서 종목을 하나도 읽지 못했습니다")
    return out


def _decode(raw: bytes) -> str:
    """네이버 응답은 때에 따라 EUC-KR로 온다. UTF-8로 먼저 읽고 안 되면 CP949로."""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp949")


def fetch_etfs(timeout: int = 30) -> list[dict]:
    """국내 상장 ETF 전체 목록."""
    import requests

    try:
        response = requests.get(
            ETF_LIST_URL,
            params={"etfType": 0, "targetColumn": "market_sum", "sortOrder": "desc"},
            headers={**HEADERS, "Accept": "application/json,*/*", "Referer": "https://finance.naver.com/"},
            timeout=timeout,
        )
    except Exception as exc:
        raise KrxUnavailable(f"ETF 목록 요청 실패 — {type(exc).__name__}: {exc}") from exc

    if response.status_code != 200:
        raise KrxUnavailable(f"ETF 목록 HTTP {response.status_code}")
    try:
        payload = json.loads(_decode(response.content))
    except ValueError as exc:
        raise KrxUnavailable(f"ETF 목록을 읽지 못했습니다 — {exc}") from exc
    return parse_etf_list(payload)


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
    """코스피+코스닥 상장법인 + ETF 전체 목록. 한쪽이 실패해도 나머지는 살린다."""
    listings: list[dict] = []
    errors: list[str] = []
    sources = [(board.value, lambda b=board: fetch_board(b, timeout=timeout)) for board in MARKET_TYPES]
    sources.append(("ETF", lambda: fetch_etfs(timeout=timeout)))
    for label, fetch in sources:
        try:
            listings.extend(fetch())
        except KrxUnavailable as exc:
            errors.append(f"{label}: {exc}")
            logger.warning("KRX %s 목록 조회 실패: %s", label, exc)

    if not listings:
        raise KrxUnavailable(" | ".join(errors) or "목록을 받지 못했습니다")
    return listings
