"""`deploy/backup-export.sh` — 서버 밖으로 꺼낼 때 서버 쪽 순서 (0.45.0 A). 가짜 `docker` 로 돌린다.

진짜 서버·윈도우 PC 는 여기 없다. 셸 스크립트가 고르는 것·지우는 것·내는 것만 본다(bat 은 주인 확인 목록).
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "backup-export.sh"

pytestmark = pytest.mark.skipif(shutil.which("sh") is None, reason="sh 가 없다(윈도우)")

# 컨테이너 안의 /data/backups 를 흉내 내는 가짜 docker. `exec` 에 -T 가 없으면 ssh 로 부를 때 넘어지므로 거절한다.
FAKE_DOCKER = r"""#!/bin/sh
echo "$*" >> "$FAKE_LOG"
[ "$1" = compose ] || exit 9
shift
case "$1" in
  exec)
    [ "$2" = "-T" ] || { echo "the input device is not a TTY" >&2; exit 1; }
    shift 3
    case "$1" in
      sh) ls -1 "$FAKE_BACKUPS" ;;
      stat) f="$FAKE_BACKUPS/$(basename "$4")"; [ -f "$f" ] || exit 1; if [ -n "${GROW:-}" ] && [ -f "$GROW" ]; then rm "$GROW"; echo 1; else wc -c < "$f" | tr -d ' '; fi ;;
      python) echo "밖에 꺼낸 시각을 남겼습니다." ;;
      *) exit 8 ;;
    esac ;;
  cp) if [ -n "${SHORT_COPY:-}" ]; then head -c 3 "$FAKE_BACKUPS/$(basename "$2")" > "$3"; else cp "$FAKE_BACKUPS/$(basename "$2")" "$3"; fi ;;
  *) exit 7 ;;
esac
"""


@pytest.fixture()
def server(tmp_path):
    backups = tmp_path / "volume"
    backups.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER)
    docker.chmod(0o755)
    env = {
        **os.environ,
        "DOCKER": str(docker),
        "FAKE_BACKUPS": str(backups),
        "FAKE_LOG": str(tmp_path / "docker.log"),
        "EXPORT_DIR": str(tmp_path / "export"),
        "SETTLE_SECONDS": "0",
        "HOME": str(tmp_path / "home"),
    }

    def run(*args, **extra):
        return subprocess.run(["sh", str(SCRIPT), *args], env={**env, **extra}, capture_output=True, text=True)

    run.backups = backups
    run.export = tmp_path / "export"
    run.log = tmp_path / "docker.log"
    return run


def test_export_picks_the_newest_daily_backup_and_prints_its_name_and_size(server):
    (server.backups / "signalboard-20261018-233000.sql").write_text("old")
    (server.backups / "signalboard-20261019-233000.sql").write_text("newest daily")
    (server.backups / "signalboard-20261020-091500-premigrate.sql").write_text("before upgrade — not this")
    (server.backups / "backup-status.json").write_text("{}")
    (server.backups / "backup-status.json.123.tmp").write_text("{}")
    (server.backups / "backup-status.json.lock").write_text("")

    res = server("export")

    assert res.returncode == 0, res.stderr
    assert res.stdout == "signalboard-20261019-233000.sql 12\n"
    assert sorted(p.name for p in server.export.iterdir()) == ["signalboard-20261019-233000.sql"]
    assert (server.export / "signalboard-20261019-233000.sql").read_text() == "newest daily"
    assert oct((server.export / "signalboard-20261019-233000.sql").stat().st_mode & 0o777) == "0o600"
    # ssh 로 부를 때 넘어지지 않게 -T, 그리고 새로 뜨지 않는다(app.services.backup 을 부르지 않는다)
    log = server.log.read_text()
    assert "exec -T app sh -c ls -1 /data/backups" in log
    assert "app.services.backup" not in log


def test_export_empties_what_an_earlier_run_left(server):
    (server.backups / "signalboard-20261019-233000.db").write_text("x")
    server.export.mkdir()
    (server.export / "signalboard-20261001-233000.db").write_text("left from last week")
    assert server("export").returncode == 0
    assert sorted(p.name for p in server.export.iterdir()) == ["signalboard-20261019-233000.db"]


def test_export_without_a_daily_backup_fails(server):
    (server.backups / "signalboard-20261020-091500-premigrate.sql").write_text("only before upgrade")
    res = server("export")
    assert res.returncode == 1
    assert "매일 백업이 아직 없습니다" in res.stderr
    assert res.stdout == ""


def test_export_waits_out_a_backup_being_written(server, tmp_path):
    (server.backups / "signalboard-20261019-233000.sql").write_text("still writing")
    grow = tmp_path / "grow"
    grow.write_text("")
    res = server("export", GROW=str(grow))
    assert res.returncode == 1
    assert "백업을 쓰는 중입니다" in res.stderr
    assert not list(server.export.iterdir())


def test_clean_removes_the_export_folder(server):
    (server.backups / "signalboard-20261019-233000.sql").write_text("x")
    assert server("export").returncode == 0
    assert server("clean").returncode == 0
    assert not server.export.exists()
    assert server("clean").returncode == 0  # 이미 없어도


def test_mark_calls_the_tool_inside_the_container(server):
    res = server("mark")
    assert res.returncode == 0
    assert "exec -T app python -m app.tools.backup_pulled" in server.log.read_text()


def test_unknown_command(server):
    assert server("pull").returncode == 2


# ---------------------------------------------------------------------------
#  app.tools.backup_pulled
# ---------------------------------------------------------------------------


def test_the_tool_marks_and_says_so(capsys):
    from app.services import backup
    from app.tools import backup_pulled

    assert backup_pulled.main([]) == 0
    assert capsys.readouterr().out == "밖에 꺼낸 시각을 남겼습니다.\n"
    assert backup.status()["offsite"]["last_at"] is not None


def test_the_tool_exits_1_when_it_cannot_write(capsys):
    from app.services import backup
    from app.tools import backup_pulled

    (backup.BACKUP_DIR / backup.STATUS_FILE).mkdir(parents=True)
    assert backup_pulled.main([]) == 1
    assert "남기지 못했습니다" in capsys.readouterr().err


def test_export_refuses_a_copy_of_the_wrong_size(server):
    """꺼낸 파일이 서버의 것과 크기가 다르면(복사가 끊겼다) 이름을 내지 않고 꺼낼 폴더도 지운다 — bat 이 그것을 받아 "꺼냈다"고 적지 않게."""
    (server.backups / "signalboard-20261019-233000.sql").write_text("twelve bytes")
    res = server("export", SHORT_COPY="1")
    assert res.returncode == 1
    assert "꺼낸 파일의 크기가 다릅니다 (3 / 12)" in res.stderr
    assert res.stdout == ""
    assert not server.export.exists()
