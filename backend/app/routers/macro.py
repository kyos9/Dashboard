"""매크로 지표 API.

**시그널과 섞이지 않는다.** 이 라우터는 값을 보여줄 뿐이고, `/api/dashboard` 의 매수·매도
판정에 아무것도 넘기지 않는다 (이유는 `services/macro.py` 맨 앞에 적어뒀다).
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import MacroSeries
from app.schemas import (
    MacroForecastUpdate,
    MacroHistoryOut,
    MacroOverviewOut,
    MacroPinnedOut,
    MacroPinnedUpdate,
    MacroPointOut,
    MacroRefreshResult,
    MacroSeriesOut,
)
from app.services import macro
from app.services.users import current_user_id

router = APIRouter(prefix="/api/macro", tags=["macro"])

# 차트에서 고를 수 있는 기간. 시세 차트(`ChartModal`)와 일부러 같은 이름을 쓴다 —
# 화면 둘이 다른 말을 쓰면 사용자가 매번 다시 읽어야 한다.
RANGE_DAYS = {"1y": 365, "5y": 365 * 5, "10y": 365 * 10, "max": None}


@router.get("", response_model=MacroOverviewOut)
def get_overview(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    """지표 목록 + 최신값 + 갱신 상태, 그리고 금리차."""
    return macro.overview(db, user_id)


# **`/{code}` 보다 먼저 있어야 한다.** 아래로 내려가면 `/pinned` 요청이 "PINNED 라는
# 지표를 달라"로 잡혀서 404 가 된다 — FastAPI 는 먼저 등록된 경로를 먼저 본다.
@router.get("/pinned", response_model=MacroPinnedOut)
def get_pinned(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    """홈 화면에 띄울 지표들. 고른 게 없으면 기본 셋이 온다."""
    return macro.pinned_overview(db, user_id)


@router.put("/pinned", response_model=MacroPinnedOut)
def put_pinned(
    payload: MacroPinnedUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """홈에 띄울 지표를 정한다.

    **없는 코드는 400 으로 돌려준다.** 조용히 버리면 별을 눌렀는데 홈에 안 뜨는 이유를
    사용자가 알 수 없고, 오타 하나가 영영 저장된 채로 남는다.
    """
    wanted = macro.normalize_codes(payload.codes)
    if wanted:
        known = set(db.scalars(select(MacroSeries.code).where(MacroSeries.code.in_(wanted))).all())
        # 장단기 금리차는 `macro_series` 에 행이 없다 — 받아오는 지표가 아니라 두 금리에서
        # 계산한 값이다. 그래도 홈에서는 켜고 끌 수 있어야 한다.
        known.add(macro.TERM_SPREAD_CODE)
        missing = [code for code in wanted if code not in known]
        if missing:
            raise HTTPException(status_code=400, detail=f"unknown macro code: {', '.join(missing)}")

    macro.set_pinned(db, user_id, wanted)
    return macro.pinned_overview(db, user_id)


# --- 예측치 ---------------------------------------------------------------
#
# 경로가 `/{code}/forecast` 라 칸이 둘이고, `/{code}` 와 겹치지 않는다. 그래도 `/pinned`
# 바로 아래, `/{code}` 위에 둔다 — 경로 순서가 중요한 파일에서는 순서를 눈으로 볼 수
# 있게 모아두는 편이 안전하다.
def _forecast_series(db: Session, code: str) -> MacroSeries:
    """예측치를 넣을 수 있는 지표를 찾아 온다. 못 넣는 지표는 여기서 400 으로 끊는다."""
    series = db.get(MacroSeries, code.upper())
    if series is None:
        raise HTTPException(status_code=404, detail="macro series not found")
    if not macro.is_forecastable(series):
        raise HTTPException(
            status_code=400,
            detail=(
                f"{series.code}: 매일 나오는 값에는 예상치가 없습니다 "
                "(발표되는 지표에만 컨센서스가 있습니다)"
            ),
        )
    return series


def _forecast_card(db: Session, series: MacroSeries) -> dict:
    """바뀐 뒤의 카드 한 장. 화면이 그대로 갈아끼우면 되게 같은 모양으로 돌려준다."""
    return macro.attach_forecasts(db, [macro.snapshot(db, series)])[0]


@router.put("/{code}/forecast", response_model=MacroSeriesOut)
def put_forecast(code: str, payload: MacroForecastUpdate, db: Session = Depends(get_db)):
    """예상치를 직접 넣는다 (Investing 에서 본 숫자를 옮겨 적는 자리).

    **같은 날 다시 넣으면 덮어쓴다.** 오타를 고치는 길이 그것뿐이다. 날이 바뀌면 새 줄이
    쌓이고, 그래야 "발표 직전에 무엇을 예상하고 있었나"가 남는다.
    """
    series = _forecast_series(db, code)

    limit = dt.date.today() + dt.timedelta(days=31 * macro.FORECAST_MAX_MONTHS_AHEAD)
    if payload.as_of > limit:
        raise HTTPException(
            status_code=400,
            detail=f"{payload.as_of}: 너무 먼 미래입니다 (연도를 확인해주세요)",
        )

    macro.set_forecast(db, series.code, payload.as_of, payload.value)
    return _forecast_card(db, series)


@router.delete("/{code}/forecast", response_model=MacroSeriesOut)
def delete_forecast(
    code: str,
    as_of: dt.date = Query(..., description="지울 예상치가 가리키는 달 (그 달 아무 날)"),
    db: Session = Depends(get_db),
):
    """그 달에 직접 넣어둔 예상치를 지운다.

    **덮어쓰기만으로는 못 지운다.** 어제 넣은 줄이 남아 있으면 잘못된 예상치 때문에
    "물가 상회" 배지가 계속 떠 있게 되고, 사용자는 끌 방법이 없다.

    받아온 예상치는 안 건드린다 — 지워도 다음 배치가 다시 받아온다.
    """
    series = _forecast_series(db, code)
    macro.clear_forecast(db, series.code, as_of)
    return _forecast_card(db, series)


@router.get("/{code}", response_model=MacroHistoryOut)
def get_history(
    code: str, range: str = Query("5y", alias="range"), db: Session = Depends(get_db)
):
    """차트용 시계열.

    기본을 5년으로 둔다. 매크로는 "지금이 어느 정도인지"를 보는 것이라 1년만 보면
    비교할 대상이 없다 — 금리 4%가 높은 건지 낮은 건지는 2020년이 화면에 있어야 보인다.
    """
    if range not in RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"invalid range: {range}")

    series = db.get(MacroSeries, code.upper())
    if series is None:
        raise HTTPException(status_code=404, detail="macro series not found")

    days = RANGE_DAYS[range]
    start = dt.date.today() - dt.timedelta(days=days) if days is not None else None
    points = macro.display_points(db, series, start=start)

    return MacroHistoryOut(
        code=series.code,
        name=series.name,
        unit=macro.display_unit(series),
        transform=series.transform,
        transform_label=macro.TRANSFORM_LABEL.get(series.transform),
        points=[MacroPointOut(as_of=as_of, value=value) for as_of, value in points],
    )


@router.post("/refresh", response_model=list[MacroRefreshResult])
def refresh(db: Session = Depends(get_db)):
    """사람이 누르는 갱신.

    **받을 때가 됐는지 따지지 않는다.** 눌렀는데 "아직 받을 때가 아님"만 돌아오면
    그건 고장으로 보인다. 배치(`refresh_due`)와 다른 점이 그것뿐이다.

    예측치도 같이 받는다(`force=True`) — 사람이 보기에 "지금 받아오기"는 이 화면에
    뜨는 것 전부를 뜻하지, 지표만을 뜻하지 않는다. 실패해도 지표 결과는 그대로 간다.
    """
    results = macro.refresh_all(db)
    forecast = macro.refresh_forecasts(db, force=True)
    if not forecast.get("ok"):
        # 목록에 한 줄로 끼워 보낸다. 예상치를 못 받은 것도 사용자가 알아야 하지만,
        # 그것 때문에 지표 갱신 결과가 통째로 오류로 보이면 안 된다.
        results.append(
            {"code": "예측치", "ok": False, "error": forecast.get("error"),
             "hint": "예상치는 없어도 지표는 그대로입니다 — 카드에서 직접 넣을 수 있습니다."}
        )
    return results
