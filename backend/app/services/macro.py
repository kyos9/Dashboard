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
from app.services import regime
from app.services import settings as settings_service
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
        # VIX 바로 다음에 둔다. 둘 다 "무서워하고 있나"를 보는 것이지만 **같은 것을
        # 재지 않는다** — VIX 는 옵션 가격에서 나오는 숫자 하나이고, 이쪽은 일곱 가지
        # (주가 모멘텀·신고가/신저가·시장 폭·풋콜 비율·정크본드 수요·변동성·안전자산
        # 수요)를 합쳐 0~100 으로 만든 것이다. 둘이 어긋날 때가 오히려 볼 만하다.
        "code": "FEARGREED",
        "name": "공포·탐욕 지수",
        "note": "0 공포 ~ 100 탐욕",
        "source": "cnn",
        "source_code": "fearandgreed",
        # 폴백이 없다. 이 지수를 내는 곳이 여기뿐이다 — 이름이 같은 다른 지수
        # (alternative.me)는 암호화폐 시장 것이라 꽂으면 값이 조용히 다른 시장의
        # 것으로 바뀐다. `providers/cnn.py` 의 설명 참고.
        "fallback_source": None,
        "fallback_code": None,
        "unit": MacroUnit.level.value,
        "transform": MacroTransform.none.value,
        "frequency": MacroFrequency.daily.value,
        "display_order": 15,
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


def is_stale(
    db: Session,
    series: MacroSeries,
    today: dt.date | None = None,
    row: MacroValue | None = None,
) -> bool:
    """들고 있는 값이 지나치게 오래됐는가. (화면·진단에서 쓴다.)

    **발표일을 알면 그걸로 잰다.** `as_of` 로만 재면 발표가 늦는 지표가 멀쩡한데도
    걸린다 — 9월 21일에 최신 PCE 가 7월분인 것은 8월분이 아직 안 나왔기 때문이지
    고장이 아니다. 반면 "마지막으로 뭔가 발표된 지 한참"이라면 그건 진짜 이상하다.

    `released_at` 은 키가 있을 때만 채워지므로, 없으면 `as_of` 기준 자로 물러선다.

    `row` 는 호출부가 이미 최신 행을 읽어둔 경우에 넘긴다 — 카드를 아홉 장 그리면서
    같은 질의를 아홉 번 더 할 이유가 없다.
    """
    row = row or latest_point(db, series.code)
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
    """**켠 직후** 도는 자리 — 방금 받은 지표는 건너뛴다.

    정기 갱신(하루 한 번)은 이쪽이 아니라 `refresh_all` 을 부른다. 하루에 한 번이라는
    것이 이미 주기인데 여기서 또 거르면, 그 사이에 다른 이유로 한 번 받았을 때 정기
    갱신이 통째로 건너뛰어진다 (`scheduler._macro_refresh_job` 에 실제 사례를 적어뒀다).

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
    point = term_spread_point(db, long_code=long_code, short_code=short_code)
    return point[1] if point else None


def term_spread_point(
    db: Session, long_code: str = "DGS10", short_code: str = "DGS2"
) -> tuple[dt.date, float] | None:
    """금리차와 **그 값이 어느 날 것인지**. 화면은 날짜까지 보여줘야 한다 —
    두 금리가 어제 것인데 금리차만 오늘 것처럼 보이면 그게 더 헷갈린다."""
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
    return long_row.as_of, long_row.value - short_row.value


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


# ---------------------------------------------------------------------------
#  화면이 읽는 모양
# ---------------------------------------------------------------------------
#
#  저장된 것은 원본 지수(CPI 320.541)이고 화면에 뜨는 것은 전년비(2.9%)다. 그 사이의
#  계산을 여기서 한 번만 하고, 라우터와 진단이 같은 함수를 쓴다 — 두 군데서 따로
#  계산하면 언젠가 화면과 진단이 다른 숫자를 말하게 된다.

# 변환에 필요한 **과거 여유분**.
#
# 이게 없으면 조용히 틀린다. "1년치를 보여달라"를 그대로 1년치만 읽어 전년비로 바꾸면,
# 모든 점이 자기 12개월 전 값을 못 찾아 **차트가 통째로 빈다.** 변환을 먼저 하고
# 자르는 순서로 가되, 읽을 때 12개월치를 더 읽어둔다.
TRANSFORM_LOOKBACK_DAYS = {
    MacroTransform.yoy.value: 400,  # 12개월 + 여유 (월 초/말이 어긋나도 그 달이 들어오게)
    MacroTransform.mom.value: 40,
}

# 변환된 값 옆에 붙는 말. 화면에서 "2.9%" 만 보면 그게 물가인지 전년비인지 알 수 없다.
TRANSFORM_LABEL = {
    MacroTransform.yoy.value: "전년비",
    MacroTransform.mom.value: "전월비",
}


def display_unit(series: MacroSeries) -> str:
    """변환을 거친 **뒤**의 단위.

    지수를 전년비로 바꾸면 더 이상 지수가 아니라 %다. 저장된 단위를 그대로 화면에
    쓰면 CPI 가 "320.5 지수"가 아니라 "2.9 지수"로 뜬다.
    """
    if series.transform in TRANSFORM_LABEL:
        return MacroUnit.percent.value
    return series.unit


def display_points(
    db: Session, series: MacroSeries, start: dt.date | None = None
) -> list[tuple[dt.date, float]]:
    """화면에 그대로 그릴 수 있는 점들. 변환까지 끝난 값이다."""
    read_from = start
    if start is not None:
        pad = TRANSFORM_LOOKBACK_DAYS.get(series.transform)
        if pad:
            read_from = start - dt.timedelta(days=pad)

    rows = values(db, series.code, start=read_from)
    points = apply_transform(series.transform, [(row.as_of, row.value) for row in rows])

    if start is not None:
        # 여유분은 계산에만 쓰고 돌려주지 않는다 — 고른 기간 밖의 점이 차트에 끼면
        # "1년을 눌렀는데 2년이 보인다"가 된다.
        points = [point for point in points if point[0] >= start]
    return points


# 1년이 몇 점인가. 카드에 필요한 만큼만 읽으려고 쓴다.
PERIODS_PER_YEAR = {
    MacroFrequency.daily.value: 260,  # 거래일 기준
    MacroFrequency.weekly.value: 53,
    MacroFrequency.monthly.value: 12,
    MacroFrequency.quarterly.value: 4,
}


def snapshot_limit(series: MacroSeries) -> int:
    """카드 한 장을 그리려고 **뒤에서 몇 줄**만 읽을 것인가.

    필요한 건 최신값과 직전값 두 점뿐인데, 전 구간을 읽으면 지표 아홉 개짜리 목록을
    한 번 그릴 때마다 20년치(수만 행)가 올라온다. 화면을 열 때마다 그러므로 그냥
    느린 게 아니라 **열수록 느려지는** 쪽이다.

    전년비는 사정이 다르다 — 지금 값 하나를 만드는 데 12개월 전 값이 필요하므로
    1년치를 읽어야 한다. 여유 4점은 중간에 한 달이 비어도 최신 점이 사라지지 않게.
    """
    per_year = PERIODS_PER_YEAR.get(series.frequency, PERIODS_PER_YEAR[MacroFrequency.daily.value])
    if series.transform == MacroTransform.yoy.value:
        return per_year + 4
    if series.transform == MacroTransform.mom.value:
        return max(per_year // 12, 1) + 4
    return 2


def recent_values(db: Session, code: str, limit: int) -> list[MacroValue]:
    """뒤에서 `limit` 줄. 돌려줄 때는 다시 오름차순이다 (계산이 그 순서를 기대한다)."""
    rows = db.scalars(
        select(MacroValue)
        .where(MacroValue.code == code)
        .order_by(MacroValue.as_of.desc())
        .limit(limit)
    ).all()
    return list(reversed(rows))


def snapshot(db: Session, series: MacroSeries, today: dt.date | None = None) -> dict:
    """지표 하나를 카드 한 장에 필요한 만큼으로.

    `change` 는 **직전 값과의 차이**이지 변화율이 아니다. 여기 오는 값들은 이미 % 인
    경우가 많아서(금리 4.2%, 전년비 2.9%) 다시 %로 나누면 "%의 %"가 되어 아무도 못
    읽는다. 금리가 4.1 에서 4.2 로 갔으면 +0.1(%p)이라고 말하는 게 맞다.
    """
    rows = recent_values(db, series.code, snapshot_limit(series))
    points = apply_transform(series.transform, [(row.as_of, row.value) for row in rows])
    latest = points[-1] if points else None
    previous = points[-2] if len(points) > 1 else None
    raw = rows[-1] if rows else None

    return {
        "code": series.code,
        "name": series.name,
        "note": series.note,
        "unit": display_unit(series),
        "transform": series.transform,
        "transform_label": TRANSFORM_LABEL.get(series.transform),
        "frequency": series.frequency,
        "as_of": latest[0] if latest else None,
        "value": latest[1] if latest else None,
        "previous": previous[1] if previous else None,
        "change": (latest[1] - previous[1]) if latest and previous else None,
        # 구간 이름이 있는 지표(공포·탐욕)만 채워진다. 어느 구간인지는 화면이 정하는
        # 것이 아니라 발표하는 쪽이 정해둔 것이라 서버에서 붙인다 — 화면 둘(매크로 탭과
        # 홈)이 각자 경계를 들고 있으면 언젠가 둘이 다른 이름을 말한다.
        "zone": regime.zone_of(series.code, latest[1] if latest else None),
        # 발표일과 출처는 **원본 행**에서 온다. 변환은 날짜를 안 바꾸므로 같은 날 것이다.
        "released_at": raw.released_at if raw else None,
        "source": raw.source if raw else None,
        "stale": is_stale(db, series, today=today, row=raw),
        "last_checked_at": series.last_checked_at,
        "last_ok_at": series.last_ok_at,
        "last_error": series.last_error,
    }


def overview(db: Session, today: dt.date | None = None) -> dict:
    """매크로 화면 한 장.

    금리차를 지표 목록과 **따로** 내려준다. 저장된 지표가 아니라 두 지표에서 계산한
    값이라 `macro_series` 행이 없고, 목록에 섞으면 "이건 왜 갱신 상태가 없나"가 된다.
    """
    series_list = active_series(db)
    spread = term_spread_point(db)
    term = (
        {"as_of": spread[0], "value": spread[1], "long_code": "DGS10", "short_code": "DGS2"}
        if spread
        else None
    )
    snapshots = [snapshot(db, series, today=today) for series in series_list]
    return {
        "series": snapshots,
        "term_spread": term,
        # 배지는 **방금 만든 스냅샷을 보고** 만든다. DB 를 다시 읽지 않으므로 쿼리가 늘지
        # 않고, 배지와 카드가 같은 값을 말하는 것이 보장된다 (`services/regime.py` 참고).
        "badges": regime.badges(snapshots, term),
        "pinned": pinned_codes(settings_service.get_settings(db)),
    }


def pinned_overview(db: Session, today: dt.date | None = None) -> dict:
    """홈 화면 한 줄. **고른 지표만** 읽는다.

    매크로 탭의 `overview` 를 그대로 홈에서 부르면 홈을 열 때마다 지표 아홉 개를 전부
    계산하게 된다. 홈의 주인공은 종목이고 매크로는 한 줄이라, 세 개 보여주려고 아홉 개를
    읽을 이유가 없다.

    고른 코드 중 없어졌거나 꺼진 지표는 **조용히 빠진다.** 지표를 끄고 나서 홈이
    비어 보이는 것보다, 홈에서 그것만 사라지는 쪽이 덜 놀랍다.
    """
    codes = pinned_codes(settings_service.get_settings(db))
    if not codes:
        return {"codes": [], "series": []}

    rows = {
        series.code: series
        for series in db.scalars(
            select(MacroSeries).where(MacroSeries.code.in_(codes), MacroSeries.active.is_(True))
        ).all()
    }
    # 고른 **순서대로** 돌려준다. `IN` 질의가 돌려주는 순서는 아무 의미가 없다.
    return {
        "codes": codes,
        "series": [snapshot(db, rows[code], today=today) for code in codes if code in rows],
    }


def normalize_codes(codes: list[str]) -> list[str]:
    """받은 코드 목록을 저장할 모양으로. 대소문자를 맞추고 중복은 **처음 것만** 남긴다.

    저장하는 쪽(`set_pinned`)과 검사하는 쪽(라우터)이 **같은 함수를 쓴다.** 각자
    다듬으면 한쪽만 대문자로 바꾸는 날이 오고, 그때 "vix"는 검사에서 통과했다가
    저장은 "VIX"로 되거나 그 반대가 된다.
    """
    seen: list[str] = []
    for code in codes:
        code = str(code).strip().upper()
        if code and code not in seen:
            seen.append(code)
    return seen


def set_pinned(db: Session, codes: list[str]) -> list[str]:
    """홈에 띄울 지표를 정한다.

    없는 코드는 여기 오기 전에 걸러져야 한다 (라우터가 400 으로 돌려준다) — 조용히
    버리면 사용자는 별을 눌렀는데 홈에 안 뜨는 이유를 알 수 없다.
    """
    wanted = normalize_codes(codes)
    settings = settings_service.get_settings(db)
    settings.pinned_macro = wanted
    db.commit()
    return wanted
