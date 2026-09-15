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


def _apply_additive_migrations() -> None:
    """이미 만들어진 SQLite 파일에 나중에 추가된 nullable 컬럼을 채워 넣는다.

    `create_all`은 기존 테이블에 컬럼을 추가해주지 않기 때문에, 사용자가 쓰던 DB 파일이
    새 버전에서 그대로 열리도록 여기서 `ALTER TABLE ... ADD COLUMN`을 직접 수행한다.
    (nullable 컬럼 추가만 다루므로 기존 데이터는 그대로 보존된다.)
    """
    expected: dict[str, dict[str, str]] = {
        "stocks": {"category": "VARCHAR"},
    }
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, columns in expected.items():
            if table not in existing_tables:
                continue  # create_all이 이미 최신 스키마로 만들어준다
            present = {col["name"] for col in inspector.get_columns(table)}
            for column, ddl_type in columns.items():
                if column not in present:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def init_db() -> None:
    from app import models  # noqa: F401  (ensure models are registered)

    _apply_additive_migrations()
    Base.metadata.create_all(bind=engine)
