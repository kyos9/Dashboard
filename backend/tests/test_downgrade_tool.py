"""`python -m app.tools.downgrade` — 내리기 전 백업이 실패할 때 (0.45.0 D4).

예전에는 올리기용 문구("업그레이드를 멈춥니다 … 이전 버전으로 돌아가세요")와 traceback 이 그대로 나왔다.
"""

import pytest

from app import migrate
from app.services import backup
from app.tools import downgrade


def _fail_with(cause: BaseException):
    def boom(revision, bind=None):
        try:
            raise cause
        except BaseException as exc:
            raise backup.MigrationBackupFailed("마이그레이션 전 백업에 실패해 업그레이드를 멈춥니다: secret-path") from exc

    return boom


@pytest.mark.parametrize(
    "cause, reason",
    [
        (PermissionError(13, "Permission denied", "/data/backups/SENTINEL-path"), "백업 폴더에 쓸 수 없습니다"),
        (RuntimeError("pg_dump 실패 (코드 1): postgresql://u:SENTINEL-pw@db/signal"), "pg_dump 가 실패했습니다"),
    ],
)
def test_a_failed_backup_says_one_downgrade_line_and_exits_1(monkeypatch, capsys, cause, reason):
    monkeypatch.setattr(migrate, "current_revision", lambda bind=None: "0014")
    monkeypatch.setattr(migrate, "downgrade_to", _fail_with(cause))

    assert downgrade.main(["0013"]) == 1

    out = capsys.readouterr()
    assert out.out == ""
    assert out.err.startswith(f"내리기 전 백업에 실패해 멈췄습니다: {reason}.")
    assert "DB 는 그대로입니다" in out.err
    assert "0.42 이상으로 돌아가는 것이면 내리지 않고 이미지만 바꿔도 됩니다 (DEPLOY.md 9-3)" in out.err
    # 올리기용 말·경로·접속 주소·traceback 은 없다
    for gone in ("업그레이드", "이전 버전으로 돌아가세요", "SENTINEL", "secret-path", "Traceback"):
        assert gone not in out.err


def test_a_refused_downgrade_still_prints_the_reason(monkeypatch, capsys):
    monkeypatch.setattr(migrate, "current_revision", lambda bind=None: "0014")

    def refuse(revision, bind=None):
        raise ValueError("0005 은 되돌릴 수 없습니다 — 백업에서 되돌리세요")

    monkeypatch.setattr(migrate, "downgrade_to", refuse)
    assert downgrade.main(["0004"]) == 1
    assert capsys.readouterr().err == "0005 은 되돌릴 수 없습니다 — 백업에서 되돌리세요\n"


def test_a_downgrade_that_works_prints_before_and_after(monkeypatch, capsys):
    revisions = iter(["0014"])
    monkeypatch.setattr(migrate, "current_revision", lambda bind=None: next(revisions))
    monkeypatch.setattr(migrate, "downgrade_to", lambda revision, bind=None: revision)
    assert downgrade.main(["0013"]) == 0
    assert capsys.readouterr().out == "DB 스키마: 0014 → 0013\n"
