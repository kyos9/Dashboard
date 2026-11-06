import { useEffect, useRef } from 'react'
import { useBackToClose } from '../lib/backToClose'
import type { DashboardCard } from '../types'
import type { ChartTab } from '../lib/fundamentals'
import { lockBodyScroll } from '../lib/scrollLock'
import { StockDetail } from './stock/StockDetail'

interface Props {
  ticker: string
  name?: string | null
  /** 대시보드에서 열면 그 종목의 카드 — 차트 위에 오늘 매수 조건 한 줄(디자인 2차, 주인 결정).
   * 재무·더보기 차트에서 열면 없다(그때는 그 줄이 없다) */
  card?: DashboardCard
  /** 어느 탭부터 — "재무" 화면에서 열면 재무, 대시보드의 "AI 분석" 버튼으로 열면 AI */
  initialTab?: ChartTab
  onClose: () => void
}

/**
 * 종목 차트를 화면 위에 띄운다.
 *
 * 차트를 보려고 페이지를 떠나면 보던 표의 스크롤 위치와 필터가 날아가고, 돌아오면
 * 다시 찾아야 한다. 차트는 "잠깐 확인하는" 것이므로 지금 화면 위에 얹는다.
 */
export function ChartModal({ ticker, name, card, initialTab = 'chart', onClose }: Props) {
  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  // ESC로 닫기 + 뒤 화면이 같이 스크롤되지 않게.
  // Tab 은 팝업 안에서만 돈다 — 밖으로 새면 키보드로 뒤 화면을 누르게 된다 (디자인 2차 검토, DESIGN_PROMPT 3-1)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.closest('[hidden], [aria-hidden="true"]'))
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!active && dialogRef.current.contains(active)
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    // 열면 포커스를 팝업으로, 닫으면 연 단추로 돌려준다 (디자인 2차 재검토)
    const opener = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    document.addEventListener('keydown', onTab)
    return () => {
      document.removeEventListener('keydown', onTab)
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${name ?? ticker} 차트`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 종목 안과 같은 것 — 종목 탭의 화면(/stocks/:ticker)과 한 부품 (디자인 4차 목업 11 가) */}
        <StockDetail
          ticker={ticker}
          name={name}
          card={card}
          initialTab={initialTab}
          onPurged={onClose}
          trail={
            <button className="icon-btn" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          }
        />
      </div>
    </div>
  )
}
