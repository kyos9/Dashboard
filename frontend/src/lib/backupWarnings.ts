import type { BackupStatus } from '../types'

/** 하루 한 벌이 도는데 이보다 오래면 멈춘 것 */
export const BACKUP_STALE_HOURS = 36
/** 서버 밖으로 꺼낸 지 이보다 오래면 — 서버의 `backup.OFFSITE_STALE_DAYS` 와 같다(헤더 ⋯ 의 점) */
export const OFFSITE_STALE_DAYS = 30

/**
 * 진단의 백업 칸이 경고(노란 줄)를 띄우는 까닭 셋 — 경고 줄과 맨 위 요약이 **같은 판정**을 쓰게 한 곳에 둔다(0.45.1 C1).
 * 요약이 서버 로그만 세어, 백업 칸에 경고가 있는데 위에는 "경고·오류가 없습니다"라고 했다(0.45 A 사용자 확인).
 * `now` — 응답을 받은 때.
 */
export function backupWarnings(backup: BackupStatus, now: number) {
  // "마지막"·멈춤 경고는 매일 백업만 — 업그레이드 직전 백업이 멈춘 것을 가리지 않게 (0.44.0 D0 검토)
  const stale = backup.last_at !== null && now - new Date(backup.last_at).getTime() > BACKUP_STALE_HOURS * 3600_000
  const failed = backup.last_failure != null
  // 서버(`attention`)와 같은 경계 — 30일이 **지난 순간**부터. 날 수로 자르면 30~31일 사이 하루는 ⋯ 점만 뜨고 까닭이 없었다
  const pulledAt = backup.offsite?.last_at ?? null
  const age = pulledAt ? now - new Date(pulledAt).getTime() : null
  const offsiteStaleDays = age !== null && age > OFFSITE_STALE_DAYS * 86400_000 ? Math.floor(age / 86400_000) : null
  return { stale, failed, offsiteStaleDays, any: stale || failed || offsiteStaleDays !== null }
}
