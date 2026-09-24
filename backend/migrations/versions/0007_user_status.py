"""사용자마다 "들어와서 쓸 수 있는가"를 적을 자리를 만든다 — 가입 신청 → 관리자 승인.

예전에는 들어올 수 있는 사람을 `.env` 의 `ALLOWED_GOOGLE_EMAILS` 로만 정했다. 사람을
받을 때마다 파일을 고치고 서버를 다시 띄워야 했다. 이제 누구나 구글로 **신청**은 할 수
있고(승인 대기), 관리자가 사용자 목록에서 승인·거절·차단한다.

**이미 있는 사람은 전부 `active` 다.** 지금 DB에 있는 사람은 주인이거나 허용목록으로
들어온 사람이라 이미 승인된 것과 같다. 열의 서버 기본값이 그 일을 한다.

Revision ID: 0007
Revises: 0006
"""

import sqlite3

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("status", sa.String(), nullable=False, server_default="active")
        )


def downgrade() -> None:
    # 내리면 승인 대기·거절·차단의 구분이 사라진다. 내린 코드는 쪽지만 맞으면 들여보내므로,
    # **승인 안 된 사람이 이미 받아 둔 쪽지를 먼저 무효로 만든다** (epoch 를 올린다). 그 뒤로
    # 그들이 다시 로그인하면 내린 코드는 허용목록으로 가르고, 목록에 없으면 막는다.
    op.execute("UPDATE users SET session_epoch = session_epoch + 1 WHERE status <> 'active'")
    # SQLite는 제자리에서 지운다 — 표를 새로 만들어 옮기는 방식은 `users` 를 가리키는 표
    # (user_stock·user_settings …) 때문에 외래키 검사에 막힌다 (0006 과 같은 이유).
    if op.get_bind().dialect.name == "sqlite" and sqlite3.sqlite_version_info >= (3, 35, 0):
        op.execute("ALTER TABLE users DROP COLUMN status")
        return
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("status")
