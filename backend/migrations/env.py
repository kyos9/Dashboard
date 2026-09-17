"""Alembic 실행 환경.

접속 주소와 모델은 앱과 같은 것을 쓴다. 여기서 따로 정의하면 앱이 보는 DB와
마이그레이션이 고치는 DB가 갈라진다.

프로그램에서 부를 때(`app.migrate`)는 이미 열어둔 연결을 `config.attributes`로
넘긴다 — 같은 연결 안에서 돌아야 테스트에서 임시 DB를 겨냥할 수 있다.
"""

from alembic import context
from sqlalchemy import create_engine

import app.models  # noqa: F401  (모든 테이블이 Base.metadata에 등록되도록)
from app.db import Base, database_url, engine_options

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or database_url()


def run_migrations_offline() -> None:
    url = _url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite는 ALTER TABLE이 거의 없다. batch 모드는 임시 테이블로 복사해 바꾸는
        # 방식이라, 컬럼 삭제·타입 변경이 SQLite에서도 돌아간다.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return

    url = _url()
    connectable = create_engine(url, **engine_options(url))
    with connectable.connect() as conn:
        _run(conn)
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
