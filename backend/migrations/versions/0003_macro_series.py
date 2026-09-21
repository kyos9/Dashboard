"""매크로 지표를 담을 자리를 만든다.

표를 셋으로 쪼갠 이유는 각각 성격이 다르기 때문이다.

- `macro_series`   지표가 무엇인지. 지표를 늘릴 때 **코드를 안 고치고 행만 추가**하면
                   되도록, 화면에 어떻게 보여줄지까지 여기 들어 있다.
- `macro_value`    실제로 발표된 값. `as_of`(언제의 값)와 `released_at`(언제 공개됐나)을
                   처음부터 둘 다 둔다 — CPI·PCE 는 발표 후에도 수정되므로, 나중에
                   과거를 검증할 때 이 구분이 없으면 그 시점에 알 수 없던 정보로
                   판단하게 된다. 나중에 붙이면 데이터를 전부 다시 받아야 한다.
- `macro_forecast` 예측치. 나우캐스트는 매일 바뀌므로 `forecast_date` 로 쌓는다.
                   한 칸에 덮어쓰면 "발표 직전에 시장이 뭘 예상했나"가 사라진다.

셋 다 **공용 데이터다** — 사용자가 백 명이어도 CPI 는 하나다. 반면 "그 중 무엇을 홈
화면에 둘까"는 사용자별 선택이라 `portfolio_settings.pinned_macro` 로 간다
(ROADMAP 1절의 경계: `fx_overrides` 와 같은 자리).

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "macro_series",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("source_code", sa.String(), nullable=False),
        sa.Column("fallback_source", sa.String(), nullable=True),
        sa.Column("fallback_code", sa.String(), nullable=True),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("transform", sa.String(), nullable=False),
        sa.Column("frequency", sa.String(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("code"),
    )

    op.create_table(
        "macro_value",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("released_at", sa.Date(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["code"], ["macro_series.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", "as_of", name="uq_macro_value_code_as_of"),
    )
    op.create_index(op.f("ix_macro_value_code"), "macro_value", ["code"])
    op.create_index(op.f("ix_macro_value_as_of"), "macro_value", ["as_of"])

    op.create_table(
        "macro_forecast",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("forecast_date", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["code"], ["macro_series.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "code", "as_of", "source", "forecast_date", name="uq_macro_forecast_key"
        ),
    )
    op.create_index(op.f("ix_macro_forecast_code"), "macro_forecast", ["code"])
    op.create_index(op.f("ix_macro_forecast_as_of"), "macro_forecast", ["as_of"])

    # NULL 로 둔다 — "아직 안 골랐다"(기본값을 보여준다)와 "일부러 다 껐다"(`[]`)를
    # 구분해야 하기 때문이다. 여기서 `[]` 로 채우면 쓰던 사람의 홈에서 매크로가
    # 통째로 사라지고, 그건 설정이 아니라 고장으로 보인다.
    with op.batch_alter_table("portfolio_settings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pinned_macro", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("portfolio_settings", schema=None) as batch_op:
        batch_op.drop_column("pinned_macro")

    op.drop_index(op.f("ix_macro_forecast_as_of"), table_name="macro_forecast")
    op.drop_index(op.f("ix_macro_forecast_code"), table_name="macro_forecast")
    op.drop_table("macro_forecast")

    op.drop_index(op.f("ix_macro_value_as_of"), table_name="macro_value")
    op.drop_index(op.f("ix_macro_value_code"), table_name="macro_value")
    op.drop_table("macro_value")

    op.drop_table("macro_series")
