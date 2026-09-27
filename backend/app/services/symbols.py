"""종목명/코드 -> 티커 해석.

"삼성전자"나 "005930"처럼 사람이 아는 표현을 앱이 쓰는 티커(`005930.KS`)로 바꾼다.

원칙: **틀린 티커를 조용히 고르지 않는다.** 이름이 애매하면 후보를 여러 개 돌려주고
화면에서 사용자가 고르게 한다. 종목코드를 잘못 짚으면 엉뚱한 회사의 시세를 받아오는데,
그건 실패보다 나쁘다.

해석 순서 (앞에서 찾으면 뒤는 보지 않는다):
  1. 이미 티커 형태인가 — `VOO`, `005930.KS`, `^GSPC`
  2. 번들 시드 (`krx_seed.json` · `jp_seed.json` · `us_seed.json`) — 네트워크가 막혀도
     주요 종목은 찾을 수 있고, 미국 종목은 한글 이름으로도 찾을 수 있다
  3. DB에 캐시된 KRX 상장목록 · 미국 상장목록 (`us_listing.py`)
  4. KRX 상장목록 온라인 조회 (받아오면 DB에 캐시)
  5. 야후 검색 API — 해외 종목과 국내 ETF까지 폭넓게 커버
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.markets import (
    KRX_CODE_RE,
    Board,
    Market,
    build_krx_ticker,
    market_of,
    normalize_ticker,
    parse_krx_ticker,
    parse_tse_ticker,
)

logger = logging.getLogger(__name__)

SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "krx_seed.json"
JP_SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "jp_seed.json"
US_SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "us_seed.json"

# 내장 목록을 손으로 정리한 시점. 이후의 신규 상장·사명 변경은 들어 있지 않으므로
# 화면에 그대로 보여준다 — 목록이 언제 기준인지 모르면 "검색이 안 된다"의 원인을
# 사용자가 짐작할 수 없다.
SEED_AS_OF = "2026-09"

# 일본 내장 목록의 기준 시점. 한국거래소처럼 받아올 공식 목록이 없어서 **손으로 적은**
# 목록이고, 그래서 갱신되지 않는다. 여기 없는 종목은 티커(`7203.T`)로 등록하면 되고,
# 이름이 마음에 안 들면 종목 관리 화면에서 그 자리에서 고칠 수 있다.
JP_SEED_AS_OF = "2026-09"

# 미국 내장 목록의 기준 시점. 야후는 미국 종목 이름을 영문으로만 주므로 "애플"로는 아무것도
# 찾을 수 없다. 자주 보는 종목과 ETF에 **한글 별칭**을 붙여 손으로 적어둔 목록이고,
# 그래서 갱신되지 않는다. 여기 없는 종목은 티커(`AAPL`)나 영문 이름으로 등록하면 된다.
#
# 이름은 상장목록의 공식 표기를 따라 적었다. 미국 상장목록(`us_listing.py`)을 받아도 **이
# 목록이 이긴다** — 받아온 이름은 별칭으로만 붙는다 (`_us_entries`). 거기 없는 종목만
# 받아온 이름 그대로 검색된다.
US_SEED_AS_OF = "2026-09"

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

# 티커 모양으로 친 입력(VOO, SCHD). 이름·별칭에 **부분적으로** 걸리는 후보보다는 위,
# 이름 앞부분이 그대로 맞는 후보보다는 아래에 둔다.
#
# 전보다 높였다. 이 값이 부분 일치보다 낮았을 때 "SCHD"를 치면 별칭에 그 글자가 든
# 국내 ETF(`tiger schd`, `sol schd`)가 앞서면서, 그것도 둘이 동점이라 자동 해석이
# 실패했다 — 정확한 티커를 그대로 쳤는데 "종목을 찾지 못했습니다"가 나왔다.
# 이름 앞부분 일치(80)보다는 낮게 둬야 "TIGER"나 "KODEX"처럼 티커 모양이면서 실은
# 국내 ETF 브랜드인 말이 엉뚱한 해외 티커로 잡히지 않는다.
SCORE_TICKER_GUESS = 76.0


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


@lru_cache(maxsize=1)
def load_jp_seed() -> list[dict]:
    """번들된 일본 주요 종목 목록 (한글 이름).

    야후는 일본 종목 이름을 영문으로 준다. 한국거래소 목록 같은 공식 소스가 일본에는
    없으므로, 자주 보는 종목만 한글 이름으로 적어 함께 넣어둔다.
    """
    try:
        with JP_SEED_PATH.open(encoding="utf-8") as fp:
            return json.load(fp)
    except Exception:
        logger.exception("일본 시드 파일을 읽지 못했습니다: %s", JP_SEED_PATH)
        return []


@lru_cache(maxsize=1)
def load_us_seed() -> list[dict]:
    """번들된 미국 주요 종목·ETF 목록 (영문 이름 + 한글 별칭)."""
    try:
        with US_SEED_PATH.open(encoding="utf-8") as fp:
            return json.load(fp)
    except Exception:
        logger.exception("미국 시드 파일을 읽지 못했습니다: %s", US_SEED_PATH)
        return []


def jp_seed_name(code: str) -> str | None:
    """도쿄 종목코드에 붙은 한글 이름. 목록에 없으면 None."""
    for entry in load_jp_seed():
        if entry["code"] == code:
            return entry["name"]
    return None


def _entry_to_match(entry: dict, source: str, score: float) -> SymbolMatch:
    if entry.get("market") == Market.US.value:
        # 미국은 종목코드가 곧 티커다 (`AAPL`). 한국처럼 시장 접미사를 붙이지 않는다.
        return SymbolMatch(
            ticker=normalize_ticker(entry["code"]),
            name=entry["name"],
            market=Market.US,
            instrument=entry.get("instrument") or "STOCK",
            source=source,
            confident=True,
            score=score,
        )

    if entry.get("market") == Market.JP.value:
        return SymbolMatch(
            ticker=f"{entry['code']}.T",
            name=entry["name"],
            market=Market.JP,
            instrument=entry.get("instrument") or "STOCK",
            source=source,
            confident=True,
            score=score,
        )

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
    # 미국 코드는 티커라서 대소문자와 하이픈이 섞인다 (`BRK-B`). 양쪽 다 눌러서 비교한다 —
    # 한국 코드는 숫자뿐이라 눌러도 그대로다.
    code_tight, name_tight, aliases_tight = entry.get("_tight") or _tight_forms(entry)
    if code_tight == query_tight:
        return SCORE_CODE_EXACT

    if name_tight == query_tight:
        return SCORE_NAME_EXACT
    if name_tight.startswith(query_tight):
        return SCORE_NAME_PREFIX
    if query_tight in name_tight:
        return SCORE_NAME_CONTAINS

    best = 0.0
    for alias_tight in aliases_tight:
        if alias_tight == query_tight:
            best = max(best, SCORE_ALIAS_EXACT)
        elif alias_tight.startswith(query_tight):
            best = max(best, SCORE_ALIAS_PREFIX)
        elif query_tight in alias_tight:
            best = max(best, SCORE_ALIAS_CONTAINS)
    return best


def _tight_forms(entry: dict) -> tuple[str, str, tuple[str, ...]]:
    return (
        _tight(entry["code"]),
        _tight(entry["name"]),
        tuple(_tight(alias) for alias in entry.get("aliases", ())),
    )


# 검색은 글자를 칠 때마다 온다. 매번 두 목록(국내 수천·미국 1만 줄 가깝게)을 DB 에서 다시
# 읽고 이름마다 공백·기호를 다시 떼면 검색 한 번이 수십 ms 가 된다. **두 표의 행 수와 받은
# 시각이 그대로인 동안은** 만들어둔 목록을 쓴다 — 목록을 다시 받으면 받은 시각이 바뀌어
# 다음 검색이 새로 만든다 (프로세스가 여럿이어도 각자 알아챈다). 목록 안의 사전은
# 여럿이 같이 읽으므로 **고치지 않는다.**
_entries_lock = threading.Lock()
_entries_cache: tuple[tuple | None, list[dict]] = (None, [])


def reset_entries_cache() -> None:
    """테스트용 — DB 가 테스트마다 새로 생기므로 앞 테스트가 만들어둔 목록을 비운다."""
    global _entries_cache
    with _entries_lock:
        _entries_cache = (None, [])


def _listing_key(db: Session | None) -> tuple:
    if db is None:
        return ("no-db",)
    from app.models import KrxListing, UsListing

    key: list = []
    for model in (KrxListing, UsListing):
        try:
            key.extend(db.query(func.count(model.code), func.max(model.updated_at)).one())
        except Exception:
            # 표가 아직 없거나 읽기 실패 — 있는 것으로 계속 간다 (아래에서 다시 시도한다)
            db.rollback()
            key.extend((None, model.__tablename__))
    return tuple(key)


def _local_entries(db: Session | None) -> list[dict]:
    """시드 + 받아둔 상장목록을 합친 목록 (공백·기호를 뗀 형태까지 미리 만들어 둔다)."""
    global _entries_cache
    key = _listing_key(db)
    cached_key, cached = _entries_cache
    if key == cached_key:
        return cached
    entries = _build_entries(db)
    for entry in entries:
        entry["_tight"] = _tight_forms(entry)
    with _entries_lock:
        _entries_cache = (key, entries)
    return entries


def _build_entries(db: Session | None) -> list[dict]:
    """시드 + DB 캐시를 합친 목록. 같은 코드는 DB 캐시(한국거래소 공식)를 쓴다."""
    by_code: dict[str, dict] = {
        entry["code"]: {**entry, "source": "seed"} for entry in load_seed()
    }

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
                    "source": "krx",
                }
        except Exception:
            # 캐시 테이블이 아직 없거나 읽기 실패해도 시드만으로 계속 동작해야 한다
            logger.exception("KRX 캐시 조회 실패 — 시드만 사용합니다")

    # 같은 이름인데 코드가 다르면 한국거래소 목록만 남긴다.
    # 내장 목록은 손으로 적은 데이터라 종목코드가 낡거나 틀릴 수 있는데, 그대로 두면
    # 이름이 같은 후보가 둘 뜨고 사용자가 엉뚱한 쪽을 고를 수 있다.
    official_names = {_tight(e["name"]) for e in by_code.values() if e["source"] == "krx"}
    entries = [
        entry
        for entry in by_code.values()
        if entry["source"] == "krx" or _tight(entry["name"]) not in official_names
    ]

    # 일본은 받아올 공식 목록이 없어 합칠 것도 없다 — 시드를 그대로 붙인다.
    # (위 걸러내기는 한국 종목끼리의 문제이므로 여기 적용하지 않는다.)
    entries.extend(
        {**entry, "market": Market.JP.value, "source": "seed-jp"} for entry in load_jp_seed()
    )
    entries.extend(_us_entries(db))
    return entries


def _us_entries(db: Session | None) -> list[dict]:
    """내장 미국 목록 + 받아둔 미국 상장목록.

    **같은 티커면 내장 목록이 이긴다.** 손으로 적은 정식 이름과 한글 별칭("애플")이 거기
    있고, 받아온 쪽 이름(SEC 는 "NVIDIA CORP" 처럼 대문자로 준다)은 별칭으로만 붙인다 —
    그래도 그 이름으로 찾힌다. 내장 목록에 없는 종목은 받아온 이름 그대로 쓴다.
    """
    by_code: dict[str, dict] = {
        entry["code"]: {**entry, "market": Market.US.value, "source": "seed-us"}
        for entry in load_us_seed()
    }
    for code, name, instrument in _us_listing_rows(db):
        seeded = by_code.get(code)
        if seeded is None:
            by_code[code] = {
                "code": code,
                "name": name,
                "instrument": instrument,
                "aliases": [],
                "market": Market.US.value,
                "source": "us-listing",
            }
        elif _tight(seeded["name"]) != _tight(name):
            seeded["aliases"] = [*seeded.get("aliases", []), name]
    return list(by_code.values())


def _us_listing_rows(db: Session | None) -> list[tuple[str, str, str]]:
    if db is None:
        return []
    from app.models import UsListing

    try:
        return [
            (code, name, instrument or "STOCK")
            for code, name, instrument in db.query(UsListing.code, UsListing.name, UsListing.instrument)
        ]
    except Exception:
        # 표가 아직 없거나 읽기 실패해도 내장 목록만으로 계속 동작해야 한다
        logger.exception("미국 상장목록 캐시 조회 실패 — 내장 목록만 사용합니다")
        db.rollback()
        return []


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
    return [
        _entry_to_match(entry, entry.get("source", "seed"), score) for score, entry in scored[:limit]
    ]


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

    # 도쿄 종목(`7203.T`)은 숫자로 시작해서 아래 미국 티커 규칙에 걸리지 않는다.
    # 여기서 잡지 않으면 **티커를 정확히 넣어도** 야후 검색까지 내려가고,
    # 네트워크가 막힌 환경에서는 등록 자체가 실패한다.
    tse_code = parse_tse_ticker(ticker)
    if tse_code is not None:
        return SymbolMatch(
            ticker=f"{tse_code}.T",
            # 내장 목록에 있으면 한글 이름을 붙인다. 없으면 티커를 그대로 둔다 —
            # 야후가 주는 영문 이름은 검색으로 들어왔을 때만 채워진다.
            name=jp_seed_name(tse_code) or f"{tse_code}.T",
            market=Market.JP,
            source="ticker",
            score=SCORE_CODE_EXACT,
        )

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


# 이보다 짧은 검색어로는 바깥에 묻지 않는다 (한 글자를 칠 때마다 요청이 나가지 않게).
MIN_NETWORK_QUERY_LEN = 3

# 상장목록은 자주 바뀌지 않는다 (신규 상장·사명 변경 정도). 이보다 오래되면 다시 받는다.
LISTING_STALE_AFTER = dt.timedelta(days=7)


def krx_listing_updated_at(db: Session) -> dt.datetime | None:
    """상장목록 캐시를 마지막으로 받아온 시각. 캐시가 비어 있으면 None."""
    from app.models import KrxListing

    try:
        return db.query(func.max(KrxListing.updated_at)).scalar()
    except Exception:
        logger.exception("KRX 캐시 시각 조회 실패")
        return None


def listing_status(db: Session) -> dict:
    """지금 무엇으로 검색되고 있는지. 화면에서 그대로 보여준다."""
    from app.models import KrxListing

    try:
        cached = db.query(func.count(KrxListing.code)).scalar() or 0
    except Exception:
        logger.exception("KRX 캐시 개수 조회 실패")
        cached = 0

    updated_at = krx_listing_updated_at(db) if cached else None
    us_count, us_updated_at, us_source = _us_listing_summary(db)
    return {
        "cached_count": cached,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "seed_count": len(load_seed()),
        "seed_as_of": SEED_AS_OF,
        "us_count": us_count,
        "us_updated_at": us_updated_at.isoformat() if us_updated_at else None,
        # 나스닥 트레이더(ETF 포함) / SEC(회사만) — SEC 면 화면이 "ETF 는 빠져 있다"고 말한다
        "us_source": us_source,
        "us_seed_count": len(load_us_seed()),
    }


def _us_listing_summary(db: Session) -> tuple[int, dt.datetime | None, str | None]:
    from app.models import UsListing

    try:
        count, updated_at = db.query(func.count(UsListing.code), func.max(UsListing.updated_at)).one()
        source = db.query(UsListing.source).limit(1).scalar() if count else None
    except Exception:
        logger.exception("미국 상장목록 캐시 조회 실패")
        return 0, None, None
    return count or 0, updated_at, source


def refresh_us_listing_if_stale(db: Session, timeout: int = 30) -> int | None:
    """비어 있거나 일주일이 지났을 때만 받는다. 건너뛰었으면 None."""
    count, updated_at, _ = _us_listing_summary(db)
    if count and updated_at is not None and dt.datetime.utcnow() - updated_at < LISTING_STALE_AFTER:
        return None
    return refresh_us_listing(db, timeout=timeout)


def refresh_us_listing(db: Session, timeout: int = 30) -> int:
    """미국 상장목록을 받아 **통째로 갈아 끼운다.** 저장한 종목 수를 돌려준다.

    한국 목록처럼 덧붙이기만 하면 상장폐지된 종목(미국은 스팩·소형주가 잦다)이 검색에
    계속 남는다. 잘린 목록으로 덮어쓰는 일은 `us_listing.MIN_ROWS` 가 막는다 — 받는 쪽이
    실패하면 여기까지 오지 않고 기존 캐시가 그대로 남는다.
    """
    from app.models import UsListing
    from app.services import us_listing

    source, rows = us_listing.fetch_all(timeout=timeout)  # 실패하면 UsListingUnavailable
    now = dt.datetime.utcnow()
    try:
        db.query(UsListing).delete()
        db.add_all(
            UsListing(
                code=row["code"],
                name=row["name"],
                exchange=row.get("exchange"),
                instrument=row.get("instrument") or "STOCK",
                source=source,
                updated_at=now,
            )
            for row in rows
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return len(rows)


def refresh_krx_listing_if_stale(db: Session, timeout: int = 30) -> int | None:
    """비어 있거나 오래됐을 때만 받아온다. 건너뛰었으면 None.

    내장 목록은 주요 종목 위주라 중소형주는 이름으로 찾을 수 없다. 사용자가 버튼을
    누르기를 기다리는 대신, 앱이 알아서 한 번 채워둔다.
    """
    updated_at = krx_listing_updated_at(db)
    fresh = updated_at is not None and dt.datetime.utcnow() - updated_at < LISTING_STALE_AFTER
    if fresh and _has_kind(db, "ETF") and _has_kind(db, "STOCK"):
        return None
    # 주식이나 ETF 중 한쪽이 한 줄도 없으면 날짜와 상관없이 다시 받는다. 목록은 세 곳에서
    # 받고 한 곳만 성공해도 날짜가 새로 찍히므로, 날짜만 보면 빠진 쪽을 일주일 동안 안 채운다.
    # (ETF 목록을 받기 전인 0.20.1까지 채운 캐시도 여기서 걸린다.)
    return refresh_krx_listing(db, timeout=timeout)


def _has_kind(db: Session, instrument: str) -> bool:
    from app.models import KrxListing

    try:
        return db.query(KrxListing.code).filter(KrxListing.instrument == instrument).first() is not None
    except Exception:
        logger.exception("KRX 캐시 조회 실패")
        return True  # 모르면 평소 주기대로 둔다


def refresh_krx_listing(db: Session, timeout: int = 30) -> int:
    """KRX 상장목록을 받아 DB에 캐시한다. 저장한 종목 수를 돌려준다."""
    from app.models import KrxListing
    from app.services import krx

    listings = krx.fetch_all(timeout=timeout)  # 실패하면 KrxUnavailable
    now = dt.datetime.utcnow()
    existing = {row.code: row for row in db.query(KrxListing).all()}

    for item in listings:
        row = existing.get(item["code"])
        if row is None:
            row = KrxListing(code=item["code"])
            db.add(row)
        row.name = item["name"]
        row.board = item["board"]
        row.instrument = item.get("instrument", "STOCK")
        # 받을 때마다 찍는다. 새 행에만 찍히던 때는 "언제 받았나"가 **마지막 신규 상장일**이
        # 되어 화면의 "받음" 날짜가 틀렸고, 검색이 목록이 바뀐 것을 알아채지 못했다.
        row.updated_at = now
    db.commit()
    _adopt_official_names(db, {item["code"]: item["name"] for item in listings})
    return len(listings)


def _adopt_official_names(db: Session, official: dict[str, str]) -> None:
    """이미 담긴 국내 종목의 이름을 거래소 정식 이름으로 맞춘다.

    목록에 없던 종목(대부분 ETF)은 야후 검색으로 들어와 영문 이름("Samsung KODEX ...")이
    붙었거나, 코드로 들어와 이름 자리에 코드가 들어가 있다. 증권사 앱과 이름이 달라
    알아보기 어렵다. **사람이 직접 고친 이름은 건드리지 않는다** — 내 행의 이름이 공용
    행의 옛 이름과 같을 때(= 등록할 때 자동으로 붙은 이름 그대로일 때)만 바꾼다.
    """
    from app.models import Instrument, UserStock

    changed = 0
    for instrument in db.query(Instrument).filter(Instrument.market == Market.KR.value).all():
        parsed = parse_krx_ticker(instrument.ticker)
        name = official.get(parsed[0]) if parsed else None
        if not name or instrument.name == name:
            continue
        old = instrument.name
        for stock in db.query(UserStock).filter(UserStock.ticker == instrument.ticker).all():
            if stock.name is None or stock.name == old:
                stock.name = name
        instrument.name = name
        changed += 1
    if changed:
        db.commit()
        logger.info("국내 종목 %d개의 이름을 거래소 정식 이름으로 맞췄습니다", changed)


def _search_yahoo(query: str, limit: int, timeout: int = 5) -> list[SymbolMatch]:
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


def _is_bare_ticker_guess(match: SymbolMatch) -> bool:
    """"티커 모양이라 티커로 봤다"일 뿐, 실재하는지도 이름도 모르는 후보인가.

    `apple` 은 미국 티커 규칙(영문 10자 이하)에 걸려서 `APPLE` 이라는 후보가 된다. 이걸
    찾은 것으로 치면 두 가지가 한꺼번에 망가진다 — 화면에 없는 종목이 뜨고, 이름 검색을
    할 필요가 없다고 판단해 **네트워크까지 가지 않는다**. 실제로 `apple` 은 야후를 한 번도
    부르지 않았고 사용자는 시세가 붙지 않는 `APPLE` 을 등록할 수 있었다.

    이름을 아는 후보(시드·거래소 목록·야후)는 `name` 이 티커와 다르므로 여기 걸리지 않는다.
    """
    return match.source == "ticker" and match.name == match.ticker


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
    network_gate: Callable[[], bool] | None = None,
) -> list[SymbolMatch]:
    """검색어에 맞는 종목 후보를 점수 순으로 돌려준다.

    `network_gate` 는 바깥에 묻기 **직전에만** 불린다 — 로컬에서 찾히는 평소 검색은 한도를
    쓰지 않는다. False 면 지금 있는 것으로만 답한다 (`search_gate`).
    """
    normalized = normalize_query(query)
    if not normalized:
        return []

    matches: list[SymbolMatch] = []

    exact_ticker = _as_ticker(db, query)
    if exact_ticker is not None:
        matches.append(exact_ticker)

    matches.extend(_search_local(db, normalized, limit))

    # 이름을 아는 후보가 하나라도 있으면 이름 모르는 추측은 버린다. 남겨두면 `apple` 을
    # 쳤을 때 목록에 `AAPL` 과 `APPLE` 이 나란히 서고, 잘못 고르면 빈 종목이 등록된다.
    if any(not _is_bare_ticker_guess(match) for match in matches):
        matches = [match for match in matches if not _is_bare_ticker_guess(match)]

    # 로컬에서 못 찾았을 때만 네트워크를 쓴다 (평소 검색은 전부 오프라인으로 끝난다).
    # 이름 모르는 추측뿐인 것도 "못 찾았다"로 본다 — 그래야 `apple` 이 야후까지 간다.
    def unresolved() -> bool:
        return all(_is_bare_ticker_guess(match) for match in matches)

    # 너무 짧은 입력은 바깥에 묻지 않는다. 티커 모양이면 한 글자도 추측이 되므로,
    # 안 막으면 `AAPL` 을 치는 동안 `a` · `aa` · `aap` 까지 전부 야후로 나간다.
    # 한두 글자짜리 진짜 티커(`V`, `T`)는 내장 목록에 있어서 여기까지 오지 않는다.
    long_enough = len(normalized) >= MIN_NETWORK_QUERY_LEN

    if allow_network and long_enough and unresolved() and (network_gate is None or network_gate()):
        if db is not None and (KRX_CODE_RE.match(normalized) or _has_hangul(normalized)):
            # 목록을 여기서 기다리며 받지 않는다 — 뒤에서 받게만 하고 지금 있는 것으로 답한다.
            _refresh_listing_in_background()
        matches.extend(_search_yahoo(normalized, limit))

    # 아무 데서도 못 찾은 6자리 코드는 시장을 모르니 양쪽 다 후보로 제시한다
    if not matches and KRX_CODE_RE.match(normalized):
        matches.extend(_bare_code_candidates(normalized))

    return _dedupe(matches)[:limit]


# 검색에서 못 찾았을 때 목록을 다시 받는 것은 이 간격에 한 번만.
MISS_REFRESH_EVERY = dt.timedelta(hours=1)
_miss_refresh_lock = threading.Lock()
_miss_refresh_at: dt.datetime | None = None


def _refresh_listing_in_background() -> bool:
    """못 찾은 이름이 새로 상장한 종목일 수 있으니 목록을 다시 받는다 — **뒤에서.**

    예전에는 검색 요청 안에서 기다리며 받았다. 목록은 세 군데(코스피·코스닥·ETF)에서 차례로
    받고 각각 30초까지 기다리는데, 서버에서 한 곳이 응답을 안 하면 **종목 추가 한 번이 1분 넘게**
    걸렸다. 글자를 칠 때마다 검색하므로 못 찾는 글자마다 그랬다. 목록은 서버를 켤 때와
    매주 알아서 받으므로, 여기서는 한 시간에 한 번만 뒤에서 받게 한다.
    """
    global _miss_refresh_at
    now = dt.datetime.utcnow()
    with _miss_refresh_lock:
        if _miss_refresh_at is not None and now - _miss_refresh_at < MISS_REFRESH_EVERY:
            return False
        _miss_refresh_at = now

    def run() -> None:
        from app.db import SessionLocal

        db = SessionLocal()
        try:
            logger.info("검색에서 못 찾은 이름이 있어 상장목록 %d건을 다시 받았습니다", refresh_krx_listing(db))
        except Exception as exc:
            logger.info("상장목록을 다시 받지 못했습니다: %s", exc)
        finally:
            db.close()

    threading.Thread(target=run, name="listing-refresh", daemon=True).start()
    return True


def _has_hangul(text: str) -> bool:
    return any("가" <= ch <= "힣" or "ㄱ" <= ch <= "ㆎ" for ch in text)


def search_gate(user_id: int) -> Callable[[], bool]:
    """사람마다 분당 몇 번까지만 바깥(야후)에 묻는다 (ROADMAP 4-4b).

    오타 하나, 글자 하나가 외부 조회 하나다. 사람이 늘면 조용히 비싸지므로 사람에 건다 —
    검색어는 사람마다 다르니 종목처럼 자원에 걸 수가 없다. 막히면 로컬 결과만 돌려준다.
    (상장목록을 다시 받는 것은 이미 전역으로 한 시간에 한 번이다 — `MISS_REFRESH_EVERY`.)
    """
    from app.services import limits

    def gate() -> bool:
        if limits.yahoo_searches.allow(user_id):
            return True
        logger.info("사용자 %s: 바깥 검색이 분당 %d번을 넘어 로컬 결과만 돌려줍니다",
                    user_id, limits.YAHOO_SEARCHES_PER_MINUTE)
        return False

    return gate


def resolve(
    query: str,
    db: Session | None = None,
    allow_network: bool = True,
    network_gate: Callable[[], bool] | None = None,
) -> SymbolMatch | None:
    """가장 잘 맞는 후보 하나. 확정할 수 없으면 None.

    두 경우에 None을 돌려준다:
      - 시장이 확정되지 않은 추정만 있을 때 (`confident=False`)
      - 1등과 2등의 점수가 같을 때 — 어느 쪽이 맞는지 서버가 알 수 없다

    어느 쪽이든 화면에서 사용자가 직접 고르게 해야 엉뚱한 종목이 등록되지 않는다.
    """
    candidates = [
        m
        for m in search(query, db=db, allow_network=allow_network, limit=5, network_gate=network_gate)
        if m.confident
    ]
    if not candidates:
        return None
    if len(candidates) > 1 and candidates[1].score == candidates[0].score:
        logger.info("%r: 동점 후보가 여럿이라 자동 선택하지 않습니다 (%s)",
                    query, [m.ticker for m in candidates[:3]])
        return None
    return candidates[0]
