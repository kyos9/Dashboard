"""재무 지표 — 공시 값, 종목별 수집 상태, 액면분할 이력 (ROADMAP 3b).

새 표 셋이라 **이미 있는 데이터는 건드리지 않는다.** 내리면 받아둔 재무가 사라지고,
다시 올리면 다음 새벽 작업이 처음부터 다시 받는다 (공시일도 출처가 다시 준다).

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fundamental_fact",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("filed_at", sa.Date(), nullable=False),
        sa.Column("filed_estimated", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("form", sa.String(), nullable=True),
        sa.Column("tag", sa.String(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticker"], ["instrument.ticker"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "ticker", "source", "metric", "period_start", "period_end", "filed_at",
            name="uq_fundamental_fact_key",
        ),
    )
    op.create_index(op.f("ix_fundamental_fact_ticker"), "fundamental_fact", ["ticker"], unique=False)
    op.create_table(
        "fundamental_status",
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("message", sa.String(), nullable=True),
        sa.Column("checked_at", sa.DateTime(), nullable=True),
        sa.Column("ok_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["ticker"], ["instrument.ticker"]),
        sa.PrimaryKeyConstraint("ticker"),
    )
    op.create_table(
        "stock_split",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("ratio", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["ticker"], ["instrument.ticker"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticker", "date", name="uq_stock_split_ticker_date"),
    )
    op.create_index(op.f("ix_stock_split_ticker"), "stock_split", ["ticker"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_stock_split_ticker"), table_name="stock_split")
    op.drop_table("stock_split")
    op.drop_table("fundamental_status")
    op.drop_index(op.f("ix_fundamental_fact_ticker"), table_name="fundamental_fact")
    op.drop_table("fundamental_fact")
