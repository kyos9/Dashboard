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

import datetime as dt
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
        return None
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


def snapshot_before_migration(bind, backup_dir: Path | None = None) -> Path | None:
    """스키마를 바꾸기 **직전에** 한 벌 떠둔다.

    마이그레이션이 잘못 돌면 되돌릴 자리가 여기밖에 없다. 그래서 이 백업만은 정기
    백업과 달리 "최근에 떴으니 넘어간다"를 하지 않는다 — 바꾸기 직전의 모습이어야
    쓸모가 있다.

    `bind`에서 주소를 꺼낸다. 전역 설정이 아니라 **지금 고치려는 그 DB**를 떠야 한다.
    """
    url = bind.url.render_as_string(hide_password=False)
    if sqlite_file(url) is None and not url.startswith("postgres"):
        return None  # 메모리 DB 등 — 뜰 것도, 잃을 것도 없다
    try:
        return create_backup(url=url, backup_dir=backup_dir, label="premigrate")
    except Exception as exc:
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
