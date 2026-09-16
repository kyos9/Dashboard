import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DB_PATH = os.environ.get("SIGNAL_DASHBOARD_DB", os.path.join(os.path.dirname(__file__), "..", "signal_dashboard.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _apply_additive_migrations(bind=None) -> None:
    """이미 만들어진 SQLite 파일에 나중에 추가된 nullable 컬럼을 채워 넣는다.

    `create_all`은 기존 테이블에 컬럼을 추가해주지 않기 때문에, 사용자가 쓰던 DB 파일이
    새 버전에서 그대로 열리도록 여기서 `ALTER TABLE ... ADD COLUMN`을 직접 수행한다.
    (nullable 컬럼 추가만 다루므로 기존 데이터는 그대로 보존된다.)

    `bind`로 다른 엔진을 넘길 수 있다 — 옛 스키마 파일로 이 경로를 테스트하기 위함이다.
    """
    bind = bind or engine
    expected: dict[str, dict[str, str]] = {
        "stocks": {
            "category": "VARCHAR",
            # NOT NULL 컬럼이지만 기존 행을 채워야 하므로 DEFAULT를 붙여 추가한다.
            # 실제 값은 아래 _backfill_stock_markets가 티커를 보고 다시 채운다.
            "market": "VARCHAR DEFAULT 'US' NOT NULL",
            "currency": "VARCHAR DEFAULT 'USD' NOT NULL",
            "sort_order": "INTEGER DEFAULT 0 NOT NULL",
        },
        "price_daily": {
            # 이 컬럼이 생기기 전에 저장된 행은 출처를 알 수 없으므로 nullable로 둔다
            "source": "VARCHAR",
        },
        "portfolio_settings": {
            "base_currency": "VARCHAR DEFAULT 'KRW' NOT NULL",
            "usd_krw_override": "FLOAT",
            "usd_krw_rate": "FLOAT",
            "usd_krw_updated_at": "DATETIME",
        },
    }
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    with bind.begin() as conn:
        for table, columns in expected.items():
            if table not in existing_tables:
                continue  # create_all이 이미 최신 스키마로 만들어준다
            present = {col["name"] for col in inspector.get_columns(table)}
            for column, ddl_type in columns.items():
                if column not in present:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def _backfill_stock_markets(bind=None) -> None:
    """기존에 등록된 종목의 시장/통화를 티커에서 다시 판별해 채운다.

    마이그레이션으로 추가된 컬럼은 전부 'US'/'USD'로 시작하므로, 이미 한국 종목을
    담고 있었다면 값이 틀린다. 티커가 곧 정답이라 매번 다시 계산해도 안전하다.
    """
    from app.markets import currency_of, market_of

    bind = bind or engine
    inspector = inspect(bind)
    if "stocks" not in set(inspector.get_table_names()):
        return

    with bind.begin() as conn:
        rows = conn.execute(text("SELECT ticker, market, currency FROM stocks")).fetchall()
        for ticker, market, currency in rows:
            expected_market = market_of(ticker).value
            expected_currency = currency_of(ticker).value
            if market == expected_market and currency == expected_currency:
                continue
            conn.execute(
                text("UPDATE stocks SET market = :m, currency = :c WHERE ticker = :t"),
                {"m": expected_market, "c": expected_currency, "t": ticker},
            )


def init_db(bind=None) -> None:
    from app import models  # noqa: F401  (ensure models are registered)

    bind = bind or engine
    _apply_additive_migrations(bind)
    Base.metadata.create_all(bind=bind)
    _backfill_stock_markets(bind)
