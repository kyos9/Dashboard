"""푸시 알림 — 기기마다의 구독, 이미 알린 것, 받을 종류 (ROADMAP 6단계).

새 표 둘과 설정 칸 하나라 **이미 있는 데이터는 건드리지 않는다.** 내리면 구독이 사라지고,
다시 올린 뒤 화면을 열면 브라우저가 다시 구독한다 (`frontend/src/lib/push.ts`).

Revision ID: 0008
Revises: 0007
"""

import sqlite3

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscription",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(), nullable=False),
        sa.Column("p256dh", sa.String(), nullable=False),
        sa.Column("auth", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_ok_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index(
        op.f("ix_push_subscription_user_id"), "push_subscription", ["user_id"], unique=False
    )
    op.create_table(
        "push_state",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id", "subject"),
    )
    op.add_column("user_settings", sa.Column("push_kinds", sa.JSON(), nullable=True))


def downgrade() -> None:
    # SQLite는 제자리에서 지운다 (0007 과 같은 이유 — 표를 새로 만들어 옮기면 외래키에 막힌다)
    if op.get_bind().dialect.name == "sqlite" and sqlite3.sqlite_version_info >= (3, 35, 0):
        op.execute("ALTER TABLE user_settings DROP COLUMN push_kinds")
    else:
        with op.batch_alter_table("user_settings", schema=None) as batch_op:
            batch_op.drop_column("push_kinds")
    op.drop_table("push_state")
    op.drop_index(op.f("ix_push_subscription_user_id"), table_name="push_subscription")
    op.drop_table("push_subscription")
