"""DB 연결 설정.

접속 주소는 **`DATABASE_URL` 하나로 받는다.** 예전에는 SQLite 파일 경로만 받아
`sqlite:///{경로}`로 조립했는데, 그러면 Postgres를 쓸 방법이 아예 없었다. 로컬은
SQLite 파일 하나로 두고, 서버는 Postgres를 쓰는 게 목표라 주소를 통째로 받는다.

- `DATABASE_URL=postgresql+psycopg://user:pw@host/db`  (서버)
- `DATABASE_URL=sqlite:////data/signal_dashboard.db`   (파일 위치만 옮기고 싶을 때)
- 아무것도 없으면 예전과 같은 자리의 SQLite 파일  (개인 PC)

`SIGNAL_DASHBOARD_DB`(파일 경로)도 계속 받는다 — 쓰던 설정이 조용히 무시되면
엉뚱한 빈 DB가 열리고, 사용자는 데이터가 사라진 줄 안다.
"""

import os
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "signal_dashboard.db"


def database_url() -> str:
    """이번 실행이 쓸 접속 주소."""
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return _normalize(url)
    path = os.environ.get("SIGNAL_DASHBOARD_DB") or str(DEFAULT_DB_PATH)
    return f"sqlite:///{path}"


def _normalize(url: str) -> str:
    """관리형 Postgres가 나눠주는 주소를 SQLAlchemy가 받는 형태로 맞춘다.

    많은 호스팅이 `postgres://`로 시작하는 주소를 주는데, SQLAlchemy 2.0은 이 접두사를
    모른다고 거절한다. 사용자가 받은 주소를 그대로 붙여넣을 수 있어야 하므로 여기서 바꾼다.
    드라이버를 따로 안 적은 `postgresql://`도 psycopg(v3)로 고정한다 — 안 그러면
    설치하지도 않은 psycopg2를 찾는다.
    """
    scheme = urlsplit(url).scheme
    if scheme == "postgres":
        return "postgresql+psycopg://" + url.split("://", 1)[1]
    if scheme == "postgresql":
        return "postgresql+psycopg://" + url.split("://", 1)[1]
    return url


def sqlite_file(url: str | None = None) -> Path | None:
    """SQLite 주소면 그 파일 경로를, 아니면 None. (백업이 어느 방식을 쓸지 고른다.)"""
    parsed = make_url(url or database_url())
    if not parsed.drivername.startswith("sqlite"):
        return None
    if not parsed.database or parsed.database == ":memory:":
        return None
    return Path(parsed.database)


def engine_options(url: str) -> dict:
    if url.startswith("sqlite"):
        # 스케줄러 스레드와 요청 스레드가 같은 연결을 쓴다
        return {"connect_args": {"check_same_thread": False}}
    # 서버 DB는 유휴 연결이 방화벽·프록시에 끊긴 뒤에도 커넥션 풀에 남아 있다.
    # 꺼내 쓰기 전에 한 번 찔러보지 않으면 첫 요청이 항상 실패한다.
    return {"pool_pre_ping": True}


DATABASE_URL = database_url()
engine = create_engine(DATABASE_URL, **engine_options(DATABASE_URL))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
#  Alembic 이전에 쓰던 DB를 이어받는 자리
#
#  아래 세 함수는 **끝난 코드다. 여기에 더 붙이지 않는다.** 앞으로의 스키마·데이터
#  변경은 전부 migrations/versions/ 에 리비전으로 넣는다. 이 자리는 "Alembic을 알기
#  전에 만들어진 DB 파일"을 0001 상태까지 데려오는 일만 한다 (app.migrate 참고).
# ---------------------------------------------------------------------------


# 0001 리비전이 아는 테이블 전부. **여기에 새 테이블을 더하지 않는다** —
# 0002 이후에 생기는 테이블은 각자의 리비전이 만든다.
TABLES_AT_0001 = (
    "krx_listing",
    "portfolio_settings",
    "stocks",
    "buy_execution",
    "holding",
    "indicator_daily",
    "price_daily",
    "signal_daily",
)


def _apply_additive_migrations(bind) -> None:
    """옛 DB 파일에 나중에 추가된 컬럼을 채워 넣는다.

    `create_all`은 기존 테이블에 컬럼을 추가해주지 않기 때문에, 사용자가 쓰던 DB 파일이
    새 버전에서 그대로 열리도록 `ALTER TABLE ... ADD COLUMN`을 직접 수행한다.
    (nullable 컬럼 추가만 다루므로 기존 데이터는 그대로 보존된다.)
    """
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
                continue  # 이 테이블은 처음부터 최신 스키마로 만들어진다
            present = {col["name"] for col in inspector.get_columns(table)}
            for column, ddl_type in columns.items():
                if column not in present:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def _backfill_stock_markets(bind) -> None:
    """기존에 등록된 종목의 시장/통화를 티커에서 다시 판별해 채운다.

    위에서 추가된 컬럼은 전부 'US'/'USD'로 시작하므로, 이미 한국 종목을 담고 있었다면
    값이 틀린다. 틀린 채로 두면 원화 종목이 달러로 잡혀 비중이 통째로 어긋난다.
    """
    from app.markets import currency_of, market_of

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


def _rename_buy_status(bind) -> None:
    """예전 DB에 저장된 buy_execution.status = 'recommended'를 'scheduled'로 바꾼다.

    이름만 바뀐 것이고 뜻은 그대로다 — "아직 매수완료 확인을 안 한 건". 이 앱은 종목을
    고르지도 사라고 권하지도 않는데 '추천'이라는 말이 동작보다 앞서 나가 있었다.
    """
    inspector = inspect(bind)
    if "buy_execution" not in set(inspector.get_table_names()):
        return
    with bind.begin() as conn:
        conn.execute(
            text("UPDATE buy_execution SET status = 'scheduled' WHERE status = 'recommended'")
        )


def adopt_pre_alembic_database(bind=None) -> None:
    """Alembic을 모르는 DB 파일을 0001 상태까지 데려온다.

    `app.migrate`가 **딱 한 번** 부른다 — 그 뒤로는 `alembic_version`이 남으므로
    두 번 다시 이 경로를 타지 않는다. 그래도 각 단계는 여러 번 돌려도 안전하게 짜여
    있다 (중간에 꺼졌다 다시 켜질 수 있으므로).
    """
    bind = bind or engine
    _apply_additive_migrations(bind)
    # 옛 파일에는 아예 없던 테이블(krx_listing 등)이 있다. 0001은 도장만 찍고 넘어갈
    # 참이라 여기서 만들어두지 않으면 영영 안 만들어진다.
    #
    # **0001이 아는 테이블만 만든다.** 모델 전체를 만들면 그 뒤 리비전이 만들 테이블까지
    # 미리 생겨서, 이어지는 업그레이드가 "이미 있다"에서 멈춘다. 이 경로가 하는 일은
    # 어디까지나 "옛 파일을 0001까지 데려오기"다.
    Base.metadata.create_all(
        bind=bind,
        tables=[Base.metadata.tables[name] for name in TABLES_AT_0001 if name in Base.metadata.tables],
    )
    _backfill_stock_markets(bind)
    _rename_buy_status(bind)


def init_db(bind=None) -> None:
    """앱이 뜰 때 DB를 최신 스키마로 맞춘다."""
    from app import models  # noqa: F401  (모든 테이블이 Base.metadata에 등록되도록)
    from app.migrate import upgrade_to_head

    upgrade_to_head(bind or engine)
