"""매크로 지표마다 "마지막 갱신이 어떻게 됐는지"를 남길 자리를 만든다.

이게 없으면 구분되지 않는 두 가지가 있다.

  받아봤는데 새 값이 없었다   (정상 — CPI 는 한 달에 한 번 나온다)
  아예 못 받았다              (문제 — 네트워크·키·코드)

`macro_value.fetched_at` 으로는 알 수 없다. 그쪽은 **값이 실제로 바뀌었을 때만**
갱신되기 때문에, 성공했지만 새 게 없던 날은 아무 흔적도 남지 않는다. 둘을 못 가르면
화면은 "8월 값"을 띄워두고 그게 최신이라서인지 고장나서인지 말해주지 못한다.

`last_checked_at` 은 하루에 한 번만 시도하게 만드는 기준이기도 하다 — 이게 없으면
앱을 다시 띄울 때마다 20년치를 다시 받는다.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 전부 nullable 이다. 이미 있는 행은 "아직 한 번도 안 돌았다"로 읽히고, 그게 맞다.
    with op.batch_alter_table("macro_series", schema=None) as batch_op:
        batch_op.add_column(sa.Column("last_checked_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("last_ok_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("last_error", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("macro_series", schema=None) as batch_op:
        batch_op.drop_column("last_error")
        batch_op.drop_column("last_ok_at")
        batch_op.drop_column("last_checked_at")
