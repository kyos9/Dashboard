"""한 사람의 표를 사용자별로 쪼갠다 — 되돌릴 수 없는 유일한 리비전 (ROADMAP 4단계 2번).

지금까지 `stocks` 한 줄에는 두 가지가 섞여 있었다.

- **종목이 무엇인가** (이름·시장·통화) — 누가 보든 같다        -> `instrument` (공용)
- **그 종목을 얼마씩, 몇 %로 담나** — 사람마다 다르다          -> `user_stock` (사용자별)

시세·지표·시그널은 공용 쪽(`instrument`)에 매달리고, 보유수량·매수기록·설정은
사용자에게 붙는다. 로그인은 아직 없다. 쓰던 데이터는 전부 **1번 사용자**의 것이 된다.

순서: ①`users`+1번 → ②`instrument` → ③`user_stock` → ④`holding` → ⑤`buy_execution`
→ ⑥`user_settings` → ⑦공용 3표의 외래키 교체 → ⑧`stocks`·`portfolio_settings` 삭제.

**되돌릴 수 없는 이유.** 사용자가 둘이 되면 `user_stock` 여러 줄을 `stocks` 한 줄로
합칠 방법이 없다. downgrade는 사용자가 한 명일 때만 돌고, 둘 이상이면 **거절한다** —
조용히 한 사람 것만 남기는 것보다 못 내리는 게 낫다. 그래서 `app.migrate.IRREVERSIBLE`
에 이 리비전이 있고, 백업에 실패하면 시작하지 않는다.

**SQLite와 Postgres가 갈리는 자리가 둘 있다.**

1. 외래키를 바꾸는 방법. SQLite는 ALTER로 외래키를 못 바꾼다 — 표를 새로 만들어 옮겨
   담는다(`batch_alter_table`). 그런데 옛 외래키에 이름이 없어서 지정할 수가 없으므로,
   이름 규칙을 줘서 반영할 때 이름을 붙인다. Postgres는 이름으로 떼고 붙인다.
2. Enum 타입. Postgres는 Enum이 **DB에 따로 있는 타입**이라, 옛 표가 만든 `dcaperiod`
   같은 타입을 새 표가 그대로 쓴다. 새로 만들려 들면 "이미 있다"에서 멈춘다.

보유·매수기록은 작은 표라 읽어서 다시 넣는다. 기본키가 바뀌는데, 표를 이름만 바꿔
옮기는 방법은 Postgres에서 옛 기본키 이름(`holding_pkey`)이 그대로 남아 새 표와 부딪힌다.

Revision ID: 0005
Revises: 0004
"""

import datetime as dt
import logging

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")

# 쓰던 데이터의 주인. 로그인이 붙으면 주인의 구글 계정이 이 행에 연결된다(4-3).
OWNER_ID = 1

# SQLite 외래키에 이름을 붙이는 규칙 (위 1번). 옛 외래키는 이 규칙으로 이름을 얻는다.
SQLITE_NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}

SHARED_TABLES = ("price_daily", "indicator_daily", "signal_daily")

ENUMS = {
    "dcaperiod": ("monthly", "quarterly"),
    "rebalanceperiod": ("quarterly", "semiannual"),
    "buytype": ("signal", "fallback"),
    "buystatus": ("scheduled", "confirmed"),
}


def _on_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _enum(name: str):
    """이미 있는 Enum 타입을 가리킨다. Postgres에서 다시 만들지 않는다 (위 2번)."""
    if _on_postgres():
        return postgresql.ENUM(*ENUMS[name], name=name, create_type=False)
    return sa.Enum(*ENUMS[name], name=name)


def _run(sql: str, **params):
    return op.get_bind().execute(sa.text(sql), params)


def _bump_sequence(table: str, column: str = "id") -> None:
    """id를 직접 넣었으면 Postgres의 번호표를 그 뒤로 옮긴다.

    안 옮기면 다음에 새 행을 넣을 때 번호표가 1부터 다시 나와 이미 있는 id와 부딪힌다.
    SQLite는 가장 큰 id 다음을 쓰므로 할 일이 없다.
    """
    if not _on_postgres():
        return
    _run(
        f"SELECT setval(pg_get_serial_sequence('{table}', '{column}'),"
        f" COALESCE((SELECT max({column}) FROM {table}), 1),"
        f" (SELECT count(*) > 0 FROM {table}))"
    )


def _repoint_ticker_fk(table: str, old_parent: str, new_parent: str) -> None:
    """공용 표의 `ticker` 외래키를 `old_parent` -> `new_parent`로 옮긴다.

    옛 외래키가 **없을 수도 있다.** Alembic 이전에 만들어진 SQLite 파일은 이 표들을
    외래키 없이 만들었다. 있으면 떼고, 어느 쪽이든 새 것을 붙인다.
    """
    old = [
        fk
        for fk in sa.inspect(op.get_bind()).get_foreign_keys(table)
        if fk["referred_table"] == old_parent
    ]

    if _on_postgres():
        for fk in old:
            op.drop_constraint(fk["name"], table, type_="foreignkey")
        op.create_foreign_key(f"{table}_ticker_fkey", table, new_parent, ["ticker"], ["ticker"])
        return

    with op.batch_alter_table(table, recreate="always", naming_convention=SQLITE_NAMING) as batch:
        if old:
            batch.drop_constraint(f"fk_{table}_ticker_{old_parent}", type_="foreignkey")
        batch.create_foreign_key(
            f"fk_{table}_ticker_{new_parent}", new_parent, ["ticker"], ["ticker"]
        )


# ---------------------------------------------------------------------------
#  올리기
# ---------------------------------------------------------------------------


def upgrade() -> None:
    now = dt.datetime.utcnow()

    # ① 사람. 쓰던 데이터의 주인이 1번이다.
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("google_sub", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("session_epoch", sa.Integer(), nullable=False),
        sa.Column("is_owner", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("google_sub"),
    )
    _run(
        "INSERT INTO users (id, created_at, session_epoch, is_owner)"
        " VALUES (:id, :now, 0, :owner)",
        id=OWNER_ID,
        now=now,
        owner=True,
    )
    _bump_sequence("users")

    # ② 종목 — 공용 절반.
    op.create_table(
        "instrument",
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("market", sa.String(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("ticker"),
    )
    _run(
        "INSERT INTO instrument (ticker, name, market, currency)"
        " SELECT ticker, name, market, currency FROM stocks"
    )
    _adopt_orphan_prices()

    # ③ 내가 담은 종목 — 사용자별 절반. 이름도 여기로 온다(화면에 보이는 이름은 사람마다
    #    고쳐 쓸 수 있다). 공용 쪽 이름은 위에서 같은 값으로 채웠다.
    op.create_table(
        "user_stock",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.Column("dca_amount", sa.Float(), nullable=False),
        sa.Column("dca_period", _enum("dcaperiod"), nullable=False),
        sa.Column("rebalance_period", _enum("rebalanceperiod"), nullable=False),
        sa.Column("target_weight_pct", sa.Float(), nullable=False),
        sa.Column("rebalance_band_pct", sa.Float(), nullable=True),
        sa.Column("review_date_override", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["ticker"], ["instrument.ticker"]),
        sa.PrimaryKeyConstraint("user_id", "ticker"),
    )
    _run(
        "INSERT INTO user_stock (user_id, ticker, name, category, active, added_at,"
        " dca_amount, dca_period, rebalance_period, target_weight_pct, rebalance_band_pct,"
        " review_date_override, sort_order)"
        " SELECT :owner, ticker, name, category, active, added_at,"
        " dca_amount, dca_period, rebalance_period, target_weight_pct, rebalance_band_pct,"
        " review_date_override, sort_order FROM stocks",
        owner=OWNER_ID,
    )

    # ④ 보유수량 — 기본키가 (사용자, 티커)가 된다.
    holdings = _run(
        "SELECT ticker, quantity, updated_at FROM holding"
        " WHERE ticker IN (SELECT ticker FROM stocks)"
    ).fetchall()
    _warn_orphans("holding")
    op.drop_table("holding")
    _create_holding()
    for ticker, quantity, updated_at in holdings:
        _run(
            "INSERT INTO holding (user_id, ticker, quantity, updated_at)"
            " VALUES (:owner, :ticker, :quantity, :updated_at)",
            owner=OWNER_ID,
            ticker=ticker,
            quantity=quantity,
            updated_at=updated_at,
        )

    # ⑤ 매수기록 — 사용자가 붙는다. id는 그대로 옮긴다(화면이 id로 확정 버튼을 부른다).
    buys = _run(
        "SELECT id, ticker, period_start, period_end, exec_date, type, amount, status,"
        " confirmed_at FROM buy_execution WHERE ticker IN (SELECT ticker FROM stocks)"
    ).fetchall()
    _warn_orphans("buy_execution")
    op.drop_table("buy_execution")
    _create_buy_execution()
    for row in buys:
        _run(
            "INSERT INTO buy_execution (id, user_id, ticker, period_start, period_end,"
            " exec_date, type, amount, status, confirmed_at)"
            " VALUES (:id, :owner, :ticker, :period_start, :period_end, :exec_date,"
            f" {_cast('type', 'buytype')}, :amount, {_cast('status', 'buystatus')},"
            " :confirmed_at)",
            owner=OWNER_ID,
            **row._mapping,
        )
    _bump_sequence("buy_execution")

    # ⑥ 설정 — 한 줄짜리 표가 사람마다 한 줄이 된다.
    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("default_rebalance_band_pct", sa.Float(), nullable=False),
        sa.Column("base_currency", sa.String(), nullable=False),
        sa.Column("fx_overrides", sa.JSON(), nullable=True),
        sa.Column("pinned_macro", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )
    # SQL 안에서 옮긴다 — JSON을 파이썬으로 꺼냈다 넣으면 드라이버마다 모양이 달라진다.
    _run(
        "INSERT INTO user_settings"
        " (user_id, default_rebalance_band_pct, base_currency, fx_overrides, pinned_macro)"
        " SELECT :owner, default_rebalance_band_pct, base_currency, fx_overrides, pinned_macro"
        " FROM portfolio_settings WHERE id = (SELECT min(id) FROM portfolio_settings)",
        owner=OWNER_ID,
    )

    # ⑦ 시세·지표·시그널은 이제 공용 종목에 매달린다.
    for table in SHARED_TABLES:
        _repoint_ticker_fk(table, "stocks", "instrument")

    # ⑧ 옛 표. 가리키는 곳이 하나도 남지 않은 뒤에 지운다.
    op.drop_table("portfolio_settings")
    op.drop_table("stocks")


def _cast(param: str, enum_name: str) -> str:
    """Postgres는 글자를 Enum 칸에 넣을 때 타입을 밝혀야 한다."""
    return f"CAST(:{param} AS {enum_name})" if _on_postgres() else f":{param}"


def _adopt_orphan_prices() -> None:
    """`stocks`에 없는 티커의 시세가 있으면 공용 종목 행을 만들어준다.

    Postgres는 외래키를 늘 검사하므로 이런 행이 없다. 하지만 개인 PC의 SQLite는 외래키를
    검사하지 않아서, 예전 버전에서 종목만 지워진 채 시세가 남았을 수 있다. 공용 데이터라
    누구 것도 아니므로 버리지 않고 종목 행을 붙여준다 — 화면에는 안 보인다.
    """
    from app.markets import currency_of, market_of

    for table in SHARED_TABLES:
        rows = _run(
            f"SELECT DISTINCT ticker FROM {table}"
            " WHERE ticker NOT IN (SELECT ticker FROM instrument)"
        ).fetchall()
        for (ticker,) in rows:
            _run(
                "INSERT INTO instrument (ticker, name, market, currency)"
                " VALUES (:ticker, NULL, :market, :currency)",
                ticker=ticker,
                market=market_of(ticker).value,
                currency=currency_of(ticker).value,
            )
        if rows:
            logger.warning("%s: 종목 목록에 없던 티커 %d개에 공용 종목 행을 붙였습니다", table, len(rows))


def _warn_orphans(table: str) -> None:
    """내 종목 목록에 없는 티커의 보유·매수기록은 옮기지 않는다 — 조용히 넘어가지는 않는다.

    이런 행은 SQLite에서만 생길 수 있고(위와 같은 이유) 화면 어디에서도 보이지 않던
    것이다. 새 표는 "내 목록에 있는 종목의 기록"만 받는다. 원본은 마이그레이션 직전
    백업에 남아 있다.
    """
    count = _run(
        f"SELECT count(*) FROM {table} WHERE ticker NOT IN (SELECT ticker FROM stocks)"
    ).scalar()
    if count:
        logger.warning(
            "%s: 종목 목록에 없는 티커의 행 %d개는 옮기지 않았습니다 (직전 백업에 남아 있습니다)",
            table,
            count,
        )


def _create_holding() -> None:
    op.create_table(
        "holding",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id", "ticker"], ["user_stock.user_id", "user_stock.ticker"]
        ),
        sa.PrimaryKeyConstraint("user_id", "ticker"),
    )


def _create_buy_execution() -> None:
    op.create_table(
        "buy_execution",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("exec_date", sa.Date(), nullable=False),
        sa.Column("type", _enum("buytype"), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("status", _enum("buystatus"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id", "ticker"], ["user_stock.user_id", "user_stock.ticker"]
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_buy_execution_ticker", "buy_execution", ["ticker"], unique=False)
    op.create_index("ix_buy_execution_user_id", "buy_execution", ["user_id"], unique=False)


# ---------------------------------------------------------------------------
#  내리기 — 사용자가 한 명일 때만
# ---------------------------------------------------------------------------


def downgrade() -> None:
    _refuse_if_more_than_one_user()
    now = dt.datetime.utcnow()

    op.create_table(
        "stocks",
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("market", sa.String(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.Column("dca_amount", sa.Float(), nullable=False),
        sa.Column("dca_period", _enum("dcaperiod"), nullable=False),
        sa.Column("rebalance_period", _enum("rebalanceperiod"), nullable=False),
        sa.Column("target_weight_pct", sa.Float(), nullable=False),
        sa.Column("rebalance_band_pct", sa.Float(), nullable=True),
        sa.Column("review_date_override", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("ticker"),
    )
    _run(
        "INSERT INTO stocks (ticker, name, category, market, currency, active, added_at,"
        " dca_amount, dca_period, rebalance_period, target_weight_pct, rebalance_band_pct,"
        " review_date_override, sort_order)"
        " SELECT us.ticker, us.name, us.category, i.market, i.currency, us.active, us.added_at,"
        " us.dca_amount, us.dca_period, us.rebalance_period, us.target_weight_pct,"
        " us.rebalance_band_pct, us.review_date_override, us.sort_order"
        " FROM user_stock us JOIN instrument i ON i.ticker = us.ticker"
    )
    # 아무도 안 담은 공용 종목(시세만 남은 것)은 옛 모양에서는 "치워둔 종목"이었다.
    _run(
        "INSERT INTO stocks (ticker, name, category, market, currency, active, added_at,"
        " dca_amount, dca_period, rebalance_period, target_weight_pct, rebalance_band_pct,"
        " review_date_override, sort_order)"
        f" SELECT ticker, name, NULL, market, currency, :inactive, :now, 0,"
        f" {_literal_enum('monthly', 'dcaperiod')}, {_literal_enum('quarterly', 'rebalanceperiod')},"
        " 0, NULL, NULL, 0 FROM instrument"
        " WHERE ticker NOT IN (SELECT ticker FROM user_stock)",
        inactive=False,
        now=now,
    )

    op.create_table(
        "portfolio_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("default_rebalance_band_pct", sa.Float(), nullable=False),
        sa.Column("base_currency", sa.String(), nullable=False),
        sa.Column("fx_overrides", sa.JSON(), nullable=True),
        sa.Column("pinned_macro", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    _run(
        "INSERT INTO portfolio_settings"
        " (id, default_rebalance_band_pct, base_currency, fx_overrides, pinned_macro)"
        " SELECT 1, default_rebalance_band_pct, base_currency, fx_overrides, pinned_macro"
        " FROM user_settings WHERE user_id = :owner",
        owner=OWNER_ID,
    )

    holdings = _run("SELECT ticker, quantity, updated_at FROM holding").fetchall()
    op.drop_table("holding")
    op.create_table(
        "holding",
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticker"], ["stocks.ticker"]),
        sa.PrimaryKeyConstraint("ticker"),
    )
    for ticker, quantity, updated_at in holdings:
        _run(
            "INSERT INTO holding (ticker, quantity, updated_at)"
            " VALUES (:ticker, :quantity, :updated_at)",
            ticker=ticker,
            quantity=quantity,
            updated_at=updated_at,
        )

    buys = _run(
        "SELECT id, ticker, period_start, period_end, exec_date, type, amount, status,"
        " confirmed_at FROM buy_execution"
    ).fetchall()
    op.drop_table("buy_execution")
    op.create_table(
        "buy_execution",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ticker", sa.String(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("exec_date", sa.Date(), nullable=False),
        sa.Column("type", _enum("buytype"), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("status", _enum("buystatus"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["ticker"], ["stocks.ticker"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_buy_execution_ticker", "buy_execution", ["ticker"], unique=False)
    for row in buys:
        _run(
            "INSERT INTO buy_execution (id, ticker, period_start, period_end, exec_date,"
            f" type, amount, status, confirmed_at) VALUES (:id, :ticker, :period_start,"
            f" :period_end, :exec_date, {_cast('type', 'buytype')}, :amount,"
            f" {_cast('status', 'buystatus')}, :confirmed_at)",
            **row._mapping,
        )
    _bump_sequence("buy_execution")

    for table in SHARED_TABLES:
        _repoint_ticker_fk(table, "instrument", "stocks")

    op.drop_table("user_settings")
    op.drop_table("user_stock")
    op.drop_table("instrument")
    op.drop_table("users")


def _literal_enum(value: str, enum_name: str) -> str:
    return f"CAST('{value}' AS {enum_name})" if _on_postgres() else f"'{value}'"


def _refuse_if_more_than_one_user() -> None:
    """두 사람 이상의 데이터를 한 사람 모양으로 접으면 누군가의 것이 사라진다."""
    users = _run("SELECT count(*) FROM users").scalar()
    others = sum(
        _run(f"SELECT count(*) FROM {table} WHERE user_id <> :owner", owner=OWNER_ID).scalar()
        for table in ("user_stock", "holding", "buy_execution", "user_settings")
    )
    if users > 1 or others:
        raise RuntimeError(
            f"사용자가 {users}명이라 0005 이전으로 되돌릴 수 없습니다. "
            "한 사람 모양의 표로 접으면 나머지 사람의 종목·보유·매수기록이 사라집니다. "
            "되돌려야 한다면 마이그레이션 직전 백업에서 복구하세요 (DEPLOY.md)."
        )
