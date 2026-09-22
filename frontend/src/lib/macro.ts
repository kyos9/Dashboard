import type { MacroSeriesInfo } from '../types'

/* 매크로 값을 화면 글자로 바꾸는 자리.
 *
 * **여기서 색으로 좋고 나쁨을 말하지 않는다.** 금리가 오르는 것이 좋은 일인지는
 * 지표마다 다르고, 같은 지표라도 무엇을 들고 있느냐에 따라 다르다. 시세처럼
 * 빨강/초록을 칠하면 화면이 "팔아라/사라"를 말하는 셈인데, 매크로를 시그널 조건에
 * 넣지 않기로 한 이유(services/macro.py 맨 앞)가 그대로 화면에도 적용된다.
 * 방향은 +/− 부호로만 말한다. */

/** 단위별 소수 자릿수. 금리는 0.01%p가 뉴스가 되지만 VIX는 소수 둘째 자리가 무의미하다 */
export function digitsFor(unit: string): number {
  if (unit === 'percent') return 2
  return 1
}

export function unitSuffix(unit: string): string {
  return unit === 'percent' ? '%' : ''
}

/** 카드에 크게 뜨는 숫자. 값이 없으면 '—' */
export function macroValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const digits = digitsFor(unit)
  return `${value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${unitSuffix(unit)}`
}

/**
 * 직전 값과의 차이.
 *
 * **%p로 적는다.** 금리 4.05% → 4.11% 는 "0.06% 올랐다"가 아니라 "0.06%p 올랐다"다.
 * 앞쪽으로 읽으면 1.5% 상승(4.05 × 1.015)이 되는데 그건 전혀 다른 숫자다.
 */
export function macroChange(change: number | null | undefined, unit: string): string {
  if (change === null || change === undefined || Number.isNaN(change)) return ''
  const digits = digitsFor(unit)
  const body = Math.abs(change).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±'
  return `${sign}${body}${unit === 'percent' ? '%p' : ''}`
}

/**
 * 공포·탐욕 지수의 구간 이름. CNN이 쓰는 경계 그대로다.
 *
 * 이 지표에만 붙는다 — 0~100 점수를 구간으로 읽는 것이 이 지수의 정의이고, 다른
 * 지표에는 그런 경계가 없다. (지표 전반의 "국면 배지"는 따로 할 일이다.)
 *
 * 색은 **극단인지 아닌지**만 말한다. 공포를 초록으로 칠하면 "지금 사라"가 되고
 * 탐욕을 빨강으로 칠하면 "지금 팔아라"가 되는데, 이 화면은 그 말을 하지 않는다.
 */
export function fearGreedZone(value: number | null): { label: string; tone: string } | null {
  if (value === null || Number.isNaN(value)) return null
  if (value < 25) return { label: '극단적 공포', tone: 'badge-amber' }
  if (value < 45) return { label: '공포', tone: 'badge-grey' }
  if (value <= 55) return { label: '중립', tone: 'badge-grey' }
  if (value <= 75) return { label: '탐욕', tone: 'badge-grey' }
  return { label: '극단적 탐욕', tone: 'badge-amber' }
}

/**
 * 마지막으로 **받아본** 시각을 "9/22 09:11" 로. 읽을 수 없으면 빈 문자열.
 *
 * `as_of`(값이 가리키는 날짜)만 보여주면 "9월 18일"이 두 가지 뜻이 된다 — 출처에 더
 * 새 것이 없거나, 우리가 18일 이후로 안 받아봤거나. 사용자가 할 일이 정반대다.
 * 실제로 이것 때문에 "날짜가 최신이 아니다"를 화면만 보고는 가릴 수 없었다.
 *
 * **시간대를 안 달고 오면 UTC 로 읽는다.** 서버는 UTC 로 저장하는데 `new Date` 는
 * 시간대 없는 문자열을 **보는 사람의 지역시**로 읽는다 — 그대로 두면 한국에서 아홉
 * 시간 어긋나고, 그 어긋남이 하필 "언제 받았나"를 묻는 자리에서 생긴다.
 */
export function checkedLabel(checkedAt?: string | null): string {
  if (!checkedAt) return ''
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(checkedAt)
  const when = new Date(hasZone ? checkedAt : `${checkedAt}Z`)
  if (Number.isNaN(when.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())}`
}

/** 주기를 사람 말로 (카드 아래 "월간 · 8월분" 처럼 쓴다) */
export const FREQUENCY_LABEL: Record<string, string> = {
  daily: '일간',
  weekly: '주간',
  monthly: '월간',
  quarterly: '분기',
}

/**
 * 이 지표가 지금 어떤 상태인가 — 카드에 한 줄로 뜨는 말.
 *
 * 세 가지를 구분한다. **받아본 적이 없다**(서버를 막 띄웠다), **받아봤는데 막혔다**
 * (사용자가 손대야 한다), **받았는데 오래됐다**(대개 발표가 아직 안 난 것이지만
 * 진짜 고장일 수도 있다). 셋을 "값 없음" 하나로 뭉치면 사용자가 할 일이 안 보인다.
 */
export function statusOf(series: MacroSeriesInfo): { text: string; tone: string } | null {
  if (series.last_error) {
    return { text: '받지 못했습니다', tone: 'badge-red' }
  }
  if (series.value === null) {
    return series.last_checked_at
      ? { text: '값 없음', tone: 'badge-grey' }
      : { text: '아직 안 받음', tone: 'badge-grey' }
  }
  if (series.stale) {
    return { text: '오래됨', tone: 'badge-amber' }
  }
  return null
}
