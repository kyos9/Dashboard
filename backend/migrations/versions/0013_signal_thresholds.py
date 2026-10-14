"""시그널 기준 내 설정 — `user_settings.signal_thresholds` (0.42.0).

사람마다 ADX·거래량비·이격도·비교 기간을 바꿀 수 있다. 바꾼 키만 JSON 으로 담고, **비어 있으면(NULL) 기본
기준**이다 — 올리면 모두 NULL 로 시작하므로 지금과 똑같이 보인다. 공용 판정(`signal_daily`)은 건드리지 않는다.

내리면 이 칸만 사라진다(고른 기준을 잃고 기본으로 돌아갈 뿐 다른 데이터는 그대로). **옛 이미지로 되돌리려면
먼저 이 이미지로 0012 까지 내린다** — 옛 이미지는 0013 을 몰라 켜지지 않는다(DEPLOY.md 9-2 되돌리기).

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.add_column(sa.Column("signal_thresholds", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.drop_column("signal_thresholds")
