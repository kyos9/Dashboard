import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MacroStrip } from '../components/MacroStrip'
import { NumberInput } from '../components/NumberInput'
import { dropSide, moveOne, placeAt } from '../lib/reorder'
import { useReorderAnimation } from '../lib/flip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { lazyChunk } from '../lib/lazyChunk'
import type { ChartTab } from '../lib/fundamentals'
import { useRecheck } from '../lib/recheck'

// 차트는 누를 때 받는다 (App.tsx의 HistoryChart와 같은 이유)
const ChartModal = lazyChunk(() => import('../components/ChartModal'), 'ChartModal')
import { ErrorNotice } from '../components/ErrorNotice'
import {
  amount,
  CATEGORY_UNSET,
  categoryOf,
  conditionMark,
  CONDITION_BY_METRIC,
  daysFrom,
  num,
  price,
  providerLabel,
  readAdx,
  readDi,
  readDisparity,
  readMa200,
  readVolume,
  relativeDay,
  REVIEW_PERIOD_LABEL,
  reviewCountdown,
  signed,
  signedAmount,
  rowLabel,
  stockLabel,
  trafficLight,
  type MetricKey,
  type Traffic,
} from '../lib/display'
import type {
  CashRow,
  Currency,
  DashboardCard,
  KneeConditions,
  RebalanceRow,
  ReviewStatus,
  Stock,
  StockUpdateInput,
} from '../types'

/* 비중 스택 바에 쓰는 색 (최대 8종목까지 구분되고, 그 이상은 반복) */
const SLICE_COLORS = ['#38bdf8', '#a855f7', '#22c55e', '#f0b429', '#f05252', '#2dd4bf', '#f472b6', '#818cf8']

type QuickFilter = 'all' | 'knee' | 'rebalance'
/** 표 / 카드 / 설정(편집) — 같은 목록을 다른 형태로 보는 것이라 한 자리에서 고른다 */
type ViewMode = 'table' | 'card' | 'edit'

function TrafficBadge({ traffic }: { traffic: Traffic }) {
  return (
    <span className={`traffic ${traffic.tone}`} title={traffic.desc}>
      <span className="traffic-lamp" aria-hidden="true">
        <i />
        <i />
      </span>
      {traffic.label}
    </span>
  )
}

/**
 * 이 지표가 매수 조건을 만족하는지 — 지표 바로 아래에 붙인다.
 *
 * 조건 네 개를 종합 신호등 칸에 모아두면 "DI 약세"가 어느 숫자에서 나온 말인지
 * 눈으로 이을 수 없다. 숫자 옆에 두면 25.7 / 30.5를 보면서 바로 읽힌다.
 */
function ConditionTag({ metric, conditions }: { metric: MetricKey; conditions: KneeConditions }) {
  const condition = CONDITION_BY_METRIC[metric]
  const met = conditions[condition.key]
  const mark = conditionMark(met)
  return (
    <span
      className={`cond${met === true ? ' met' : ''}`}
      title={`${condition.detail} — ${mark.word}`}
    >
      {mark.sign} {condition.label}
    </span>
  )
}

/**
 * 표에서는 조건을 기호 하나로만 찍는다.
 *
 * 칸마다 값·해석·조건을 세 줄씩 쌓으니 한 행이 130px이 되어, 다섯 종목이면 이미
 * 화면을 넘겼다. 조건이 무엇인지는 열 머리글에 한 번만 적혀 있으므로(그 열의 성질이지
 * 행마다 달라지는 값이 아니다) 행에는 충족 여부만 있으면 된다. 자세한 말은 마우스를
 * 올리면 나오고, 카드 보기에는 그대로 다 적혀 있다.
 */
function ConditionMark({ metric, conditions }: { metric: MetricKey; conditions: KneeConditions }) {
  const condition = CONDITION_BY_METRIC[metric]
  const met = conditions[condition.key]
  const mark = conditionMark(met)
  return (
    <span
      className={`cond-mark${met === true ? ' met' : ''}`}
      title={`${condition.label} — ${condition.detail} · ${mark.word}`}
      aria-label={`${condition.label} ${mark.word}`}
    >
      {mark.sign}
    </span>
  )
}

/** 열 머리글 — 이름, 부제, 그리고 이 열이 맡은 매수 조건 */
function MetricHead({ title, sub, metric }: { title: string; sub: string; metric?: MetricKey }) {
  return (
    <>
      {title}
      <br />
      <span className="th-sub">{sub}</span>
      {metric && <span className="th-cond">매수 조건 {CONDITION_BY_METRIC[metric].header}</span>}
    </>
  )
}

/** 끌어서 순서 바꾸기. 마우스를 못 쓰는 상황을 위해 위아래 화살표 키도 받는다. */
function DragHandle({
  ticker,
  label,
  controls,
}: {
  ticker: string
  label: string
  controls: RowControlProps
}) {
  return (
    <span
      className="drag-handle"
      draggable={!controls.busy}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        // 일부 브라우저는 데이터가 없으면 끌기 자체를 시작하지 않는다
        event.dataTransfer.setData('text/plain', ticker)
        controls.onDragStart(ticker)
      }}
      onDragEnd={controls.onDragEnd}
      role="button"
      tabIndex={0}
      aria-label={`${label} 순서 바꾸기`}
      title="끌어서 순서 변경 (위/아래 화살표 키도 됩니다)"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        controls.onMove(ticker, event.key === 'ArrowUp' ? 'up' : 'down')
      }}
    >
      ⠿
    </span>
  )
}

/**
 * 종목 이름. 누르면 차트가 열린다.
 *
 * 국내는 종목명, 해외는 티커 하나만 적는다 — 티커·시장·"차트 보기"를 함께 적던 때는
 * 한 칸이 세 줄이 되어 표 전체가 들쭉날쭉했다.
 *
 * AI 분석은 이 줄이 아니라 맨 오른쪽 칸에 둔다(`AiButton`) — 이름 칸이 두 줄이 되지 않게.
 */
function StockName({ card, onChart }: { card: DashboardCard; onChart: (card: DashboardCard) => void }) {
  return (
    <div className="stock-line">
      {card.category && <span className="cat-tag">{card.category}</span>}
      <button className="stock-name" onClick={() => onChart(card)} title="차트 보기">
        {stockLabel(card)}
      </button>
    </div>
  )
}

/**
 * 맨 오른쪽 "AI 분석" — 누르면 종목 팝업이 AI 탭으로 열린다. 부르는 건 거기서 한 번 더 눌러야
 * 한다(요금이 나가는 일이라 버튼 하나로 바로 부르지 않는다). 받아 둔 글이 있으면 그것부터 보인다.
 */
function AiButton({ card, onAi }: { card: DashboardCard; onAi: (card: DashboardCard) => void }) {
  return (
    <button className="ghost sm ai-open" onClick={() => onAi(card)} aria-label={`${stockLabel(card)} AI 분석`}>
      AI 분석
    </button>
  )
}

/** 표의 지표 한 칸 — 값 하나와 조건 기호 하나, 한 줄이다 */
function Metric({
  value,
  tone,
  note,
  metric,
  conditions,
}: {
  value: string
  tone: string
  /** 해석 문구. 표에서는 마우스를 올렸을 때만 나온다 */
  note: string
  metric?: MetricKey
  conditions?: KneeConditions
}) {
  return (
    <div className="metric-line">
      <span className={`metric-chip ${tone}`} title={note}>
        {value}
      </span>
      {metric && conditions && <ConditionMark metric={metric} conditions={conditions} />}
    </div>
  )
}

function PriceCell({ card }: { card: DashboardCard }) {
  const change = card.indicators.change_pct
  const dir = change === null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : ''
  return (
    <div className="metric-line">
      <span className="metric-value">{price(card.indicators.close, card.currency)}</span>
      <span className={`metric-note ${dir}`} title="전일 대비">
        {change === null ? '—' : signed(change, 2, '%')}
      </span>
    </div>
  )
}

/**
 * 무릎매수(v2)가 마지막으로 뜬 날.
 *
 * 적립할 때 "이번 달에 벌써 떴나"를 보는 자리다. 예전에는 기간(월/분기)을 정해 매수 예정을
 * 기록으로 잡아두고 "매수완료"를 눌러야 했는데, 리밸런싱에는 수량만 있으면 돼서 그 기록을
 * 걷어냈다. 날짜만 보여주면 판단은 사람이 한다.
 */
function LastBuySignal({ card }: { card: DashboardCard }) {
  const date = card.last_buy_signal_date
  if (!date) return <span className="hint">저장된 기간에 없음</span>
  const days = daysFrom(date)
  return (
    <div className="metric-line" title="매수 시그널(무릎매수 v2)이 마지막으로 뜬 날">
      <span className="metric-value mono">{date}</span>
      <span className={`metric-note ${days !== null && days <= 7 ? 'up' : ''}`}>{relativeDay(days)}</span>
    </div>
  )
}

/* ---------- 설정(편집) 모드 ----------
   고치려고 종목 관리 화면으로 건너가면 보던 순서·필터를 잃고 그 종목을 다시 찾아야 한다.
   보고 있는 표를 그대로 입력칸으로 바꾸고, 다 고친 뒤 한 번에 저장한다. */

interface Draft {
  category: string
  target_weight_pct: string
  rebalance_band_pct: string
}

function draftOf(stock: Stock): Draft {
  return {
    category: stock.category ?? '',
    target_weight_pct: String(stock.target_weight_pct),
    rebalance_band_pct: stock.rebalance_band_pct === null ? '' : String(stock.rebalance_band_pct),
  }
}

function draftsFrom(stocks: Stock[]): Record<string, Draft> {
  return Object.fromEntries(stocks.map((stock) => [stock.ticker, draftOf(stock)]))
}

function toUpdate(draft: Draft): StockUpdateInput {
  return {
    category: draft.category.trim() === '' ? null : draft.category.trim(),
    target_weight_pct: Number(draft.target_weight_pct || 0),
    rebalance_band_pct: draft.rebalance_band_pct === '' ? null : Number(draft.rebalance_band_pct),
  }
}

/** 실제로 바뀐 종목만 저장한다 — 손대지 않은 종목까지 PUT을 보낼 이유가 없다 */
export function isDirty(stock: Stock, draft: Draft | undefined): boolean {
  if (!draft) return false
  const next = toUpdate(draft)
  return (
    next.category !== (stock.category ?? null) ||
    next.target_weight_pct !== stock.target_weight_pct ||
    next.rebalance_band_pct !== stock.rebalance_band_pct
  )
}

/** 대시보드가 리밸런싱 현황에서 빌려 쓰는 것 — 전체 자금·현금·손익·리뷰 일정 */
interface Portfolio {
  total: number
  cash: CashRow
  pnl: number | null
  cost: number | null
  review: ReviewStatus
}

/** 다음 리뷰까지 — 리뷰할 때면 리밸런싱 화면으로 부른다 */
function ReviewKpi({ review }: { review: ReviewStatus | null }) {
  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-title">
          다음 리뷰{review && ` · ${REVIEW_PERIOD_LABEL[review.period]}`}
        </span>
        <Link to="/rebalance" className="hint">
          리밸런싱 →
        </Link>
      </div>
      {review ? (
        <>
          <div className="kpi-figure">
            <span className="big">{review.due ? '리뷰할 때' : reviewCountdown(review)}</span>
            <span className="hint mono">{review.next_date}</span>
          </div>
          <p className="kpi-foot">
            {review.due
              ? '비중을 확인하고 정리한 뒤 리밸런싱 화면에서 기록을 남기세요.'
              : review.last_snapshot_at
                ? `마지막 기록 ${review.last_snapshot_at.slice(0, 10)}`
                : '아직 남긴 리밸런싱 기록이 없습니다.'}
          </p>
        </>
      ) : (
        <p className="kpi-foot">—</p>
      )}
    </div>
  )
}

export function Dashboard() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const [cards, setCards] = useState<DashboardCard[]>([])
  const [weights, setWeights] = useState<RebalanceRow[]>([])
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [baseCurrency, setBaseCurrency] = useState<Currency>('KRW')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  // 팝업과 어느 탭부터 열지 — 종목 이름은 차트, 맨 오른쪽 "AI 분석" 버튼은 AI 탭
  const [chart, setChart] = useState<{ card: DashboardCard; tab: ChartTab } | null>(null)
  const openChart = useCallback((card: DashboardCard) => setChart({ card, tab: 'chart' }), [])
  const openAi = useCallback((card: DashboardCard) => setChart({ card, tab: 'ai' }), [])
  const [stocks, setStocks] = useState<Stock[]>([])
  const [reordering, setReordering] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  // 끄는 동안 보여줄 임시 순서. 놓기 전에도 자리가 벌어지는 게 보여야
  // "여기 놓으면 여기로 간다"를 손이 아니라 눈으로 확인할 수 있다.
  const [preview, setPreview] = useState<string[] | null>(null)

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState(false)
  const [confirmingPurge, setConfirmingPurge] = useState<string | null>(null)

  const [category, setCategory] = useState<string>('전체')
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1100 ? 'card' : 'table',
  )

  const fetchAll = useCallback(
    () => Promise.all([api.getDashboard(), api.getRebalanceCurrent(), api.listStocks()]),
    [],
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchAll()
      .then(([c, rebalance, stockList]) => {
        setCards(c)
        setWeights(rebalance.rows)
        setPortfolio({
          total: rebalance.total_value_base,
          cash: rebalance.cash,
          pnl: rebalance.unrealized_pnl_base,
          cost: rebalance.cost_value_base,
          review: rebalance.review,
        })
        setBaseCurrency(rebalance.base_currency)
        setStocks(stockList)
        // 편집 중이던 값은 서버에서 다시 받은 값으로 맞춘다 (저장 직후에 온다)
        setDrafts(draftsFrom(stockList))
        setConfirmingPurge(null)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [refreshKey, fetchAll])

  // 방금 등록한 종목의 시세를 서버가 뒤에서 받는 중이면, 다 받을 때까지 몇 초마다 다시 본다.
  // 다 받으면 전체를 새로 그린다(비중·손익까지 그 종목 시세가 들어가야 맞으므로).
  const loadingCards = cards.filter((c) => c.data_status === 'loading')
  const recheck = useCallback(() => {
    api
      .getDashboard()
      .then((next) => {
        if (next.some((c) => c.data_status === 'loading')) setCards(next)
        else notifyDataChanged()
      })
      .catch(() => {}) // 한 번 못 물어봐도 다음에 다시 묻는다
  }, [notifyDataChanged])
  useRecheck(loadingCards.length > 0, recheck, cards, 4000)

  const stockByTicker = useMemo(() => new Map(stocks.map((s) => [s.ticker, s])), [stocks])

  /** 새 순서를 화면에 먼저 반영하고 저장한다. 실패하면 화면도 되돌린다. */
  const applyOrder = async (next: string[]) => {
    const order = stocks.map((s) => s.ticker)
    setPreview(null)
    if (next.join() === order.join()) return

    const previousStocks = stocks
    const previousCards = cards
    setStocks(next.map((t) => stockByTicker.get(t)!).filter(Boolean))
    setCards((previous) => [...previous].sort((a, b) => next.indexOf(a.ticker) - next.indexOf(b.ticker)))

    setReordering(true)
    try {
      await api.updateStockOrder(next)
    } catch (e) {
      // 저장에 실패했으면 화면도 되돌린다. 다시 불러오면(notifyDataChanged) 오류 문구가
      // 같이 지워져서, 사용자는 순서가 저장된 줄 알게 된다.
      setStocks(previousStocks)
      setCards(previousCards)
      setError(e)
    } finally {
      setReordering(false)
    }
  }

  /**
   * 키보드로 한 칸 옮긴다. 필터가 걸려 있어도 "보이는 이웃"과 자리를 바꾸므로
   * 누른 결과가 항상 눈에 보인다.
   */
  const handleMove = (ticker: string, direction: 'up' | 'down') =>
    void applyOrder(
      moveOne(stocks.map((s) => s.ticker), visible.map((c) => c.ticker), ticker, direction),
    )

  /** 끄는 동안 자리를 미리 벌려준다. 놓는 순간에는 이미 보이던 그 순서를 저장한다. */
  const handleDragOverRow = (target: string, side: 'before' | 'after') => {
    if (!dragging || dragging === target) return
    setPreview((current) => {
      const base = current ?? stocks.map((s) => s.ticker)
      const next = placeAt(base, dragging, target, side)
      return next === base ? current : next
    })
  }

  const handleDrop = () => {
    const shown = preview
    setDragging(null)
    setPreview(null)
    if (shown) void applyOrder(shown)
  }

  const dirtyTickers = useMemo(
    () => stocks.filter((s) => isDirty(s, drafts[s.ticker])).map((s) => s.ticker),
    [stocks, drafts],
  )

  const saveEdits = async () => {
    if (dirtyTickers.length === 0) return
    setSaving(true)
    setError(null)
    try {
      // 고친 종목만, 한꺼번에 보낸다 (한 종목씩 기다리면 종목 수만큼 왕복이 쌓인다)
      await Promise.all(dirtyTickers.map((t) => api.updateStock(t, toUpdate(drafts[t]))))
      notifyDataChanged()
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  const removeStock = async (ticker: string, mode: 'hide' | 'purge') => {
    setSaving(true)
    setError(null)
    try {
      if (mode === 'hide') await api.deactivateStock(ticker)
      else await api.purgeStock(ticker)
      notifyDataChanged()
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  const summary = useMemo(() => {
    const lights = cards.map(trafficLight)
    const reasons = cards.flatMap((c) => (c.rebalance_signal.active ? c.rebalance_signal.reasons : []))
    return {
      buy: lights.filter((l) => l.state === 'buy').length,
      watch: lights.filter((l) => l.state === 'watch').length,
      hot: lights.filter((l) => l.state === 'hot').length,
      stale: lights.filter((l) => l.state === 'stale').length,
      rebalanceCount: cards.filter((c) => c.rebalance_signal.active).length,
      sellReview: reasons.filter((r) => r.includes('매도')).length,
      buyReview: reasons.filter((r) => r.includes('매수')).length,
      periodicReview: reasons.filter((r) => r.includes('정기')).length,
    }
  }, [cards])

  const allocation = useMemo(() => {
    // 평가금액은 반드시 기준통화 환산값으로 합산한다 (현지 통화끼리 더하면 비중이 틀어진다).
    // 비중은 서버가 현금까지 더한 전체 자금 대비로 준다 — 막대도 현금 한 칸을 같이 그린다.
    const invested = weights.filter((w) => w.current_value_base > 0)
    const total = portfolio?.total ?? invested.reduce((s, w) => s + w.current_value_base, 0)
    const worst = weights.reduce<RebalanceRow | null>(
      (acc, w) => (acc === null || Math.abs(w.excess_pct) > Math.abs(acc.excess_pct) ? w : acc),
      null,
    )
    return { invested, total, worst, cash: portfolio?.cash ?? null }
  }, [weights, portfolio])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    cards.forEach((c) => {
      const key = categoryOf(c.category)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    // 미분류는 항상 맨 뒤로
    return [...counts.entries()].sort((a, b) =>
      a[0] === CATEGORY_UNSET ? 1 : b[0] === CATEGORY_UNSET ? -1 : a[0].localeCompare(b[0], 'ko'),
    )
  }, [cards])

  const visible = useMemo(() => {
    const shown = cards.filter((c) => {
      if (category !== '전체' && categoryOf(c.category) !== category) return false
      if (quick === 'knee' && !c.knee_buy_v2) return false
      if (quick === 'rebalance' && !c.rebalance_signal.active) return false
      return true
    })
    if (!preview) return shown
    // 끄는 동안에는 임시 순서로 보여준다 (저장은 놓을 때 한 번만 한다)
    const rank = new Map(preview.map((ticker, index) => [ticker, index]))
    return [...shown].sort((a, b) => (rank.get(a.ticker) ?? 0) - (rank.get(b.ticker) ?? 0))
  }, [cards, category, quick, preview])

  // 순서가 바뀐 렌더에서만 각 행을 새 자리로 미끄러뜨린다.
  // 끄는 동안에는 자리만 즉시 바꾼다 (미끄러뜨리면 크롬이 끌기를 취소한다 — flip.ts 참고)
  const listRef = useReorderAnimation<HTMLDivElement>(
    visible.map((c) => c.ticker).join(),
    dragging !== null,
  )

  // 순서 화살표는 "보이는 목록" 기준으로 끝인지 판단해야 누른 결과가 눈에 보인다
  const rowControls: RowControlProps = {
    tickers: visible.map((c) => c.ticker),
    busy: reordering,
    dragging,
    onMove: handleMove,
    onDragStart: setDragging,
    onDragEnd: () => {
      // 끌다 말았으면(ESC·바깥에 놓기) 보여주던 임시 순서도 접는다
      setDragging(null)
      setPreview(null)
    },
    onDragOverRow: handleDragOverRow,
    onDrop: handleDrop,
  }

  if (loading) return <p className="hint">불러오는 중…</p>
  if (error && cards.length === 0) return <ErrorNotice error={error} />

  if (cards.length === 0) {
    return (
      // 처음 들어온 사람의 첫 화면이다. 빈 표만 두면 무엇을 해야 하는지 모른다 (ROADMAP 4단계 8-2)
      <div className="empty-state first-steps">
        <h3>아직 담은 종목이 없습니다 — 세 단계면 시작합니다</h3>
        <ol>
          <li>
            <b>종목 담기</b> — <Link to="/stocks">종목 관리</Link>에서 이름이나 티커로 찾아 추가합니다 (예:
            삼성전자, VOO). 시세와 지표는 알아서 받습니다.
          </li>
          <li>
            <b>보유수량 적기</b> — 추가할 때나 <Link to="/rebalance">리밸런싱</Link>에서 수량·평단가·목표 비중을
            적으면 비중이 얼마나 벗어났는지 알려줍니다.
          </li>
          <li>
            <b>시그널 보기</b> — 이 화면에 종목마다 매수·매도 시그널이 뜹니다. 시세는 장 마감 뒤 매일 새로
            받습니다.
          </li>
        </ol>
        <Link to="/stocks" className="link-button">
          종목 추가하러 가기
        </Link>
        <p className="hint">
          종목은 30개까지 담을 수 있습니다. 시그널은 참고용이며 투자 권유가 아닙니다.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* 구분 입력 추천값 — 편집 모드의 구분 칸에서 쓴다 */}
      <datalist id="category-options">
        {categories.map(([name]) => (
          <option key={name} value={name === CATEGORY_UNSET ? '' : name} />
        ))}
      </datalist>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {loadingCards.length > 0 && (
        <div className="callout blue" role="status">
          <span className="ico">⏳</span>
          <div>
            {loadingCards.map(stockLabel).join(', ')} 시세를 받는 중입니다 — 다 받으면 저절로
            채워집니다.
          </div>
        </div>
      )}

      {/* 매크로는 한 줄만. 홈의 주인공은 종목이다 (components/MacroStrip.tsx) */}
      <MacroStrip />

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">종합 신호등 현황</span>
            <span className="hint mono">{cards.length}종목</span>
          </div>
          <div className="kpi-counts">
            <span className="count-chip green">
              <span className="num">{summary.buy}</span>
              <span className="lbl">매수 시그널</span>
            </span>
            <span className="count-chip amber">
              <span className="num">{summary.watch}</span>
              <span className="lbl">관망</span>
            </span>
            <span className="count-chip red">
              <span className="num">{summary.hot}</span>
              <span className="lbl">매도 시그널</span>
            </span>
          </div>
          <p className="kpi-foot">
            {summary.stale > 0
              ? `${summary.stale}종목은 시세가 오래되어 판정에서 제외됐습니다.`
              : '모든 종목의 시세가 최신 상태입니다.'}
          </p>
        </div>

        <ReviewKpi review={portfolio?.review ?? null} />

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">비중조절 신호</span>
          </div>
          <div className="kpi-figure">
            <span className="big">{summary.rebalanceCount}</span>
            <span className="hint">종목에서 발생</span>
          </div>
          <div className="badge-row">
            {summary.sellReview > 0 && <span className="badge badge-red">매도 검토 {summary.sellReview}</span>}
            {summary.buyReview > 0 && <span className="badge badge-blue">매수 검토 {summary.buyReview}</span>}
            {summary.periodicReview > 0 && (
              <span className="badge badge-purple">정기 리뷰 {summary.periodicReview}</span>
            )}
            {summary.rebalanceCount === 0 && <span className="badge badge-grey">모두 밴드 이내</span>}
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">포트폴리오 배분</span>
            <Link to="/rebalance" className="hint">
              리밸런싱 →
            </Link>
          </div>
          {allocation.total > 0 ? (
            <>
              <div className="weight-bar">
                {allocation.invested.map((w, i) => (
                  <span
                    key={w.ticker}
                    style={{
                      width: `${w.actual_weight_pct}%`,
                      background: SLICE_COLORS[i % SLICE_COLORS.length],
                    }}
                    title={`${rowLabel(w)} ${num(w.actual_weight_pct, 1)}%`}
                  />
                ))}
                {allocation.cash && allocation.cash.actual_pct > 0 && (
                  <span
                    className="cash-slice"
                    style={{ width: `${allocation.cash.actual_pct}%` }}
                    title={`현금 ${num(allocation.cash.actual_pct, 1)}%`}
                  />
                )}
              </div>
              <div className="weight-legend">
                {allocation.invested.map((w, i) => (
                  <span key={w.ticker}>
                    <i
                      className="legend-dot"
                      style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                      aria-hidden="true"
                    />
                    {rowLabel(w)} <span className="mono">{num(w.actual_weight_pct, 1)}%</span>
                  </span>
                ))}
                {allocation.cash && allocation.cash.actual_pct > 0 && (
                  <span>
                    <i className="legend-dot cash-slice" aria-hidden="true" />
                    현금 <span className="mono">{num(allocation.cash.actual_pct, 1)}%</span>
                  </span>
                )}
              </div>
              <p className="kpi-foot">
                총 {amount(allocation.total, baseCurrency)}
                {portfolio?.pnl !== null && portfolio?.pnl !== undefined && (
                  <>
                    {' '}· 평가손익{' '}
                    <span className={portfolio.pnl > 0 ? 'up' : portfolio.pnl < 0 ? 'down' : ''}>
                      {signedAmount(portfolio.pnl, baseCurrency)}
                      {portfolio.cost ? ` (${signed((portfolio.pnl / portfolio.cost) * 100, 1, '%')})` : ''}
                    </span>
                  </>
                )}{' '}
                ·{' '}
                {allocation.worst && Math.abs(allocation.worst.excess_pct) >= 0.05
                  ? `목표 대비 최대 이탈: ${rowLabel(allocation.worst)} ${signed(allocation.worst.excess_pct, 1, '%p')}`
                  : '목표 비중과 거의 일치합니다.'}
              </p>
            </>
          ) : (
            <p className="kpi-foot">
              보유수량과 현금이 없습니다. 리밸런싱 화면에서 입력하면 실제 비중이 계산됩니다.
            </p>
          )}
        </div>
      </div>

      <div className="toolbar">
        <span className="toolbar-label">구분</span>
        <div className="chip-row">
          <button className={`chip${category === '전체' ? ' active' : ''}`} onClick={() => setCategory('전체')}>
            전체 {cards.length}
          </button>
          {categories.map(([name, count]) => (
            <button
              key={name}
              className={`chip${category === name ? ' active' : ''}`}
              onClick={() => setCategory(name)}
            >
              {name} {count}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <span className="toolbar-label">신호</span>
        <div className="chip-row">
          <button className={`chip${quick === 'all' ? ' active' : ''}`} onClick={() => setQuick('all')}>
            모두 보기
          </button>
          <button className={`chip${quick === 'knee' ? ' active' : ''}`} onClick={() => setQuick('knee')}>
            매수 시그널 {summary.buy}
          </button>
          <button
            className={`chip${quick === 'rebalance' ? ' active' : ''}`}
            onClick={() => setQuick('rebalance')}
          >
            비중조절 신호 {summary.rebalanceCount}
          </button>
        </div>
        <div className="chip-row spacer">
          <button className={`chip${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>
            표 보기
          </button>
          <button className={`chip${view === 'card' ? ' active' : ''}`} onClick={() => setView('card')}>
            카드 보기
          </button>
          <button
            className={`chip${view === 'edit' ? ' active' : ''}`}
            onClick={() => {
              setDrafts(draftsFrom(stocks))
              setConfirmingPurge(null)
              setView('edit')
            }}
          >
            ⚙ 설정
          </button>
        </div>
      </div>

      <div ref={listRef}>
      {visible.length === 0 ? (
        <div className="empty-state">
          <h3>조건에 맞는 종목이 없습니다</h3>
          <p>필터를 바꾸거나 "모두 보기"를 선택해주세요.</p>
        </div>
      ) : view === 'edit' ? (
        <SettingsTable
          cards={visible}
          stockByTicker={stockByTicker}
          drafts={drafts}
          dirtyTickers={dirtyTickers}
          busy={saving}
          confirmingPurge={confirmingPurge}
          controls={rowControls}
          onChange={(ticker, draft) => setDrafts((prev) => ({ ...prev, [ticker]: draft }))}
          onSave={() => void saveEdits()}
          onReset={() => setDrafts(draftsFrom(stocks))}
          onRemove={(ticker, mode) => void removeStock(ticker, mode)}
          onConfirmPurge={setConfirmingPurge}
          onDone={() => setView('table')}
        />
      ) : view === 'table' ? (
        <SignalMatrix
          cards={visible}
          onChart={openChart}
          onAi={openAi}
          controls={rowControls}
        />
      ) : (
        <SignalCards
          cards={visible}
          onChart={openChart}
          onAi={openAi}
          controls={rowControls}
        />
      )}
      </div>

      {chart && (
        <Suspense fallback={null}>
          <ChartModal
            // 같은 종목이라도 다른 버튼으로 열면 그 탭부터 — 새로 띄운다
            key={`${chart.card.ticker}:${chart.tab}`}
            ticker={chart.card.ticker}
            name={stockLabel(chart.card)}
            initialTab={chart.tab}
            onClose={() => setChart(null)}
          />
        </Suspense>
      )}

      <p className="hint" style={{ marginTop: 14 }}>
        매수 시그널 = -DI &gt; +DI · 이격도 &lt; 0 · (StdDev20 축소 또는 거래량비 &gt; 1.1) · ADX &gt; 20 —
        네 조건을 모두 만족할 때. 각 조건은 해당 지표 칸에 ✓로 표시됩니다. 매도 시그널은 참고용이며 실제
        매도는 리밸런싱 리뷰 때 비중을 보고 정합니다.
      </p>
    </div>
  )
}

interface RowControlProps {
  tickers: string[]
  busy: boolean
  dragging: string | null
  onMove: (ticker: string, direction: 'up' | 'down') => void
  onDragStart: (ticker: string) => void
  onDragEnd: () => void
  onDragOverRow: (ticker: string, side: 'before' | 'after') => void
  onDrop: () => void
}

/**
 * 끌어다 놓을 수 있는 행 — 표와 편집 표와 카드가 같은 동작을 쓴다.
 *
 * `data-flip-key`는 순서가 바뀔 때 이 요소를 새 자리로 미끄러뜨리기 위한 표식이다.
 */
function dragProps(ticker: string, controls: RowControlProps) {
  return {
    'data-flip-key': ticker,
    className: controls.dragging === ticker ? 'dragging' : '',
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!controls.dragging) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const element = event.currentTarget
      // 옆 항목이 같은 줄에 있으면 가로로 늘어선 목록(여러 열 카드)이다.
      // 표는 한 줄에 한 행이므로 위아래 절반으로 가른다.
      const sibling = element.nextElementSibling ?? element.previousElementSibling
      const horizontal =
        sibling instanceof HTMLElement && Math.abs(sibling.offsetTop - element.offsetTop) < 4
      controls.onDragOverRow(
        ticker,
        dropSide(
          element.getBoundingClientRect(),
          { x: event.clientX, y: event.clientY },
          horizontal,
        ),
      )
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      controls.onDrop()
    },
  }
}

function SignalMatrix({
  cards,
  onChart,
  onAi,
  controls,
}: {
  cards: DashboardCard[]
  onChart: (card: DashboardCard) => void
  onAi: (card: DashboardCard) => void
  controls: RowControlProps
}) {
  return (
    <div className="table-scroll">
      <table className="data-table fixed" style={{ minWidth: 1302 }}>
        <thead>
          <tr>
            <th style={{ width: 44 }} aria-label="순서" />
            <th style={{ width: 146 }}>구분 / 종목</th>
            <th style={{ width: 128 }}>
              <MetricHead title="현재가" sub="(전일 대비)" />
            </th>
            <th style={{ width: 132 }}>
              <MetricHead title="이격도" sub="(MA20 대비)" metric="disparity" />
            </th>
            <th style={{ width: 118 }}>
              <MetricHead title="ADX" sub="(추세 강도)" metric="adx" />
            </th>
            <th style={{ width: 134 }}>
              <MetricHead title="DI 방향" sub="(+DI / -DI)" metric="di" />
            </th>
            <th style={{ width: 128 }}>
              <MetricHead title="거래량비" sub="(MA5/MA20)" metric="volume" />
            </th>
            <th style={{ width: 112 }}>
              <MetricHead title="200일선" sub="(장기 추세)" />
            </th>
            <th style={{ width: 128 }}>종합 신호등</th>
            <th style={{ width: 136 }}>
              <MetricHead title="마지막 매수" sub="시그널" />
            </th>
            <th style={{ width: 96 }}>AI 분석</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const ind = card.indicators
            const disparity = readDisparity(ind.disparity)
            const adx = readAdx(ind.adx)
            const di = readDi(ind.plus_di, ind.minus_di)
            const vol = readVolume(ind.vol_ratio)
            const ma200 = readMa200(ind.close, ind.ma200)

            return (
              <tr key={card.ticker} {...dragProps(card.ticker, controls)}>
                <td>
                  <DragHandle ticker={card.ticker} label={stockLabel(card)} controls={controls} />
                </td>
                <td>
                  <StockName card={card} onChart={onChart} />
                </td>
                <td>
                  <PriceCell card={card} />
                </td>
                <td>
                  <Metric
                    value={signed(ind.disparity, 2, '%')}
                    tone={disparity.tone}
                    note={disparity.note}
                    metric="disparity"
                    conditions={card.knee_conditions}
                  />
                </td>
                <td>
                  <Metric
                    value={num(ind.adx, 1)}
                    tone={adx.tone}
                    note={adx.note}
                    metric="adx"
                    conditions={card.knee_conditions}
                  />
                </td>
                <td>
                  <Metric
                    value={`${num(ind.plus_di, 1)} / ${num(ind.minus_di, 1)}`}
                    tone={di.tone}
                    note={di.note}
                    metric="di"
                    conditions={card.knee_conditions}
                  />
                </td>
                <td>
                  <Metric
                    value={`${num(ind.vol_ratio, 2)}x`}
                    tone={vol.tone}
                    note={vol.note}
                    metric="volume"
                    conditions={card.knee_conditions}
                  />
                </td>
                <td>
                  <Metric value={signed(ma200.pct, 1, '%')} tone={ma200.tone} note={ma200.note} />
                </td>
                <td>
                  <div className="metric">
                    <TrafficBadge traffic={trafficLight(card)} />
                    {(card.rebalance_signal.reasons.length > 0 ||
                      (card.knee_buy_v2 && card.shoulder_sell_ref)) && (
                      <div className="badge-row">
                        {/* 둘 다 뜨면 신호등은 매수를 보여준다 — 매도 쪽이 조용히 사라지지 않게 */}
                        {card.knee_buy_v2 && card.shoulder_sell_ref && (
                          <span className="badge badge-amber">매도 조건도 충족</span>
                        )}
                        {card.rebalance_signal.reasons.map((r) => (
                          <span className="badge badge-purple" key={r}>
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <LastBuySignal card={card} />
                </td>
                <td>
                  <AiButton card={card} onAi={onAi} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SettingsTable({
  cards,
  stockByTicker,
  drafts,
  dirtyTickers,
  busy,
  confirmingPurge,
  controls,
  onChange,
  onSave,
  onReset,
  onRemove,
  onConfirmPurge,
  onDone,
}: {
  cards: DashboardCard[]
  stockByTicker: Map<string, Stock>
  drafts: Record<string, Draft>
  dirtyTickers: string[]
  busy: boolean
  confirmingPurge: string | null
  controls: RowControlProps
  onChange: (ticker: string, draft: Draft) => void
  onSave: () => void
  onReset: () => void
  onRemove: (ticker: string, mode: 'hide' | 'purge') => void
  onConfirmPurge: (ticker: string | null) => void
  onDone: () => void
}) {
  return (
    <>
      <div className="edit-bar">
        <span className="hint">
          {dirtyTickers.length === 0
            ? '고칠 값을 바로 입력하세요. 순서는 맨 앞 ⠿를 끌어서 바꿉니다.'
            : `${dirtyTickers.length}개 종목이 바뀌었습니다 (${dirtyTickers.join(', ')})`}
        </span>
        <div className="btn-group tight">
          <button className="primary sm" onClick={onSave} disabled={busy || dirtyTickers.length === 0}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button className="sm" onClick={onReset} disabled={busy || dirtyTickers.length === 0}>
            되돌리기
          </button>
          <button className="sm ghost" onClick={onDone} disabled={busy}>
            설정 닫기
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table fixed" style={{ minWidth: 710 }}>
          <thead>
            <tr>
              <th style={{ width: 44 }} aria-label="순서" />
              <th style={{ width: 150 }}>종목</th>
              <th style={{ width: 112 }}>구분</th>
              <th style={{ width: 112 }}>목표 비중</th>
              <th style={{ width: 112 }}>
                밴드 임계값
                <br />
                (비우면 기본값)
              </th>
              <th style={{ width: 180 }}>정리</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const stock = stockByTicker.get(card.ticker)
              const draft = drafts[card.ticker]
              if (!stock || !draft) return null
              const label = stockLabel(card)
              const set = (patch: Partial<Draft>) => onChange(card.ticker, { ...draft, ...patch })
              const drag = dragProps(card.ticker, controls)

              return (
                <tr
                  key={card.ticker}
                  {...drag}
                  className={`${drag.className} ${dirtyTickers.includes(card.ticker) ? 'dirty' : ''}`.trim()}
                >
                  <td>
                    <DragHandle ticker={card.ticker} label={label} controls={controls} />
                  </td>
                  <td>
                    <div className="stock-line">
                      {card.category && <span className="cat-tag">{card.category}</span>}
                      <span className="stock-name">{label}</span>
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      list="category-options"
                      value={draft.category}
                      placeholder="예: 지수"
                      aria-label={`${label} 구분`}
                      onChange={(e) => set({ category: e.target.value })}
                    />
                  </td>
                  <td>
                    <div className="input-with-button tight">
                      <NumberInput
                        value={draft.target_weight_pct}
                        onChange={(v) => set({ target_weight_pct: v })}
                        aria-label={`${label} 목표 비중`}
                      />
                      <span className="unit">%</span>
                    </div>
                  </td>
                  <td>
                    <div className="input-with-button tight">
                      <NumberInput
                        value={draft.rebalance_band_pct}
                        onChange={(v) => set({ rebalance_band_pct: v })}
                        placeholder="기본값"
                        aria-label={`${label} 밴드 임계값`}
                      />
                      <span className="unit">%p</span>
                    </div>
                  </td>
                  <td>
                    <div className="btn-group tight">
                      <button className="sm ghost" disabled={busy} onClick={() => onRemove(card.ticker, 'hide')}>
                        감추기
                      </button>
                      <button
                        className="sm danger"
                        disabled={busy}
                        onClick={() => onConfirmPurge(card.ticker)}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirmingPurge && (
        <ConfirmDialog
          title={`${confirmingPurge} 삭제`}
          confirmLabel="네, 지웁니다"
          busyLabel="지우는 중…"
          busy={busy}
          onConfirm={() => onRemove(confirmingPurge, 'purge')}
          onCancel={() => onConfirmPurge(null)}
        >
          <p>
            <strong>{confirmingPurge}</strong>을(를) 내 목록에서 빼고 보유수량·평단가를 지웁니다. 되돌릴 수
            없습니다. 시세·지표는 모두가 같이 쓰는 기록이라 남겨 두므로, 다시 등록하면 히스토리가 바로 보입니다.
            이미 남긴 리밸런싱 기록도 그대로 둡니다.
          </p>
          <p>
            잠시 치워두려는 것이라면 <strong>감추기</strong>를 쓰세요.
          </p>
        </ConfirmDialog>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        <strong>감추기</strong>는 대시보드에서만 내리고 시세·기록은 그대로 둡니다 (종목 관리 화면에서 다시
        켤 수 있습니다). 새 종목 추가와 시세 갱신은 <Link to="/stocks">종목 관리</Link>에서 합니다.
      </p>
    </>
  )
}

function SignalCards({
  cards,
  onChart,
  onAi,
  controls,
}: {
  cards: DashboardCard[]
  onChart: (card: DashboardCard) => void
  onAi: (card: DashboardCard) => void
  controls: RowControlProps
}) {
  return (
    <div className="card-grid">
      {cards.map((card) => {
        const ind = card.indicators
        const disparity = readDisparity(ind.disparity)
        const adx = readAdx(ind.adx)
        const di = readDi(ind.plus_di, ind.minus_di)
        const vol = readVolume(ind.vol_ratio)
        const ma200 = readMa200(ind.close, ind.ma200)
        const change = ind.change_pct
        const drag = dragProps(card.ticker, controls)

        return (
          <article
            key={card.ticker}
            className={`stock-card ${drag.className}`.trim()}
            onDragOver={drag.onDragOver}
            onDrop={drag.onDrop}
          >
            <div className="stock-card-head">
              <div className="ticker-cell">
                <div className="stock-line">
                  <DragHandle ticker={card.ticker} label={stockLabel(card)} controls={controls} />
                  {card.category && <span className="cat-tag">{card.category}</span>}
                  <button className="stock-name" onClick={() => onChart(card)} title="차트 보기">
                    {stockLabel(card)}
                  </button>
                </div>
              </div>
              <div className="stock-card-price">
                <span className="big">{price(ind.close, card.currency)}</span>
                <span
                  className={`metric-note ${change === null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : ''}`}
                >
                  {change === null ? '전일 대비 —' : signed(change, 2, '%')}
                </span>
              </div>
            </div>

            <TrafficBadge traffic={trafficLight(card)} />

            {(card.rebalance_signal.active || (card.knee_buy_v2 && card.shoulder_sell_ref)) && (
              <div className="badge-row">
                {card.knee_buy_v2 && card.shoulder_sell_ref && (
                  <span className="badge badge-amber">매도 조건도 충족</span>
                )}
                {card.rebalance_signal.reasons.map((r) => (
                  <span className="badge badge-purple" key={r}>
                    {r}
                  </span>
                ))}
              </div>
            )}

            <div className="stat-grid">
              <div className="stat-box">
                <span className="k">이격도 (MA20)</span>
                <span className={`v ${disparity.tone === 'grey' ? '' : disparity.tone}`}>
                  {signed(ind.disparity, 2, '%')}
                </span>
                <span className="k">{disparity.note}</span>
                <ConditionTag metric="disparity" conditions={card.knee_conditions} />
              </div>
              <div className="stat-box">
                <span className="k">ADX 추세강도</span>
                <span className="v">{num(ind.adx, 1)}</span>
                <span className="k">{adx.note}</span>
                <ConditionTag metric="adx" conditions={card.knee_conditions} />
              </div>
              <div className="stat-box">
                <span className="k">+DI / -DI</span>
                <span className="v">
                  {num(ind.plus_di, 1)} / {num(ind.minus_di, 1)}
                </span>
                <span className="k">{di.note}</span>
                <ConditionTag metric="di" conditions={card.knee_conditions} />
              </div>
              <div className="stat-box">
                <span className="k">거래량비</span>
                <span className="v">{num(ind.vol_ratio, 2)}x</span>
                <span className="k">{vol.note}</span>
                <ConditionTag metric="volume" conditions={card.knee_conditions} />
              </div>
              <div className="stat-box">
                <span className="k">200일선 대비</span>
                <span className="v">{signed(ma200.pct, 1, '%')}</span>
                <span className="k">{ma200.note}</span>
              </div>
              <div className="stat-box">
                <span className="k">MA20 / MA50</span>
                <span className="v">
                  {price(ind.ma20, card.currency)} / {price(ind.ma50, card.currency)}
                </span>
                <span className="k">
                  기준일 {ind.date ?? '—'}
                  {providerLabel(card.price_source) && ` · ${providerLabel(card.price_source)} 시세`}
                </span>
              </div>
            </div>

            <div className="card-actions">
              <span className="k">마지막 매수 시그널</span>
              <LastBuySignal card={card} />
              <AiButton card={card} onAi={onAi} />
            </div>
          </article>
        )
      })}
    </div>
  )
}
