"""서버 밖(관리자 PC)으로 백업을 꺼냈다고 적는다 (0.45.0 A) — 저장소 맨 위 `server-backup-pull.bat` 이 부른다.

    docker compose exec -T app python -m app.tools.backup_pulled

받은 파일의 크기를 확인한 **뒤에만** 부른다. 진단의 "밖에 꺼낸 것: 마지막 …" 과 헤더 ⋯ 의 점이 이 시각을 본다.
백업을 새로 뜨지 않는다 — 꺼내는 쪽이 뜬 백업이 "매일 백업"으로 세어지면 스케줄러가 멈춘 것을 가린다.
`app.services.backup` 의 `main()` 에 인자로 달지 않은 것도 그래서다: 옛 이미지의 `main()` 은 인자를 모른 채 백업을
한 벌 뜨고 0 으로 끝난다. 이 모듈이 없는 옛 이미지에서는 여기서 바로 실패(exit 1)한다.
"""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    from app.services import backup

    if backup.mark_pulled():
        sys.stdout.write("밖에 꺼낸 시각을 남겼습니다.\n")
        return 0
    sys.stderr.write("밖에 꺼낸 시각을 남기지 못했습니다 — 서버의 백업 폴더에 쓸 수 없습니다(디스크·권한).\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
