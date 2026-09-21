# 신호판을 어디서든 같은 모양으로 띄우기 위한 이미지.
#
# "내 PC에선 되는데 서버에선 안 된다"를 없애는 것이 목적이고, 덤으로 오라클이 막혔을 때
# 다른 곳으로 옮기는 비용이 거의 0이 된다. 파이썬 버전도, 노드 버전도, 시스템 패키지도
# 여기 적힌 것이 그대로 돌아간다.
#
# 폴더 구조는 저장소와 똑같이 맞춘다 (/srv/backend, /srv/frontend/dist).
# app/web.py 가 `backend/../frontend/dist` 를 찾기 때문이다 — 여기서만 다르게 두면
# 화면이 안 뜨는데 원인을 찾기 어렵다.

# ---- 1단계: 화면을 빌드한다 -------------------------------------------------
FROM node:22-slim AS frontend

WORKDIR /build
# package.json 만 먼저 복사해 의존성 설치를 캐시에 남긴다. 소스만 고쳤을 때
# npm ci 를 다시 돌리지 않는다.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2단계: 실제로 돌아가는 이미지 -------------------------------------------
#
# 파이썬 버전은 **개인 PC와 맞춘다.** 여기만 다르면 "내 PC에선 되는데 서버에선
# 안 된다"가 되고, 그건 이 이미지를 만든 이유 자체다. (인코딩 문제로 한 번 겪었다 —
# 환경이 갈라지면 가장 늦은 자리에서 알게 된다. app/migrate.py 참고.)
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# 남아야 하는 것은 전부 /data 아래로 모은다 (아래 VOLUME).
# 이미지 안에 두면 다시 올릴 때마다 통째로 사라진다.
ENV SIGNAL_DASHBOARD_DB=/data/signal_dashboard.db \
    SIGNAL_DASHBOARD_LOG_DIR=/data/logs \
    SIGNAL_DASHBOARD_BACKUP_DIR=/data/backups \
    SIGNAL_DASHBOARD_SECRET_FILE=/data/session.key

# postgresql-client: 백업의 pg_dump. curl: 아래 HEALTHCHECK.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/backend

COPY backend/requirements.txt backend/requirements-postgres.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-postgres.txt

COPY backend/ ./
COPY --from=frontend /build/dist /srv/frontend/dist

# 어느 커밋으로 만든 이미지인지. 이미지에는 .git 이 안 들어가므로(.dockerignore)
# 여기서 넣어주지 않으면 서버 화면이 버전만 알고 커밋은 모른다 — "올렸는데 그대로"가
# 코드 문제인지 옛 이미지인지 구분이 안 된다. 손으로 빌드하면 비어 있고, 그때는
# 앱이 알아서 git 에 물어본다.
ARG GIT_SHA=""
ENV APP_REVISION=$GIT_SHA

# root로 돌리지 않는다. 컨테이너가 뚫려도 할 수 있는 일이 줄어든다.
RUN useradd --create-home --uid 10001 signal \
    && mkdir -p /data \
    && chown -R signal:signal /data /srv
USER signal

VOLUME ["/data"]
EXPOSE 8000

# 시작하자마자가 아니라 좀 기다렸다 본다 — 첫 기동에는 마이그레이션이 돈다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8000/api/health || exit 1

# 워커는 하나로 둔다. 스케줄러가 앱 안에서 돌기 때문에 워커마다 하나씩 생긴다.
# (Postgres를 쓰면 app/services/leader.py 의 자물쇠가 실제로 막아주지만, 그건
#  실수를 받아내는 장치이고 기본 구성은 하나로 둔다.)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
