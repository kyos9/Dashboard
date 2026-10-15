import { describe, expect, it } from 'vitest'
import { TickMarkType, type Time } from 'lightweight-charts'
import { chartDate, chartPrice, chartTick, collapseStreaks, currencyOfTicker, markerDays } from '../lib/chartFormat'

/**
 * 어깨매도는 며칠씩 연속으로 발동한다. 그대로 마커를 찍으면 라벨이 겹쳐 읽을 수 없어서
 * 연속 구간을 하나로 묶는다. 묶는 기준은 "직전 마커(tail)와의 간격"이지 그룹의
 * 시작일(head)이 아니다 — head 기준으로 재면 긴 연속 구간이 도중에 끊긴다.
 */
const d = (date: string) => ({ date })

describe('연속 시그널 묶기', () => {
  it('빈 입력은 빈 결과', () => {
    expect(collapseStreaks([])).toEqual([])
  })

  it('하루짜리 발동은 그대로 하나', () => {
    expect(collapseStreaks([d('2026-09-10')])).toEqual([{ head: d('2026-09-10'), tail: d('2026-09-10'), length: 1 }])
  })

  it('연달아 뜬 날은 한 묶음으로 센다', () => {
    const groups = collapseStreaks([d('2026-09-10'), d('2026-09-11'), d('2026-09-14')])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({ head: d('2026-09-10'), tail: d('2026-09-14'), length: 3 })
  })

  it('간격이 벌어지면 다른 묶음으로 나눈다', () => {
    const groups = collapseStreaks([d('2026-09-10'), d('2026-09-20')])
    expect(groups.map((g) => g.head.date)).toEqual(['2026-09-10', '2026-09-20'])
  })

  it('긴 연속 구간이 도중에 끊기지 않는다', () => {
    // 4일씩 이어지는 12개. 그룹 시작일과 비교했다면 두세 조각으로 쪼개졌을 것이다.
    const dates = Array.from({ length: 12 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 8, 1 + i * 4))
      return d(day.toISOString().slice(0, 10))
    })

    const groups = collapseStreaks(dates)
    expect(groups).toHaveLength(1)
    expect(groups[0].length).toBe(12)
  })

  it('경계값: 정확히 4일 간격은 같은 묶음, 5일은 새 묶음', () => {
    expect(collapseStreaks([d('2026-09-10'), d('2026-09-14')])).toHaveLength(1)
    expect(collapseStreaks([d('2026-09-10'), d('2026-09-15')])).toHaveLength(2)
  })

  it('입력 순서가 뒤섞여 있어도 날짜순으로 묶는다', () => {
    const groups = collapseStreaks([d('2026-09-20'), d('2026-09-10'), d('2026-09-11')])
    expect(groups.map((g) => [g.head.date, g.length])).toEqual([
      ['2026-09-10', 2],
      ['2026-09-20', 1],
    ])
  })

  it('원본 배열을 건드리지 않는다', () => {
    const input = [d('2026-09-20'), d('2026-09-10')]
    collapseStreaks(input)
    expect(input[0].date).toBe('2026-09-20')
  })

  it('많은 발동을 읽을 수 있는 수로 줄인다', () => {
    // 매 거래일마다 뜬 41일치 — 실제로 GOOG 1년 차트에서 나왔던 상황
    const dates = Array.from({ length: 41 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 0, 1 + i))
      return d(day.toISOString().slice(0, 10))
    })

    expect(collapseStreaks(dates)).toHaveLength(1)
  })
})

describe('연속은 거래일로 센다 (0.42.0)', () => {
  // 10-01~05 와 10-08~14 — 10-06·07 은 거래일인데 신호가 꺼졌다. 달력 4일 안이라 예전에는 한 구간이 됐다
  const trading = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14']
  const on = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'].map(d)

  it('거래일 하나라도 끊기면 다른 구간', () => {
    expect(collapseStreaks(on, trading).map((g) => [g.head.date, g.tail.date])).toEqual([
      ['2026-10-01', '2026-10-05'],
      ['2026-10-08', '2026-10-14'],
    ])
  })

  it('주말·휴장일(거래일이 아닌 날)은 건너도 이어진다', () => {
    expect(collapseStreaks([d('2026-10-09'), d('2026-10-12')], trading)).toHaveLength(1)
  })

  it('오늘까지 이어진 구간은 첫날과 오늘 둘 다 찍는다 — 오늘 뜬 매수가 차트에 보인다', () => {
    expect(markerDays(on, trading).map((x) => x.date)).toEqual(['2026-10-01', '2026-10-08', '2026-10-14'])
  })

  it('오늘에 닿지 않은 구간은 첫날만, 오늘 하루짜리는 하나만', () => {
    expect(markerDays([d('2026-10-01'), d('2026-10-02')], trading).map((x) => x.date)).toEqual(['2026-10-01'])
    expect(markerDays([d('2026-10-14')], trading).map((x) => x.date)).toEqual(['2026-10-14'])
  })
})

describe('차트 글자 꼴 (0.42.0)', () => {
  it('세로축 가격 — 원·엔은 정수 + 쉼표, 달러는 센트까지', () => {
    expect(chartPrice(68000, 'KRW')).toBe('68,000')
    expect(chartPrice(2850.4, 'JPY')).toBe('2,850')
    expect(chartPrice(1234.5, 'USD')).toBe('1,234.50')
  })

  it('티커로 통화 — 서버와 같은 규칙', () => {
    expect(currencyOfTicker('005930.KS')).toBe('KRW')
    expect(currencyOfTicker('247540.KQ')).toBe('KRW')
    expect(currencyOfTicker('7203.T')).toBe('JPY')
    expect(currencyOfTicker('VOO')).toBe('USD')
  })

  it('날짜 — 십자선 "2026-10-09", 눈금은 해·달·날', () => {
    expect(chartDate('2026-10-09' as Time)).toBe('2026-10-09')
    expect(chartDate({ year: 2026, month: 3, day: 5 } as Time)).toBe('2026-03-05')
    expect(chartTick({ year: 2026, month: 10, day: 9 } as Time, TickMarkType.DayOfMonth)).toBe('10.09')
    expect(chartTick({ year: 2026, month: 10, day: 1 } as Time, TickMarkType.Month)).toBe('10월')
    expect(chartTick({ year: 2027, month: 1, day: 1 } as Time, TickMarkType.Year)).toBe('2027')
  })
})
