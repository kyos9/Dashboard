import { useEffect, useState } from 'react'

/**
 * 차트 색 — 디자인 4차(색표는 styles/tokens.css 한 곳). lightweight-charts 는 CSS 를 모르므로
 * 그릴 때 문서 루트의 CSS 변수(--chart-* · --signal-*)를 읽어 넘긴다. 색 값을 여기 적지 않는다.
 * 테마(data-theme)나 상승 색(data-rise)이 바뀌면 다시 그리도록 그 둘을 지켜본다.
 */
export interface ChartPalette {
  text: string
  grid: string
  line: string
  bg: string
  zero: string
  buy: string
  sell: string
  font: string
}

function read(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim()
}

export function readChartPalette(): ChartPalette {
  const style = getComputedStyle(document.documentElement)
  return {
    text: read(style, '--chart-text'),
    grid: read(style, '--chart-grid'),
    line: read(style, '--chart-line'),
    bg: read(style, '--chart-bg'),
    zero: read(style, '--chart-zero'),
    buy: read(style, '--signal-buy'),
    sell: read(style, '--signal-sell'),
    font: read(style, '--font-sans'),
  }
}

/** 차트 색을 다시 읽어야 하는 때를 알리는 값 — 테마·상승 색이 바뀌면 달라진다 */
export function useChartThemeKey(): string {
  const now = () => {
    const root = document.documentElement
    return `${root.getAttribute('data-theme') ?? ''}|${root.getAttribute('data-rise') ?? ''}`
  }
  const [key, setKey] = useState(now)
  useEffect(() => {
    const observer = new MutationObserver(() => setKey(now()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-rise'] })
    return () => observer.disconnect()
  }, [])
  return key
}

/** 색 값이 비어 있으면(테스트 환경 등) 라이브러리에 넘기지 않는다 — 빈 글자는 색으로 읽지 못해 넘어진다 */
export function orUndefined(value: string): string | undefined {
  return value === '' ? undefined : value
}
