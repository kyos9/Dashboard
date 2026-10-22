"""DB 스키마를 한 리비전으로 내린다 — 새 이미지에서 옛 이미지로 되돌리기 전에 (DEPLOY.md 9-2).

    docker compose run --rm --no-deps app python -m app.tools.downgrade 0012

옛 이미지는 자기가 모르는 리비전이 찍힌 DB 를 열지 못한다(0.41.x 까지). 그래서 **지금(새) 이미지로** 먼저 내린다.
내리기 직전에 백업을 한 벌 뜬다. 되돌릴 수 없는 리비전(0005·0006)을 건너야 하면 거절한다 — 그때는 백업에서(10-1).
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    from app import migrate

    parser = argparse.ArgumentParser(description="DB 스키마를 한 리비전으로 내린다 (옛 이미지로 되돌리기 전에)")
    parser.add_argument("revision", help="내릴 자리 (예: 0012)")
    args = parser.parse_args(argv)
    from app.services import backup

    before = migrate.current_revision()
    try:
        now = migrate.downgrade_to(args.revision)
    except ValueError as e:
        sys.stderr.write(f"{e}\n")
        return 1
    except backup.MigrationBackupFailed as e:
        # 그 문구는 올리기(업그레이드)용이다 — "업그레이드를 멈춥니다", "이전 버전으로 돌아가세요"가 내리는 사람에게는
        # 틀린 말이고, 잡지 않으면 traceback 이 그대로 나왔다 (0.45.0 D4). 원인은 갈래 이름만(경로·접속 주소를 싣지 않는다).
        reason = backup._failure_kind(e.__cause__ or e)
        sys.stderr.write(
            f"내리기 전 백업에 실패해 멈췄습니다: {reason}. 이 내리기는 다시 못 만드는 기록을 지우므로 백업 없이는 하지 않습니다. "
            "DB 는 그대로입니다.\n"
            "- 0.42 이상으로 돌아가는 것이면 내리지 않고 이미지만 바꿔도 됩니다 (DEPLOY.md 9-3).\n"
            "- 그보다 옛 버전이면 원인을 고친 뒤 다시 내리세요.\n"
        )
        return 1
    sys.stdout.write(f"DB 스키마: {before} → {now}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
