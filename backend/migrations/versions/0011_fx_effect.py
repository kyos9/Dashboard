"""산 환율과 환율 효과 켜기 (ROADMAP 8-3).

- `holding.avg_fx`: 외화 종목을 산 환율(1단위에 몇 원, 금액 가중 평균). 모르면 비워둔다.
- `user_settings.include_fx_effect`: 수익률·평가손익에 환율 효과를 넣을지. 기본은 끔.

두 칸을 더하기만 하므로 **이미 있는 값은 건드리지 않는다.** 있던 보유는 산 환율이 빈 채로,
있던 사람은 끔으로 시작한다 — 지금 화면과 똑같이 보인다.

내리면 두 칸이 사라진다. 적어 둔 산 환율도 같이 사라지지만 비중·주문과는 무관한 값이라
되돌릴 수 없는 손실로 치지 않는다 (`IRREVERSIBLE` 에 넣지 않는다).

Revision ID: 0011
Revises: 0010
"""

import sqlite3

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("holding", sa.Column("avg_fx", sa.Float(), nullable=True))
    op.add_column(
        "user_settings",
        sa.Column("include_fx_effect", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def _drop(table: str, column: str) -> None:
    # SQLite는 제자리에서 지운다 — 표를 새로 만들어 옮기는 방식은 `holding` 이 `user_stock` 을,
    # `user_settings` 가 `users` 를 가리켜 외래키 검사에 막힌다 (0006·0007 과 같은 이유).
    if op.get_bind().dialect.name == "sqlite" and sqlite3.sqlite_version_info >= (3, 35, 0):
        op.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
        return
    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.drop_column(column)


def downgrade() -> None:
    _drop("user_settings", "include_fx_effect")
    _drop("holding", "avg_fx")
