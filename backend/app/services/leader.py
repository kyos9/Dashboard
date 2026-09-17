"""여러 개가 떠도 스케줄러는 하나만 돌게 한다 (ROADMAP 5단계).

APScheduler는 앱 **안에서** 돈다. 그래서 워커를 늘리거나 컨테이너를 둘 띄우면 갱신
job도 그 수만큼 생긴다 — 같은 시각에 같은 종목을 두 번 받아오고, 백업이 두 벌 뜨고,
매수 기록을 서로 밀어내며 경쟁한다. 지금까지는 "워커를 하나만 띄운다"는 주석으로
막아두고 있었는데, 주석은 `--workers 4`를 붙이는 순간 아무것도 막지 못한다.

Postgres의 어드바이저리 락을 쓴다. DB는 어차피 하나뿐이므로 **누가 먼저 잡는지를
DB가 정해준다.** 이 락은 연결이 끊어지면 저절로 풀린다 — 앱이 죽어도 다음에 뜨는
쪽이 이어받는다. (죽은 프로세스가 잡아둔 자물쇠가 영영 남는 것이 이런 장치의 가장
흔한 실패다. 그래서 파일이나 테이블 한 줄로 만들지 않았다.)

SQLite에는 이 장치가 없고, 필요도 없다 — 파일 하나를 쓰는 개인 PC에서는 앱도 하나다.
그래서 SQLite면 묻지 않고 "네가 맡아라"라고 답한다.

**한계.** 락을 들고 있던 연결이 끊기면(DB 재시작, 네트워크) 락이 풀리고, 그 틈에 다른
프로세스가 스케줄러를 시작할 수 있다. 그래도 하는 일은 전부 멱등하다(시세는 upsert,
매수 기록은 중복 판정을 거친다). 이 장치가 막으려는 것은 사고가 아니라 **워커를
늘렸을 때 생기는 상시 중복**이다.
"""

import logging

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.db import engine as default_engine

logger = logging.getLogger(__name__)

# 'SGNL' 네 글자를 그대로 숫자로 쓴다. 이 DB를 언젠가 다른 것과 나눠 쓰게 되더라도
# 락 번호가 우연히 겹치지 않도록, 앱을 알아볼 수 있는 값으로 둔다.
LOCK_KEY = 0x53474E4C


class SchedulerLock:
    """스케줄러를 맡을 프로세스를 하나로 정하는 자물쇠."""

    def __init__(self, engine: Engine | None = None) -> None:
        self._engine = engine
        self._connection: Connection | None = None

    @property
    def engine(self) -> Engine:
        # 기본값을 생성 시점이 아니라 쓸 때 읽는다 — import 순서에 걸리지 않는다.
        return self._engine if self._engine is not None else default_engine

    def acquire(self) -> bool:
        """이 프로세스가 스케줄러를 맡아도 되는지."""
        if self._connection is not None:
            return True

        engine = self.engine
        if not engine.dialect.name.startswith("postgres"):
            return True

        try:
            connection = engine.connect()
            held = bool(
                connection.execute(
                    text("SELECT pg_try_advisory_lock(:key)"), {"key": LOCK_KEY}
                ).scalar()
            )
        except Exception:
            # DB에 못 붙는 상황이면 어차피 할 수 있는 일이 별로 없다. 그래도 여기서
            # "맡지 않겠다"고 답하면 **아무도 갱신하지 않는 서버**가 되므로 맡는 쪽으로 간다.
            logger.warning(
                "스케줄러 자물쇠를 확인하지 못했습니다 — 이 프로세스가 맡습니다", exc_info=True
            )
            return True

        if not held:
            connection.close()
            return False

        # 연결을 붙들고 있는 동안만 락이 유지되므로 닫지 않고 들고 있는다.
        self._connection = connection
        return True

    def release(self) -> None:
        """자물쇠를 놓는다. **닫기 전에 명시적으로 푼다.**

        `connection.close()`는 연결을 진짜로 끊는 게 아니라 커넥션 풀에 돌려놓을 뿐이다.
        어드바이저리 락은 그 연결(세션)이 살아 있는 한 유지되므로, 풀에 돌아간 연결이
        락을 그대로 쥔 채 남는다 — 그러면 **다시 띄운 앱이 영영 스케줄러를 못 맡는다.**
        (롤백으로도 풀리지 않는다.)
        """
        if self._connection is None:
            return
        try:
            self._connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY})
            self._connection.close()
        except Exception:
            logger.debug("스케줄러 자물쇠를 놓는 중 오류", exc_info=True)
            # 풀지 못했으면 풀에 돌려보내지 않는다 — 락을 쥔 연결이 재사용되면 더 나쁘다.
            self._connection.invalidate()
        finally:
            self._connection = None
