"""0007 — 사용자 상태 칸 (가입 승인).

- 올릴 때: 이미 있는 사람(주인·허용목록으로 들어온 친구)은 전부 승인된 상태여야 한다.
  아니면 업데이트한 날 친구들이 전부 "승인 대기"로 떨어진다.
- 내릴 때: 내린 코드는 쪽지만 맞으면 들여보낸다. 승인 안 된 사람의 쪽지를 먼저 끊는다.
"""

from alembic import command
from sqlalchemy import inspect, text

from app import migrate
from tests import test_migration_0005 as m0005
from tests.test_migration_0005 import _rows

# 0005 테스트의 "몇 달 쓴 DB"와 백업 기록 픽스처를 그대로 쓴다
at_0004 = m0005.at_0004
snapshots = m0005.snapshots

FRIEND = 2
WAITING = 3


def _to(engine, revision: str) -> None:
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), revision)


def test_people_already_here_stay_approved(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0006")
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (id, google_sub, email, created_at, session_epoch, is_owner)"
                 " VALUES (:i, 'sub-friend', 'f@example.com', CURRENT_TIMESTAMP, 0, :o)"),
            {"i": FRIEND, "o": False},
        )

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()
    assert sorted(_rows(engine, "SELECT id, status FROM users")) == [(1, "active"), (FRIEND, "active")]


def test_downgrade_cuts_off_people_who_were_not_approved(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    with engine.begin() as conn:
        for user_id, status in ((FRIEND, "active"), (WAITING, "pending")):
            conn.execute(
                text("INSERT INTO users (id, google_sub, email, created_at, session_epoch, is_owner, status)"
                     " VALUES (:i, :s, :e, CURRENT_TIMESTAMP, 4, :o, :st)"),
                {"i": user_id, "s": f"sub-{user_id}", "e": f"{user_id}@example.com", "o": False, "st": status},
            )

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0006")

    assert "status" not in {c["name"] for c in inspect(engine).get_columns("users")}
    epochs = dict(_rows(engine, "SELECT id, session_epoch FROM users WHERE id > 1"))
    assert epochs == {FRIEND: 4, WAITING: 5}  # 승인 대기의 쪽지만 끊겼다
