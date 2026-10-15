import { TickMarkType, type Time } from 'lightweight-charts'
import { currencyMeta } from './display'
import type { Currency } from '../types'

/* 차트 두 개(종목 PriceChart · 매크로 MacroChart)가 함께 쓰는 점 묶기와 글자 꼴 (0.42.0 에 PriceChart 에서 옮김) */

/** 거래일을 모를 때(시세 없이 점만 받았을 때) 같은 흐름으로 볼 최대 간격(달력 일). 주말을 건너뛰게. */
const STREAK_GAP_DAYS = 4

/**
 * 시그널은 며칠씩 연달아 뜨기 때문에 그대로 찍으면 점이 뭉쳐 하나의 덩어리가 된다.
 * 연속 발동 구간을 하나로 묶어 시작일에만 찍는다.
 *
 * **연속은 거래일로 센다** (`tradingDays` — 차트의 시세 날짜). 예전에는 달력 4일 안이면 이었다 — 그러면 하루 끊겼다가
 * 다시 뜬 신호(10-01~05, 10-08~14)가 한 구간이 되어 뒤 구간의 ▲ 가 사라졌다(0.41.0 사용자 확인 "오늘 ▲ 가 없다").
 */
export function collapseStreaks<T extends { date: string }>(
  items: T[],
  tradingDays?: readonly string[],
): { head: T; tail: T; length: number }[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
  const groups: { head: T; tail: T; length: number }[] = []
  const position = tradingDays ? new Map(tradingDays.map((d, i) => [d, i])) : null
  const asDays = (d: string) => new Date(`${d}T00:00:00Z`).getTime() / 86_400_000
  const follows = (prev: string, next: string) => {
    const a = position?.get(prev)
    const b = position?.get(next)
    if (a !== undefined && b !== undefined) return b - a === 1
    return asDays(next) - asDays(prev) <= STREAK_GAP_DAYS
  }

  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && follows(last.tail.date, item.date)) {
      last.length += 1
      last.tail = item
      continue
    }
    groups.push({ head: item, tail: item, length: 1 })
  }
  return groups
}

/** 차트에 찍을 날 — 구간마다 첫날, 그리고 **오늘(마지막 거래일)까지 이어진 구간이면 오늘도** */
export function markerDays<T extends { date: string }>(items: T[], tradingDays: readonly string[]): T[] {
  const today = tradingDays[tradingDays.length - 1]
  return collapseStreaks(items, tradingDays).flatMap(({ head, tail }) =>
    tail !== head && tail.date === today ? [head, tail] : [head],
  )
}

/** 티커로 통화 — 서버 `markets.market_of` 와 같은 규칙 (한국 .KS/.KQ, 일본 .T, 나머지 미국) */
export function currencyOfTicker(ticker: string): Currency {
  if (/\.(KS|KQ)$/.test(ticker)) return 'KRW'
  if (/\.T$/.test(ticker)) return 'JPY'
  return 'USD'
}

/** 세로축·십자선 가격 — 원·엔은 정수, 달러는 센트까지, 천 단위 쉼표 */
export function chartPrice(value: number, currency: Currency): string {
  const digits = currencyMeta(currency).priceDigits
  return value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function ymd(time: Time): [number, number, number] {
  if (typeof time === 'string') {
    const [y, m, d] = time.split('-').map(Number)
    return [y, m, d]
  }
  if (typeof time === 'number') {
    const date = new Date(time * 1000)
    return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
  }
  return [time.year, time.month, time.day]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 십자선 날짜 — 화면의 다른 날짜와 같은 꼴 "2026-10-09" */
export function chartDate(time: Time): string {
  const [y, m, d] = ymd(time)
  return `${y}-${pad(m)}-${pad(d)}`
}

/** 축 눈금 — 해가 바뀌는 자리는 "2026", 달은 "10월", 날은 "10.09" */
export function chartTick(time: Time, kind: TickMarkType): string {
  const [y, m, d] = ymd(time)
  if (kind === TickMarkType.Year) return String(y)
  if (kind === TickMarkType.Month) return `${m}월`
  return `${pad(m)}.${pad(d)}`
}

