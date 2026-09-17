"""포트폴리오 설정 — 한 줄짜리 테이블.

기준통화, 기본 밴드, 수동 환율이 여기 한 행에 들어 있다. 행이 하나뿐이라 "없으면
만든다"가 여기저기 흩어져 있었는데, **화면이 처음 열릴 때 문제가 된다.**

대시보드는 열리면서 여러 API를 동시에 부른다. DB가 비어 있으면 그 요청들이 전부
"설정이 없네, 만들자"에 도착하고, 먼저 넣은 하나만 성공한다. 나머지는
`UNIQUE constraint failed: portfolio_settings.id`로 500이 난다 — **처음 켠 사람만
겪는 오류**라서 눈에 잘 안 띄고, 화면 한 칸이 그냥 비어 보인다.

그래서 만드는 자리를 여기 하나로 모으고, 경쟁에서 져도 실패로 다루지 않는다.
먼저 넣은 쪽이 넣어준 행을 읽으면 그만이다.
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import PortfolioSettings

# 설정은 한 줄뿐이다. 이 값으로 고정해두면 "혹시 두 줄이 생겼나"를 걱정하지 않아도 된다.
SINGLETON_ID = 1


def get_settings(db: Session) -> PortfolioSettings:
    """설정 행을 돌려준다. 없으면 만든다. 동시에 불려도 안전하다."""
    settings = db.get(PortfolioSettings, SINGLETON_ID)
    if settings is not None:
        return settings

    settings = PortfolioSettings(id=SINGLETON_ID)
    db.add(settings)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        settings = db.get(PortfolioSettings, SINGLETON_ID)
        if settings is None:
            raise  # 중복이 아닌 다른 문제다 — 숨기면 안 된다
        return settings

    db.refresh(settings)
    return settings
