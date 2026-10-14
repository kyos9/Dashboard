"""전 종목의 지난 시그널 판정을 저장된 시세로 다시 계산한다 (손으로).

    python -m app.tools.recompute_signals            # 정의가 바뀌었을 때만 (서버가 켤 때 하는 것과 같다)
    python -m app.tools.recompute_signals --force    # 바뀌지 않았어도

서버가 켜질 때 저절로 하므로(`services/signal_recompute.py`) 보통은 부를 일이 없다. 네트워크를 쓰지 않는다.
서버(Docker)에서는 `docker compose exec app python -m app.tools.recompute_signals`.
"""

from __future__ import annotations

import argparse
import json

from app.db import SessionLocal, init_db
from app.services import signal_recompute


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="시그널 지난 판정 다시 계산")
    parser.add_argument("--force", action="store_true", help="정의가 그대로여도 다시 계산한다")
    args = parser.parse_args(argv)
    init_db()
    db = SessionLocal()
    try:
        summary = (
            signal_recompute.recompute_all(db, reason="manual")
            if args.force
            else signal_recompute.run_if_changed(db)
        )
    finally:
        db.close()
    if summary is None:
        print("시그널 정의가 그대로입니다 — 다시 계산하지 않았습니다 (--force 로 강제)")
        return 0
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
