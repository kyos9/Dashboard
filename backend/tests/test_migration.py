"""기존 DB 파일이 새 스키마로 올라오는지.

사용자는 이미 종목과 보유수량이 들어 있는 `signal_dashboard.db`를 쓰고 있다.
업데이트 후 앱이 안 뜨거나 데이터가 사라지면 복구할 방법이 없으므로, 옛 스키마에서
올라오는 경로를 직접 재현해 검증한다.
"""

import sqlite3

import pytest
from sqlalchemy import create_engine, text

# 통화/시장 컬럼이 없던 시절의 스키마
OLD_SCHEMA = """
CREATE TABLE stocks (
  ticker VARCHAR NOT NULL PRIMARY KEY,
  name VARCHAR,
  active BOOLEAN NOT NULL,
  added_at DATETIME NOT NULL,
  dca_amount FLOAT NOT NULL,
  dca_period VARCHAR NOT NULL,
  rebalance_period VARCHAR NOT NULL,
  target_weight_pct FLOAT NOT NULL,
  rebalance_band_pct FLOAT,
  review_date_override DATE
);
CREATE TABLE portfolio_settings (
  id INTEGER NOT NULL PRIMARY KEY,
  default_rebalance_band_pct FLOAT NOT NULL
);
CREATE TABLE holding (
  ticker VARCHAR NOT NULL PRIMARY KEY,
  quantity FLOAT NOT NULL,
  updated_at DATETIME NOT NULL
);
"""

OLD_ROWS = """
INSERT INTO stocks VALUES
  ('VOO','S&P500 ETF',1,'2026-01-01 00:00:00',300,'monthly','quarterly',60,NULL,NULL),
  ('005930.KS','삼성전자',1,'2026-01-01 00:00:00',500000,'monthly','quarterly',40,3.0,'2026-06-30'),
  ('247540.KQ','에코프로비엠',0,'2026-01-01 00:00:00',0,'monthly','quarterly',0,NULL,NULL);
INSERT INTO portfolio_settings VALUES (1, 7.5);
INSERT INTO holding VALUES ('VOO', 12.5, '2026-01-01 00:00:00'), ('005930.KS', 100, '2026-01-01 00:00:00');
"""


@pytest.fixture()
def upgraded(tmp_path):
    """옛 DB 파일을 만들고 init_db()를 태운 뒤 연결을 돌려준다."""
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript(OLD_SCHEMA)
    con.executescript(OLD_ROWS)
    con.commit()
    con.close()

    from app.db import init_db

    engine = create_engine(f"sqlite:///{path}")
    init_db(bind=engine)
    with engine.connect() as conn:
        yield conn
    engine.dispose()


def test_existing_rows_survive_upgrade(upgraded):
    conn = upgraded
    rows = conn.execute(
        text("SELECT ticker, name, target_weight_pct, rebalance_band_pct FROM stocks ORDER BY ticker")
    ).fetchall()

    assert rows == [
        ("005930.KS", "삼성전자", 40.0, 3.0),
        ("247540.KQ", "에코프로비엠", 0.0, None),
        ("VOO", "S&P500 ETF", 60.0, None),
    ]


def test_holdings_and_settings_survive_upgrade(upgraded):
    conn = upgraded
    holdings = dict(
        conn.execute(text("SELECT ticker, quantity FROM holding")).fetchall()
    )
    assert holdings == {"VOO": 12.5, "005930.KS": 100.0}

    band = conn.execute(
        text("SELECT default_rebalance_band_pct FROM portfolio_settings")
    ).scalar()
    assert band == 7.5


def test_market_and_currency_are_backfilled_from_ticker(upgraded):
    """컬럼 기본값은 US/USD라, 이미 있던 한국 종목이 달러로 잡히면 비중이 틀어진다."""
    conn = upgraded
    rows = {
        r[0]: (r[1], r[2])
        for r in conn.execute(text("SELECT ticker, market, currency FROM stocks")).fetchall()
    }

    assert rows["005930.KS"] == ("KR", "KRW")
    assert rows["247540.KQ"] == ("KR", "KRW")
    assert rows["VOO"] == ("US", "USD")


def test_new_currency_settings_get_defaults(upgraded):
    conn = upgraded
    row = conn.execute(
        text(
            "SELECT base_currency, usd_krw_override, usd_krw_rate FROM portfolio_settings"
        )
    ).fetchone()
    assert row == ("KRW", None, None)


def test_new_tables_are_created(upgraded):
    conn = upgraded
    tables = {
        r[0]
        for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }
    assert "krx_listing" in tables


def test_upgrade_is_idempotent(tmp_path):
    """앱을 다시 켤 때마다 init_db가 돌아도 데이터가 달라지면 안 된다."""
    from app.db import init_db

    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript(OLD_SCHEMA)
    con.executescript(OLD_ROWS)
    con.commit()
    con.close()

    engine = create_engine(f"sqlite:///{path}")
    try:
        for _ in range(3):
            init_db(bind=engine)
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM stocks")).scalar() == 3
            assert conn.execute(text("SELECT count(*) FROM holding")).scalar() == 2
            columns = [
                r[1] for r in conn.execute(text("PRAGMA table_info(stocks)")).fetchall()
            ]
            # 같은 컬럼이 두 번 붙지 않았다
            assert len(columns) == len(set(columns))
    finally:
        engine.dispose()


def test_fresh_database_starts_with_full_schema(tmp_path):
    """새로 시작하는 사용자도 같은 스키마를 얻어야 한다."""
    from app.db import init_db

    engine = create_engine(f"sqlite:///{tmp_path / 'new.db'}")
    try:
        init_db(bind=engine)
        with engine.connect() as conn:
            columns = {
                r[1] for r in conn.execute(text("PRAGMA table_info(stocks)")).fetchall()
            }
            assert {"market", "currency", "category"} <= columns
    finally:
        engine.dispose()
