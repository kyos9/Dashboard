"""내장 미국 종목·ETF 목록이 맞는지 야후와 대조한다.

**왜 필요한가.** `app/data/us_seed.json`은 한국거래소 목록처럼 받아온 데이터가 아니라
손으로 적은 것이다. 티커를 잘못 적으면 **엉뚱한 회사의 시세**를 받아오는데, 그건
"못 찾았다"보다 나쁘다. 형식과 중복은 테스트가 막지만, **티커와 회사가 실제로 짝인지는
바깥에 물어봐야** 알 수 있다.

    python check_us_seed.py          # 전부 대조
    python check_us_seed.py AAPL QQQ # 몇 개만

우리가 적은 이름과 야후가 아는 이름을 나란히 찍고, 첫 낱말조차 겹치지 않으면 표시한다.
자동으로 맞다/틀리다를 판정하지는 않는다 — "Alphabet Inc. Class A"와 "Alphabet Inc."가
같은 회사인지는 사람이 보는 편이 정확하다. 표시된 줄만 확인하면 된다.
"""

import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.symbols import US_SEED_PATH, _search_yahoo  # noqa: E402

LINE = "─" * 78
PAUSE_SECONDS = 0.4  # 야후에 너무 빠르게 물으면 막힌다

# 회사 이름에서 어디에나 붙는 말 — 겹치는지 볼 때 세면 전부 "비슷함"이 된다
BOILERPLATE = {
    "inc", "inc.", "corp", "corp.", "corporation", "company", "co", "co.", "the",
    "ltd", "limited", "plc", "holdings", "group", "etf", "fund", "trust", "shares",
    "class", "a", "b", "c", "n.v.", "&",
}


def _words(name: str) -> set[str]:
    return {w for w in re.split(r"[\s,]+", name.lower()) if w and w not in BOILERPLATE}


def lookup(ticker: str) -> str | None:
    """야후가 아는 그 티커의 이름. 못 찾으면 None."""
    for match in _search_yahoo(ticker, limit=5):
        if match.ticker.upper() == ticker.upper():
            return match.name
    return None


def main() -> int:
    entries = json.loads(US_SEED_PATH.read_text(encoding="utf-8"))
    wanted = {t.upper() for t in sys.argv[1:]}
    if wanted:
        entries = [e for e in entries if e["code"].upper() in wanted]
        if not entries:
            print(f"내장 목록에 없는 티커입니다: {', '.join(sorted(wanted))}")
            return 1

    print(f"{LINE}\n내장 미국 목록 대조 — {len(entries)}종목\n{LINE}")
    print(f"{'':2}{'티커':<7} {'우리 이름':<40} 야후가 아는 이름")
    print(LINE)

    missing: list[str] = []
    suspect: list[str] = []
    for index, entry in enumerate(entries):
        ticker, name = entry["code"], entry["name"]
        found = lookup(ticker)

        mark = " "
        if found is None:
            missing.append(f"{ticker} {name}")
            found = "??? (야후에서 못 찾음)"
            mark = "?"
        elif not (_words(name) & _words(found)):
            suspect.append(f"{ticker}: 우리 '{name}' / 야후 '{found}'")
            mark = "!"

        print(f"{mark} {ticker:<7} {name[:40]:<40} {found}")
        if index < len(entries) - 1:
            time.sleep(PAUSE_SECONDS)

    print(LINE)
    if missing and len(missing) == len(entries) and len(entries) > 1:
        # 전부 실패했으면 목록이 아니라 네트워크 문제다. 목록을 의심하게 두면 안 된다.
        print("전부 확인에 실패했습니다 — 목록이 아니라 네트워크가 막혔을 가능성이 큽니다.")
        print("먼저 `python diagnose.py AAPL` 로 연결부터 확인해주세요.")
        return 1

    if missing:
        print("야후에서 확인되지 않은 티커 — 상장폐지·티커 변경일 수 있습니다:")
        for line in missing:
            print(f"  - {line}")
        print()
    if suspect:
        print("이름이 전혀 겹치지 않는 줄 (!) — 다른 회사일 수 있습니다:")
        for line in suspect:
            print(f"  - {line}")
        print()
    if not missing and not suspect:
        print("전부 이름이 겹칩니다.")
    print("고칠 것이 있으면 app/data/us_seed.json 을 손보거나,")
    print("종목 관리 화면에서 그 종목의 이름을 직접 바꾸면 됩니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
