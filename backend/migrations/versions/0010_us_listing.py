"""미국 상장 종목 캐시 (작은 일들 — 미국 전체 상장목록·검색).

새 표 하나라 **이미 있는 데이터는 건드리지 않는다.** 내리면 캐시가 사라질 뿐이고, 다음에
켤 때 다시 받는다. 그동안은 내장 목록과 야후 검색으로 찾는다.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "us_listing",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("exchange", sa.String(), nullable=True),
        sa.Column("instrument", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("code"),
    )


def downgrade() -> None:
    op.drop_table("us_listing")
