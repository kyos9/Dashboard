"""날마다의 평가금액 — `portfolio_value_daily` (0.44.0).

사람마다 하루 한 줄. 올리면 빈 표로 시작하고 기존 데이터는 그대로다.

**내리면 쌓인 기록이 사라지고, 다시 만들 수 없다.** 그래서 이 리비전을 건너는 내리기는 백업에 성공해야만
한다(`migrate.DATA_ON_DOWNGRADE`). 0.43 으로 되돌릴 때는 내리지 않는다 — 0.42 이상은 모르는 리비전이 찍힌
DB 로도 뜨고 이 표를 쓰지 않을 뿐이라, 이미지만 되돌리면 기록이 산다(DEPLOY.md 9-2).

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portfolio_value_daily",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # CASCADE: 0.43 이미지는 이 표를 모른다 — 되돌린 동안의 탈퇴가 Postgres 에서 넘어지지 않게.
        # SQLite 는 외래키를 강제하지 않으므로 남은 줄은 0.44 가 켤 때 치운다(db.init_db → value_record.sweep_orphans).
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("base_currency", sa.String(), nullable=False),
        sa.Column("total_value_base", sa.Float(), nullable=False),
        sa.Column("stock_value_base", sa.Float(), nullable=False),
        sa.Column("cash_value_base", sa.Float(), nullable=False),
        sa.Column("cash", sa.JSON(), nullable=False),
        sa.Column("fx", sa.JSON(), nullable=False),
        sa.Column("positions", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "date", name="uq_portfolio_value_daily_user_date"),
    )
    op.create_index("ix_portfolio_value_daily_user_id", "portfolio_value_daily", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_portfolio_value_daily_user_id", table_name="portfolio_value_daily")
    op.drop_table("portfolio_value_daily")
