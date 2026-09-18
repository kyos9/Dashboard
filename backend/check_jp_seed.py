"""내장 일본 종목 목록이 맞는지 야후와 대조한다.

**왜 필요한가.** `app/data/jp_seed.json`은 한국거래소 목록처럼 받아온 데이터가 아니라
손으로 적은 것이다. 종목코드를 잘못 적으면 **엉뚱한 회사의 시세**를 받아오는데, 그건
"못 찾았다"보다 나쁘다. 형식과 중복은 테스트가 막지만, **코드와 회사가 실제로 짝인지는
바깥에 물어봐야** 알 수 있다.

    python check_jp_seed.py          # 전부 대조
    python check_jp_seed.py 8766     # 한 종목만

야후가 돌려주는 영문 이름을 우리 한글 이름 옆에 나란히 찍는다. 자동으로 맞다/틀리다를
판정하지 않는다 — "도쿄해상홀딩스"와 "Tokio Marine Holdings"가 같은 회사인지는 사람이
보는 편이 정확하다. 눈에 띄는 것만 확인하면 된다.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.symbols import JP_SEED_PATH, _search_yahoo  # noqa: E402

LINE = "─" * 72
PAUSE_SECONDS = 0.4  # 야후에 너무 빠르게 물으면 막힌다


def lookup(code: str) -> str | None:
    """야후가 아는 그 종목의 이름. 못 찾으면 None."""
    for match in _search_yahoo(f"{code}.T", limit=5):
        if match.ticker.upper() == f"{code}.T":
            return match.name
    return None


def main() -> int:
    entries = json.loads(JP_SEED_PATH.read_text(encoding="utf-8"))
    wanted = {c.upper() for c in sys.argv[1:]}
    if wanted:
        entries = [e for e in entries if e["code"].upper() in wanted]
        if not entries:
            print(f"내장 목록에 없는 코드입니다: {', '.join(sorted(wanted))}")
            return 1

    print(f"{LINE}\n내장 일본 종목 목록 대조 — {len(entries)}종목\n{LINE}")
    print(f"{'코드':<6} {'우리 이름':<24} 야후가 아는 이름")
    print(LINE)

    missing: list[str] = []
    for index, entry in enumerate(entries):
        code, name = entry["code"], entry["name"]
        found = lookup(code)
        if found is None:
            missing.append(f"{code} {name}")
            found = "??? (야후에서 못 찾음)"
        print(f"{code:<6} {name:<24} {found}")
        if index < len(entries) - 1:
            time.sleep(PAUSE_SECONDS)

    print(LINE)
    if missing and len(missing) == len(entries) and len(entries) > 1:
        # 전부 실패했으면 목록이 아니라 네트워크 문제다. 목록을 의심하게 두면 안 된다.
        print("전부 확인에 실패했습니다 — 목록이 아니라 네트워크가 막혔을 가능성이 큽니다.")
        print("먼저 `python diagnose.py 7203.T` 로 연결부터 확인해주세요.")
        return 1

    if missing:
        print("야후에서 확인되지 않은 종목 — 상장폐지·코드 변경일 수 있습니다:")
        for line in missing:
            print(f"  - {line}")
        print()
    print("이름이 서로 다른 회사로 보이면 app/data/jp_seed.json 을 고치거나,")
    print("종목 관리 화면에서 그 종목의 이름을 직접 바꾸면 됩니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
