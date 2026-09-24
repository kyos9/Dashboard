"""국내 상장 종목 목록 조회 — 종목코드↔종목명 대응표.

**코스피·코스닥은 네이버 금융 시가총액 목록에서 받는다** (`fetch_board_naver`). 증권사 앱과
같은 종목명이 오고, 우선주(삼성전자우)도 따로 들어 있다. 예전에는 한국거래소 KIND의
상장법인 목록을 받았는데, 서버(오라클 클라우드)에서는 KIND가 HTTP 403으로 막혀 내장 목록
(주요 종목 150여 개)에 없는 국내 주식은 이름으로 찾을 수 없었다. KIND는 네이버가 안 될
때의 대안으로만 남긴다 (`fetch_board_kind` — 회사 단위라 우선주가 없다).

ETF는 네이버 금융의 ETF 목록(`fetch_etfs`)에서 따로 받는다 — 시가총액 목록에도 섞여
있지만 ETF 목록 쪽이 ETF라고 확실히 알려준다.
"""

from __future__ import annotations

import json
import logging
import re
import time
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

from app.markets import Board

logger = logging.getLogger(__name__)

KIND_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do"

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


def fetch_board_kind(board: Board, timeout: int = 30) -> list[dict]:
    """한 시장(코스피/코스닥)의 상장법인 목록 — 한국거래소 KIND."""
    import requests

    market_type = MARKET_TYPES.get(board)
    if market_type is None:
        raise KrxUnavailable(f"{board.value}는 목록 조회를 지원하지 않습니다")

    try:
        response = requests.get(
            KIND_URL,
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


# 네이버 금융 시가총액 순위 (키 필요 없음). 한 쪽에 50종목, sosok=0 코스피 / 1 코스닥.
MARKET_SUM_URL = "https://finance.naver.com/sise/sise_market_sum.naver"
NAVER_SOSOK: dict[Board, int] = {Board.KOSPI: 0, Board.KOSDAQ: 1}

# 쪽 수 상한 — 코스피·코스닥 모두 40쪽 남짓이다. 쪽 번호를 잘못 읽어도 끝없이 돌지 않게.
MAX_PAGES = 120
# 한 시장을 받는 데 쓸 최대 시간. 네이버가 느려져도 목록 받기가 한없이 붙잡지 않게.
BOARD_BUDGET_SECONDS = 240


def _page_number(href: str) -> int | None:
    values = parse_qs(urlparse(href).query).get("page")
    try:
        return int(values[0]) if values else None
    except ValueError:
        return None


def parse_market_sum_page(html: str, board: Board) -> tuple[list[dict], int]:
    """시가총액 목록 한 쪽을 ([{code, name, board}], 마지막 쪽 번호)로 바꾼다.

    종목 줄은 `<a href="/item/main.naver?code=005930" class="tltle">삼성전자</a>` 모양이다
    (`tltle`은 네이버 쪽 철자 그대로). 마지막 쪽은 아래 쪽 번호 표의 링크 중 가장 큰 번호다 —
    "맨뒤" 링크도 그 표 안에 있고, 마지막 쪽 근처에서 "맨뒤"가 없어지면 끝 번호가 직접 보인다.
    """
    soup = BeautifulSoup(html, "html.parser")
    links = soup.select("a.tltle") or soup.select("table.type_2 a[href*='code=']")

    rows: list[dict] = []
    seen: set[str] = set()
    for link in links:
        code = (parse_qs(urlparse(link.get("href", "")).query).get("code") or [""])[0].strip()
        name = link.get_text(strip=True)
        # 여섯 자리 숫자만 — 영문이 섞인 새 코드는 아직 등록할 수 없다 (_ETF_CODE_RE 참고)
        if not name or not _ETF_CODE_RE.match(code) or code in seen:
            continue
        seen.add(code)
        rows.append({"code": code, "name": name, "board": board.value})

    numbers = [n for a in soup.select("table.Nnavi a[href]") if (n := _page_number(a["href"]))]
    return rows, max(numbers, default=1)


def _fetch_market_sum_page(board: Board, page: int, timeout: int) -> tuple[list[dict], int]:
    import requests

    response = requests.get(
        MARKET_SUM_URL,
        params={"sosok": NAVER_SOSOK[board], "page": page},
        headers={**HEADERS, "Referer": "https://finance.naver.com/sise/"},
        timeout=timeout,
    )
    if response.status_code != 200:
        raise KrxUnavailable(f"HTTP {response.status_code}")
    return parse_market_sum_page(_decode(response.content), board)


def fetch_board_naver(board: Board, timeout: int = 30) -> list[dict]:
    """한 시장(코스피/코스닥)의 전체 종목 — 네이버 금융 시가총액 목록을 첫 쪽부터 끝까지.

    한 쪽이라도 끝내 못 받으면 **전부 실패로 친다.** 시가총액 순이라 뒤쪽이 빠지면
    중소형주만 조용히 빠진 목록이 "받았음"으로 저장돼 일주일 동안 그 종목들을 못 찾는다.
    (이미 받아둔 목록은 지워지지 않으므로 실패해도 검색이 줄지는 않는다.)
    """
    if board not in NAVER_SOSOK:
        raise KrxUnavailable(f"{board.value}는 목록 조회를 지원하지 않습니다")

    began = time.monotonic()
    out: list[dict] = []
    seen: set[str] = set()
    page, last = 1, 1
    while page <= min(last, MAX_PAGES):
        if time.monotonic() - began > BOARD_BUDGET_SECONDS:
            raise KrxUnavailable(f"{BOARD_BUDGET_SECONDS}초 안에 다 받지 못했습니다 ({page - 1}/{last}쪽)")
        try:
            rows, last = _fetch_market_sum_page(board, page, timeout)
        except Exception as first:  # 한 번만 다시 — 잠깐 끊긴 것까지 전체 실패로 만들지 않게
            try:
                rows, last = _fetch_market_sum_page(board, page, timeout)
            except KrxUnavailable as exc:
                raise KrxUnavailable(f"{page}쪽 {exc}") from first
            except Exception as exc:
                raise KrxUnavailable(f"{page}쪽 요청 실패 — {type(exc).__name__}: {exc}") from exc

        fresh = [row for row in rows if row["code"] not in seen]
        if not fresh:
            if page == 1:
                raise KrxUnavailable("시가총액 목록에서 종목을 하나도 읽지 못했습니다 (화면 모양이 바뀌었을 수 있습니다)")
            break  # 쪽 번호를 넘겨 물으면 네이버는 마지막 쪽을 다시 준다
        seen.update(row["code"] for row in fresh)
        out.extend(fresh)
        page += 1
    return out


def fetch_board(board: Board, timeout: int = 30) -> list[dict]:
    """한 시장의 전체 종목. 네이버에서 받고, 안 되면 한국거래소 KIND에서."""
    try:
        return fetch_board_naver(board, timeout=timeout)
    except KrxUnavailable as naver:
        logger.info("네이버 %s 목록을 받지 못해 한국거래소로 시도합니다: %s", board.value, naver)
        try:
            return fetch_board_kind(board, timeout=timeout)
        except KrxUnavailable as kind:
            raise KrxUnavailable(f"네이버 {naver} / 한국거래소 {kind}") from kind


def fetch_all(timeout: int = 30) -> list[dict]:
    """코스피+코스닥 전체 종목 + ETF 목록. 한쪽이 실패해도 나머지는 살린다.

    같은 코드가 두 번 나올 수 있다 — 시가총액 목록에도 ETF가 섞여 있다. 한 번만 남기고,
    ETF 목록에 있는 종목은 ETF로 적는다 (저장할 때 같은 코드가 두 번 오면 키가 겹친다).
    """
    by_code: dict[str, dict] = {}
    errors: list[str] = []
    sources = [(board.value, lambda b=board: fetch_board(b, timeout=timeout)) for board in MARKET_TYPES]
    sources.append(("ETF", lambda: fetch_etfs(timeout=timeout)))
    for label, fetch in sources:
        try:
            rows = fetch()
        except KrxUnavailable as exc:
            errors.append(f"{label}: {exc}")
            logger.warning("국내 %s 목록 조회 실패: %s", label, exc)
            continue
        for row in rows:
            if row["code"] in by_code and row.get("instrument") != "ETF":
                continue
            by_code[row["code"]] = row

    if not by_code:
        raise KrxUnavailable(" | ".join(errors) or "목록을 받지 못했습니다")
    return list(by_code.values())
