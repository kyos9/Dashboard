#!/bin/sh
# 서버의 백업을 서버 밖(관리자 PC)으로 꺼낼 때 서버 쪽에서 하는 일 (0.45.0 A, DEPLOY.md 10).
# 관리자 PC 의 server-backup-pull.bat 이 ssh 로 부른다. 손으로도 된다:
#
#   ~/Dashboard/deploy/backup-export.sh export   # 가장 새 매일 백업을 꺼낼 폴더로 → "이름 바이트수" 한 줄
#   ~/Dashboard/deploy/backup-export.sh clean    # 꺼낼 폴더를 지운다 (받든 못 받든 끝에 늘)
#   ~/Dashboard/deploy/backup-export.sh mark     # 밖에 꺼냈다고 적는다 (받은 크기를 확인한 뒤에만)
#
# 백업을 **새로 뜨지 않는다** — 매일 23:30·켤 때 뜬 것 중 가장 새것을 꺼낸다. 꺼내는 쪽이 뜨면 그것이 "매일 백업"으로
# 세어져 스케줄러가 멈춘 것을 가린다. 업그레이드 직전 백업(-premigrate)·상태 파일은 고르지 않는다.
# 꺼낼 폴더는 볼륨 밖이라 앱의 7벌 순환이 닿지 않는다 — 그래서 늘 비운다(방침 5절: 탈퇴한 사람의 데이터가 오래 남지 않게).
set -eu

DOCKER="${DOCKER:-docker}"
EXPORT_DIR="${EXPORT_DIR:-$HOME/dashboard-backup-export}"
SETTLE_SECONDS="${SETTLE_SECONDS:-2}"
cd "$(dirname "$0")/.."

remote_size() {
  $DOCKER compose exec -T app stat -c %s "/data/backups/$1"
}

case "${1:-}" in
  export)
    rm -rf "$EXPORT_DIR"
    mkdir -p "$EXPORT_DIR"
    chmod 700 "$EXPORT_DIR"
    newest=$($DOCKER compose exec -T app sh -c 'ls -1 /data/backups' \
      | grep -E '^signalboard-[0-9]{8}-[0-9]{6}\.(db|sql)$' | sort | tail -n 1 || true)
    if [ -z "$newest" ]; then
      echo "매일 백업이 아직 없습니다 — 앱이 켜진 뒤 1분, 또는 밤 11시 반 뒤에 다시 하세요." >&2
      exit 1
    fi
    # pg_dump 는 마지막 이름에 바로 쓴다 — 쓰는 중이면 크기가 자란다
    before=$(remote_size "$newest")
    sleep "$SETTLE_SECONDS"
    after=$(remote_size "$newest")
    if [ "$before" != "$after" ]; then
      echo "백업을 쓰는 중입니다 — 잠시 뒤 다시 하세요." >&2
      exit 1
    fi
    $DOCKER compose cp "app:/data/backups/$newest" "$EXPORT_DIR/$newest" >/dev/null
    chmod 600 "$EXPORT_DIR/$newest"
    got=$(wc -c < "$EXPORT_DIR/$newest" | tr -d ' ')
    if [ "$got" != "$after" ]; then
      echo "꺼낸 파일의 크기가 다릅니다 ($got / $after) — 다시 하세요." >&2
      rm -rf "$EXPORT_DIR"
      exit 1
    fi
    echo "$newest $after"
    ;;
  clean)
    rm -rf "$EXPORT_DIR"
    ;;
  mark)
    $DOCKER compose exec -T app python -m app.tools.backup_pulled
    ;;
  *)
    echo "쓰는 법: $0 export | clean | mark" >&2
    exit 2
    ;;
esac
