"""포트폴리오 설정 — 사용자마다 한 줄.

기준통화, 기본 밴드, 수동 환율, 홈 즐겨찾기가 한 사람당 한 행에 들어 있다. "없으면
만든다"가 여기저기 흩어져 있었는데, **화면이 처음 열릴 때 문제가 된다.**

대시보드는 열리면서 여러 API를 동시에 부른다. DB가 비어 있으면 그 요청들이 전부
"설정이 없네, 만들자"에 도착하고, 먼저 넣은 하나만 성공한다. 나머지는
`UNIQUE constraint failed: user_settings.user_id`로 500이 난다 — **처음 켠 사람만
겪는 오류**라서 눈에 잘 안 띄고, 화면 한 칸이 그냥 비어 보인다.

그래서 만드는 자리를 여기 하나로 모으고, 경쟁에서 져도 실패로 다루지 않는다.
먼저 넣은 쪽이 넣어준 행을 읽으면 그만이다.
"""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import UserSettings


def get_settings(db: Session, user_id: int) -> UserSettings:
    """그 사람의 설정 행을 돌려준다. 없으면 만든다. 동시에 불려도 안전하다."""
    settings = db.get(UserSettings, user_id)
    if settings is not None:
        return settings

    settings = UserSettings(user_id=user_id)
    db.add(settings)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        settings = db.get(UserSettings, user_id)
        if settings is None:
            raise  # 중복이 아닌 다른 문제다 — 숨기면 안 된다
        return settings

    db.refresh(settings)
    return settings
