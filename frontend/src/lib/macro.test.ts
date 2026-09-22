import { describe, expect, it } from 'vitest'
import { checkedLabel, fearGreedZone, macroChange, macroValue, statusOf } from './macro'
import type { MacroSeriesInfo } from '../types'

function series(overrides: Partial<MacroSeriesInfo>): MacroSeriesInfo {
  return {
    code: 'DGS10', name: '10년물', note: null, unit: 'percent', transform: 'none',
    transform_label: null, frequency: 'daily', as_of: '2026-09-21', value: 4.11,
    previous: 4.05, change: 0.06, released_at: null, source: 'fred_api', stale: false,
    last_checked_at: '2026-09-21T23:00:00', last_ok_at: '2026-09-21T23:00:00',
    last_error: null, ...overrides,
  }
}

describe('값 표시', () => {
  it('금리는 소수 둘째 자리까지 — 0.01%p가 뉴스가 된다', () => {
    expect(macroValue(4.1, 'percent')).toBe('4.10%')
  })

  it('지수는 소수 첫째 자리까지 — VIX 18.42의 둘째 자리는 의미가 없다', () => {
    expect(macroValue(18.42, 'level')).toBe('18.4')
  })

  it('값이 없으면 0이 아니라 줄표다 — 0%는 실제로 있을 수 있는 값이다', () => {
    expect(macroValue(null, 'percent')).toBe('—')
    expect(macroValue(0, 'percent')).toBe('0.00%')
  })
})

describe('변화폭', () => {
  it('%p로 적는다 (4.05 → 4.11 은 1.5% 상승이 아니다)', () => {
    expect(macroChange(0.06, 'percent')).toBe('+0.06%p')
    expect(macroChange(-0.12, 'percent')).toBe('−0.12%p')
  })

  it('%가 아닌 지표에는 %p를 안 붙인다', () => {
    expect(macroChange(-5.1, 'level')).toBe('−5.1')
  })

  it('변화가 없으면 ±로 적는다 — 빈칸이면 "못 받았다"로 읽힌다', () => {
    expect(macroChange(0, 'percent')).toBe('±0.00%p')
  })

  it('직전 값이 없으면 아무것도 안 붙인다', () => {
    expect(macroChange(null, 'percent')).toBe('')
  })
})

describe('공포·탐욕 구간', () => {
  it.each([
    [5, '극단적 공포'],
    [24.9, '극단적 공포'],
    [25, '공포'],
    [50, '중립'],
    [55, '중립'],
    [56, '탐욕'],
    [75, '탐욕'],
    [76, '극단적 탐욕'],
    [100, '극단적 탐욕'],
  ])('%s점은 %s', (value, label) => {
    expect(fearGreedZone(value)!.label).toBe(label)
  })

  it('양 극단만 눈에 띄게 한다 — 공포를 초록으로 칠하면 "사라"가 된다', () => {
    expect(fearGreedZone(10)!.tone).toBe('badge-amber')
    expect(fearGreedZone(90)!.tone).toBe('badge-amber')
    expect(fearGreedZone(50)!.tone).toBe('badge-grey')
  })
})

describe('지표 상태', () => {
  it('멀쩡하면 아무 배지도 안 붙는다', () => {
    expect(statusOf(series({}))).toBeNull()
  })

  it('막힌 것과 아직 안 받은 것과 오래된 것은 할 일이 다르다', () => {
    expect(statusOf(series({ last_error: '막힘' }))!.text).toBe('받지 못했습니다')
    expect(statusOf(series({ value: null, last_checked_at: null }))!.text).toBe('아직 안 받음')
    expect(statusOf(series({ value: null }))!.text).toBe('값 없음')
    expect(statusOf(series({ stale: true }))!.text).toBe('오래됨')
  })

  it('실패가 우선이다 — 못 받았는데 "오래됨"만 뜨면 기다리면 되는 줄 안다', () => {
    expect(statusOf(series({ stale: true, last_error: '막힘' }))!.text).toBe('받지 못했습니다')
  })
})

describe('마지막 확인 시각', () => {
  it('시간대를 안 달고 오면 UTC로 읽는다 — 그냥 두면 한국에서 아홉 시간 어긋난다', () => {
    // 같은 순간을 두 가지로 적어주고 같은 결과가 나오는지 본다.
    // (시간대는 보는 사람의 것이므로 문자열을 못 박지 않는다.)
    expect(checkedLabel('2026-09-21T16:00:00Z')).not.toBe('')  // 빈 문자열끼리 비교하면 아무것도 확인 못 한다
    expect(checkedLabel('2026-09-21T16:00:00')).toBe(checkedLabel('2026-09-21T16:00:00Z'))
    expect(checkedLabel('2026-09-21T16:00:00.123456')).toBe(checkedLabel('2026-09-21T16:00:00Z'))
  })

  it('시간대가 붙어 오면 그대로 존중한다', () => {
    expect(checkedLabel('2026-09-21T16:00:00+00:00')).toBe(checkedLabel('2026-09-21T16:00:00Z'))
    expect(checkedLabel('2026-09-22T01:00:00+09:00')).toBe(checkedLabel('2026-09-21T16:00:00Z'))
  })

  it('한 번도 안 받아봤으면 빈 문자열', () => {
    expect(checkedLabel(null)).toBe('')
    expect(checkedLabel(undefined)).toBe('')
  })

  it('읽을 수 없는 값은 아예 안 붙인다 — Invalid Date 는 없는 것보다 나쁘다', () => {
    expect(checkedLabel('그런 시각 없음')).toBe('')
  })
})
