"""매수 기록을 걷어내고, 평단가·현금·포트폴리오 리뷰 주기·리밸런싱 기록을 넣는다.

**무엇이 바뀌나.** 리밸런싱이 실제로 쓰는 값은 *수량 × 현재가, 목표비중, 밴드, 리뷰일*
뿐이었다. 종목마다 적던 적립 금액·주기(`dca_*`)와 그걸로 잡던 기간별 매수 기록
(`buy_execution`)은 리밸런싱과 따로 도는 기능이었고, 쓰는 사람이 "필요 없다"고 정했다.

- `user_stock`: `dca_amount`·`dca_period`·`rebalance_period`·`review_date_override` 삭제
- `buy_execution`: 표째로 삭제 (확정한 매수는 이미 보유수량에 더해져 있다)
- `holding.avg_cost`: 평단가 — 손익을 보여주는 데만 쓴다
- `user_settings`: 리뷰 주기·다음 리뷰일(직접 지정)·현금·현금 목표비중
- `rebalance_snapshot`: 리뷰할 때 남기는 기록. **다시 만들 수 없는 종류**라 새 표로 둔다

**되돌릴 수 없는 이유.** 매수 기록과 적립 설정은 지우면 끝이다. downgrade는 표 모양만
되살리고 내용은 빈 채로 둔다. 그래서 `app.migrate.IRREVERSIBLE`에 들어가고, 백업에
실패하면 시작하지 않는다.

**종목마다 있던 리뷰 설정을 하나로 모으는 법.**
- 주기: 그 사람의 (켜진) 종목이 가장 많이 쓰던 주기. 같으면 분기.
- 직접 지정한 리뷰일: **아직 오지 않은 것** 중 가장 이른 날. 지난 날짜를 옮기면 "리뷰가
  밀렸다"는 표시가 영영 켜진 채 남는다.

**SQLite에서 열 지우기.** 3.35부터 `ALTER TABLE ... DROP COLUMN`이 된다. 표를 새로 만들어
옮기는 방식(batch)은 외래키 검사를 켠 연결에서 `user_stock`을 지우는 순간 `holding`이
가리키는 행 때문에 막힌다 — 지우려는 열은 외래키와 무관하므로 제자리에서 지운다.

Revision ID: 0006
Revises: 0005
"""

import datetime as dt
import logging
import sqlite3
from collections import Counter

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")

DROPPED_STOCK_COLUMNS = ("dca_amount", "dca_period", "rebalance_period", "review_date_override")

# 0005가 쓰던 Postgres Enum 타입. 이 리비전 뒤로는 아무도 쓰지 않는다.
OLD_ENUMS = {
    "dcaperiod": ("monthly", "quarterly"),
    "rebalanceperiod": ("quarterly", "semiannual"),
    "buytype": ("signal", "fallback"),
    "buystatus": ("scheduled", "confirmed"),
}

DEFAULT_PERIOD = "quarterly"
# 새 기본값은 모델(UserSettings)과 같아야 한다 — 설정 행이 없던 사람에게 새로 만들어 줄 때 쓴다
DEFAULT_BAND = 5.0
DEFAULT_BASE = "KRW"


def _on_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _run(sql: str, **params):
    return op.get_bind().execute(sa.text(sql), params)


def _as_date(value) -> dt.date | None:
    if value is None or isinstance(value, dt.date):
        return value
    return dt.date.fromisoformat(str(value)[:10])


def upgrade() -> None:
    today = dt.date.today()

    # ① 평단가 — 모르면 비워둔다
    op.add_column("holding", sa.Column("avg_cost", sa.Float(), nullable=True))

    # ② 포트폴리오 단위 설정. 이미 있는 행을 채워야 해서 NOT NULL 칸에는 기본값을 준다.
    op.add_column(
        "user_settings",
        sa.Column("review_period", sa.String(), nullable=False, server_default=DEFAULT_PERIOD),
    )
    op.add_column("user_settings", sa.Column("review_date_override", sa.Date(), nullable=True))
    op.add_column("user_settings", sa.Column("cash", sa.JSON(), nullable=True))
    op.add_column(
        "user_settings",
        sa.Column("cash_target_pct", sa.Float(), nullable=False, server_default="0"),
    )
    _carry_review_settings(today)

    # ③ 리밸런싱 기록
    op.create_table(
        "rebalance_snapshot",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("taken_at", sa.DateTime(), nullable=False),
        sa.Column("review_date", sa.Date(), nullable=True),
        sa.Column("base_currency", sa.String(), nullable=False),
        sa.Column("total_value_base", sa.Float(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_rebalance_snapshot_user_id", "rebalance_snapshot", ["user_id"], unique=False
    )

    # ④ 매수 기록. 몇 줄을 버렸는지는 남긴다 — 백업에서 찾아야 할 때 단서가 된다.
    (total, confirmed), = _run(
        "SELECT count(*), sum(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)"
        " FROM buy_execution"
    ).fetchall()
    if total:
        applied = f" (확정 {confirmed}건은 이미 보유수량에 반영돼 있습니다)" if confirmed else ""
        logger.warning(
            "매수 기록 %d건을 지웁니다%s. 필요하면 마이그레이션 직전 백업에 남아 있습니다.",
            total,
            applied,
        )
    op.drop_table("buy_execution")

    # ⑤ 종목마다 있던 적립·리뷰 칸
    _drop_stock_columns()

    if _on_postgres():
        for name in OLD_ENUMS:
            _run(f"DROP TYPE IF EXISTS {name}")


def _carry_review_settings(today: dt.date) -> None:
    """종목마다 흩어져 있던 리뷰 주기·리뷰일을 사람마다 하나로 모은다 (위 설명)."""
    rows = _run(
        "SELECT user_id, active, rebalance_period, review_date_override FROM user_stock"
    ).fetchall()
    by_user: dict[int, list] = {}
    for user_id, active, period, override in rows:
        by_user.setdefault(user_id, []).append((bool(active), str(period), _as_date(override)))

    has_settings = {r[0] for r in _run("SELECT user_id FROM user_settings").fetchall()}

    for user_id, stocks in by_user.items():
        considered = [s for s in stocks if s[0]] or stocks
        counts = Counter(period for _, period, _ in considered)
        # 가장 많이 쓴 주기. 같으면 분기 (정렬 순서가 아니라 규칙으로 정한다)
        top = max(counts.values())
        tied = {period for period, n in counts.items() if n == top}
        period = DEFAULT_PERIOD if DEFAULT_PERIOD in tied else sorted(tied)[0]

        upcoming = sorted(o for _, _, o in considered if o is not None and o >= today)
        override = upcoming[0] if upcoming else None

        if user_id in has_settings:
            _run(
                "UPDATE user_settings SET review_period = :p, review_date_override = :o"
                " WHERE user_id = :u",
                p=period,
                o=override,
                u=user_id,
            )
        elif period != DEFAULT_PERIOD or override is not None:
            # 설정 행이 없으면 기본값을 쓰게 되는데, 그러면 그 사람이 고른 주기가 사라진다
            _run(
                "INSERT INTO user_settings (user_id, default_rebalance_band_pct, base_currency,"
                " review_period, review_date_override, cash_target_pct)"
                " VALUES (:u, :band, :base, :p, :o, 0)",
                u=user_id,
                band=DEFAULT_BAND,
                base=DEFAULT_BASE,
                p=period,
                o=override,
            )


def _drop_stock_columns() -> None:
    if _on_postgres():
        for column in DROPPED_STOCK_COLUMNS:
            op.drop_column("user_stock", column)
        return
    if sqlite3.sqlite_version_info >= (3, 35, 0):
        for column in DROPPED_STOCK_COLUMNS:
            _run(f"ALTER TABLE user_stock DROP COLUMN {column}")
        return
    # 아주 오래된 SQLite. 앱은 외래키 검사를 켜지 않으므로 옮겨 담아도 된다.
    with op.batch_alter_table("user_stock", recreate="always") as batch:
        for column in DROPPED_STOCK_COLUMNS:
            batch.drop_column(column)


# ---------------------------------------------------------------------------
#  내리기 — 모양만 되살린다. 지운 매수 기록과 적립 설정은 돌아오지 않는다.
# ---------------------------------------------------------------------------


def _old_enum(name: str):
    if _on_postgres():
        return postgresql.ENUM(*OLD_ENUMS[name], name=name, create_type=False)
    return sa.Enum(*OLD_ENUMS[name], name=name)


def downgrade() -> None:
    logger.warning("0006을 내립니다 — 평단가·현금·리밸런싱 기록은 버려지고, 매수 기록은 빈 표로 돌아옵니다")

    if _on_postgres():
        for name, values in OLD_ENUMS.items():
            postgresql.ENUM(*values, name=name).create(op.get_bind(), checkfirst=True)

    op.add_column(
        "user_stock",
        sa.Column("dca_amount", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "user_stock",
        sa.Column("dca_period", _old_enum("dcaperiod"), nullable=False, server_default="monthly"),
    )
    op.add_column(
        "user_stock",
        sa.Column(
            "rebalance_period",
            _old_enum("rebalanceperiod"),
            nullable=False,
            server_default="quarterly",
        ),
    )
    op.add_column("user_stock", sa.Column("review_date_override", sa.Date(), nullable=True))
    # 연 1회는 예전에 없던 값이다 — 가장 가까운 반기로 돌린다
    cast = "::rebalanceperiod" if _on_postgres() else ""
    _run(
        "UPDATE user_stock SET rebalance_period = (SELECT CASE WHEN s.review_period = 'quarterly'"
        f" THEN 'quarterly' ELSE 'semiannual' END{cast} FROM user_settings s"
        " WHERE s.user_id = user_stock.user_id)"
        " WHERE EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = user_stock.user_id)"
    )

    op.create_table(
        "buy_execution",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("exec_date", sa.Date(), nullable=False),
        sa.Column("type", _old_enum("buytype"), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("status", _old_enum("buystatus"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id", "ticker"], ["user_stock.user_id", "user_stock.ticker"]
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_buy_execution_ticker", "buy_execution", ["ticker"], unique=False)
    op.create_index("ix_buy_execution_user_id", "buy_execution", ["user_id"], unique=False)

    op.drop_index("ix_rebalance_snapshot_user_id", table_name="rebalance_snapshot")
    op.drop_table("rebalance_snapshot")

    for column in ("cash_target_pct", "cash", "review_date_override", "review_period"):
        _drop_column("user_settings", column)
    _drop_column("holding", "avg_cost")


def _drop_column(table: str, column: str) -> None:
    if _on_postgres() or sqlite3.sqlite_version_info < (3, 35, 0):
        with op.batch_alter_table(table) as batch:
            batch.drop_column(column)
    else:
        _run(f"ALTER TABLE {table} DROP COLUMN {column}")
