"""테스트가 쓰는 행을 한 곳에서 만든다.

**왜 모으나.** 4단계에서 종목·보유·매수기록·설정에 *사용자*가 붙는다. 그때
`Stock(ticker=...)` 가 테스트 파일 여덟 군데에 흩어져 있으면 서른 몇 군데를 한꺼번에
고쳐야 하고, 그 커밋은 아무도 읽을 수 없다 — 진짜 바뀐 것(사용자 분리)이 기계적인
치환에 묻힌다. 여기 한 파일만 바꾸면 되게 해둔다.

**규칙: 이 파일은 지금 동작을 그대로 만든다.** 기본값을 바꾸고 싶어지면 그건 다른
커밋이다. 여기가 조용히 테스트의 의미를 바꾸는 자리가 되면, 테스트가 무엇을 지키고
있는지 아무도 모르게 된다.

시세(`PriceDaily`)·지표·시그널은 여기 없다. 그건 **모든 사용자가 같이 쓰는** 데이터라
사용자가 붙지 않는다 — 4단계에서 바뀌지 않는 것을 미리 감쌀 이유가 없다.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from app.models import BuyExecution, BuyStatus, BuyType, Holding, PortfolioSettings, Stock
from app.services.settings import SINGLETON_ID


def make_stock(db: Session, ticker: str = "TST", *, commit: bool = True, **fields) -> Stock:
    """종목 하나를 만들어 DB에 넣는다.

    나머지 칸(`target_weight_pct`, `dca_period`, `added_at` …)은 부르는 쪽이 필요한
    것만 넘긴다. 여기서 기본값을 따로 정하지 않는 이유는 모델의 기본값과 다른 값을
    숨겨두면, 테스트가 왜 그렇게 도는지 이 파일을 열어봐야만 알 수 있기 때문이다.
    """
    stock = Stock(ticker=ticker, **fields)
    db.add(stock)
    if commit:
        db.commit()
    return stock


def make_holding(db: Session, ticker: str, quantity: float, *, commit: bool = True) -> Holding:
    """보유수량 한 줄."""
    holding = Holding(ticker=ticker, quantity=quantity)
    db.add(holding)
    if commit:
        db.commit()
    return holding


def build_settings(**fields) -> PortfolioSettings:
    """DB에 넣지 않는 설정 객체 — 순수 함수를 검증할 때 쓴다."""
    return PortfolioSettings(**fields)


def make_settings(db: Session, *, commit: bool = True, **fields) -> PortfolioSettings:
    """포트폴리오 설정(한 줄짜리 표)을 DB에 넣는다.

    `id` 를 받지 않는다. 설정은 싱글턴이고, 테스트마다 다른 id로 넣으면 서비스가
    읽는 행과 테스트가 쓴 행이 어긋난다.
    """
    settings = PortfolioSettings(id=SINGLETON_ID, **fields)
    db.add(settings)
    if commit:
        db.commit()
    return settings


def make_buy(
    db: Session,
    ticker: str,
    *,
    period_start: dt.date,
    period_end: dt.date | None = None,
    exec_date: dt.date | None = None,
    type: BuyType = BuyType.signal,
    amount: float = 100.0,
    status: BuyStatus = BuyStatus.scheduled,
    commit: bool = True,
) -> BuyExecution:
    """매수 기록 한 줄. 기간 끝·실행일을 안 주면 기간 시작과 같은 날로 둔다."""
    buy = BuyExecution(
        ticker=ticker,
        period_start=period_start,
        period_end=period_end or period_start,
        exec_date=exec_date or period_start,
        type=type,
        amount=amount,
        status=status,
    )
    db.add(buy)
    if commit:
        db.commit()
    return buy
