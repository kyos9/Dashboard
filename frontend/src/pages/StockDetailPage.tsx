import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAppState } from '../AppState'
import { useCachedLoad } from '../lib/cache'
import type { DashboardCard } from '../types'
import { StockDetail } from '../components/stock/StockDetail'
import { Icon } from '../components/icons/Icon'
import type { ChartTab } from '../lib/fundamentals'

const TABS: ChartTab[] = ['chart', 'signal', 'fundamentals', 'holding', 'ai']

/**
 * 종목 안 화면 (/stocks/:ticker) — 종목 탭의 줄·카드를 누르면 온다 (디자인 4차 목업 11 가).
 * 홈의 차트 팝업과 같은 부품(StockDetail)이다. 시세·신호는 홈과 같은 카드 응답에서 그 종목만 꺼낸다.
 * `?tab=fundamentals` 처럼 처음 탭을 주소로 줄 수 있다(옛 /fundamentals · /history 주소 넘기기).
 */
export function StockDetailPage() {
  const { ticker = '' } = useParams()
  const navigate = useNavigate()
  const { refreshKey } = useAppState()
  const [cards, setCards] = useState<DashboardCard[] | null>(null)
  useCachedLoad('page:stocks:cards', api.getDashboard, setCards, () => setCards([]), [refreshKey])

  const wanted = new URLSearchParams(window.location.search).get('tab') as ChartTab | null
  const card = cards?.find((c) => c.ticker.toUpperCase() === ticker.toUpperCase())
  // 뒤로 — 앱 안에서 왔으면 그 자리로(스크롤·거르기 그대로), 바로 열었으면 종목 탭으로
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/stocks'))

  return (
    <StockDetail
      key={card?.ticker ?? ticker}
      ticker={card?.ticker ?? ticker}
      name={card?.name}
      card={card}
      initialTab={wanted && TABS.includes(wanted) ? wanted : 'chart'}
      onPurged={() => navigate('/stocks', { replace: true })}
      lead={
        <button type="button" className="icon-btn stock-back" onClick={back} aria-label="종목 목록으로">
          <Icon name="back" />
        </button>
      }
    />
  )
}
