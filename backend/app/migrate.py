"""스키마 변경을 Alembic에 맡긴다.

예전에는 `db._apply_additive_migrations`가 "없는 컬럼이 있으면 ALTER TABLE로 붙인다"를
직접 했다. 혼자 쓸 때는 충분했지만 할 수 있는 일이 nullable 컬럼 추가뿐이었다. 테이블을
쪼개거나 값을 옮기는 변경은 못 하고, 무엇보다 **되돌릴 방법과 기록이 없다.** 남의 데이터가
든 서버에서는 "DB 지우고 다시"가 선택지가 아니므로 여기서 Alembic으로 넘긴다.

어려운 부분은 하나뿐이다 — **이미 쓰고 있는 DB를 어떻게 받아들이나.** 그 파일에는
테이블이 다 들어 있지만 Alembic이 남긴 기록(`alembic_version`)은 없다. 그대로 올리면
Alembic은 빈 DB인 줄 알고 첫 리비전부터 실행하다 "테이블이 이미 있다"에서 멈춘다.

그래서 이렇게 한다.

1. `alembic_version`이 있으면 → 평소대로 `upgrade head`
2. 없는데 테이블은 있으면 → **옛 방식으로 한 번 현행화한 뒤 0001을 도장만 찍고**(stamp)
   거기서부터 `upgrade head`
3. 아무것도 없으면 → 처음부터 `upgrade head`

2번은 딱 한 번만 일어난다. 그 뒤로 이 파일이 하는 일은 1번뿐이다.
"""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import inspect

from app.db import adopt_pre_alembic_database, engine
from app.services import backup

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
SCRIPT_LOCATION = BACKEND_DIR / "migrations"

# Alembic 이전에 쓰던 DB가 도착해 있는 지점. 이 값은 바뀌지 않는다 —
# 새 리비전은 이 뒤에 쌓이지, 이 자리를 대신하지 않는다.
INITIAL_REVISION = "0001"


def _config(connection) -> Config:
    """마이그레이션을 돌릴 설정. **ini 파일을 읽지 않는다.**

    여기서 필요한 건 두 가지(스크립트 위치, 이미 열어둔 연결)뿐인데, ini를 읽게 두면
    그 *내용*이 아니라 **읽는 방식** 때문에 앱이 통째로 안 뜬다.

    Alembic은 ini를 **시스템 로케일 인코딩**으로 읽는다. 한국어 윈도우는 그게 cp949라,
    UTF-8로 저장된 한글 주석 한 줄이 `UnicodeDecodeError`가 되고 기동 중에 죽는다.
    리눅스와 CI는 UTF-8이라 **이 경로는 거기서 영원히 잡히지 않는다** — 실제로 그렇게
    지나갔고, 사용자 PC에서 처음 터졌다.

    alembic.ini는 명령줄(`alembic revision -m ...`)을 위해 남겨둔다. 그쪽은 여전히
    로케일로 읽으므로 **그 파일은 ASCII로 유지한다** (test_alembic.py가 지킨다).
    """
    cfg = Config()
    # 작업 디렉터리가 어디든(서비스로 띄우면 / 인 경우도 있다) 같은 곳을 보게 절대경로로.
    cfg.set_main_option("script_location", str(SCRIPT_LOCATION))
    cfg.set_main_option("path_separator", "os")
    # 이미 열어둔 연결 위에서 돌린다 — 테스트가 임시 DB를 겨냥할 수 있어야 한다.
    cfg.attributes["connection"] = connection
    return cfg


def current_revision(bind=None) -> str | None:
    bind = bind or engine
    with bind.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def head_revision() -> str | None:
    from alembic.script import ScriptDirectory

    return ScriptDirectory(str(SCRIPT_LOCATION)).get_current_head()


def upgrade_to_head(bind=None) -> str | None:
    """DB를 최신 스키마로 올리고, 올라간 자리를 돌려준다."""
    bind = bind or engine

    with bind.connect() as conn:
        stamped = MigrationContext.configure(conn).get_current_revision()
        tables = set(inspect(conn).get_table_names())

    adopting = stamped is None and bool(tables - {"alembic_version"})

    # 빈 DB를 처음 만드는 건 잃을 게 없다. 그 외에 실제로 바꿀 게 있을 때만 떠둔다 —
    # 앱을 켤 때마다 뜨면 정작 필요한 "바꾸기 직전"의 백업이 밀려나 사라진다.
    if tables and (adopting or stamped != head_revision()):
        backup.snapshot_before_migration(bind)

    if adopting:
        logger.info("Alembic 이전에 만들어진 DB를 이어받습니다")
        adopt_pre_alembic_database(bind)
        with bind.begin() as conn:
            command.stamp(_config(conn), INITIAL_REVISION)

    with bind.begin() as conn:
        command.upgrade(_config(conn), "head")

    now = current_revision(bind)
    if now != stamped:
        logger.info("DB 스키마: %s → %s", stamped or "(없음)", now)
    return now
