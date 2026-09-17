"""거래일 캘린더.

기간 경계(월/분기/반기)와 리뷰 마감일이 여기서 나온다. 여기가 틀리면 폴백 매수일과
리뷰 마감일이 실제로 장이 열리지 않는 날로 잡힌다.
"""

import datetime as dt
import subprocess
import sys
from pathlib import Path

from app.markets import Market
from app.services.trading_calendar import period_trading_bounds, trading_days


def test_korea_and_us_close_on_different_days():
    """12월 31일은 한국이 휴장이고 미국은 개장한다 — 같은 캘린더를 쓰면 안 되는 이유."""
    _, kr_end = period_trading_bounds(dt.date(2025, 12, 15), "quarterly", Market.KR)
    _, us_end = period_trading_bounds(dt.date(2025, 12, 15), "quarterly", Market.US)

    assert kr_end != us_end
    assert us_end == dt.date(2025, 12, 31)
    assert kr_end == dt.date(2025, 12, 30)


def test_weekends_are_not_trading_days():
    days = trading_days(dt.date(2026, 9, 1), dt.date(2026, 9, 30), Market.KR)
    assert all(day.weekday() < 5 for day in days)
    assert len(days) == 20


# 이 코드는 **새 파이썬 프로세스**에서 돈다. 같은 프로세스 안에서 재현하려 했더니
# 앞선 테스트들이 이미 라이브러리 내부 캐시를 데워놔서 경쟁이 일어나지 않았고,
# 잠금을 빼도 통과하는 — 있으나 마나 한 — 테스트가 됐다. 처음 켠 순간을 보려면
# 정말로 아무것도 데워지지 않은 상태여야 한다.
FIRST_LOAD = """
import datetime as dt, threading
from app.markets import Market
from app.services.trading_calendar import trading_days

errors, results = [], []

def open_the_dashboard():
    try:
        results.append(tuple(trading_days(dt.date(2026, 9, 1), dt.date(2026, 9, 30), Market.KR)))
    except Exception as exc:
        errors.append(f"{type(exc).__name__}: {exc}")

threads = [threading.Thread(target=open_the_dashboard) for _ in range(8)]
for t in threads: t.start()
for t in threads: t.join()

assert not errors, errors
assert len(set(results)) == 1, "스레드마다 다른 답이 나왔습니다"
print("OK")
"""


def test_first_screen_load_does_not_break_the_calendar():
    """화면을 처음 열 때 여러 요청이 동시에 캘린더를 만든다.

    `lru_cache`는 저장소만 스레드 안전하지 **함수 본문이 동시에 실행되는 건 막지
    않는다.** 캐시가 빈 상태로 여러 스레드가 들어가면 라이브러리 안쪽의 공유 상태를
    같이 건드려 반쯤 만들어진 캘린더가 나왔다
    (`Length of values (288) does not match length of index (245)`).

    새로고침하면 캐시가 차 있어 멀쩡해지므로 "가끔 그러네"로 넘어가기 쉬웠다.
    """
    result = subprocess.run(
        [sys.executable, "-c", FIRST_LOAD],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr[-2000:]
