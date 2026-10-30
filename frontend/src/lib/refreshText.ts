import { parseInstant, whenText } from './diagTime'
import type { RefreshStatus } from '../types'

/** 시세 받기 줄의 글 (0.46.0 C) — 진단 화면이 쓴다. 화면 파일 밖에 두는 것은 화면 파일이 부품만 내보내게(빠른 새로고침) */

function when(iso: string): string {
  const ms = parseInstant(iso, 'utc')
  return ms === null ? iso : whenText(ms)
}

const MARKET_TEXT: Record<string, string> = { US: '미국', KR: '한국', JP: '일본' }
const PROVIDER_TEXT: Record<string, string> = { yahoo: 'Yahoo', stooq: 'Stooq', naver: '네이버' }

/** "2026-10-26" → "10월 26일" */
function dayText(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return m && d ? `${m}월 ${d}일` : iso
}

/** 한 시장의 한 줄 (0.46.0 C) — 서버는 이름·숫자만 보낸다(오류 글 없음) */
export function refreshLine(state: RefreshStatus): string {
  const market = MARKET_TEXT[state.market] ?? state.market
  const sources = state.providers.length
    ? ` (시세 출처 ${state.providers.map((p) => PROVIDER_TEXT[p] ?? p).join('·')})`
    : ''
  if (!state.blocked) {
    const names = state.failed > 0 && state.failed_tickers.length ? ` (${state.failed_tickers.join(', ')})` : ''
    return `${market}: ${when(state.at)} 받음 · ${state.total}종목 중 실패 ${state.failed}${names}`
  }
  if (state.reason === 'stale' && state.failed === 0) {
    const day = state.latest_date ? dayText(state.latest_date) : '?'
    return `${market}: 받았지만 시세가 ${day}에 멈춰 있습니다${sources}`
  }
  const last = state.last_ok_at ? `마지막으로 받은 때 ${when(state.last_ok_at)}` : '아직 제대로 받은 적이 없습니다'
  return `${market}: ${when(state.at)} ${state.total}종목 중 ${state.failed}개 실패${sources} — ${last}`
}

/** 진단의 어느 칸을 봐야 하나 — ⋯ 의 점 풀이에 붙인다. 없으면 null */
export function diagnosticsReason(backup: boolean, refresh: boolean): string | null {
  if (backup && refresh) return '백업 · 시세 받기'
  if (backup) return '백업'
  if (refresh) return '시세 받기'
  return null
}
