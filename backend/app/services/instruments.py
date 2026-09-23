"""종목(`Instrument`) — 공용 절반.

사람이 종목을 담으면(`UserStock`) 그 밑에 공용 행이 하나 있어야 한다. 시세·지표·
시그널이 여기에 매달리기 때문이다. 누가 먼저 담았든 한 줄이다.
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.markets import normalize_ticker
from app.models import Instrument


def ensure_instrument(db: Session, ticker: str, name: str | None = None) -> Instrument:
    """종목 행을 돌려준다. 없으면 만들고 **커밋한다.**

    두 사람이 같은 종목을 동시에 담으면 삽입이 부딪힌다. 경합에서 진 쪽은 실패가
    아니다 — 먼저 넣은 쪽의 행을 읽으면 된다 (`settings.get_settings`와 같은 방법).
    """
    ticker = normalize_ticker(ticker)
    found = db.get(Instrument, ticker)
    if found is not None:
        if found.name is None and name:
            found.name = name
            db.commit()
        return found

    instrument = Instrument(ticker=ticker, name=name)
    db.add(instrument)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        found = db.get(Instrument, ticker)
        if found is None:
            raise  # 중복이 아닌 다른 문제다 — 숨기면 안 된다
        return found
    return instrument
