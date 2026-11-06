import { useEffect, useState } from 'react'
import { api } from '../api/client'

/**
 * 카드 보기의 스파크라인에 쓸 지난 석 달 종가 (디자인 4차 목업 11 나).
 *
 * 새 API 없이 차트가 쓰는 시세(getHistory 6개월)를 그대로 받아 끝의 63거래일만 쓴다. 카드 보기를 고른 사람만 받는다.
 * 한 번 받은 것은 이 탭이 살아 있는 동안 들고 있고, 한꺼번에 15개를 쏘지 않게 셋씩 받는다.
 * 못 받으면 그 카드만 선이 빈다(숫자는 그대로 보인다).
 */
const DAYS = 63
const AT_ONCE = 3
const store = new Map<string, number[] | null>()

export function useSparkHistory(tickers: string[], enabled: boolean): Map<string, number[] | null> {
  const [, bump] = useState(0)
  const key = tickers.join(',')
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const queue = tickers.filter((t) => !store.has(t))
    const next = async (): Promise<void> => {
      const ticker = queue.shift()
      if (!ticker || !alive) return
      try {
        const history = await api.getHistory(ticker, '6mo')
        store.set(ticker, history.prices.slice(-DAYS).map((p) => p.close))
      } catch {
        store.set(ticker, null)
      }
      if (alive) bump((n) => n + 1)
      return next()
    }
    for (let i = 0; i < AT_ONCE; i++) void next()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return store
}

/** 테스트 사이에 비운다 */
export function resetSparkHistory() {
  store.clear()
}
