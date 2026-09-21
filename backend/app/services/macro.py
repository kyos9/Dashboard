"""매크로 지표 — 어떤 지표를 들고 있는지, 값을 어떻게 받아 쌓는지.

**이 값들은 시그널 조건에 섞이지 않는다.** 이게 이 기능에서 가장 중요한 결정이라
코드 맨 앞에 적어둔다. 이유 셋:

1. `SIGNAL_APP_SPEC.md` 의 백테스트가 검증한 것은 기술적 조건 네 개다. 매크로를 AND 로
   걸면 그 백테스트가 검증한 물건이 아니게 된다 — 연 5~9회라는 발동 횟수도 무의미해진다.
2. 적립식 원칙과 정면으로 충돌한다. "매크로가 나쁘니 이번 달은 쉰다"는 마켓타이밍인데,
   이 앱은 그걸 안 하기로 하고 폴백 매수를 만들었다.
3. 매크로가 나쁠 때가 보통 싸게 사는 때다. 조건으로 걸면 가장 좋은 기회를 스스로 막는다.

맥락으로만 쓴다 — 국면을 보여주고, 판단은 사람이 한다.
"""

from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    MacroFrequency,
    MacroSeries,
    MacroTransform,
    MacroUnit,
    MacroValue,
    PortfolioSettings,
)
from app.services.providers import AllMacroProvidersFailed, fetch_macro_points

logger = logging.getLogger(__name__)

# 처음 받아올 때 거슬러 올라가는 기간. 60년치를 받을 필요는 없지만, 2008년과 2020년이
# 차트에 들어와야 "지금이 어느 정도인지"가 보인다.
BACKFILL_YEARS = 20

# 이후 갱신에서 다시 받는 구간.
#
# 월간 지표는 **매번 전 구간을 다시 받는다.** 고작 수백 행이고, CPI·PCE 는 몇 년 전 값까지
# 소급 수정되기 때문이다. 며칠치만 받으면 그 수정이 영원히 반영되지 않는다.
# 일간 금리는 수정되지 않으므로 최근 며칠이면 된다.
DAILY_LOOKBACK_DAYS = 10

# 홈 화면에 아무것도 고르지 않았을 때 보여줄 것. 성격이 겹치지 않게 골랐다 —
# 공포 · 금리 · 물가.
DEFAULT_PINNED = ["VIX", "DGS10", "PCEPILFE"]


# ---------------------------------------------------------------------------
#  어떤 지표를 들고 있는가
# ---------------------------------------------------------------------------
#
#  이 목록은 **첫 실행 때 DB 로 한 번 옮겨지고**, 그 뒤로는 DB 가 진실이다. 지표를
#  늘리거나 순서를 바꾸는 일이 코드 수정 없이 되게 하려는 것이고, 프런트도 이 표를
#  읽어 화면을 만든다.

SEED_SERIES: list[dict] = [
    {
        "code": "VIX",
        "name": "VIX",
        "note": "변동성 지수 · 시장의 공포",
        # 야후가 FRED(VIXCLS)보다 하루 빠르다. FRED 는 같은 값을 들고 있어 폴백으로 맞다.
        "source": "yahoo",
        "source_code": "^VIX",
        "fallback_source": "fred",
        "fallback_code": "VIXCLS",
        "unit": MacroUnit.level.value,
        "transform": MacroTransform.none.value,
        "frequency": MacroFrequency.daily.value,
        "display_order": 10,
    },
    {
        "code": "DGS10",
        "name": "미 10년물 금리",
        "note": "장기 금리의 기준",
        "source": "fred",
        "source_code": "DGS10",
        "unit": MacroUnit.percent.value,
        "transform": MacroTransform.none.value,
        "frequency": MacroFrequency.daily.value,
        "display_order": 20,
    },
    {
        "code": "DGS2",
        "name": "미 2년물 금리",
        "note": "정책금리 기대를 비춘다",
        "source": "fred",
        "source_code": "DGS2",
        "unit": MacroUnit.percent.value,
        "transform": MacroTransform.none.value,
        "frequency": MacroFrequency.daily.value,
        "display_order": 30,
    },
    {
        # 물가 넷 중 이것을 맨 위에 둔다 — 뉴스에 나오는 건 CPI 지만
        # **연준이 실제로 목표 삼는 물가지표는 근원 PCE** 다.
        "code": "PCEPILFE",
        "name": "근원 PCE",
        "note": "연준이 보는 물가",
        "source": "fred",
        "source_code": "PCEPILFE",
        "unit": MacroUnit.index.value,
        "transform": MacroTransform.yoy.value,
        "frequency": MacroFrequency.monthly.value,
        "display_order": 40,
    },
    {
        "code": "PCEPI",
        "name": "PCE 물가",
        "note": None,
        "source": "fred",
        "source_code": "PCEPI",
        "unit": MacroUnit.index.value,
        "transform": MacroTransform.yoy.value,
        "frequency": MacroFrequency.monthly.value,
        "display_order": 50,
    },
    {
        "code": "CPILFESL",
        "name": "근원 CPI",
        "note": "에너지·식품을 뺀 물가",
        "source": "fred",
        "source_code": "CPILFESL",
        "unit": MacroUnit.index.value,
        "transform": MacroTransform.yoy.value,
        "frequency": MacroFrequency.monthly.value,
        "display_order": 60,
    },
    {
        "code": "CPIAUCSL",
        "name": "CPI",
        "note": "뉴스에 나오는 물가",
        "source": "fred",
        "source_code": "CPIAUCSL",
        "unit": MacroUnit.index.value,
        "transform": MacroTransform.yoy.value,
        "frequency": MacroFrequency.monthly.value,
        "display_order": 70,
    },
    {
        "code": "DFF",
        "name": "미 기준금리",
        "note": "연준 정책금리(실효)",
        "source": "fred",
        "source_code": "DFF",
        "unit": MacroUnit.percent.value,
        "transform": MacroTransform.none.value,
        "frequency": MacroFrequency.daily.value,
        "display_order": 80,
    },
]


def ensure_seed(db: Session) -> int:
    """기본 지표 목록을 DB 에 넣는다. **이미 있는 행은 건드리지 않는다.**

    덮어쓰면 사용자가 끈 지표(`active=False`)가 다음 실행 때 되살아나고, 바꿔둔 순서가
    원래대로 돌아간다. 설정을 지우는 코드가 매번 도는 셈이라 되돌릴 방법도 없다.
    """
    existing = set(db.scalars(select(MacroSeries.code)).all())
    added = 0
    for spec in SEED_SERIES:
        if spec["code"] in existing:
            continue
        db.add(MacroSeries(**spec))
        added += 1
    if added:
        db.commit()
        logger.info("매크로 지표 %d개를 새로 등록했습니다", added)
    return added


def active_series(db: Session) -> list[MacroSeries]:
    return list(
        db.scalars(
            select(MacroSeries)
            .where(MacroSeries.active.is_(True))
            .order_by(MacroSeries.display_order.asc(), MacroSeries.code.asc())
        ).all()
    )


# ---------------------------------------------------------------------------
#  값을 받아 쌓는다
# ---------------------------------------------------------------------------


def latest_as_of(db: Session, code: str) -> dt.date | None:
    return db.scalar(select(MacroValue.as_of).where(MacroValue.code == code).order_by(MacroValue.as_of.desc()).limit(1))


def fetch_start(db: Session, series: MacroSeries, today: dt.date | None = None) -> dt.date:
    """이번에 어디서부터 받을지.

    월간·분기 지표는 항상 전 구간을 다시 받는다 (위 `DAILY_LOOKBACK_DAYS` 주석 참고 —
    몇 년 전 값까지 소급 수정되므로 최근 며칠만 받으면 수정이 영원히 안 들어온다).
    """
    today = today or dt.date.today()
    full = today - dt.timedelta(days=365 * BACKFILL_YEARS)

    if series.frequency != MacroFrequency.daily.value:
        return full

    last = latest_as_of(db, series.code)
    if last is None:
        return full
    return max(full, last - dt.timedelta(days=DAILY_LOOKBACK_DAYS))


def upsert_values(db: Session, code: str, points, source: str | None = None) -> dict:
    """받아온 점들을 저장한다. 같은 `as_of` 가 이미 있으면 값이 달라졌을 때만 덮어쓴다.

    덮어쓴 횟수(`revised`)를 따로 세는 이유: 그게 바로 "발표 뒤 수정"이다. 조용히
    지나가면 나중에 과거 값이 왜 달라졌는지 알 수 없다.
    """
    existing = {
        row.as_of: row
        for row in db.scalars(select(MacroValue).where(MacroValue.code == code)).all()
    }

    now = dt.datetime.utcnow()
    inserted = revised = 0

    for point in points:
        row = existing.get(point.as_of)
        if row is None:
            db.add(
                MacroValue(
                    code=code,
                    as_of=point.as_of,
                    value=point.value,
                    released_at=point.released_at,
                    fetched_at=now,
                    source=source,
                )
            )
            inserted += 1
            continue

        changed = False
        if row.value != point.value:
            row.value = point.value
            revised += 1
            changed = True
        # 발표일은 나중에 키가 생겨야 채워지는 경우가 많다. 이미 있는 값을 None 으로
        # 지우지는 않는다 — 발표일을 안 주는 제공자로 폴백한 날 기록이 사라지면 안 된다.
        if point.released_at is not None and row.released_at != point.released_at:
            row.released_at = point.released_at
            changed = True
        if changed:
            row.fetched_at = now
            row.source = source

    db.commit()
    return {"inserted": inserted, "revised": revised}


def refresh_series(db: Session, series: MacroSeries, today: dt.date | None = None) -> dict:
    """지표 하나를 갱신한다. 실패해도 **이전 값은 그대로 남는다.**"""
    start = fetch_start(db, series, today=today)
    # 발표일은 월간·분기 지표에만 의미가 있다. 일간 금리는 매일 나오고 수정되지 않는다.
    want_release_dates = series.frequency != MacroFrequency.daily.value

    try:
        points, provider = fetch_macro_points(
            series.code,
            source=series.source,
            fallback_source=series.fallback_source,
            fallback_code=series.fallback_code,
            start=start,
            want_release_dates=want_release_dates,
        )
    except AllMacroProvidersFailed as exc:
        logger.warning("%s 갱신 실패: %s", series.code, exc)
        return {"code": series.code, "ok": False, "error": str(exc), "hint": exc.hint()}

    result = upsert_values(db, series.code, points, source=provider)
    return {
        "code": series.code,
        "ok": True,
        "provider": provider,
        "as_of": points[-1].as_of.isoformat(),
        **result,
    }


def refresh_all(db: Session, codes: list[str] | None = None, today: dt.date | None = None) -> list[dict]:
    """활성 지표를 갱신한다. **한 지표가 실패해도 나머지는 계속한다.**

    (어떤 지표를 "받을 때가 됐다"고 볼지 — 주기별 스케줄 — 는 3a-2 에서 이 위에 얹는다.
    지금은 부르면 전부 받는다.)
    """
    wanted = set(codes) if codes else None
    results = []
    for series in active_series(db):
        if wanted is not None and series.code not in wanted:
            continue
        try:
            results.append(refresh_series(db, series, today=today))
        except Exception as exc:  # 한 지표의 버그가 배치 전체를 멈추면 안 된다
            logger.exception("%s 갱신 중 예상치 못한 오류", series.code)
            db.rollback()
            results.append({"code": series.code, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
    return results


# ---------------------------------------------------------------------------
#  저장된 원본에서 화면에 쓸 값을 만든다
# ---------------------------------------------------------------------------
#
#  **원본 지수를 저장하고 전년비는 여기서 계산한다.** FRED API 에 변환 옵션이 있지만
#  쓰지 않는다 — 원본을 쥐고 있으면 나중에 다른 계산(3개월 연율 같은 것)이 필요할 때
#  데이터를 다시 안 받아도 되고, 제공자가 바뀌어도 저장된 값의 의미가 안 변한다.


def values(db: Session, code: str, start: dt.date | None = None) -> list[MacroValue]:
    stmt = select(MacroValue).where(MacroValue.code == code)
    if start is not None:
        stmt = stmt.where(MacroValue.as_of >= start)
    return list(db.scalars(stmt.order_by(MacroValue.as_of.asc())).all())


def year_over_year(points: list[tuple[dt.date, float]]) -> list[tuple[dt.date, float]]:
    """지수 레벨을 전년 대비 %로. 12개월 전 값이 없는 구간은 그냥 빠진다.

    "12개월 전"을 **달력으로** 찾는다 (12칸 앞이 아니라). 월간 시계열에 한 달이 빠져
    있으면 칸 수로 세는 순간 13개월 전과 비교하게 되고, 그 오차는 화면에서 안 보인다.
    """
    by_month = {(as_of.year, as_of.month): value for as_of, value in points}
    out: list[tuple[dt.date, float]] = []
    for as_of, value in points:
        base = by_month.get((as_of.year - 1, as_of.month))
        if base:
            out.append((as_of, (value / base - 1.0) * 100.0))
    return out


def month_over_month(points: list[tuple[dt.date, float]]) -> list[tuple[dt.date, float]]:
    """지수 레벨을 전월 대비 %로."""
    by_month = {(as_of.year, as_of.month): value for as_of, value in points}
    out: list[tuple[dt.date, float]] = []
    for as_of, value in points:
        year, month = (as_of.year, as_of.month - 1) if as_of.month > 1 else (as_of.year - 1, 12)
        base = by_month.get((year, month))
        if base:
            out.append((as_of, (value / base - 1.0) * 100.0))
    return out


def apply_transform(transform: str, points: list[tuple[dt.date, float]]) -> list[tuple[dt.date, float]]:
    if transform == MacroTransform.yoy.value:
        return year_over_year(points)
    if transform == MacroTransform.mom.value:
        return month_over_month(points)
    return list(points)


def term_spread(db: Session, long_code: str = "DGS10", short_code: str = "DGS2") -> float | None:
    """장단기 금리차. **따로 받지 않고 두 값에서 계산한다.**

    FRED 에 `T10Y2Y` 라는 시리즈가 따로 있지만 쓰지 않는다. 세 값을 각각 받으면 셋이
    서로 안 맞는 날이 생기고 (한쪽만 갱신됐을 때), 화면에서는 10년물 − 2년물 ≠ 금리차로
    보인다. 계산해서 쓰면 그런 날이 없다.

    **같은 날짜의 값끼리만 뺀다.** 어제 10년물과 그제 2년물을 빼면 그건 금리차가 아니다.
    """
    long_row = db.scalars(
        select(MacroValue).where(MacroValue.code == long_code).order_by(MacroValue.as_of.desc()).limit(1)
    ).first()
    if long_row is None:
        return None
    short_row = db.scalars(
        select(MacroValue).where(
            MacroValue.code == short_code, MacroValue.as_of == long_row.as_of
        )
    ).first()
    if short_row is None:
        return None
    return long_row.value - short_row.value


# ---------------------------------------------------------------------------
#  홈 화면 즐겨찾기
# ---------------------------------------------------------------------------


def pinned_codes(settings: PortfolioSettings | None) -> list[str]:
    """홈 화면에 띄울 지표 코드.

    **`None` 과 `[]` 는 다른 뜻이다.** `None` 은 "아직 안 골랐다"라서 기본값을 보여주고,
    `[]` 는 "일부러 다 껐다"라서 아무것도 안 보여준다. 둘을 합치면 "홈에서 매크로를
    빼겠다"는 선택이 불가능해진다 — 껐는데 기본값이 다시 뜨는 화면은 설정이 아니라
    고장으로 보인다.
    """
    if settings is None or settings.pinned_macro is None:
        return list(DEFAULT_PINNED)
    return [str(code) for code in settings.pinned_macro]
