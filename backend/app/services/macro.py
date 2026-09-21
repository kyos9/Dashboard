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

# --- 얼마나 자주 받아볼 것인가 ---------------------------------------------
#
# **24 가 아니라 20 이다.** 하루 한 번 도는 cron 은 매번 정확히 24시간 뒤에 돌지
# 않는다 — 몇 초에서 몇 분씩 밀린다. 기준이 24시간이면 그 밀림 때문에 "아직 24시간이
# 안 됐다"로 걸러져 **하루 걸러 한 번씩만** 받게 되고, 그 증상은 지표가 가끔 하루
# 늦는 모습이라 원인을 짚기 어렵다. 넉넉히 20으로 두면 매일 돌고, 앱을 하루에 열 번
# 다시 띄워도 20년치를 다시 받지는 않는다.
CHECK_INTERVAL_HOURS = 20

# 실패한 지표를 다시 해볼 때까지. 하루를 기다리지 않는 이유는 **고친 직후를 위해서다** —
# `.env` 에 키를 넣고 앱을 다시 띄웠는데 내일까지 기다려야 한다면 고친 게 맞는지 알 수 없다.
RETRY_AFTER_HOURS = 2

# 값이 언제부터 "오래됐다"인가.
#
# **발표일을 알면 그걸로 잰다.** 한 번 발표됐으면 다음 것은 대략 한 주기 뒤에 나오므로,
# "마지막 발표 이후 한 주기하고도 한참이 지났는가"가 곧 고장 여부다.
STALE_AFTER_RELEASE_DAYS = {
    MacroFrequency.daily.value: 7,
    MacroFrequency.weekly.value: 21,
    MacroFrequency.monthly.value: 45,
    MacroFrequency.quarterly.value: 135,
}

# 발표일을 모를 때(키가 없어 CSV 로 받은 경우) 쓰는, `as_of` 기준의 자.
#
# **월간을 한 숫자로 재면 반드시 하나는 틀린다.** 지표마다 발표가 얼마나 늦는지가
# 다르기 때문이다 — 8월 CPI 는 9월 중순에 나오지만 8월 PCE 는 9월 말에 나온다.
# 실제로 75일로 뒀다가 9월 21일에 "7월 PCE 가 최신"인 정상 상태를 오래됐다고 표시했다.
# 그때 최신이 7월분인 것은 **8월분이 아직 안 나왔기 때문**이었다.
#
# 그래서 가장 늦은 쪽(PCE)에 맞춰 넉넉히 잡는다. 여기 걸리는 건 진짜 고장일 때뿐이어야
# 하고, 멀쩡한데 빨간 표시가 뜨면 사람은 곧 그 표시를 안 믿게 된다. 진짜 고장은 어차피
# `last_error` 가 따로 말해준다 — 이쪽은 보조 수단이지 유일한 경보가 아니다.
STALE_AFTER_DAYS = {
    MacroFrequency.daily.value: 7,
    MacroFrequency.weekly.value: 21,
    MacroFrequency.monthly.value: 100,
    MacroFrequency.quarterly.value: 250,
}


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


def is_due(
    series: MacroSeries, now: dt.datetime | None = None, after_restart: bool = False
) -> bool:
    """이 지표를 지금 받아볼 때가 됐는가.

    한 번도 안 받아봤으면 당연히 받는다. 그 뒤로는 하루 한 번이되, **마지막이 실패였다면
    더 일찍 다시 해본다** (위 `RETRY_AFTER_HOURS`).

    `after_restart` 는 **앱을 다시 띄웠다는 뜻이고, 그건 "뭔가 고쳤다"는 신호다.** 그때는
    실패했던 지표를 시간과 무관하게 바로 다시 해본다.

    이게 없어서 한 번 헛돌았다. FRED 키를 `.env` 에 넣고 다시 띄웠는데 **아무 일도 안
    일어났다** — 직전 실패가 2시간 안쪽이라 전부 "대기"로 걸러졌기 때문이다. 고친 사람
    입장에서는 고친 게 맞는지조차 알 수 없고, 화면은 두 시간 동안 빈 채로 있는다.
    간격을 더 줄이는 것은 답이 아니다. 막혀 있는 서버를 2분마다 두드리는 게 되니까.
    고쳤다는 신호가 올 때 다시 해보는 것이 맞다.

    성공했던 지표는 재시작해도 안 받는다 — 그래야 앱을 열 번 띄워도 20년치를 열 번
    다시 받지 않는다.

    판정에 `last_checked_at`(시도한 시각)을 쓰지 `MacroValue.fetched_at`(값이 바뀐 시각)을
    쓰지 않는다. 후자는 새 값이 없던 날 안 움직이므로, 그걸 기준으로 삼으면 발표가 없는
    동안 매번 "아직 못 받았다"로 읽혀 20년치를 날마다 다시 받게 된다.
    """
    now = now or dt.datetime.utcnow()
    if series.last_checked_at is None:
        return True
    if after_restart and series.last_error:
        return True
    hours = (now - series.last_checked_at).total_seconds() / 3600
    return hours >= (RETRY_AFTER_HOURS if series.last_error else CHECK_INTERVAL_HOURS)


def latest_point(db: Session, code: str) -> MacroValue | None:
    return db.scalar(
        select(MacroValue).where(MacroValue.code == code).order_by(MacroValue.as_of.desc()).limit(1)
    )


def is_stale(db: Session, series: MacroSeries, today: dt.date | None = None) -> bool:
    """들고 있는 값이 지나치게 오래됐는가. (화면·진단에서 쓴다.)

    **발표일을 알면 그걸로 잰다.** `as_of` 로만 재면 발표가 늦는 지표가 멀쩡한데도
    걸린다 — 9월 21일에 최신 PCE 가 7월분인 것은 8월분이 아직 안 나왔기 때문이지
    고장이 아니다. 반면 "마지막으로 뭔가 발표된 지 한참"이라면 그건 진짜 이상하다.

    `released_at` 은 키가 있을 때만 채워지므로, 없으면 `as_of` 기준 자로 물러선다.
    """
    row = latest_point(db, series.code)
    if row is None:
        return True

    today = today or dt.date.today()
    if row.released_at is not None:
        limit = STALE_AFTER_RELEASE_DAYS.get(
            series.frequency, STALE_AFTER_RELEASE_DAYS[MacroFrequency.daily.value]
        )
        return today - row.released_at > dt.timedelta(days=limit)

    limit = STALE_AFTER_DAYS.get(series.frequency, STALE_AFTER_DAYS[MacroFrequency.daily.value])
    return today - row.as_of > dt.timedelta(days=limit)


def mark_checked(db: Session, series: MacroSeries, error: str | None = None) -> None:
    """시도한 결과를 지표 행에 남긴다. **성공하면 지난 실패 사유를 지운다.**

    안 지우면 이미 해결된 문제를 화면이 계속 띄우고, 그 표시는 곧 아무도 안 믿게 된다.
    """
    now = dt.datetime.utcnow()
    series.last_checked_at = now
    if error is None:
        series.last_ok_at = now
        series.last_error = None
    else:
        # 통째로 넣으면 화면이 읽기 어려워진다. 원인은 앞쪽에 나온다.
        series.last_error = error[:500]
    db.commit()


def refresh_series(db: Session, series: MacroSeries, today: dt.date | None = None) -> dict:
    """지표 하나를 갱신한다. 실패해도 **이전 값은 그대로 남는다.**"""
    start = fetch_start(db, series, today=today)
    # 발표일은 월간·분기 지표에만 의미가 있다. 일간 금리는 매일 나오고 수정되지 않는다.
    want_release_dates = series.frequency != MacroFrequency.daily.value

    try:
        points, provider = fetch_macro_points(
            series.code,
            source=series.source,
            # 우리가 부르는 이름(`code`)이 아니라 **그쪽에서 부르는 이름**으로 묻는다.
            # VIX 는 우리에게 `VIX`, 야후에서 `^VIX` 다.
            source_code=series.source_code,
            fallback_source=series.fallback_source,
            fallback_code=series.fallback_code,
            start=start,
            want_release_dates=want_release_dates,
        )
    except AllMacroProvidersFailed as exc:
        logger.warning("%s 갱신 실패: %s", series.code, exc)
        mark_checked(db, series, error=str(exc))
        return {"code": series.code, "ok": False, "error": str(exc), "hint": exc.hint()}

    result = upsert_values(db, series.code, points, source=provider)
    mark_checked(db, series)
    return {
        "code": series.code,
        "ok": True,
        "provider": provider,
        "as_of": points[-1].as_of.isoformat(),
        **result,
    }


def refresh_all(
    db: Session,
    codes: list[str] | None = None,
    today: dt.date | None = None,
    only_due: bool = False,
    now: dt.datetime | None = None,
    after_restart: bool = False,
) -> list[dict]:
    """활성 지표를 갱신한다. **한 지표가 실패해도 나머지는 계속한다.**

    `only_due` 가 참이면 받을 때가 된 것만 받는다 (`is_due`). 배치가 쓰는 길이다.
    사람이 "지금 받아와" 를 누르는 길은 거짓으로 둔다 — 눌렀는데 아무 일도 안 일어나면
    그건 고장으로 보인다.
    """
    wanted = set(codes) if codes else None
    results = []
    for series in active_series(db):
        if wanted is not None and series.code not in wanted:
            continue
        if only_due and not is_due(series, now=now, after_restart=after_restart):
            results.append({"code": series.code, "ok": True, "skipped": "아직 받을 때가 아님"})
            continue
        try:
            results.append(refresh_series(db, series, today=today))
        except Exception as exc:  # 한 지표의 버그가 배치 전체를 멈추면 안 된다
            logger.exception("%s 갱신 중 예상치 못한 오류", series.code)
            # 먼저 되돌린다 — 실패한 트랜잭션 위에서는 상태 기록도 같이 실패한다.
            db.rollback()
            detail = f"{type(exc).__name__}: {exc}"
            try:
                mark_checked(db, series, error=detail)
            except Exception:
                logger.exception("%s 실패 기록마저 실패", series.code)
                db.rollback()
            results.append({"code": series.code, "ok": False, "error": detail})
    return results


def refresh_due(
    db: Session, now: dt.datetime | None = None, after_restart: bool = False
) -> list[dict]:
    """배치가 부르는 자리 — 받을 때가 된 지표만 받는다.

    `after_restart` 는 켠 직후 한 번 도는 쪽에서 준다 (`is_due` 의 설명 참고).
    """
    return refresh_all(db, only_due=True, now=now, after_restart=after_restart)


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
