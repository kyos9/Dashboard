import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAppState } from '../AppState'
import { useCachedLoad } from '../lib/cache'
import type { DashboardCard, Stock } from '../types'
import { StockDetail } from '../components/stock/StockDetail'
import { ErrorNotice } from '../components/ErrorNotice'
import { Icon } from '../components/icons/Icon'
import type { ChartTab } from '../lib/fundamentals'

const TABS: ChartTab[] = ['chart', 'signal', 'fundamentals', 'holding', 'ai']

/**
 * 종목 안 화면 (/stocks/:ticker) — 종목 탭의 줄·카드를 누르면 온다 (디자인 4차 목업 11 가).
 * 홈의 차트 팝업과 같은 부품(StockDetail)이다. 시세·신호는 홈과 같은 카드 응답에서 그 종목만 꺼낸다.
 * `?tab=fundamentals` 처럼 처음 탭을 주소로 줄 수 있다(옛 /history?ticker= 주소 넘기기).
 *
 * 주소의 종목은 담은 종목 목록으로 맞춘다 — 옛 차트 화면(0.45.1 B2·BCD)이 하던 일을 그대로 잇는다(묶음 3 검토 조건 1):
 * - 소문자(`voo`)·이름(`삼성전자`) 주소는 담은 종목의 티커 주소로 바꾼다. 비활성 종목도 연다
 * - 담은 종목에 없으면 서버의 영어 404·빈 범례("매수 0일") 대신 한 줄로 말하고, 시세는 부르지 않는다
 * - 목록을 못 받으면 맞추지 않고 주소 그대로 연다(오류 줄과 함께)
 */
export function StockDetailPage() {
  const { ticker = '' } = useParams()
  const navigate = useNavigate()
  const { refreshKey } = useAppState()
  const [cards, setCards] = useState<DashboardCard[] | null>(null)
  const [stocks, setStocks] = useState<Stock[] | null>(null)
  const [listError, setListError] = useState<unknown>(null)
  useCachedLoad('page:stocks:cards', api.getDashboard, setCards, () => setCards([]), [refreshKey])
  useCachedLoad(
    'page:stocks',
    api.listStocks,
    (list) => {
      setStocks(list)
      setListError(null)
    },
    setListError,
    [refreshKey],
  )

  const match = stocks?.find((s) => s.ticker.toUpperCase() === ticker.toUpperCase() || s.name === ticker)
  const listed = stocks !== null || listError !== null
  const unknown = stocks !== null && !match
  const shown = match?.ticker ?? ticker

  // 소문자·이름 주소는 담은 종목의 티커 주소로 — 뒤로가기에 옛 주소가 남지 않게 바꿔 둔다
  useEffect(() => {
    if (match && match.ticker !== ticker) navigate(`/stocks/${encodeURIComponent(match.ticker)}${window.location.search}`, { replace: true })
  }, [match, ticker, navigate])

  // 목록을 내린 자리에서 들어와도 머리부터 — 확대 150% 에서 차트 가운데부터 열렸다(사용자 확인 막힌 곳 4)
  useEffect(() => {
    window.scrollTo?.(0, 0)
  }, [shown])

  const wanted = new URLSearchParams(window.location.search).get('tab') as ChartTab | null
  const card = cards?.find((c) => c.ticker === shown)
  // 뒤로 — 앱 안에서 왔으면 그 자리로(스크롤·거르기 그대로), 바로 열었으면 종목 탭으로
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/stocks'))
  const lead = (
    <button type="button" className="icon-btn stock-back" onClick={back} aria-label="종목 목록으로">
      <Icon name="back" />
    </button>
  )

  if (!listed) return <p className="hint detail-empty">불러오는 중…</p>

  if (unknown) {
    return (
      <div className="stock-detail">
        <div className="stock-detail-bar">
          {lead}
          <h2 className="stock-detail-name">{ticker}</h2>
        </div>
        <div className="empty-state">
          <h3>‘{ticker}’ 은 담은 종목에 없습니다</h3>
          <p>종목 탭의 찾기 칸에서 찾아 담으면 차트 · 신호 · 재무를 볼 수 있습니다.</p>
          <Link to="/stocks" className="link-button">
            종목 탭으로
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <ErrorNotice error={listError} onDismiss={() => setListError(null)} />
      <StockDetail
        key={shown}
        ticker={shown}
        name={card?.name ?? match?.name}
        card={card}
        initialTab={wanted && TABS.includes(wanted) ? wanted : 'chart'}
        onPurged={() => navigate('/stocks', { replace: true, state: { purged: match?.name ?? shown } })}
        lead={lead}
      />
    </>
  )
}
