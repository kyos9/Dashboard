"""로그를 파일로 남긴다.

코드 곳곳은 이미 `logging`을 제대로 쓰고 있었다 — 시세 조회 실패, 제공자 폴백, 스케줄러
결과가 전부 찍히고 있다. 그런데 그게 **검은 콘솔 창으로 흘러가고 사라질 뿐**이었다.
창을 닫는 순간(그리고 서버에 올린 뒤에는 애초에) 어제 무슨 일이 있었는지 알 방법이 없다.

그래서 여기서는 로그를 만들지 않는다. 이미 만들어지고 있는 것을 **받아서 파일에 담는다.**

파일은 돌려쓴다(5MB × 3). 한 파일이 무한히 커지면 디스크를 먹고, 열어보기도 어렵다.
"""

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(
    os.environ.get("SIGNAL_DASHBOARD_LOG_DIR", Path(__file__).resolve().parents[1] / "logs")
)
LOG_FILE = LOG_DIR / "app.log"

MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 3

# 로그 한 줄의 모양. 진단 화면이 이 모양을 그대로 되짚어 읽으므로 둘을 같이 고쳐야 한다.
FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_HANDLER_NAME = "signal-dashboard-file"

# 파일에 담지 않을 로거. 접속 기록은 요청마다 한 줄씩 쌓여서, 며칠 전 경고를 회전에
# 밀어내 버린다. 진단 화면에서 보려는 건 그 경고지 접속 기록이 아니다.
# (접속 기록이 필요하면 start-backend.bat 으로 띄워 창에서 그대로 볼 수 있다.)
#
# 직접 안 붙이는 것만으로는 부족하다 — 로거는 부모(루트)로 기록을 올려보내므로,
# 루트에 붙은 핸들러가 결국 받아 적는다. 그래서 핸들러 쪽에서 걸러낸다.
EXCLUDED_LOGGERS = ("uvicorn.access",)


def _not_excluded(record: logging.LogRecord) -> bool:
    return not record.name.startswith(EXCLUDED_LOGGERS)


def _existing_handler() -> logging.Handler | None:
    for handler in logging.getLogger().handlers:
        if getattr(handler, "name", None) == _HANDLER_NAME:
            return handler
    return None


def setup_logging() -> Path | None:
    """루트 로거에 파일 핸들러를 붙인다. 여러 번 불러도 한 번만 붙는다.

    쓸 수 없는 경로(권한 없음 등)라면 **조용히 포기한다.** 로그를 못 남기는 것 때문에
    앱이 안 뜨면 그게 더 나쁘다.
    """
    if _existing_handler() is not None:
        return LOG_FILE

    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            LOG_FILE, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
        )
    except OSError:
        logging.getLogger(__name__).warning("로그 파일을 열 수 없어 파일 기록 없이 진행합니다")
        return None

    handler.name = _HANDLER_NAME
    handler.setFormatter(logging.Formatter(FORMAT, datefmt=DATE_FORMAT))
    handler.setLevel(logging.INFO)
    handler.addFilter(_not_excluded)

    root = logging.getLogger()
    root.addHandler(handler)
    # 루트가 WARNING이면 우리 코드의 logger.info가 핸들러까지 오지도 않는다.
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)

    # uvicorn은 자기 로거를 따로 세워 두고 propagate를 끊어 놓기도 한다. 기동 실패가
    # 파일에 없으면 정작 필요할 때 볼 게 없으므로 직접 붙인다.
    # (`uvicorn.access`는 위 EXCLUDED_LOGGERS에서 걸러진다.)
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).addHandler(handler)

    # 라이브러리가 INFO로 쏟는 것까지 담으면 우리 기록이 묻힌다
    for name in ("httpx", "httpcore", "urllib3", "apscheduler.executors.default"):
        logging.getLogger(name).setLevel(logging.WARNING)

    return LOG_FILE
