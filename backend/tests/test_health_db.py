"""헬스체크가 DB 를 본다 (0.46.0 B, 제로베이스 점검 9번). 전에는 DB 가 죽어도 `ok` 였다."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

import app.main as main_module
from app.db import get_db
from app.models import User
from app.services import auth as auth_service

SECRET = "postgresql://signal:SENTINEL-pw@db:5432/signal"


class _DeadSession:
    """무엇을 물어도 "접속할 수 없다" — 오류 글에 접속 주소가 든다(진짜 psycopg 처럼)."""

    def get_bind(self):
        raise OperationalError("SELECT 1", {}, Exception(f"connection to {SECRET} failed"))

    def execute(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception(f"connection to {SECRET} failed"))

    def get(self, *args, **kwargs):
        raise OperationalError("SELECT", {}, Exception(f"connection to {SECRET} failed"))

    def rollback(self):
        pass

    def close(self):
        pass


def _kill_db():
    def dead():
        yield _DeadSession()

    main_module.app.dependency_overrides[get_db] = dead


def test_a_live_database_says_ok(api):
    client, _ = api
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok" and body["db"] == "ok"
    assert "version" in body  # 옛 필드 그대로(열린 PC 는 로그인한 셈)


def test_a_dead_database_is_503_without_the_address(api, caplog):
    client, _ = api
    _kill_db()
    res = client.get("/api/health")
    assert res.status_code == 503
    assert res.json() == {"status": "error", "db": "down", "locked": False}
    assert "SENTINEL" not in res.text and "5432" not in res.text
    assert "DB 가 답하지 않습니다" in caplog.text  # 원문은 로그에만


def test_google_mode_with_a_cookie_still_reaches_503(api, monkeypatch):
    """구글 모드는 문지기가 handler 앞에서 DB 를 본다 — 쿠키가 있는 화면 요청이 500 이 아니라 503 에 닿는다 (계획 검토)."""
    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    client, Session = api
    with Session() as db:
        owner = db.get(User, 1)
        owner.google_sub = "sub-1"
        owner.status = "active"
        db.commit()
        token = auth_service.issue_user_token(1, owner.session_epoch, "sub-1")
    client.cookies.set(auth_service.COOKIE_NAME, token)
    assert client.get("/api/health").json()["version"]  # 살아 있을 때는 로그인한 사람의 응답
    _kill_db()
    res = client.get("/api/health")
    assert res.status_code == 503
    assert res.json()["db"] == "down" and "version" not in res.json()


def test_other_paths_still_fail_as_before_when_the_database_is_dead(api, monkeypatch):
    """손님으로 넘기는 것은 헬스체크만 — 다른 주소가 DB 오류를 "손님"으로 삼키면 401 로 보여 로그인 문제처럼 읽힌다."""
    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    client, _ = api
    token = auth_service.issue_user_token(1, 0, "sub-1")  # 문지기가 DB 를 열어 볼 만한 쪽지
    client.cookies.set(auth_service.COOKIE_NAME, token)
    _kill_db()
    with pytest.raises(OperationalError):
        client.get("/api/stocks")
    quiet = TestClient(main_module.app, raise_server_exceptions=False)
    quiet.cookies.set(auth_service.COOKIE_NAME, token)
    assert quiet.get("/api/stocks").status_code == 500


def test_health_on_postgres_sets_a_statement_timeout(api):
    """매달린 DB 에서 헬스체크가 커넥션을 붙잡지 않게 — Postgres 면 이 트랜잭션에만 3초."""
    seen = []

    class _Pg:
        class _Bind:
            class dialect:
                name = "postgresql"

        def get_bind(self):
            return self._Bind()

        def execute(self, statement, *a, **k):
            seen.append(str(statement))

        def rollback(self):
            seen.append("rollback")

        def close(self):
            pass

    def pg():
        yield _Pg()

    client, _ = api
    main_module.app.dependency_overrides[get_db] = pg
    assert client.get("/api/health").status_code == 200
    assert seen[:2] == ["SET LOCAL statement_timeout = '3s'", "SELECT 1"] and "rollback" in seen
