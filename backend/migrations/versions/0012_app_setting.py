"""앱 설정 — 관리자가 화면에서 켜고 끄는 것 (ROADMAP 9-15).

첫 설정은 "사용자에게 AI 포트폴리오 진단·종목 분석을 열까"다. 새 표 하나라 **이미 있는 데이터는
건드리지 않는다.** 줄이 없으면 코드의 기본값을 쓴다. 내리면 고른 값이 사라지고 기본값으로 돌아간다.

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_setting")
