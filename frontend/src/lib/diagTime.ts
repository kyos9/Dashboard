/**
 * 진단 창의 시각 (0.45.2 B5) — 한 창 안의 시각이 세 꼴이었고, 서버 로그·느린 요청·다시 계산은 시간대 없이 와서 9시간 어긋나 보였다.
 *
 * 브라우저의 `new Date("2026-10-22 00:30:15")` 는 사파리에서 Invalid Date 라 글자를 직접 읽는다(계획 검토).
 * 시간대 표시(`Z`·`+09:00`)가 없으면 **어느 시간대인지 부르는 쪽이 정한다** — 다시 계산은 UTC, 옛 서버의 느린 요청·로그는 서버 현지라
 * 모른다(null → 글자 그대로 보인다).
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

export function parseInstant(text: string | null | undefined, naive: 'utc' | null = null): number | null {
  const m = text ? ISO.exec(text.trim()) : null
  if (!m) return null
  const [, y, mo, d, h, mi, s = '0', zone] = m
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (zone === undefined) return naive === 'utc' ? utc : null
  if (zone === 'Z') return utc
  const sign = zone.startsWith('-') ? -1 : 1
  const digits = zone.slice(1).replace(':', '')
  return utc - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000
}

/** 보는 사람의 시간대로 "10월 22일 09:30" — `seconds` 면 "10월 22일 09:30:15"(로그만). `timeZone` 은 시험용 */
export function whenText(ms: number, { seconds = false, timeZone }: { seconds?: boolean; timeZone?: string } = {}): string {
  return new Date(ms).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false,
    timeZone,
  })
}

