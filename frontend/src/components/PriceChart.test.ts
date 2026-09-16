import { describe, expect, it } from 'vitest'
import { collapseStreaks } from './PriceChart'

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
    expect(collapseStreaks([d('2026-09-10')])).toEqual([{ head: d('2026-09-10'), length: 1 }])
  })

  it('연달아 뜬 날은 한 묶음으로 센다', () => {
    const groups = collapseStreaks([d('2026-09-10'), d('2026-09-11'), d('2026-09-14')])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({ head: d('2026-09-10'), length: 3 })
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
