"""알림을 받을 때(아침·오후)와 종목별로 끈 알림 — `user_settings.push_prefs` (0.45.0 B).

`{"slots": ["morning", "afternoon"], "muted": ["VOO", …]}`. **비어 있으면(NULL) 둘 다 받고 끈 종목이 없다** — 올리면 모두
NULL 로 시작하므로 지금과 똑같다. 설정일 뿐이라 내리면 이 칸만 사라진다(고른 것을 잃고 지금처럼 다 받는다).
옛 이미지(0.42 이상)는 모르는 리비전으로도 뜨고 이 칸을 쓰지 않을 뿐이다 — 되돌릴 때 내리지 않아도 된다.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.add_column(sa.Column("push_prefs", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.drop_column("push_prefs")
