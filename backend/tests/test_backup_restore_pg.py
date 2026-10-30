"""운영 DB(Postgres) 백업을 **실제로 되돌려 본다** (0.46.0 A1, 제로베이스 점검 7번).

다른 시험의 `pg_dump` 는 늘 가짜다. 되돌리기는 PG16 에서 손으로 한 번 해 본 것이 전부였고(DEPLOY 10-1), 운영은 PG17 이다.
"한 번도 되돌려보지 않은 백업은 백업이 아니다" — 그래서 CI 의 Postgres 갈래가 매번 한다:

1. 새 데이터베이스 둘(원본·부을 곳)을 만든다 — `signal` 은 다른 시험이 시험마다 비운다.
2. 원본을 앱이 뜨는 길(`init_db`)로 만들고 **모든 표**에 줄을 넣는다. 글자에는 따옴표·역슬래시·탭·줄바꿈·한글, 숫자에는 1/3,
   JSON 에는 한글을 — 덤프(COPY)가 이스케이프를 틀리면 여기서 드러난다. 줄을 안 넣은 표가 있으면 실패한다(새 표가 생기면
   이 시험이 먼저 안다).
3. 앱의 길 그대로 `backup.create_backup()`(진짜 pg_dump) → **DEPLOY 10-1 의 명령 그대로** 붓는다
   (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` 뒤 `psql -v ON_ERROR_STOP=1 < 덤프`).
   CI 는 운영처럼 DB 컨테이너 안의 psql 로 붓는다(`PG_RESTORE_PSQL`, tests.yml).
4. 표마다 줄 수·내용 해시, `alembic_version`, 시퀀스(새 줄이 옛 id 와 부딪히지 않는지)를 견준다. 그 **뒤에** 되돌린 DB 로 앱이
   마이그레이션 없이 뜨는지 본다(먼저 부르면 시드·치우기가 견줄 값을 바꾼다).

도구가 없거나 판이 안 맞으면: 로컬에서는 건너뛰고, CI(`REQUIRE_PG_RESTORE=1`)에서는 **실패**한다 — 건너뛴 시험은 아무것도 지키지 않는다.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import shlex
import shutil
import subprocess
import uuid

import pytest
from sqlalchemy import Boolean, Date, DateTime, Float, Integer, JSON, String, create_engine, inspect, make_url, text
from sqlalchemy.engine import URL

import app.models  # noqa: F401
from app.db import Base, init_db
from app.services import backup
from tests import dbsetup

REQUIRED = os.environ.get("REQUIRE_PG_RESTORE", "").strip() == "1"
TRICKY = "값 '따옴표' \"큰\" \\역슬래시\t탭\n줄바꿈 ☃"
ROWS = 3


def _skip_or_fail(reason: str):
    if REQUIRED:
        pytest.fail(f"REQUIRE_PG_RESTORE=1 인데 되돌리기 시험을 할 수 없습니다: {reason}")
    pytest.skip(reason)


@pytest.fixture()
def databases():
    if not dbsetup.on_postgres():
        _skip_or_fail("Postgres 갈래가 아니다(TEST_DATABASE_URL)")
    if shutil.which("pg_dump") is None:
        _skip_or_fail("pg_dump 가 없다")
    base = make_url(dbsetup.TEST_DATABASE_URL)
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    server_major = int(admin.connect().execute(text("SHOW server_version_num")).scalar()) // 10000
    client = subprocess.run(["pg_dump", "--version"], capture_output=True, text=True).stdout
    found = re.search(r"\(PostgreSQL\)\s+(\d+)", client)
    if found is None:
        _skip_or_fail(f"pg_dump 판을 읽지 못했다: {client!r}")
    client_major = int(found.group(1))
    if client_major != server_major:
        # 운영에서는 이미지 안의 pg_dump 와 compose 의 postgres 가 같은 큰 판이다(Dockerfile PG_MAJOR) — 시험도 같게
        _skip_or_fail(f"pg_dump {client_major} ≠ 서버 {server_major}")
    suffix = uuid.uuid4().hex[:8]
    names = {"src": f"restore_src_{suffix}", "dst": f"restore_dst_{suffix}"}
    with admin.connect() as conn:
        for name in names.values():
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    urls = {key: base.set(database=name) for key, name in names.items()}
    try:
        yield urls
    finally:
        with admin.connect() as conn:
            for name in names.values():
                conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


# ---------------------------------------------------------------------------
#  모든 표에 줄 넣기
# ---------------------------------------------------------------------------


def _value(column, i: int):
    kind = column.type
    if isinstance(kind, Boolean):
        return i % 2 == 0
    if isinstance(kind, Integer):
        return 1000 + i
    if isinstance(kind, Float):
        return (i + 1) / 3 * 1_000_003.7
    if isinstance(kind, DateTime):
        return dt.datetime(2026, 10, 1 + i, 23, 30, 15, 123456)
    if isinstance(kind, Date):
        return dt.date(2026, 9, 1 + i)
    if isinstance(kind, JSON):
        return {"한글": [i, 1 / 3, None, TRICKY], "중첩": {"k": True}}
    if isinstance(kind, String):
        value = f"{column.name}-{i} {TRICKY}"
        return value[: kind.length] if kind.length else value
    raise AssertionError(f"모르는 칼럼 종류 {column.table.name}.{column.name}: {kind!r} — 이 시험에 넣는 값을 더하세요")


def _serial(column) -> bool:
    return column.primary_key and isinstance(column.type, Integer) and column.autoincrement in (True, "auto") \
        and len(column.table.primary_key.columns) == 1


def _fill(engine) -> dict[str, int]:
    """모델의 모든 표에 ROWS 줄씩 — 외래키는 부모의 i 번째 줄을 가리킨다. 마지막 줄은 비워도 되는 칸을 비운다."""
    inserted: dict[str, list[dict]] = {}
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = conn.execute(table.select()).mappings().all()
            rows = []
            for i in range(ROWS):
                # 번호 칸(정수 기본 키)은 DB 가 시퀀스로 준다 — 앱이 넣는 길과 같게. 손으로 주면 시퀀스가 안 움직여 아래 시퀀스 검사가 헛돈다
                row = {c.name: _value(c, i) for c in table.columns if not c.foreign_keys and not _serial(c)}
                for fk in table.foreign_key_constraints:
                    parent = fk.referred_table.name
                    source = inserted.get(parent) or []
                    assert source, f"{table.name} 의 부모 {parent} 에 줄이 없다"
                    picked = source[i % len(source)]
                    for col, element in zip(fk.columns, fk.elements):
                        row[col.name] = picked[element.column.name]
                if i == ROWS - 1:
                    for c in table.columns:
                        if c.nullable and not c.primary_key and not c.foreign_keys:
                            row[c.name] = None
                if any(all(r.get(k) == row.get(k) for k in table.primary_key.columns.keys()) for r in existing):
                    continue  # 시드(매크로 지표 목록)와 같은 키 — 시드 줄이 이미 있다
                rows.append(row)
            if rows:
                conn.execute(table.insert(), rows)
            inserted[table.name] = [dict(r) for r in conn.execute(table.select()).mappings().all()]
    return {name: len(rows) for name, rows in inserted.items()}


def _fingerprint(engine) -> dict[str, tuple[int, str]]:
    """표마다 (줄 수, 기본 키 순 내용의 md5) — 서버가 글자로 만들어 견준다(소수·JSON 을 파이썬에서 견주다 헤매지 않게)."""
    out = {}
    insp = inspect(engine)
    with engine.connect() as conn:
        for name in insp.get_table_names():
            pk = insp.get_pk_constraint(name)["constrained_columns"] or [
                c["name"] for c in insp.get_columns(name)
            ]
            order = ", ".join(f't."{c}"' for c in pk)
            count, digest = conn.execute(
                text(f'SELECT count(*), md5(coalesce(string_agg(t::text, \',\' ORDER BY {order}), \'\')) FROM "{name}" t')
            ).one()
            out[name] = (count, digest)
    return out


# ---------------------------------------------------------------------------
#  붓기 — DEPLOY 10-1 그대로
# ---------------------------------------------------------------------------


def _psql(url: URL, *args: str, stdin=None) -> subprocess.CompletedProcess:
    """CI 는 `PG_RESTORE_PSQL="docker exec -i <db 컨테이너> psql -U postgres"` — 운영처럼 DB 쪽 psql 로 붓는다."""
    env = dict(os.environ)
    prefix = os.environ.get("PG_RESTORE_PSQL", "").strip()
    if prefix:
        command = shlex.split(prefix)
    else:
        if shutil.which("psql") is None:
            _skip_or_fail("psql 이 없다")
        command = ["psql", "-h", url.host or "localhost", "-p", str(url.port or 5432), "-U", url.username or "postgres"]
        if url.password:
            env["PGPASSWORD"] = url.password
    return subprocess.run(
        [*command, "-d", url.database, "-q", *args], stdin=stdin, capture_output=True, text=True, env=env, timeout=300,
    )


def _restore(url: URL, dump) -> None:
    wiped = _psql(url, "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    assert wiped.returncode == 0, wiped.stderr
    with open(dump, encoding="utf-8") as f:
        poured = _psql(url, "-v", "ON_ERROR_STOP=1", stdin=f)
    assert poured.returncode == 0, poured.stderr


def test_a_real_backup_restores_to_the_same_database(databases, tmp_path):
    src = create_engine(databases["src"])
    dst = create_engine(databases["dst"])
    try:
        init_db(src)
        counts = _fill(src)
        empty = [name for name in inspect(src).get_table_names() if name != "alembic_version" and not counts.get(name)]
        assert not empty, f"줄을 넣지 않은 표: {empty} — 이 시험의 _fill 이 모르는 표다(마이그레이션에만 있는 표?)"
        before = _fingerprint(src)

        dump = backup.create_backup(url=databases["src"].render_as_string(hide_password=False), backup_dir=tmp_path / "b")
        assert backup.dump_is_complete(dump)
        _restore(databases["dst"], dump)

        after = _fingerprint(dst)
        assert after.keys() == before.keys()
        different = {name: (before[name], after[name]) for name in before if before[name] != after[name]}
        assert not different, different
        with src.connect() as a, dst.connect() as b:
            version = "SELECT version_num FROM alembic_version"
            assert a.execute(text(version)).scalar() == b.execute(text(version)).scalar()

        # 시퀀스 — 되돌린 DB 에 새 사람을 넣어도 옛 id 와 부딪히지 않는다(덤프가 setval 을 빠뜨리면 여기서 넘어진다)
        with dst.begin() as conn:
            old_max = conn.execute(text("SELECT max(id) FROM users")).scalar()
            new_id = conn.execute(
                text("INSERT INTO users (google_sub, email, status, session_epoch, is_owner, created_at) "
                     "VALUES ('새', 'new@example.com', 'pending', 0, false, now()) RETURNING id")
            ).scalar()
        assert new_id > old_max

        # 되돌린 DB 로 앱이 뜬다 — 이미 최신이라 마이그레이션(과 그 앞 백업)이 돌지 않는다
        init_db(dst)
        assert not [p for p in backup.existing_backups() if "premigrate" in p.name]
    finally:
        src.dispose()
        dst.dispose()


def test_a_cut_dump_is_refused_before_it_counts(databases, tmp_path, monkeypatch):
    """중간이 잘린 덤프 — psql 은 대개 성공으로 붓는다(표가 빠진 채). 그래서 뜰 때 끝 표지를 보고 거절한다."""
    src = create_engine(databases["src"])
    try:
        init_db(src)
        real_run = subprocess.run

        def cut(args, **kwargs):
            done = real_run(args, **kwargs)
            dest = args[args.index("--file") + 1]
            with open(dest, "rb") as f:
                body = f.read()
            with open(dest, "wb") as f:
                f.write(body[: len(body) // 2])
            return done

        monkeypatch.setattr(backup.subprocess, "run", cut)
        with pytest.raises(RuntimeError, match="덤프가 끝나지 않음"):
            backup.create_backup(url=databases["src"].render_as_string(hide_password=False), backup_dir=tmp_path / "b")
        assert backup.existing_backups(tmp_path / "b") == []
    finally:
        src.dispose()


# ---------------------------------------------------------------------------
#  판 맞추기 — 글자로 (Postgres 없이도 돈다)
# ---------------------------------------------------------------------------


def test_backup_restore_versions_agree():
    """운영 DB(compose)·이미지 안의 pg_dump(Dockerfile)·CI 의 서비스와 pg_dump 가 같은 큰 판이다.

    운영 DB 를 18 로 올리면서 이 셋 중 하나를 빠뜨리면, 이미지의 pg_dump 가 새 서버를 덤프하지 못해 **매일 백업이 조용히
    실패**한다(진단·⋯ 점에만 뜬다). 그 전에 여기서 멈춘다.
    """
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    compose = (repo / "docker-compose.yml").read_text(encoding="utf-8")
    dockerfile = (repo / "Dockerfile").read_text(encoding="utf-8")
    workflow = (repo / ".github" / "workflows" / "tests.yml").read_text(encoding="utf-8")
    server = re.search(r"image:\s*postgres:(\d+)", compose).group(1)
    assert re.search(r"ARG PG_MAJOR=(\d+)", dockerfile).group(1) == server
    assert re.search(r"image:\s*postgres:(\d+)", workflow).group(1) == server
    assert f"postgresql-client-{server}" in workflow and f"/usr/lib/postgresql/{server}/bin" in workflow
    assert f"(PostgreSQL) {server}" in workflow
    assert "REQUIRE_PG_RESTORE" in workflow and "PG_RESTORE_PSQL" in workflow
