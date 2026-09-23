"""사용자.

로그인이 붙기 전까지(4-3) **모든 요청은 1번 사용자로 들어온다** — 개인 PC도, 비밀번호
하나로 잠근 서버도 같다 (ROADMAP 4단계 0번). 비밀번호 잠금은 "들어올 수 있나"만 가르고
"누구인가"는 모른다.

그래도 코드는 이미 **요청마다 사용자가 정해지는 모양**이다(4-2). 라우터는 사용자를
`current_user_id` 에서 받아 서비스에 넘기고, 사용자별 서비스는 `user_id` 를 **기본값 없이**
받는다. 기본값이 있으면 넘기는 걸 잊어도 1번으로 조용히 돌아가고, 그건 사람이 둘이 된
날 남의 데이터가 보이는 것으로 드러난다. 없으면 잊은 자리가 그 자리에서 터진다.

1번은 마이그레이션 0005가 만든다. 구글 계정이 없는 로컬 계정이고 주인이다. 구글
로그인이 붙는 날(4-3) 주인의 구글 계정이 이 행에 연결된다 — 새 사용자를 만들면 내
종목이 전부 1번에 남아 빈 화면이 뜬다.
"""

import datetime as dt

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session

from app.models import User, UserStock, stock_order

# 로그인 전까지 모든 요청의 주인. 마이그레이션 0005가 만든 로컬 계정이다.
LOCAL_USER_ID = 1


def current_user_id() -> int:
    """요청을 보낸 사람. 라우터가 `Depends(current_user_id)` 로 받는다.

    지금은 늘 1번이다. 4-3에서 세션 쪽지에서 꺼내도록 **이 함수만** 바뀌고, 라우터와
    서비스는 그대로다. 테스트는 이 자리를 갈아끼워 A·B 두 사람으로 요청을 보낸다
    (`tests/test_isolation.py`).
    """
    return LOCAL_USER_ID


def user_stocks(db: Session, user_id: int) -> Query:
    """그 사람이 담은 종목. 사용자별 종목 조회는 전부 여기서 시작한다."""
    return db.query(UserStock).filter(UserStock.user_id == user_id)


def ordered_user_stocks(db: Session, user_id: int, active_only: bool = False) -> list[UserStock]:
    """화면 순서대로. `active_only` 면 비활성 종목을 뺀다."""
    query = user_stocks(db, user_id)
    if active_only:
        query = query.filter(UserStock.active.is_(True))
    return query.order_by(*stock_order()).all()


def find_user_stock(db: Session, user_id: int, ticker: str) -> UserStock | None:
    """그 사람의 종목 하나. **남의 종목은 없는 것과 같다** — 호출부는 404로 돌려준다.

    403이 아니라 404인 이유: 403은 "그런 게 있긴 하다"를 알려준다 (ROADMAP 4단계 7번).
    """
    return user_stocks(db, user_id).filter(UserStock.ticker == ticker).first()


def ensure_local_owner(db: Session) -> User:
    """1번 사용자를 돌려준다. 없으면 만든다 (동시에 불려도 안전하다).

    앱은 마이그레이션이 만든 행을 쓰므로 평소에는 읽기만 한다. `create_all`로 표를
    만드는 테스트가 여기서 1번을 얻는다.
    """
    user = db.get(User, LOCAL_USER_ID)
    if user is not None:
        return user

    user = User(id=LOCAL_USER_ID, is_owner=True, created_at=dt.datetime.utcnow())
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user = db.get(User, LOCAL_USER_ID)
        if user is None:
            raise
    return user
