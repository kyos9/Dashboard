"""DB 백업.

이게 빠지면 수정이 어려운 게 아니라 **위험해진다.** 마이그레이션이 잘못 돌든, 디스크가
나가든, 사용자가 종목을 지우든, 되돌릴 자리가 없으면 그걸로 끝이다.

두 가지를 의식하고 만들었다.

1. **돌고 있는 DB를 그냥 복사하면 안 된다.** SQLite 파일은 복사하는 동안에도 쓰이고
   있어서, 중간에 찍힌 파일은 열리지 않을 수 있다. sqlite3의 백업 API는 잠금을 걸고
   일관된 한 시점을 떠준다.
2. **복구가 쉬워야 한다.** 그래서 압축하지 않는다. SQLite 백업은 그냥 `.db` 파일이라
   *제자리에 갖다 놓으면 끝*이고, Postgres 덤프는 그냥 SQL 텍스트다. 급할 때 도구를
   찾아 헤매야 하는 백업은 없는 것과 비슷하다.
"""

import contextlib
import datetime as dt
import json
import logging
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path

from sqlalchemy import URL, make_url

from app.db import database_url, sqlite_file

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(
    os.environ.get("SIGNAL_DASHBOARD_BACKUP_DIR", Path(__file__).resolve().parents[2] / "backups")
)
# 기본 7벌. 매일 한 번 도니 일주일이다. 더 오래 두고 싶으면 환경변수로 늘린다.
KEEP = int(os.environ.get("SIGNAL_DASHBOARD_BACKUP_KEEP", "7"))

PREFIX = "signalboard-"
STAMP = "%Y%m%d-%H%M%S"


# 마지막으로 실패한 때와 그 갈래 — 진단 화면이 본다 (0.44.0 D0). 백업 폴더의 작은 파일에 둔다: 다시 켜도 남고,
# 스케줄러를 맡지 않은 워커가 요청을 받아도 같은 것을 읽는다(같은 볼륨). 성공하면 비운다.
# 사유는 갈래 이름만 — 예외 글에는 DB 파일 경로·pg_dump 의 접속 주소가 들 수 있다(원문은 서버 로그에만).
STATUS_FILE = "backup-status.json"

# 상태 파일을 못 쓴 날(백업 폴더에 쓸 수 없다·디스크가 찼다 — 바로 백업이 실패하는 날이다)의 마지막 상태.
# 이 프로세스 안에만 남지만 없는 것보다 낫다 — 파일보다 새것이므로 읽을 때 먼저 본다 (D0 두 번째 검토).
_unsaved: dict[str, dict | None] = {}


def _status_path(backup_dir: Path | None = None) -> Path:
    return Path(backup_dir or BACKUP_DIR) / STATUS_FILE


@contextlib.contextmanager
def _status_lock(path: Path):
    """상태 파일을 읽고 고쳐 쓰는 동안 잠근다 — 앱과 `docker compose exec` 로 띄운 도구가 같은 파일을 쓴다 (0.45.0 A).

    잠금은 옆의 작은 파일로(`….lock`). 윈도우에는 `fcntl` 이 없다 — 거기서는 PC 앱 하나만 쓰므로 잠그지 않는다.
    """
    try:
        import fcntl
    except ImportError:  # pragma: no cover - 윈도우
        yield
        return
    with open(path.with_name(path.name + ".lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _read_status_file(path: Path) -> dict:
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return saved if isinstance(saved, dict) else {}


def _update_status(changes: dict, backup_dir: Path | None = None) -> bool:
    """상태 파일의 키 몇 개만 고친다 — **읽고 합쳐 쓴다.** 통째로 덮어쓰면 매일 백업이 성공할 때마다(실패 기록 지우기)
    밖에 꺼낸 시각까지 지워졌다 (0.45.0 계획 검토). 임시 파일 이름에 pid 를 붙인다 — 두 프로세스가 같은 이름을 쓰지 않게.
    """
    path = _status_path(backup_dir)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _status_lock(path):
            saved = _read_status_file(path)
            saved.update(changes)
            temp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
            temp.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
            temp.replace(path)
    except OSError as exc:
        # 디스크가 찬 날이면 이것도 못 쓴다 — 로그에는 이미 남았다. 실패 기록은 이 프로세스에라도 남긴다
        logger.warning("백업 상태 파일을 쓰지 못했습니다: %s", exc)
        if "last_failure" in changes:
            _unsaved[str(path)] = changes["last_failure"]
        return False
    if "last_failure" in changes:
        _unsaved.pop(str(path), None)
    return True


def _write_failure(failure: dict | None, backup_dir: Path | None = None) -> None:
    _update_status({"last_failure": failure}, backup_dir)


def mark_pulled(now: dt.datetime | None = None, backup_dir: Path | None = None) -> bool:
    """서버 밖(관리자 PC)으로 백업을 꺼냈다고 적는다 (0.45.0 A) — `server-backup-pull.bat` 이 받은 크기를 확인한 뒤 부른다.

    따로 띄운 프로세스라 못 쓰면 메모리에 남겨 봐야 앱이 못 본다 — 그래서 False 를 돌려주고 부른 쪽이 알린다.
    """
    at = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).replace(microsecond=0).isoformat()
    return _update_status({"pulled_at": at}, backup_dir)


def _read_pulled(backup_dir: Path | None = None) -> str | None:
    at = _read_status_file(_status_path(backup_dir)).get("pulled_at")
    if not isinstance(at, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(at)
    except ValueError:
        return None
    # 시간대가 없으면(손으로 고친 파일) UTC 로 본다 — 그대로 두면 시간대 있는 시각과 빼다가 관리자 상태가 넘어졌다(A 검토)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=dt.timezone.utc).isoformat()
    return at


def _read_failure(backup_dir: Path | None = None) -> dict | None:
    path = _status_path(backup_dir)
    if str(path) in _unsaved:
        return _unsaved[str(path)]
    failure = _read_status_file(path).get("last_failure")
    if isinstance(failure, dict) and isinstance(failure.get("at"), str) and isinstance(failure.get("reason"), str):
        return {"at": failure["at"], "reason": failure["reason"]}
    return None


def _failure_kind(exc: BaseException) -> str:
    import errno

    text = str(exc)
    if "pg_dump 를 찾을 수 없습니다" in text:
        return "pg_dump 가 없습니다"
    if text.startswith("pg_dump 실패"):
        return "pg_dump 가 실패했습니다"
    if isinstance(exc, FileNotFoundError):
        return "DB 파일을 찾지 못했습니다"
    if isinstance(exc, PermissionError):
        return "백업 폴더에 쓸 수 없습니다"
    if isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
        return "디스크가 찼습니다"
    if isinstance(exc, OSError):
        return "파일을 쓰지 못했습니다"
    return "알 수 없는 오류 — 서버 로그를 보세요"


def _stamp() -> str:
    return dt.datetime.now().strftime(STAMP)


def _backup_sqlite(source: Path, dest: Path) -> None:
    """돌고 있는 파일을 일관된 한 시점으로 떠낸다."""
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


def _backup_postgres(url_text: str, dest: Path) -> None:
    """pg_dump로 SQL 덤프를 뜬다.

    비밀번호는 인자가 아니라 환경변수로 넘긴다 — 명령줄 인자는 같은 서버의 다른
    프로세스에서 `ps`로 그대로 보인다.
    """
    if shutil.which("pg_dump") is None:
        raise RuntimeError(
            "pg_dump 를 찾을 수 없습니다. postgresql-client 를 설치해야 백업할 수 있습니다."
        )

    url = make_url(url_text)
    env = dict(os.environ)
    if url.password:
        env["PGPASSWORD"] = url.password
    # libpq가 이해하는 주소로 다시 만든다. 드라이버 이름(+psycopg)은 pg_dump가 모르고,
    # 비밀번호는 위 환경변수로 가므로 주소에서 뺀다.
    # (`url.set(password=None)`은 안 된다 — None은 "그대로 두라"는 뜻이라 지워지지 않는다.)
    target = URL.create(
        drivername="postgresql",
        username=url.username,
        host=url.host,
        port=url.port,
        database=url.database,
    ).render_as_string(hide_password=False)

    result = subprocess.run(
        ["pg_dump", "--no-owner", "--no-privileges", "--file", str(dest), target],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        # check=True로 두면 "exit code 1"만 남고 왜 실패했는지는 사라진다.
        # 백업이 안 되는 이유를 모르면 고칠 수도 없다.
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"pg_dump 실패 (코드 {result.returncode}): {result.stderr.strip()}")


def create_backup(
    url: str | None = None, backup_dir: Path | None = None, label: str = ""
) -> Path:
    """백업 파일 하나를 만들고 그 경로를 돌려준다."""
    url = url or database_url()
    backup_dir = Path(backup_dir or BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)
    suffix = f"-{label}" if label else ""

    source = sqlite_file(url)
    if source is not None:
        if not source.exists():
            raise FileNotFoundError(f"백업할 DB 파일이 없습니다: {source}")
        dest = backup_dir / f"{PREFIX}{_stamp()}{suffix}.db"
        _backup_sqlite(source, dest)
    else:
        dest = backup_dir / f"{PREFIX}{_stamp()}{suffix}.sql"
        _backup_postgres(url, dest)

    logger.info("백업 완료: %s (%s바이트)", dest.name, dest.stat().st_size)
    return dest


def existing_backups(backup_dir: Path | None = None) -> list[Path]:
    """최근 것이 앞에 오도록 정렬된 백업 목록."""
    backup_dir = Path(backup_dir or BACKUP_DIR)
    if not backup_dir.is_dir():
        return []
    found = [p for p in backup_dir.iterdir() if p.is_file() and p.name.startswith(PREFIX)]
    # 이름에 찍힌 시각으로 정렬한다. 파일 수정시각은 복사·이동에 쉽게 흐트러진다.
    return sorted(found, key=lambda p: p.name, reverse=True)


def prune(keep: int | None = None, backup_dir: Path | None = None) -> list[Path]:
    """오래된 백업을 지우고, 지운 목록을 돌려준다."""
    keep = KEEP if keep is None else keep
    removed = []
    for path in existing_backups(backup_dir)[max(keep, 0) :]:
        path.unlink()
        removed.append(path)
    if removed:
        logger.info("오래된 백업 %d개를 지웠습니다", len(removed))
    return removed


def run_backup() -> Path | None:
    """스케줄러가 부르는 자리. 백업이 실패해도 앱은 계속 돌아야 한다."""
    try:
        path = create_backup()
    except Exception as exc:
        # 조용히 넘어가면 안 된다 — 백업이 없는 걸 모르는 게 백업이 없는 것보다 나쁘다.
        logger.error("백업에 실패했습니다: %s", exc)
        _write_failure({
            "at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "reason": _failure_kind(exc),
        })
        return None
    _write_failure(None)
    try:
        prune()
    except OSError as exc:
        logger.warning("오래된 백업을 지우지 못했습니다: %s", exc)
    return path


def latest_age(backup_dir: Path | None = None) -> dt.timedelta | None:
    """가장 최근 백업이 얼마나 오래됐나. 하나도 없으면 None."""
    found = existing_backups(backup_dir)
    if not found:
        return None
    try:
        stamp = dt.datetime.strptime(found[0].name[len(PREFIX) :][: len(_stamp())], STAMP)
    except ValueError:
        return None
    return dt.datetime.now() - stamp


def _label(path: Path) -> str:
    """이름에서 시각 뒤의 꼬리표 — 매일 백업은 "", 업그레이드 직전은 "premigrate"."""
    rest = path.name[len(PREFIX) + len(_stamp()) :]
    stem = rest.rsplit(".", 1)[0]
    return stem[1:] if stem.startswith("-") else stem


def _taken_at(path: Path) -> str | None:
    """이름에 찍힌 서버 시각을 UTC 로 — 화면이 보는 사람의 시간대로 바꾼다."""
    try:
        stamp = dt.datetime.strptime(path.name[len(PREFIX) :][: len(_stamp())], STAMP)
    except ValueError:
        return None
    return stamp.astimezone(dt.timezone.utc).isoformat()


def status(backup_dir: Path | None = None) -> dict:
    """진단(주인)에 보일 백업 상태 (0.44.0 D0) — 마지막 백업 시각·크기·벌 수·마지막 실패.

    "마지막"은 **매일 백업**만 본다. 업그레이드 직전 백업(`premigrate`)까지 섞으면 업그레이드 한 번이 매일 백업이 멈춘
    것을 가린다(D0 검토) — 그것은 따로 센다. **파일 이름·경로는 담지 않는다.**
    """
    found = existing_backups(backup_dir)
    daily = [p for p in found if _label(p) == ""]
    before = [p for p in found if _label(p) == "premigrate"]
    last_size = None
    if daily:
        try:
            last_size = daily[0].stat().st_size
        except OSError:
            last_size = None
    return {
        "count": len(found),
        "keep": KEEP,
        "last_at": _taken_at(daily[0]) if daily else None,
        "last_size": last_size,
        "last_failure": _read_failure(backup_dir),
        "premigrate": {"count": len(before), "last_at": _taken_at(before[0]) if before else None},
        # 서버 밖(관리자 PC)으로 마지막으로 꺼낸 때 (0.45.0 A) — 꺼낸 쪽이 적는다. 서버는 밖에 무엇이 있는지 모른다
        "offsite": {"last_at": _read_pulled(backup_dir)},
    }


# 진단의 경고와 같은 기준 (DiagnosticsModal) — 매일 백업이 이만큼 없으면, 밖에 꺼낸 지 이만큼 지나면
STALE_HOURS = 36
# 매주 꺼내는 길(DEPLOY 10-0)이라 한 번 걸러도 사흘 안에 뜨게 — 30일은 한 달을 말없이 넘겼다(0.45.2 B3).
# 화면 `lib/backupWarnings.ts` 와 같아야 한다(test_backup 이 비교한다)
OFFSITE_STALE_DAYS = 10


def attention(now: dt.datetime | None = None, backup_dir: Path | None = None) -> bool:
    """관리자가 진단을 열어 봐야 하나 — 헤더 ⋯ 메뉴의 점 (0.45.0 A). 진단은 매일 여는 곳이 아니라서.

    매일 백업이 실패했거나 36시간 넘게 없거나, **한 번이라도** 밖에 꺼낸 뒤 10일이 넘었으면. 한 번도 안 꺼냈으면 점은
    없다(진단에 "밖에 꺼낸 기록이 없습니다"만) — 꺼내는 길을 쓰지 않는 서버에 늘 점이 뜨면 점이 아무 뜻이 없어진다.
    """
    now = now or dt.datetime.now(dt.timezone.utc)
    state = status(backup_dir)
    if state["last_failure"]:
        return True
    if state["last_at"] and now - dt.datetime.fromisoformat(state["last_at"]) > dt.timedelta(hours=STALE_HOURS):
        return True
    pulled = state["offsite"]["last_at"]
    return bool(pulled) and now - dt.datetime.fromisoformat(pulled) > dt.timedelta(days=OFFSITE_STALE_DAYS)


def run_backup_if_stale(max_age_hours: float = 12, backup_dir: Path | None = None) -> Path | None:
    """마지막 백업이 오래됐을 때만 한 벌 뜬다.

    개인 PC는 서버와 달리 **켜져 있을 때만** 스케줄러가 돈다. 매일 정해진 시각에 PC가
    켜져 있으리라는 보장이 없으니 앱을 켤 때도 한 번 본다. 다만 켤 때마다 뜨면
    하루에 몇 번씩 쌓여서 보관 7벌이 반나절치가 되어 버리므로, 최근 것이 있으면 넘어간다.
    """
    age = latest_age(backup_dir)
    if age is not None and age < dt.timedelta(hours=max_age_hours):
        logger.debug("최근 백업이 %s 전에 있어 건너뜁니다", age)
        return None
    return run_backup()


class MigrationBackupFailed(RuntimeError):
    """되돌릴 수 없는 마이그레이션 앞에서 백업을 못 떴다. 업그레이드를 시작하지 않는다."""


def snapshot_before_migration(
    bind, backup_dir: Path | None = None, *, required: bool = False
) -> Path | None:
    """스키마를 바꾸기 **직전에** 한 벌 떠둔다.

    마이그레이션이 잘못 돌면 되돌릴 자리가 여기밖에 없다. 그래서 이 백업만은 정기
    백업과 달리 "최근에 떴으니 넘어간다"를 하지 않는다 — 바꾸기 직전의 모습이어야
    쓸모가 있다.

    `bind`에서 주소를 꺼낸다. 전역 설정이 아니라 **지금 고치려는 그 DB**를 떠야 한다.

    **실패하면 어떻게 하나는 `required`가 정한다.** 컬럼을 더하는 보통의 리비전은
    경고만 남기고 진행한다 — 백업 때문에 앱이 안 뜨는 게 더 나쁘다. 하지만 되돌릴 수
    없는 리비전(`migrate.IRREVERSIBLE`) 앞에서는 멈춘다. 디스크가 찼거나 `pg_dump`가
    없는 날 그대로 실행되면 돌아갈 자리가 없다.
    """
    url = bind.url.render_as_string(hide_password=False)
    if sqlite_file(url) is None and not url.startswith("postgres"):
        return None  # 메모리 DB 등 — 뜰 것도, 잃을 것도 없다
    try:
        return create_backup(url=url, backup_dir=backup_dir, label="premigrate")
    except Exception as exc:
        if required:
            raise MigrationBackupFailed(
                f"마이그레이션 전 백업에 실패해 업그레이드를 멈춥니다: {exc}\n"
                "이번 업데이트는 되돌릴 수 없는 스키마 변경이 들어 있어, 백업 없이는 "
                "시작하지 않습니다. DB는 그대로입니다.\n"
                "- 원인(디스크 공간, pg_dump 설치)을 고친 뒤 다시 켜거나\n"
                "- 이전 버전으로 돌아가세요 (DEPLOY.md 9번의 IMAGE_TAG)."
            ) from exc
        # 백업에 실패했다고 업데이트를 막지는 않는다. 다만 조용히 넘어가지도 않는다.
        logger.warning("마이그레이션 전 백업에 실패했습니다: %s", exc)
        return None


def main() -> int:
    """`python -m app.services.backup` — 지금 한 벌 뜬다."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    path = create_backup()
    prune()
    print(f"백업: {path}")
    print(f"보관 중: {len(existing_backups())}벌 (최대 {KEEP})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
