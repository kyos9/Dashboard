"""종목명/코드 -> 티커 해석.

"삼성전자"나 "005930"처럼 사람이 아는 표현을 앱이 쓰는 티커(`005930.KS`)로 바꾼다.

원칙: **틀린 티커를 조용히 고르지 않는다.** 이름이 애매하면 후보를 여러 개 돌려주고
화면에서 사용자가 고르게 한다. 종목코드를 잘못 짚으면 엉뚱한 회사의 시세를 받아오는데,
그건 실패보다 나쁘다.

해석 순서 (앞에서 찾으면 뒤는 보지 않는다):
  1. 이미 티커 형태인가 — `VOO`, `005930.KS`, `^GSPC`
  2. 번들 시드 (`app/data/krx_seed.json`) — 네트워크가 막혀도 주요 종목은 찾을 수 있다
  3. DB에 캐시된 KRX 상장목록
  4. KRX 상장목록 온라인 조회 (받아오면 DB에 캐시)
  5. 야후 검색 API — 해외 종목과 국내 ETF까지 폭넓게 커버
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from sqlalchemy.orm import Session

from app.markets import (
    KRX_CODE_RE,
    Board,
    Market,
    build_krx_ticker,
    market_of,
    normalize_ticker,
    parse_krx_ticker,
)

logger = logging.getLogger(__name__)

SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "krx_seed.json"

# 미국식 티커 모양 (VOO, BRK-B, ^GSPC). 한글이 섞이면 당연히 해당 없음.
US_TICKER_RE = re.compile(r"^\^?[A-Za-z][A-Za-z0-9.\-]{0,9}$")

# 점수: 높을수록 먼저 보여준다
SCORE_CODE_EXACT = 100.0
SCORE_NAME_EXACT = 98.0
SCORE_ALIAS_EXACT = 94.0
SCORE_NAME_PREFIX = 80.0
SCORE_ALIAS_PREFIX = 74.0
SCORE_NAME_CONTAINS = 60.0
SCORE_ALIAS_CONTAINS = 54.0
SCORE_TICKER_GUESS = 50.0


@dataclass(frozen=True)
class SymbolMatch:
    ticker: str
    name: str
    market: Market
    board: Board | None = None
    instrument: str = "STOCK"
    source: str = "seed"
    # False면 시장 구분이 확정되지 않은 추정 (예: 6자리 코드만 알고 코스피/코스닥 미확인).
    # 화면에서 "확인 필요"로 표시해 사용자가 고르게 한다.
    confident: bool = True
    score: float = 0.0

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "name": self.name,
            "market": self.market.value,
            "board": self.board.value if self.board else None,
            "instrument": self.instrument,
            "source": self.source,
            "confident": self.confident,
        }


def normalize_query(raw: str) -> str:
    """검색어를 비교용으로 정규화 (소문자, 공백 축약)."""
    return re.sub(r"\s+", " ", raw.strip()).lower()


def _tight(text: str) -> str:
    """공백·구두점을 모두 뺀 형태 — "삼성 전자"와 "삼성전자"를 같게 본다."""
    return re.sub(r"[\s.\-_&]+", "", text).lower()


@lru_cache(maxsize=1)
def load_seed() -> list[dict]:
    """번들된 주요 종목 목록. 파일이 깨져 있어도 앱이 죽지 않게 감싼다."""
    try:
        with SEED_PATH.open(encoding="utf-8") as fp:
            return json.load(fp)
    except Exception:
        logger.exception("KRX 시드 파일을 읽지 못했습니다: %s", SEED_PATH)
        return []


def _entry_to_match(entry: dict, source: str, score: float) -> SymbolMatch:
    board = Board(entry["board"])
    return SymbolMatch(
        ticker=build_krx_ticker(entry["code"], board),
        name=entry["name"],
        market=Market.KR,
        board=board,
        instrument=entry.get("instrument") or entry.get("type") or "STOCK",
        source=source,
        confident=True,
        score=score,
    )


def _score_entry(entry: dict, query: str, query_tight: str) -> float:
    """검색어가 이 종목과 얼마나 맞는지. 0이면 후보 아님."""
    if entry["code"] == query_tight:
        return SCORE_CODE_EXACT

    name_tight = _tight(entry["name"])
    if name_tight == query_tight:
        return SCORE_NAME_EXACT
    if name_tight.startswith(query_tight):
        return SCORE_NAME_PREFIX
    if query_tight in name_tight:
        return SCORE_NAME_CONTAINS

    best = 0.0
    for alias in entry.get("aliases", ()):
        alias_tight = _tight(alias)
        if alias_tight == query_tight:
            best = max(best, SCORE_ALIAS_EXACT)
        elif alias_tight.startswith(query_tight):
            best = max(best, SCORE_ALIAS_PREFIX)
        elif query_tight in alias_tight:
            best = max(best, SCORE_ALIAS_CONTAINS)
    return best


def _local_entries(db: Session | None) -> list[dict]:
    """시드 + DB 캐시를 합친 목록. 같은 코드는 DB 캐시(더 최신)를 쓴다."""
    by_code: dict[str, dict] = {entry["code"]: entry for entry in load_seed()}

    if db is not None:
        from app.models import KrxListing

        try:
            for row in db.query(KrxListing).all():
                seeded = by_code.get(row.code)
                # 시드의 별칭(영문명·약칭)은 살리고 이름/시장만 최신으로 덮는다
                aliases = list(seeded.get("aliases", [])) if seeded else []
                if seeded and seeded["name"] != row.name:
                    aliases.append(seeded["name"])
                by_code[row.code] = {
                    "code": row.code,
                    "name": row.name,
                    "board": row.board,
                    "instrument": row.instrument,
                    "aliases": aliases,
                }
        except Exception:
            # 캐시 테이블이 아직 없거나 읽기 실패해도 시드만으로 계속 동작해야 한다
            logger.exception("KRX 캐시 조회 실패 — 시드만 사용합니다")

    return list(by_code.values())


def _search_local(db: Session | None, query: str, limit: int) -> list[SymbolMatch]:
    query_tight = _tight(query)
    if not query_tight:
        return []

    scored: list[tuple[float, dict]] = []
    for entry in _local_entries(db):
        score = _score_entry(entry, query, query_tight)
        if score > 0:
            scored.append((score, entry))

    # 점수 같으면 이름이 짧은 쪽(= 더 정확히 맞는 쪽)을 먼저
    scored.sort(key=lambda pair: (-pair[0], len(pair[1]["name"])))
    source = "cache" if db is not None else "seed"
    return [_entry_to_match(entry, source, score) for score, entry in scored[:limit]]


def _as_ticker(db: Session | None, raw: str) -> SymbolMatch | None:
    """입력이 이미 티커면 그대로 해석한다."""
    ticker = normalize_ticker(raw)

    parsed = parse_krx_ticker(ticker)
    if parsed is not None:
        code, board = parsed
        # 이름을 알면 붙여준다 (화면에서 사용자가 확인할 수 있게)
        for entry in _local_entries(db):
            if entry["code"] == code:
                return _entry_to_match(entry, "ticker", SCORE_CODE_EXACT)
        return SymbolMatch(
            ticker=build_krx_ticker(code, board),
            name=code,
            market=Market.KR,
            board=board,
            source="ticker",
            score=SCORE_CODE_EXACT,
        )

    if KRX_CODE_RE.match(ticker):
        return None  # 6자리 코드만으로는 코스피/코스닥을 모른다 — 아래에서 후보로 처리

    if US_TICKER_RE.match(ticker):
        return SymbolMatch(
            ticker=ticker,
            name=ticker,
            market=market_of(ticker),
            source="ticker",
            score=SCORE_TICKER_GUESS,
        )
    return None


def _bare_code_candidates(code: str) -> list[SymbolMatch]:
    """어느 시장인지 모르는 6자리 코드 — 코스피/코스닥 둘 다 후보로 올린다."""
    return [
        SymbolMatch(
            ticker=build_krx_ticker(code, board),
            name=f"{code} ({board.value})",
            market=Market.KR,
            board=board,
            source="guess",
            confident=False,
            score=SCORE_TICKER_GUESS - index,
        )
        for index, board in enumerate((Board.KOSPI, Board.KOSDAQ))
    ]


def refresh_krx_listing(db: Session, timeout: int = 30) -> int:
    """KRX 상장목록을 받아 DB에 캐시한다. 저장한 종목 수를 돌려준다."""
    from app.models import KrxListing
    from app.services import krx

    listings = krx.fetch_all(timeout=timeout)  # 실패하면 KrxUnavailable
    existing = {row.code: row for row in db.query(KrxListing).all()}

    for item in listings:
        row = existing.get(item["code"])
        if row is None:
            row = KrxListing(code=item["code"])
            db.add(row)
        row.name = item["name"]
        row.board = item["board"]
        row.instrument = item.get("instrument", "STOCK")
    db.commit()
    return len(listings)


def _search_yahoo(query: str, limit: int, timeout: int = 10) -> list[SymbolMatch]:
    """야후 검색 — 해외 종목과 국내 ETF까지 덮는다. 막혀 있으면 빈 목록."""
    import requests

    try:
        response = requests.get(
            "https://query1.finance.yahoo.com/v1/finance/search",
            params={"q": query, "quotesCount": limit, "newsCount": 0},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=timeout,
        )
        if response.status_code != 200:
            return []
        quotes = response.json().get("quotes", [])
    except Exception as exc:
        logger.info("야후 검색 실패 (%s): %s", query, exc)
        return []

    out: list[SymbolMatch] = []
    for quote in quotes:
        symbol = (quote.get("symbol") or "").strip()
        if not symbol:
            continue
        name = quote.get("longname") or quote.get("shortname") or symbol
        parsed = parse_krx_ticker(symbol)
        out.append(
            SymbolMatch(
                ticker=normalize_ticker(symbol),
                name=name,
                market=market_of(symbol),
                board=parsed[1] if parsed else None,
                instrument=(quote.get("quoteType") or "STOCK").upper(),
                source="yahoo",
                score=SCORE_NAME_PREFIX,
            )
        )
    return out


def _dedupe(matches: list[SymbolMatch]) -> list[SymbolMatch]:
    """같은 티커는 점수가 높은 것만 남긴다 (순서는 유지)."""
    best: dict[str, SymbolMatch] = {}
    for match in matches:
        current = best.get(match.ticker)
        if current is None or match.score > current.score:
            best[match.ticker] = match
    return sorted(best.values(), key=lambda m: -m.score)


def search(
    query: str,
    db: Session | None = None,
    allow_network: bool = True,
    limit: int = 10,
) -> list[SymbolMatch]:
    """검색어에 맞는 종목 후보를 점수 순으로 돌려준다."""
    normalized = normalize_query(query)
    if not normalized:
        return []

    matches: list[SymbolMatch] = []

    exact_ticker = _as_ticker(db, query)
    if exact_ticker is not None:
        matches.append(exact_ticker)

    matches.extend(_search_local(db, normalized, limit))

    # 로컬에서 못 찾았을 때만 네트워크를 쓴다 (평소 검색은 전부 오프라인으로 끝난다)
    if allow_network and not matches:
        if db is not None and (KRX_CODE_RE.match(normalized) or _has_hangul(normalized)):
            try:
                count = refresh_krx_listing(db)
                logger.info("KRX 상장목록 %d건 갱신", count)
                matches.extend(_search_local(db, normalized, limit))
            except Exception as exc:
                logger.info("KRX 목록 갱신 실패: %s", exc)

        if not matches:
            matches.extend(_search_yahoo(normalized, limit))

    # 아무 데서도 못 찾은 6자리 코드는 시장을 모르니 양쪽 다 후보로 제시한다
    if not matches and KRX_CODE_RE.match(normalized):
        matches.extend(_bare_code_candidates(normalized))

    return _dedupe(matches)[:limit]


def _has_hangul(text: str) -> bool:
    return any("가" <= ch <= "힣" or "ㄱ" <= ch <= "ㆎ" for ch in text)


def resolve(query: str, db: Session | None = None, allow_network: bool = True) -> SymbolMatch | None:
    """가장 잘 맞는 후보 하나. 확정할 수 없으면 None.

    시장이 확정되지 않은 추정(`confident=False`)은 돌려주지 않는다 — 사용자가 화면에서
    직접 고르도록 해야 엉뚱한 종목이 등록되지 않는다.
    """
    candidates = [m for m in search(query, db=db, allow_network=allow_network, limit=5) if m.confident]
    return candidates[0] if candidates else None
