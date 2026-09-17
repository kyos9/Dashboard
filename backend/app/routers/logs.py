"""진단용 로그 조회.

**전체 로그를 그대로 화면에 쏟지 않는다.** 대부분은 "정상 동작 기록"이라 스크롤하다
안 읽게 된다. 실제로 알고 싶은 건 "어제 VOO 시세를 왜 못 받았나" 한 줄이고, 그건 경고
이상만 걸러도 나온다. 그래서 기본은 경고·오류만 보여주고, 전체가 필요하면 파일을
내려받게 한다.

주의: 여기에는 티커·에러·내부 경로가 찍힌다. 다중 사용자가 되면 **반드시 인증 뒤로
옮겨야 한다** (ROADMAP 4단계).
"""

import datetime as dt
import re

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.logging_setup import LOG_FILE
from app.schemas import LogEntry, LogsOut

router = APIRouter(prefix="/api/logs", tags=["logs"])

# 파일이 5MB까지 커지므로 전부 읽지 않는다. 뒤에서 이만큼만 떼어 본다.
TAIL_BYTES = 512 * 1024

# logging_setup.FORMAT과 짝이다. 한쪽을 고치면 다른 쪽도 고쳐야 한다.
LINE = re.compile(
    r"^(?P<time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) "
    r"(?P<level>[A-Z]+) "
    r"(?P<logger>[^:]+): "
    r"(?P<message>.*)$"
)

NOISY = {"DEBUG"}
WARNING_AND_UP = {"WARNING", "ERROR", "CRITICAL"}


def _tail_text(limit: int | None = None) -> str:
    # 기본값을 인자에 박으면 import 시점에 굳어 테스트에서 바꿀 수 없다
    limit = TAIL_BYTES if limit is None else limit
    size = LOG_FILE.stat().st_size
    with LOG_FILE.open("rb") as fh:
        if size > limit:
            fh.seek(size - limit)
            fh.readline()  # 잘린 첫 줄은 버린다
        return fh.read().decode("utf-8", errors="replace")


def parse_lines(text: str) -> list[LogEntry]:
    """로그 텍스트를 항목으로 나눈다. 오래된 것이 앞.

    형식에 안 맞는 줄은 버리지 않고 **바로 앞 항목에 이어 붙인다.** 그런 줄은 대부분
    파이썬 트레이스백인데, 오류를 보러 왔는데 정작 원인이 적힌 줄이 사라지면 곤란하다.
    """
    entries: list[LogEntry] = []
    for line in text.splitlines():
        match = LINE.match(line)
        if match is None:
            if entries and line.strip():
                entries[-1] = entries[-1].model_copy(
                    update={"message": entries[-1].message + "\n" + line}
                )
            continue
        entries.append(
            LogEntry(
                time=match["time"],
                level=match["level"],
                logger=match["logger"],
                message=match["message"],
            )
        )
    return entries


@router.get("", response_model=LogsOut)
def read_logs(
    level: str = Query("warning", pattern="^(warning|all)$"),
    limit: int = Query(200, ge=1, le=2000),
) -> LogsOut:
    if not LOG_FILE.is_file():
        return LogsOut(
            available=False,
            path=str(LOG_FILE),
            size_bytes=0,
            modified_at=None,
            level=level,
            entries=[],
            counts={},
        )

    stat = LOG_FILE.stat()
    entries = parse_lines(_tail_text())

    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry.level] = counts.get(entry.level, 0) + 1

    if level == "warning":
        shown = [e for e in entries if e.level in WARNING_AND_UP]
    else:
        shown = [e for e in entries if e.level not in NOISY]

    # 최근 것부터 보여준다 — 문제를 보러 온 사람은 방금 무슨 일이 있었는지가 궁금하다
    shown.reverse()

    return LogsOut(
        available=True,
        path=str(LOG_FILE),
        size_bytes=stat.st_size,
        modified_at=dt.datetime.fromtimestamp(stat.st_mtime),
        level=level,
        entries=shown[:limit],
        counts=counts,
    )


@router.get("/download")
def download_logs() -> FileResponse:
    """로그 파일 원본. 화면에서 못 알아볼 때 통째로 받아 보라고 둔다."""
    if not LOG_FILE.is_file():
        raise HTTPException(status_code=404, detail="아직 기록된 로그가 없습니다")
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    return FileResponse(
        LOG_FILE, media_type="text/plain", filename=f"signalboard-{stamp}.log"
    )
