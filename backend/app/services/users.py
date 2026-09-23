"""사용자.

잠금 없는 개인 PC와 비밀번호 하나로 잠근 서버에서는 **모든 요청이 1번 사용자로
들어온다** (ROADMAP 4단계 0번). 비밀번호 잠금은 "들어올 수 있나"만 가르고 "누구인가"는
모른다. 구글 로그인을 켜면 계정마다 다른 사용자다 (`services/google_login.py`).

코드는 **요청마다 사용자가 정해지는 모양**이다(4-2). 라우터는 사용자를
`current_user_id` 에서 받아 서비스에 넘기고, 사용자별 서비스는 `user_id` 를 **기본값 없이**
받는다. 기본값이 있으면 넘기는 걸 잊어도 1번으로 조용히 돌아가고, 그건 사람이 둘이 된
날 남의 데이터가 보이는 것으로 드러난다. 없으면 잊은 자리가 그 자리에서 터진다.

1번은 마이그레이션 0005가 만든다. 구글 계정이 없는 로컬 계정이고 주인이다. 구글
로그인이 붙는 날(4-3) 주인의 구글 계정이 이 행에 연결된다 — 새 사용자를 만들면 내
종목이 전부 1번에 남아 빈 화면이 뜬다.
"""

import datetime as dt

from fastapi import Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session

from app.db import get_db
from app.models import User, UserStock, stock_order

# 로그인 전까지 모든 요청의 주인. 마이그레이션 0005가 만든 로컬 계정이다.
LOCAL_USER_ID = 1


def current_user_id(request: Request) -> int:
    """요청을 보낸 사람. 라우터가 `Depends(current_user_id)` 로 받는다.

    누구인지는 문지기(`routers.auth.guard`)가 쪽지를 보고 정해 `request.state` 에 둔다 —
    잠금 없는 PC·비밀번호 문에서는 1번, 구글 로그인에서는 그 계정.

    **정해지지 않았으면 1번으로 넘어가지 않고 401이다.** 여기서 "없으면 1번"을 하면,
    문지기를 거치지 않는 경로가 하나라도 생기는 날 그 경로는 주인의 데이터를 연다.

    테스트는 이 자리를 갈아끼워 A·B 두 사람으로 요청을 보낸다 (`tests/test_isolation.py`).
    """
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail={"hint": "로그인이 필요합니다.", "message": "authentication required"},
        )
    return user_id


def viewer_user_id(request: Request) -> int | None:
    """보는 사람. **로그인 전 손님이면 `None`** — 1번으로 넘어가지 않는다.

    손님에게 열어둔 API(공용 매크로 읽기, `routers.auth.guest_can_read`)만 이걸 쓴다.
    `None` 을 받은 서비스는 "아무의 것도 아닌" 기본값을 보여준다.
    """
    return getattr(request.state, "user_id", None)


def require_owner(
    user_id: int = Depends(current_user_id), db: Session = Depends(get_db)
) -> int:
    """관리자(주인)만 지나간다. 사용자 계정은 403.

    관리자 전용은 **공용 자원을 건드리는 것**이다 — 전원의 시세·매크로·환율을 다시 받거나,
    남의 종목과 오류가 찍힌 로그를 보거나. 사용자는 자기 것만 바꾼다.

    남의 *자원* 은 404지만 이건 403이다. 기능이 있다는 건 비밀이 아니다.

    잠금 없는 PC와 비밀번호 문은 늘 1번이고, 1번은 관리자다 — 혼자 쓰는 동안은 달라지는 게 없다.
    """
    user = db.get(User, user_id)
    if user is None or not user.is_owner:
        raise HTTPException(
            status_code=403,
            detail={"hint": "관리자만 쓸 수 있는 기능입니다.", "message": "owner only"},
        )
    return user_id


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

    # 번호를 직접 정해 넣으면 Postgres 의 번호표는 그걸 모른다. 그대로 두면 다음 사람
    # (구글로 처음 들어온 친구)이 1번을 받으려다 부딪힌다. 마이그레이션 0005 가 하는
    # 것과 같은 일이다. SQLite 는 가장 큰 번호 다음을 주므로 할 일이 없다.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text(
                "SELECT setval(pg_get_serial_sequence('users', 'id'),"
                " (SELECT MAX(id) FROM users))"
            )
        )
        db.commit()
    return user
