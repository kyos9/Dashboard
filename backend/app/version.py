"""실행 중인 코드가 어느 버전인지 알려준다.

`git pull`을 했는지 / 서버를 다시 켰는지 화면에서 바로 확인할 수 있어야 한다.
이게 없으면 "고쳤는데 그대로예요"가 코드 문제인지 옛날 코드가 도는 건지 구분이 안 된다.
"""

import subprocess
from functools import lru_cache
from pathlib import Path

# 배포 토대를 갖춘 버전 — Alembic으로 스키마를 관리하고, DATABASE_URL로 Postgres까지
# 받고, 백업이 자동으로 뜨고, Docker로 어디서든 같은 모양으로 뜬다.
# 0.8.1: PC가 꺼져 있던 동안을 제대로 다루게 고쳤다 (중간점검에서 찾은 셋).
# 기능이 바뀔 때마다 올린다.
APP_VERSION = "0.8.1"

REPO_ROOT = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def git_revision() -> str | None:
    """현재 체크아웃된 커밋. git이 없거나 저장소가 아니면 None."""
    try:
        result = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() or None if result.returncode == 0 else None


@lru_cache(maxsize=1)
def version_string() -> str:
    revision = git_revision()
    return f"{APP_VERSION} ({revision})" if revision else APP_VERSION
