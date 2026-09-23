"""진단 로그 조회.

여기서 지키려는 건 하나다 — **문제를 보러 온 사람이 원인을 찾을 수 있어야 한다.**
그래서 경고 이상만 걸러도 트레이스백이 딸려 와야 하고, 최근 것이 앞에 와야 하고,
로그가 아직 없을 때도 화면이 깨지지 않아야 한다.
"""

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import logging_setup
from app.routers import logs
from app.services.users import LOCAL_USER_ID, require_owner

SAMPLE = """\
2026-09-17 03:00:01 INFO app.services.scheduler: daily refresh completed: 5 ok
2026-09-17 03:00:02 WARNING app.services.providers: VOO: [yahoo] CONNECT tunnel failed, 403
2026-09-17 03:00:03 ERROR app.services.pipeline: 005930.KS 갱신 실패
Traceback (most recent call last):
  File "pipeline.py", line 1, in refresh
ValueError: 시세가 비었습니다
2026-09-17 03:00:04 INFO app.services.pipeline: 다음 일정에 재시도
"""


def _logs_client() -> TestClient:
    app = FastAPI()
    app.include_router(logs.router)
    # 여기서는 로그를 읽는 법만 본다. 관리자만 보는지는 test_isolation 이 본다.
    app.dependency_overrides[require_owner] = lambda: LOCAL_USER_ID
    return TestClient(app)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    log_file = tmp_path / "app.log"
    log_file.write_text(SAMPLE, encoding="utf-8")
    monkeypatch.setattr(logs, "LOG_FILE", log_file)
    return _logs_client()


def test_warnings_only_by_default(client):
    """전체를 쏟으면 안 읽게 된다 — 기본은 경고 이상."""
    body = client.get("/api/logs").json()
    assert [e["level"] for e in body["entries"]] == ["ERROR", "WARNING"]
    assert body["counts"] == {"INFO": 2, "WARNING": 1, "ERROR": 1}


def test_newest_first(client):
    """방금 무슨 일이 있었는지가 궁금해서 온 화면이다."""
    entries = client.get("/api/logs?level=all").json()["entries"]
    assert entries[0]["time"] == "2026-09-17 03:00:04"
    assert entries[-1]["time"] == "2026-09-17 03:00:01"


def test_traceback_stays_with_its_error(client):
    """형식에 안 맞는 줄을 버리면 정작 원인이 적힌 줄이 사라진다."""
    error = next(e for e in client.get("/api/logs").json()["entries"] if e["level"] == "ERROR")
    assert "ValueError: 시세가 비었습니다" in error["message"]
    assert error["logger"] == "app.services.pipeline"


def test_limit_applies(client):
    assert len(client.get("/api/logs?level=all&limit=1").json()["entries"]) == 1


def test_no_log_file_is_not_an_error(tmp_path, monkeypatch):
    """로그가 아직 없다고 진단 화면이 깨지면 곤란하다."""
    monkeypatch.setattr(logs, "LOG_FILE", tmp_path / "없음.log")
    client = _logs_client()

    body = client.get("/api/logs").json()
    assert body["available"] is False and body["entries"] == []
    assert client.get("/api/logs/download").status_code == 404


def test_download_returns_the_raw_file(client):
    res = client.get("/api/logs/download")
    assert res.status_code == 200
    assert "Traceback" in res.text
    assert "attachment" in res.headers["content-disposition"]


def test_tail_only_reads_the_end(tmp_path, monkeypatch):
    """5MB를 통째로 읽어 메모리에 올리지 않는다 — 그러면서 끝부분은 놓치지 않는다."""
    log_file = tmp_path / "app.log"
    filler = "2026-09-17 01:00:00 INFO app.filler: " + "x" * 200 + "\n"
    log_file.write_text(filler * 5000 + SAMPLE, encoding="utf-8")
    monkeypatch.setattr(logs, "LOG_FILE", log_file)
    monkeypatch.setattr(logs, "TAIL_BYTES", 4096)

    text = logs._tail_text()
    assert log_file.stat().st_size > 1_000_000
    assert len(text.encode("utf-8")) <= 4096
    # 잘린 첫 줄은 버리므로 남은 줄은 전부 온전하다
    assert all(logs.LINE.match(line) or line.startswith((" ", "T", "V")) for line in text.splitlines())
    # 가장 최근 기록은 그대로 들어 있다
    assert "다음 일정에 재시도" in text

    body = _logs_client().get("/api/logs?level=all").json()
    assert body["size_bytes"] > 1_000_000
    assert body["entries"][0]["time"] == "2026-09-17 03:00:04"


def _detach_file_handler() -> None:
    handler = logging_setup._existing_handler()
    if handler is None:
        return
    logging.getLogger().removeHandler(handler)
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).removeHandler(handler)
    handler.close()


@pytest.fixture()
def fresh_logging():
    """앞선 테스트가 앱을 띄우며 이미 핸들러를 붙여놨을 수 있다 — 떼고 시작한다."""
    _detach_file_handler()
    yield
    _detach_file_handler()


def test_setup_logging_writes_what_the_code_already_logs(tmp_path, monkeypatch, fresh_logging):
    """로그를 새로 만드는 게 아니라, 이미 나오고 있던 것을 파일로 받는다."""
    monkeypatch.setattr(logging_setup, "LOG_DIR", tmp_path)
    monkeypatch.setattr(logging_setup, "LOG_FILE", tmp_path / "app.log")

    path = logging_setup.setup_logging()
    logging.getLogger("app.services.providers").warning("VOO: [yahoo] 막힘")
    assert "VOO: [yahoo] 막힘" in path.read_text(encoding="utf-8")

    # 두 번 불러도 핸들러가 겹쳐 붙지 않는다 (같은 줄이 두 번 찍히면 못 읽는다)
    logging_setup.setup_logging()
    logging.getLogger("app.services.providers").warning("한 번만")
    assert path.read_text(encoding="utf-8").count("한 번만") == 1


def test_access_logs_are_not_kept(tmp_path, monkeypatch, fresh_logging):
    """요청마다 한 줄씩 쌓이면 정작 볼 경고가 회전에 밀려 사라진다."""
    monkeypatch.setattr(logging_setup, "LOG_DIR", tmp_path)
    monkeypatch.setattr(logging_setup, "LOG_FILE", tmp_path / "app.log")

    path = logging_setup.setup_logging()
    logging.getLogger("uvicorn.access").info('GET /api/dashboard HTTP/1.1" 200')
    logging.getLogger("uvicorn.error").warning("포트를 열 수 없습니다")

    text = path.read_text(encoding="utf-8")
    assert "포트를 열 수 없습니다" in text
    assert "GET /api/dashboard" not in text


def test_unwritable_log_dir_does_not_stop_the_app(tmp_path, monkeypatch, fresh_logging):
    """로그를 못 남기는 것 때문에 앱이 안 뜨면 그게 더 나쁘다."""
    blocked = tmp_path / "파일이라서-폴더를-못만든다"
    blocked.write_text("", encoding="utf-8")
    monkeypatch.setattr(logging_setup, "LOG_DIR", blocked / "logs")
    monkeypatch.setattr(logging_setup, "LOG_FILE", blocked / "logs" / "app.log")

    assert logging_setup.setup_logging() is None
