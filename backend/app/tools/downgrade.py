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
    before = migrate.current_revision()
    try:
        now = migrate.downgrade_to(args.revision)
    except ValueError as e:
        sys.stderr.write(f"{e}\n")
        return 1
    sys.stdout.write(f"DB 스키마: {before} → {now}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
