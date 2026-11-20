import { useCallback, useState } from 'react'

/**
 * 종목 탭을 줄로 볼까 카드로 볼까 (디자인 4차 목업 11 — 주인: "둘 중 사용자가 선택해서 표시될 수 있도록").
 * 이 기기의 편의라 기기에 적는다. 못 적어도(사생활 모드) 지금 화면은 바뀐다.
 */
export type StockView = 'list' | 'card'

export const STOCK_VIEW_KEY = 'dashboard.stock-view'

export function readStockView(): StockView {
  try {
    return localStorage.getItem(STOCK_VIEW_KEY) === 'card' ? 'card' : 'list'
  } catch {
    return 'list'
  }
}

export function useStockView(): [StockView, (next: StockView) => void] {
  const [view, setView] = useState<StockView>(readStockView)
  const change = useCallback((next: StockView) => {
    setView(next)
    try {
      localStorage.setItem(STOCK_VIEW_KEY, next)
    } catch {
      // 기억 못 해도 지금 화면은 바뀐다
    }
  }, [])
  return [view, change]
}
