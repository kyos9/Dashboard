"""백업이 멈추지 않고, 잘린 덤프를 백업으로 세지 않고, 꼬리표마다 따로 센다 (0.46.0 A — 제로베이스 점검 7·8·12·13번)."""

from __future__ import annotations

import datetime as dt
import subprocess
import sys
from pathlib import Path

import pytest

from app.services import backup

REPO = Path(__file__).resolve().parents[2]
URL = "postgresql+psycopg://signal:pw@db:5432/signal"


def _named(directory: Path, when: dt.datetime, label: str = "") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    suffix = f"-{label}" if label else ""
    path = directory / f"{backup.PREFIX}{when.strftime(backup.STAMP)}{suffix}.sql"
    path.write_bytes(b"x")
    return path


# ---------------------------------------------------------------------------
#  A2 — 시간 한도
# ---------------------------------------------------------------------------


def _pg_dump_that(monkeypatch, behave):
    monkeypatch.setattr(backup.shutil, "which", lambda name: "/usr/bin/pg_dump")
    seen = {}

    def fake_run(args, **kwargs):
        seen.update(kwargs)
        dest = Path(args[args.index("--file") + 1])
        return behave(args, dest, kwargs)

    monkeypatch.setattr(backup.subprocess, "run", fake_run)
    return seen


def test_a_hanging_pg_dump_is_stopped_and_leaves_no_half_file(tmp_path, monkeypatch):
    def hang(args, dest, kwargs):
        dest.write_text("-- 반쯤", encoding="utf-8")
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    seen = _pg_dump_that(monkeypatch, hang)
    with pytest.raises(RuntimeError, match="시간 초과") as caught:
        backup.create_backup(url=URL, backup_dir=tmp_path / "b")
    assert seen["timeout"] == backup.TIMEOUT_SECONDS
    assert backup.existing_backups(tmp_path / "b") == []
    # 갈래는 쉬운 말, 접속 주소는 담지 않는다
    kind = backup._failure_kind(caught.value)
    assert kind.startswith("백업이 10분 안에 끝나지 않아 멈췄습니다") and "그대로" in kind
    assert "db:5432" not in kind and "signal" not in kind


def test_a_hanging_pg_dump_before_an_irreversible_upgrade_stops_the_upgrade(tmp_path, monkeypatch):
    """필수 백업이면 지금처럼 업그레이드를 멈춘다 — 다만 이제 영영 기다리지 않는다."""

    def hang(args, dest, kwargs):
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    _pg_dump_that(monkeypatch, hang)

    class Bind:
        url = backup.make_url(URL)

    with pytest.raises(backup.MigrationBackupFailed):
        backup.snapshot_before_migration(Bind(), backup_dir=tmp_path / "b", required=True)


def test_pg_dump_gets_a_connect_timeout(tmp_path, monkeypatch):
    def ok(args, dest, kwargs):
        dest.write_text(f"-- d\n{backup.DUMP_COMPLETE}\n", encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, "", "")

    seen = _pg_dump_that(monkeypatch, ok)
    backup.create_backup(url=URL, backup_dir=tmp_path / "b")
    assert seen["env"]["PGCONNECT_TIMEOUT"] == "10"


@pytest.mark.parametrize("raw, expected", [("", 600), ("abc", 600), ("0", 600), ("-5", 600), (" 900 ", 900)])
def test_settings_from_env_never_stop_the_app(monkeypatch, raw, expected):
    """전에는 `KEEP=칠` 한 줄이 `int()` 에서 넘어져 앱이 뜨지 않았다. compose 는 안 적은 이름을 빈 글자로 넘긴다."""
    monkeypatch.setenv("SIGNAL_DASHBOARD_BACKUP_TIMEOUT", raw)
    assert backup._env_int("SIGNAL_DASHBOARD_BACKUP_TIMEOUT", 600) == expected


def test_module_loads_with_broken_env(tmp_path):
    """다른 프로세스에서 — 모듈을 다시 읽으면 이 프로세스의 다른 모듈이 쥔 것과 갈라진다."""
    import os

    env = {**os.environ, "SIGNAL_DASHBOARD_BACKUP_KEEP": "칠", "SIGNAL_DASHBOARD_BACKUP_KEEP_PREMIGRATE": "",
           "SIGNAL_DASHBOARD_BACKUP_DIR": str(tmp_path)}
    out = subprocess.run(
        [sys.executable, "-c", "from app.services import backup; print(backup.KEEP, backup.KEEP_PREMIGRATE, backup.TIMEOUT_SECONDS)"],
        capture_output=True, text=True, env=env, cwd=Path(__file__).resolve().parents[1],
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.split() == ["7", "3", "600"]


def test_keep_premigrate_zero_is_allowed(monkeypatch):
    monkeypatch.setenv("X_KEEP", "0")
    assert backup._env_int("X_KEEP", 3, minimum=0) == 0


def test_compose_passes_the_backup_settings():
    """compose 는 적은 이름만 넘긴다 — 전에는 KEEP 이 없어 `.env` 에 써도 서버에 닿지 않았다 (계획 검토 개발자)."""
    compose = (REPO / "docker-compose.yml").read_text(encoding="utf-8")
    example = (REPO / ".env.example").read_text(encoding="utf-8")
    for name in (
        "SIGNAL_DASHBOARD_BACKUP_KEEP", "SIGNAL_DASHBOARD_BACKUP_KEEP_PREMIGRATE", "SIGNAL_DASHBOARD_BACKUP_TIMEOUT",
        "SIGNAL_DASHBOARD_REFRESH_ALERT",
    ):
        assert f"{name}: ${{{name}:-}}" in compose, name
        assert name in example, name


# ---------------------------------------------------------------------------
#  A1 — 덤프 끝 표지
# ---------------------------------------------------------------------------


def test_a_dump_without_the_end_mark_is_not_a_backup(tmp_path, monkeypatch):
    """코드 0 인데 끝이 없다(디스크가 중간에 참) — psql 은 그런 덤프를 **표가 빠진 채 성공**으로 붓는다."""

    def cut(args, dest, kwargs):
        dest.write_text("CREATE TABLE a ();\nCOPY a FROM stdin;\n1\n", encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, "", "")

    _pg_dump_that(monkeypatch, cut)
    with pytest.raises(RuntimeError, match="덤프가 끝나지 않음") as caught:
        backup.create_backup(url=URL, backup_dir=tmp_path / "b")
    assert backup.existing_backups(tmp_path / "b") == []
    assert backup._failure_kind(caught.value).startswith("백업 파일이 끝까지 써지지 않았습니다")


def test_the_end_mark_may_be_followed_by_unrestrict(tmp_path):
    """17.6 부터 표지 뒤에 `\\unrestrict` 줄이 온다 — 마지막 줄이 아니라 꼬리 안에서 찾는다 (계획 다시 보기)."""
    path = tmp_path / "d.sql"
    path.write_text("x" * 100_000 + f"\n{backup.DUMP_COMPLETE}\n--\n\n\\unrestrict abcdef\n\n", encoding="utf-8")
    assert backup.dump_is_complete(path)
    path.write_text(f"{backup.DUMP_COMPLETE}\n" + "y" * 100_000, encoding="utf-8")  # 표지가 꼬리 밖(앞)에만
    assert not backup.dump_is_complete(path)
    assert not backup.dump_is_complete(tmp_path / "없음.sql")


# ---------------------------------------------------------------------------
#  A3 — 꼬리표마다 따로 센다
# ---------------------------------------------------------------------------

NOW = dt.datetime(2026, 10, 30, 12, 0, 0)


def test_upgrade_backups_no_longer_push_out_daily_ones(tmp_path):
    """업데이트가 잦은 주 — 전에는 직전 백업 다섯이 7개 중 다섯을 먹어 매일 백업이 이틀치만 남았다."""
    d = tmp_path / "b"
    daily = [_named(d, NOW - dt.timedelta(days=i, hours=1)) for i in range(9)]
    before = [_named(d, NOW - dt.timedelta(days=i, hours=3), "premigrate") for i in range(5)]
    backup.prune(keep=7, keep_premigrate=3, backup_dir=d, now=NOW)
    left = set(backup.existing_backups(d))
    assert left == set(daily[:7]) | set(before[:3])


def test_eight_failed_days_then_a_success_still_leaves_seven(tmp_path):
    """달력으로 세지 않는다 — 8일 멈춘 뒤 첫 성공의 prune 이 지난 매일 백업을 다 지우지 않는다 (계획 검토 막음)."""
    d = tmp_path / "b"
    old = [_named(d, NOW - dt.timedelta(days=9 + i)) for i in range(7)]
    today = _named(d, NOW)
    backup.prune(keep=7, keep_premigrate=3, backup_dir=d, now=NOW)
    assert set(backup.existing_backups(d)) == {today, *old[:6]}


def test_upgrade_backups_older_than_seven_days_go(tmp_path):
    """방침 5절 "최대 7일" — 업데이트가 뜸해도 직전 백업이 몇 주 남지 않는다."""
    d = tmp_path / "b"
    fresh = _named(d, NOW - dt.timedelta(days=6, hours=23), "premigrate")
    stale = _named(d, NOW - dt.timedelta(days=7, hours=1), "premigrate")
    backup.prune(keep=7, keep_premigrate=3, backup_dir=d, now=NOW)
    left = set(backup.existing_backups(d))
    assert fresh in left and stale not in left


def test_unknown_labels_are_left_alone(tmp_path):
    d = tmp_path / "b"
    mine = _named(d, NOW - dt.timedelta(days=40), "손으로")
    backup.prune(keep=0, keep_premigrate=0, backup_dir=d, now=NOW)
    assert mine.exists()


def test_status_counts_both_kinds_and_keep_is_their_sum(tmp_path):
    d = tmp_path / "b"
    for i in range(7):
        _named(d, NOW - dt.timedelta(days=i))
    for i in range(3):
        _named(d, NOW - dt.timedelta(days=i, hours=2), "premigrate")
    state = backup.status(backup_dir=d)
    assert state["count"] == 10 and state["keep"] == 10  # 옛 화면 "10개 보관(최대 10개)" — 참
    assert state["daily"] == {"count": 7, "keep": 7}
    assert state["premigrate"]["count"] == 3 and state["premigrate"]["keep"] == 3


def test_policy_still_says_seven():
    """방침의 "최근 7벌 … 최대 7일" 은 매일 백업의 수 — 바꾸지 않았다(test_policy_page 가 KEEP 으로 본다)."""
    assert backup.KEEP == 7 and backup.PREMIGRATE_MAX_AGE == dt.timedelta(days=7)


# ---------------------------------------------------------------------------
#  A4 — PC 사본 폴더 경고
# ---------------------------------------------------------------------------

STAMP_NOW = dt.datetime(2026, 10, 30, 3, 0, tzinfo=dt.timezone.utc)


def test_pull_warnings_are_kept_and_replaced_each_time(tmp_path):
    d = tmp_path / "b"
    assert backup.mark_pulled(now=STAMP_NOW, backup_dir=d, warnings=["onedrive", "이상한 것", "onedrive"])
    assert backup.status(backup_dir=d)["offsite"] == {"last_at": STAMP_NOW.isoformat(), "warnings": ["onedrive"]}
    # 폴더를 옮겨 고쳤으면 다음 꺼내기에 사라진다
    assert backup.mark_pulled(now=STAMP_NOW, backup_dir=d)
    assert backup.status(backup_dir=d)["offsite"]["warnings"] == []


def test_a_broken_warning_list_reads_as_none(tmp_path):
    d = tmp_path / "b"
    d.mkdir()
    (d / backup.STATUS_FILE).write_text('{"pulled_at": "2026-10-30T00:00:00+00:00", "pulled_warnings": "onedrive"}')
    assert backup.status(backup_dir=d)["offsite"]["warnings"] == []


def test_the_tool_passes_warnings(monkeypatch, capsys):
    from app.tools import backup_pulled

    seen = {}
    monkeypatch.setattr(backup, "mark_pulled", lambda warnings=None: seen.setdefault("w", warnings) is not None)
    assert backup_pulled.main(["--warn", "noacl", "--warn", "onedrive", "--warn"]) == 0
    assert seen["w"] == ["noacl", "onedrive"]


def test_bat_sets_the_folder_to_me_only_and_never_stops_for_it():
    bat = (REPO / "server-backup-pull.bat").read_text(encoding="utf-8")
    assert '/inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" /T' in bat
    assert "--warn noacl" in bat and "--warn onedrive" in bat
    assert 'backup-export.sh mark!WARN!' in bat
    # 경고 갈래에는 goto :fail 이 없다 — 받기는 계속한다
    for block in bat.split("if errorlevel 1 (")[1:]:
        body = block.split(")", 1)[0]
        if "--warn" in body:
            assert "goto" not in body and "exit" not in body


def test_export_script_forwards_mark_arguments():
    script = (REPO / "deploy" / "backup-export.sh").read_text(encoding="utf-8")
    assert 'python -m app.tools.backup_pulled "$@"' in script


@pytest.mark.skipif(sys.platform.startswith("win"), reason="sh")
def test_old_export_script_ignores_the_new_arguments(tmp_path):
    """옛 서버의 backup-export.sh 는 `mark --warn …` 의 뒤 인자를 보지 않는다 — case 는 첫 인자만 본다."""
    script = tmp_path / "old.sh"
    script.write_text('case "${1:-}" in\n  mark) echo marked ;;\n  *) exit 2 ;;\nesac\n')
    out = subprocess.run(["sh", str(script), "mark", "--warn", "onedrive"], capture_output=True, text=True)
    assert out.returncode == 0 and out.stdout.strip() == "marked"
