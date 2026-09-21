"""실행 중인 코드가 어느 버전인지 알려준다.

`git pull`을 했는지 / 서버를 다시 켰는지 화면에서 바로 확인할 수 있어야 한다.
이게 없으면 "고쳤는데 그대로예요"가 코드 문제인지 옛날 코드가 도는 건지 구분이 안 된다.
"""

import os
import subprocess
from functools import lru_cache
from pathlib import Path

# 배포 토대를 갖춘 버전 — Alembic으로 스키마를 관리하고, DATABASE_URL로 Postgres까지
# 받고, 백업이 자동으로 뜨고, Docker로 어디서든 같은 모양으로 뜬다.
# 0.8.1: PC가 꺼져 있던 동안을 제대로 다루게 고쳤다 (중간점검에서 찾은 셋).
# 0.9.0: 바깥에 내놓을 수 있게 됐다 — 비밀번호 잠금, 스케줄러 단일 실행, HTTPS 구성.
# 0.9.1: 한국어 윈도우에서 앱이 안 뜨던 것을 고쳤다 (alembic.ini를 cp949로 읽던 문제).
# 0.10.0: 일본주식(도쿄) 추가. 환율을 달러 하나에서 통화별로 일반화했다.
# 0.10.1: 종목 관리에서도 삭제, 삭제 확인을 화면 가운데 팝업으로, 순서 이동을 눈에 보이게.
# 0.11.0: 폰에 설치해 앱처럼 쓸 수 있게 됐다 — 아이콘·manifest·서비스 워커(오프라인),
#         설치 버튼, 노치 회피와 손가락 크기 다듬기. 푸시 알림은 아직이다.
# 기능이 바뀔 때마다 올린다.
APP_VERSION = "0.11.0"

REPO_ROOT = Path(__file__).resolve().parents[2]


# 이미지를 만들 때 박아 넣는 커밋 해시 (Dockerfile 의 ARG / .github/workflows/docker.yml).
#
# **도커에는 `.git` 이 없다**(.dockerignore). 그래서 아래 `git rev-parse` 가 서버에서는
# 항상 빈손으로 돌아오고, 화면에는 `0.11.0` 만 남는다. 그 상태로는 서버가 오늘 이미지를
# 받았는지 어제 것을 그대로 쓰고 있는지 알 방법이 없다 — 이 모듈이 애초에 있는 이유가
# 그걸 알자는 것이었는데 정작 서버에서 안 되고 있었다.
REVISION_ENV = "APP_REVISION"


@lru_cache(maxsize=1)
def git_revision() -> str | None:
    """현재 실행 중인 코드의 커밋. 알 수 없으면 None.

    빌드할 때 박아둔 값을 먼저 본다 (도커). 없으면 저장소에 직접 물어본다 (개인 PC).
    """
    baked = os.environ.get(REVISION_ENV, "").strip()
    if baked:
        # 워크플로가 전체 해시를 넘긴다. 화면에는 앞 7자리면 충분하다.
        return baked[:7]
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
