"""매크로 지표 API.

**시그널과 섞이지 않는다.** 이 라우터는 값을 보여줄 뿐이고, `/api/dashboard` 의 매수·매도
판정에 아무것도 넘기지 않는다 (이유는 `services/macro.py` 맨 앞에 적어뒀다).
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import MacroSeries
from app.schemas import (
    MacroHistoryOut,
    MacroOverviewOut,
    MacroPointOut,
    MacroRefreshResult,
)
from app.services import macro

router = APIRouter(prefix="/api/macro", tags=["macro"])

# 차트에서 고를 수 있는 기간. 시세 차트(`ChartModal`)와 일부러 같은 이름을 쓴다 —
# 화면 둘이 다른 말을 쓰면 사용자가 매번 다시 읽어야 한다.
RANGE_DAYS = {"1y": 365, "5y": 365 * 5, "10y": 365 * 10, "max": None}


@router.get("", response_model=MacroOverviewOut)
def get_overview(db: Session = Depends(get_db)):
    """지표 목록 + 최신값 + 갱신 상태, 그리고 금리차."""
    return macro.overview(db)


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
    """
    return macro.refresh_all(db)
