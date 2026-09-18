"""환율을 통화별로 — 일본 종목을 담을 수 있게.

달러 하나만 다루던 구조(`portfolio_settings.usd_krw_*` 세 컬럼)로는 엔화 종목을
담을 수 없었다. 통화가 셋만 돼도 짝은 여섯이므로, 짝마다 컬럼을 늘리는 대신
**각 통화의 원화 환산값**을 한 줄씩 저장하고 나머지는 원을 거쳐 계산한다.

여기서 나누는 두 가지가 다르다는 점이 중요하다 (ROADMAP 1절의 경계):

- 조회해온 **시세**는 누구에게나 같고 다시 받아오면 된다 -> 공용 테이블 `fx_rate`
- **직접 입력한 환율**은 "내가 환전한 값으로 보겠다"는 선택이다 -> 설정에 남는다

쓰던 값은 그대로 옮긴다. 수동 입력 환율은 잃어버리면 사용자가 다시 알아내야 하는
값이라(다시 만들 수 없는 종류) 반드시 따라와야 한다.

Revision ID: 0002
Revises: 0001
"""

import datetime as dt
import json

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fx_rate",
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("krw_rate", sa.Float(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("currency"),
    )

    with op.batch_alter_table("portfolio_settings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("fx_overrides", sa.JSON(), nullable=True))

    _move_existing_rates()

    with op.batch_alter_table("portfolio_settings", schema=None) as batch_op:
        batch_op.drop_column("usd_krw_override")
        batch_op.drop_column("usd_krw_rate")
        batch_op.drop_column("usd_krw_updated_at")


def _move_existing_rates() -> None:
    """쓰던 달러 환율을 새 자리로 옮긴다."""
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, usd_krw_override, usd_krw_rate, usd_krw_updated_at"
            " FROM portfolio_settings"
        )
    ).fetchall()

    for row in rows:
        settings_id, override, rate, updated_at = row

        if rate:
            bind.execute(
                sa.text(
                    "INSERT INTO fx_rate (currency, krw_rate, source, updated_at)"
                    " VALUES ('USD', :rate, 'fetched', :updated_at)"
                ),
                {"rate": float(rate), "updated_at": updated_at or dt.datetime.utcnow()},
            )

        if override:
            # JSON 컬럼이지만 여기서는 문자열로 넣는다 — 드라이버마다 어댑터가 달라서
            # 직접 문자열을 주는 쪽이 SQLite/Postgres 양쪽에서 똑같이 동작한다.
            bind.execute(
                sa.text("UPDATE portfolio_settings SET fx_overrides = :value WHERE id = :id"),
                {"value": json.dumps({"USD": float(override)}), "id": settings_id},
            )


def downgrade() -> None:
    with op.batch_alter_table("portfolio_settings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("usd_krw_override", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("usd_krw_rate", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("usd_krw_updated_at", sa.DateTime(), nullable=True))

    bind = op.get_bind()
    usd = bind.execute(
        sa.text("SELECT krw_rate, updated_at FROM fx_rate WHERE currency = 'USD'")
    ).fetchone()
    if usd:
        bind.execute(
            sa.text(
                "UPDATE portfolio_settings SET usd_krw_rate = :rate, usd_krw_updated_at = :at"
            ),
            {"rate": usd[0], "at": usd[1]},
        )

    for settings_id, raw in bind.execute(
        sa.text("SELECT id, fx_overrides FROM portfolio_settings")
    ).fetchall():
        overrides = json.loads(raw) if isinstance(raw, str) else (raw or {})
        if overrides.get("USD"):
            bind.execute(
                sa.text("UPDATE portfolio_settings SET usd_krw_override = :v WHERE id = :id"),
                {"v": float(overrides["USD"]), "id": settings_id},
            )

    with op.batch_alter_table("portfolio_settings", schema=None) as batch_op:
        batch_op.drop_column("fx_overrides")

    op.drop_table("fx_rate")
