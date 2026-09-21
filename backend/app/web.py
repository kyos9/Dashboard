"""빌드된 프런트엔드를 백엔드가 직접 내보낸다.

개발할 때는 vite 개발 서버가 따로 떠 있어야 한다(HMR 때문에). 하지만 **실제로 쓸 때는
그럴 이유가 없다** — 화면은 이미 정적 파일 한 묶음이고, 그걸 내보내는 일은 FastAPI가
할 수 있다. 그래서 여기서 `frontend/dist`를 마운트한다.

이렇게 하면:

- 프로세스가 하나가 된다 (검은 콘솔 창이 둘에서 하나로, 그다음 0개로)
- 포트가 하나가 된다 (`http://localhost:8000`). 프록시도, CORS도 필요 없다
- 서버에 올릴 때 띄울 게 하나뿐이다

`dist`가 없으면(빌드 전이거나 개발 중이면) 아무것도 하지 않는다. 그 경우는 예전처럼
vite 개발 서버로 접속하면 된다.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# backend/app/web.py → backend/app → backend → Dashboard
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

# 브라우저가 항상 다시 받아야 하는 파일. 나머지(assets/…)는 파일명에 해시가 붙어 있어
# 영원히 캐시해도 안전하다.
#
# - index.html   : 캐시되면 새 버전을 배포해도 옛 화면이 뜬다.
# - sw.js        : 서비스 워커. **이게 캐시되면 새 버전이 영영 안 내려간다** — 브라우저는
#                  이 파일을 다시 받아 내용이 달라졌을 때만 갱신을 시작하는데, 캐시가
#                  옛 내용을 돌려주면 "달라진 적이 없는" 상태로 굳는다. 고치려면 사람이
#                  브라우저 설정에서 손으로 지워야 하므로, 여기서 막는다.
# - manifest     : 앱 이름·아이콘이 여기 있다. 고쳐도 한참 옛것이 남으면 원인을 찾기 어렵다.
NO_CACHE = {"index.html", "sw.js", "manifest.webmanifest"}


def frontend_dist() -> Path | None:
    """빌드된 화면이 있으면 그 경로를, 없으면 None."""
    return DIST if (DIST / "index.html").is_file() else None


def _file_response(path: Path) -> FileResponse:
    headers = {"Cache-Control": "no-cache"} if path.name in NO_CACHE else None
    return FileResponse(path, headers=headers)


def mount_frontend(app: FastAPI) -> bool:
    """빌드 결과가 있으면 붙이고 True. 없으면 아무 일도 하지 않고 False."""
    dist = frontend_dist()
    if dist is None:
        return False

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        """라우터가 못 잡은 주소는 전부 화면으로 넘긴다.

        `/history` 같은 주소는 서버에 그런 파일이 없고 브라우저 안에서만 뜻이 있다.
        그래서 index.html을 돌려주고 나머지는 화면이 알아서 한다 (SPA 폴백).

        단 `/api/...`는 예외다. 없는 API를 불렀는데 HTML이 돌아오면 "JSON인 줄 알았는데
        <!doctype html>" 같은 엉뚱한 오류를 쫓게 된다. 404를 그대로 내보낸다.
        """
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        # 정적 파일(favicon.svg 등)은 그대로. 경로 조작으로 바깥 파일을 읽지 못하게
        # 반드시 dist 안에 있는지 확인한다.
        if full_path:
            candidate = (dist / full_path).resolve()
            if candidate.is_file() and candidate.is_relative_to(dist.resolve()):
                return _file_response(candidate)

        return _file_response(dist / "index.html")

    return True
