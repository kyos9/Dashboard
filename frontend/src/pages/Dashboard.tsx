import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MacroStrip } from '../components/MacroStrip'
import { PortfolioView, type SignalFilter } from '../components/PortfolioView'
import { ReasonTag, SellTooTag, SignalShape } from '../components/SignalShape'
import { BuyConditions } from '../components/BuyConditions'
import { hasWeightSignal, isWeightReason, weightSide } from '../components/weightSignal'
import { useNarrow } from '../lib/narrow'
import { loadView, saveView, type DashboardView } from '../lib/portfolio'
import { NumberInput } from '../components/NumberInput'
import { dropSide, moveOne, placeAt } from '../lib/reorder'
import { useReorderAnimation } from '../lib/flip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { lazyChunk } from '../lib/lazyChunk'
import { useCachedLoad } from '../lib/cache'
import { ChartModal, preloadChartModal } from '../lib/chartChunk'
import { ModalLoading } from '../components/ModalLoading'
import { PageSkeleton } from '../components/Skeleton'
import type { ChartTab } from '../lib/fundamentals'
import { useRecheck } from '../lib/recheck'

// 차트는 누를 때 받는다 (App.tsx의 HistoryChart와 같은 이유)
const AiSummaryModal = lazyChunk(() => import('../components/AiSummaryModal'), 'AiSummaryModal')
// 시그널 기준(0.42.0)도 누를 때 받는다 — 첫 화면 JS 를 늘리지 않게
const SignalThresholdsModal = lazyChunk(() => import('../components/SignalThresholdsModal'), 'SignalThresholdsModal')
import { useAuth } from '../components/AuthGate'
import { pushAccount } from '../lib/push'
import { ErrorNotice } from '../components/ErrorNotice'
import {
  CATEGORY_UNSET,
  categoryOf,
  conditionMark,
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
  signed,
  stockLabel,
  trafficLight,
  conditionTitle,
  type MetricKey,
  type Traffic,
} from '../lib/display'
import {
  buyRule,
  buyRuleSentence,
  canCustomize,
  cardConditions,
  conditionByMetric,
  METRIC_ORDER,
  useSignalRules,
} from '../lib/signalRules'
import type { DashboardCard, RebalanceCurrent, RebalanceRow, SignalRules, Stock, StockUpdateInput } from '../types'

// over·under — 신호 요약의 "비중 초과·미달" 칩 (0.45.3 A). 눌러도 아무 일이 없었다(0.44.0 사용자 확인)
type QuickFilter = 'all' | 'knee' | 'sell' | 'rebalance' | 'over' | 'under'
/** 표 / 카드 / 설정(편집) — 같은 목록을 다른 형태로 보는 것이라 한 자리에서 고른다 */
type ViewMode = 'table' | 'card' | 'edit'

/** 관망을 대신하는 흐린 "—" 의 풀이 — 마우스를 올리거나 읽어 주는 기기가 이 말을 쓴다 (0.44.0, 주인 결정) */
const WATCH_HINT = '관망(매수·매도 조건 미충족)'

/** 신호등 — 매수 ▲ · 매도 ▼ 는 모양이 붙는다. 색만으로 가리지 않는다 (8-4).
    관망은 할 일이 없다는 뜻이라 눈에 띄지 않게 흐린 "—" 만 (0.44.0). 빈칸으로 두면 "시세 없음"과 같아 보이고,
    매수·매도만 남아 할 일 목록처럼 읽힌다(계획 검토). 수는 그대로 센다 — 신호 요약의 "관망 N" */
/** 신호 거르기 하나 — 목록·넘어온 종목 풀기·칩 수가 같은 판정을 쓴다 (0.45.3 A) */
function matchesQuick(card: DashboardCard, quick: QuickFilter, rules: SignalRules): boolean {
  if (quick === 'knee') return !!card.knee_buy_v2
  // 매도는 신호 요약의 "매도" 수와 같은 것 — 신호등이 매도인 종목 (디자인 2차, 주인 결정)
  if (quick === 'sell') return trafficLight(card, rules).state === 'hot'
  if (quick === 'rebalance') return hasWeightSignal(card)
  if (quick === 'over' || quick === 'under') return weightSide(card) === quick
  return true
}

function TrafficBadge({ traffic }: { traffic: Traffic }) {
  if (traffic.state === 'watch') {
    return (
      <span className="traffic-watch" role="img" title={WATCH_HINT} aria-label={WATCH_HINT}>
        —
      </span>
    )
  }
  return (
    <span className={`traffic ${traffic.tone}`} title={traffic.desc}>
      {traffic.state === 'buy' || traffic.state === 'hot' ? (
        <SignalShape kind={traffic.state === 'buy' ? 'buy' : 'sell'} />
      ) : (
        <span className="traffic-lamp" aria-hidden="true">
          <i />
          <i />
        </span>
      )}
      {traffic.label}
    </span>
  )
}

/**
 * 시그널 줄과 비중 줄 — 왼쪽 이름표로 지표 신호(▲▼)와 비중 신호(◆)를 가른다.
 *
 * 디자인 2차가 카드에 넣은 모양을 시그널 표의 칸에도 같이 쓴다 (0.44.0, 주인 결정 "한 칸에 이름표 두 줄").
 * 표에서는 "▼ 매도"와 "◆ 매수 검토"가 이름 없이 한 줄로 붙어 "팔라는데 사라고도?"로 읽혔다.
 * 부르는 쪽이 `.signal-rows` 격자 안에 둔다(카드는 그 아래 매수 조건 줄을 더 붙인다).
 */
/** 비중 줄 끝의 숫자 — 리밸런싱 행(현금 포함 전체 자금 대비, 기준통화). 카드에서만 (0.45.3 B) */
type WeightNumbers = Pick<RebalanceRow, 'actual_weight_pct' | 'target_weight_pct' | 'band_pct'>

function SignalAndWeightRows({ card, rules, numbers }: { card: DashboardCard; rules: SignalRules; numbers?: WeightNumbers }) {
  // 비중 줄에는 초과·미달만. 정기 리뷰는 모든 종목에 같은 날 붙는 포트폴리오의 날짜라 줄마다 세우면 시끄럽다 —
  // 신호 요약의 "정기 리뷰 N" 배지가 말한다(계획 B, 0.43 의 `hasWeightSignal` 과 같은 기준)
  const weight = card.rebalance_signal.active ? card.rebalance_signal.reasons.filter(isWeightReason) : []
  return (
    <>
      <div className="signal-row">
        <span className="signal-row-label">시그널</span>
        <div className="signal-row-items">
          <TrafficBadge traffic={trafficLight(card, rules)} />
          {/* 둘 다 뜨면 신호등은 매수를 보여준다 — 매도 쪽이 조용히 사라지지 않게 */}
          {card.knee_buy_v2 && card.shoulder_sell_ref && <SellTooTag />}
        </div>
      </div>
      {weight.length > 0 && (
        <div className="signal-row">
          <span className="signal-row-label">비중</span>
          <div className="signal-row-items">
            {weight.map((r) => (
              <ReasonTag key={r} reason={r} />
            ))}
            {/* 얼마나 벗어났는지 — "비중 초과"만으로는 몰랐다(0.44.0 사용자 확인). 밴드도 — "왜 이 종목만 미달?"(계획 사용자 검토).
                리밸런싱 화면과 같은 수(현금 포함 전체 자금 대비). 그 종목의 행이 없으면 숫자 없이 지금 그대로 */}
            {numbers && (
              <span className="hint weight-numbers nowrap">
                지금 {num(numbers.actual_weight_pct, 1)}% · 목표 {num(numbers.target_weight_pct, 0)}% ± {num(numbers.band_pct, 0)}%p
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* 카드의 조건 칩은 지표마다 붙이지 않고 "매수 조건" 한 줄로 모은다 — components/BuyConditions.tsx (디자인 2차).
   1차 때는 "숫자 옆에 두면 바로 읽힌다"고 지표 아래에 붙였지만, 거래량 칸의 "변동성·거래량 ✓"처럼
   숫자와 판정이 어긋나 보였고 칸이 없는 조건은 그려지지 않았다. 표는 지금처럼 칸마다 기호 하나. */

/**
 * 표에서는 조건을 기호 하나로만 찍는다.
 *
 * 칸마다 값·해석·조건을 세 줄씩 쌓으니 한 행이 130px이 되어, 다섯 종목이면 이미
 * 화면을 넘겼다. 조건이 무엇인지는 열 머리글에 한 번만 적혀 있으므로(그 열의 성질이지
 * 행마다 달라지는 값이 아니다) 행에는 충족 여부만 있으면 된다. 자세한 말은 마우스를
 * 올리면 나오고, 카드 보기에는 그대로 다 적혀 있다.
 */
function ConditionMark({ metric, conditions }: { metric: MetricKey; conditions: Record<string, boolean | null> }) {
  const condition = conditionByMetric(useSignalRules())[metric]
  if (!condition) return null
  const met = conditions[condition.key]
  const mark = conditionMark(met)
  return (
    <span
      className={`cond-mark${met === true ? ' met' : ''}`}
      title={conditionTitle(condition.detail, mark.word, condition.label)}
      aria-label={`${condition.label} ${mark.word}`}
    >
      {mark.sign}
    </span>
  )
}

/** 열 머리글 — 이름, 부제, 그리고 이 열이 맡은 매수 조건 */
function MetricHead({ title, sub, metric }: { title: string; sub: string; metric?: MetricKey }) {
  const condition = conditionByMetric(useSignalRules())[metric ?? '']
  return (
    <>
      {title}
      <br />
      <span className="th-sub">{sub}</span>
      {/* 조건식은 한 덩어리 — "-DI > / +DI" 처럼 갈라지지 않게. "매수 조건"이라는 말은 첫 칸이 한 번 말한다 */}
      {condition && (
        <span className="th-cond nowrap" title={`매수 조건 ${condition.header}`}>
          {/* 화면에는 첫 칸이 한 번, 화면 읽기에는 칸마다 */}
          <span className="sr-only">매수 조건 </span>
          {condition.header}
        </span>
      )}
    </>
  )
}

/**
 * 끌어서 순서 바꾸기. 마우스를 못 쓰는 상황을 위해 위아래 화살표 키도 받는다.
 *
 * **폰에서는 끌지 않는다** (ROADMAP 8-3). 손가락으로는 끌기가 시작되지 않고, 26px 손잡이는 누르기도
 * 어렵다. 대신 "순서 편집"을 켜면 이 자리에 44px ▲▼ 버튼이 선다 — 켜지 않으면 아무것도 없다.
 */
function DragHandle({
  ticker,
  label,
  controls,
}: {
  ticker: string
  label: string
  controls: RowControlProps
}) {
  if (controls.narrow) {
    if (!controls.ordering) return null
    const index = controls.tickers.indexOf(ticker)
    return (
      <span className="move-buttons">
        <button
          aria-label={`${label} 위로`}
          disabled={controls.busy || index <= 0}
          onClick={() => controls.onMove(ticker, 'up')}
        >
          ▲
        </button>
        <button
          aria-label={`${label} 아래로`}
          disabled={controls.busy || index === controls.tickers.length - 1}
          onClick={() => controls.onMove(ticker, 'down')}
        >
          ▼
        </button>
      </span>
    )
  }
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
  conditions?: Record<string, boolean | null>
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
  const rule = buyRule(useSignalRules())
  const date = card.last_buy_signal_date
  if (!date) return <span className="hint">저장된 기간에 없음</span>
  const days = daysFrom(date)
  return (
    <div className="metric-line" title={`${rule.name}(${rule.spec_name})이 마지막으로 뜬 날`}>
      <span className="metric-value mono">{date}</span>
      <span className={`metric-note ${days !== null && days <= 7 ? 'tone-buy' : ''}`}>{relativeDay(days)}</span>
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

export function Dashboard() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const [cards, setCards] = useState<DashboardCard[]>([])
  // 리밸런싱과 같은 응답 — 대시보드와 리밸런싱의 합계가 원 단위까지 같다 (ROADMAP 8-3)
  const [current, setCurrent] = useState<RebalanceCurrent | null>(null)
  const weights = useMemo(() => new Map((current?.rows ?? []).map((r) => [r.ticker, r])), [current])
  const [error, setError] = useState<unknown>(null)
  const narrow = useNarrow()
  // 팝업과 어느 탭부터 열지 — 종목 이름은 차트, 맨 오른쪽 "AI 분석" 버튼은 AI 탭
  const [chart, setChart] = useState<{ card: DashboardCard; tab: ChartTab } | null>(null)
  const [showThresholds, setShowThresholds] = useState(false)
  // 기준을 저장한 뒤 잠깐 보이는 한 줄 — 비교 기간만 바꾸면 화면 숫자가 그대로라 저장됐는지 몰랐다 (0.42.0 사용자 확인)
  const [thresholdsNote, setThresholdsNote] = useState<string | null>(null)
  useEffect(() => {
    if (!thresholdsNote) return
    const timer = setTimeout(() => setThresholdsNote(null), 6000)
    return () => clearTimeout(timer)
  }, [thresholdsNote])
  const openChart = useCallback((card: DashboardCard) => setChart({ card, tab: 'chart' }), [])
  const openAi = useCallback((card: DashboardCard) => setChart({ card, tab: 'ai' }), [])
  const [aiAll, setAiAll] = useState(false)
  const closeAiAll = useCallback(() => setAiAll(false), [])
  const { user, canAdvise } = useAuth()
  // 포트폴리오 진단 (9-7) — 내 비중(%)이 AI 에게 간다. 관리자는 늘, 사용자는 관리자가 열어 둔 동안 (9-15)
  const [aiPortfolio, setAiPortfolio] = useState(false)
  const closeAiPortfolio = useCallback(() => setAiPortfolio(false), [])
  const [stocks, setStocks] = useState<Stock[]>([])
  const [reordering, setReordering] = useState(false)
  // 폰의 "순서 편집" — 켜면 줄마다 ▲▼ 가 선다
  const [ordering, setOrdering] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  // 끄는 동안 보여줄 임시 순서. 놓기 전에도 자리가 벌어지는 게 보여야
  // "여기 놓으면 여기로 간다"를 손이 아니라 눈으로 확인할 수 있다.
  const [preview, setPreview] = useState<string[] | null>(null)

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState(false)
  const [confirmingPurge, setConfirmingPurge] = useState<string | null>(null)

  const [category, setCategory] = useState<string>('전체')
  const [quick, setQuick] = useState<QuickFilter>('all')
  // 폰: 보기·설정 단추 다섯(표·카드·종목 설정·시그널 기준·순서 편집)을 접어 둔다 — 필터가 네 줄이라 첫 카드가
  // 첫 화면 밖이었다 (디자인 2차, 주인 결정). 순서 편집·종목 설정 중에는 접지 않는다(끝내는 단추가 거기 있다)
  const [viewToolsOpen, setViewToolsOpen] = useState(false)
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1100 ? 'card' : 'table',
  )

  // 시그널 규칙 — 카드가 다른 판을 말하면(정의를 바꿔 배포한 뒤) 다시 받는다
  const rules = useSignalRules(cards[0]?.signal_rules_version)

  const fetchAll = useCallback(
    () => Promise.all([api.getDashboard(), api.getRebalanceCurrent(), api.listStocks()]),
    [],
  )

  // 탭을 옮겨 와도 들고 있던 값을 먼저 그린다 (ROADMAP 8-1)
  const { loading } = useCachedLoad(
    'page:dashboard',
    fetchAll,
    ([c, rebalance, stockList]) => {
      setError(null)
      setCards(c)
      setCurrent(rebalance)
      setStocks(stockList)
      // 편집 중이던 값은 서버에서 다시 받은 값으로 맞춘다 (저장 직후에 온다)
      setDrafts(draftsFrom(stockList))
      setConfirmingPurge(null)
    },
    setError,
    [refreshKey],
  )

  // 표가 그려지면 차트 팝업 조각을 미리 받아 둔다 — 이름을 누르자마자 열리게 (ROADMAP 8-1)
  useEffect(() => {
    if (cards.length > 0) preloadChartModal()
  }, [cards.length])

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
    const lights = cards.map((card) => trafficLight(card, rules))
    const reasons = cards.flatMap((c) => (c.rebalance_signal.active ? c.rebalance_signal.reasons : []))
    return {
      buy: lights.filter((l) => l.state === 'buy').length,
      watch: lights.filter((l) => l.state === 'watch').length,
      hot: lights.filter((l) => l.state === 'hot').length,
      stale: lights.filter((l) => l.state === 'stale').length,
      rebalanceCount: cards.filter(hasWeightSignal).length,
      // 칩 수와 누르면 걸러진 수가 같게 — 종목 수로, 거르기와 같은 판정(`weightSide`)으로 센다 (0.45.3 A)
      sellReview: cards.filter((c) => weightSide(c) === 'over').length,
      buyReview: cards.filter((c) => weightSide(c) === 'under').length,
      periodicReview: reasons.filter((r) => r.includes('정기')).length,
      // 내 기준을 쓰는 사람에게만 뜻이 있다 — 같은 카드를 기본 기준의 오늘 매수로 바꿔 센다 (0.42.0)
      buyDefault: cards.filter(
        (c) => trafficLight({ ...c, knee_buy_v2: !!c.knee_buy_v2_default }, rules).state === 'buy',
      ).length,
      buyDiffers: rules.custom
        ? cards.filter((c) => !c.data_stale && c.knee_buy_v2 !== !!c.knee_buy_v2_default).map((c) => stockLabel(c))
        : [],
    }
  }, [cards, rules])

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
      if (!matchesQuick(c, quick, rules)) return false
      return true
    })
    if (!preview) return shown
    // 끄는 동안에는 임시 순서로 보여준다 (저장은 놓을 때 한 번만 한다)
    const rank = new Map(preview.map((ticker, index) => [ticker, index]))
    return [...shown].sort((a, b) => (rank.get(a.ticker) ?? 0) - (rank.get(b.ticker) ?? 0))
  }, [cards, category, quick, preview, rules])

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
    narrow,
    ordering,
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

  /* ---------- 포트폴리오 | 시그널 ----------
     고른 쪽은 기기에 기억한다. 신호 점을 눌러 넘어간 것은 기억하지 않고 **뒤로가기 한 칸**을 쌓는다 —
     폰에서 뒤로가기를 누르면 포트폴리오의 보던 자리로 돌아온다. */
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [storedView, setStoredView] = useState<DashboardView>(loadView)
  const urlView = params.get('view')
  const mode: DashboardView = urlView === 'signal' || urlView === 'portfolio' ? urlView : storedView
  const fromDot = (location.state as { fromDot?: boolean } | null)?.fromDot === true
  const portfolioScroll = useRef<number | null>(null)

  const chooseView = (next: DashboardView) => {
    if (next === mode) return
    if (fromDot && next === 'portfolio') {
      // 점을 눌러 온 칸을 거두면 포트폴리오로 돌아간다 — 헛도는 칸이 남지 않는다
      navigate(-1)
      return
    }
    if (next === 'signal') portfolioScroll.current = window.scrollY
    saveView(next)
    setStoredView(next)
    if (urlView !== null) setParams({}, { replace: true })
  }

  const goToSignal = (ticker: string) => {
    portfolioScroll.current = window.scrollY
    navigate({ search: '?view=signal' }, { state: { fromDot: true, focus: ticker } })
  }

  // 맨 위 "확인할 신호" 줄 — 점과 같이 뒤로가기 한 칸을 쌓는다(돌아오면 포트폴리오).
  // 종류를 눌렀으면 그 종류로 걸러서 연다 (디자인 2차, 주인 결정 ②)
  const openSignals = (kind?: SignalFilter) => {
    portfolioScroll.current = window.scrollY
    navigate({ search: '?view=signal' }, { state: { fromDot: true, quick: kind ?? 'all' } })
  }
  const askedQuick = mode === 'signal' ? ((location.state as { quick?: QuickFilter } | null)?.quick ?? null) : null
  useEffect(() => {
    if (askedQuick) setQuick(askedQuick)
    // 같은 칸으로 다시 오면 다시 (focus 와 같은 규칙)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedQuick ? location.key : null])

  // 시그널 보기로 넘어온 종목 — 필터가 가리고 있으면 "모두 보기"로 돌리고, 편집 중이면 보기로 바꾼다
  const focus = mode === 'signal' ? ((location.state as { focus?: string } | null)?.focus ?? null) : null
  const focusKey = focus ? location.key : null
  useEffect(() => {
    if (!focus) return
    const target = cards.find((c) => c.ticker === focus)
    if (!target) return
    if (category !== '전체' && categoryOf(target.category) !== category) setCategory('전체')
    if (!matchesQuick(target, quick, rules)) setQuick('all')
    if (view === 'edit') setView(narrow ? 'card' : 'table')
    // 필터를 고른 뒤의 화면에서 찾는다 — 한 번만 (같은 칸으로 다시 오면 다시)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, cards.length])

  useEffect(() => {
    if (!focusKey || !focus) return
    const frame = requestAnimationFrame(() => {
      const element = listRef.current?.querySelector<HTMLElement>(`[data-ticker="${CSS.escape(focus)}"]`)
      if (!element) return
      element.scrollIntoView?.({ block: 'center' })
      element.classList.add('flash')
      window.setTimeout(() => element.classList.remove('flash'), 2000)
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, visible.length, view])

  // 포트폴리오로 돌아오면 보던 자리로
  useLayoutEffect(() => {
    if (mode !== 'portfolio' || portfolioScroll.current === null) return
    const y = portfolioScroll.current
    portfolioScroll.current = null
    window.scrollTo?.(0, y)
  }, [mode])

  if (loading) return <PageSkeleton blocks={4} rows={6} />
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
            {/* "위의 '시그널'"이라고 했지만 0종목일 때는 그 버튼이 없다 — 종목을 담은 뒤에 생긴다고 말한다 (0.42.0) */}
            <b>내 포트폴리오 보기</b> — 종목을 담으면 이 화면에 평가금액·수익률이 나오고, 맨 위에 생기는{' '}
            <b>포트폴리오 / 시그널</b> 단추에서 "시그널"을 고르면 종목마다 매수·매도 시그널이 보입니다. 시세는 장
            마감 뒤 매일 새로 받습니다.
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
      <div className="view-head">
        <div className="view-switch" role="group" aria-label="대시보드 보기">
          <button aria-pressed={mode === 'portfolio'} onClick={() => chooseView('portfolio')}>
            포트폴리오
          </button>
          <button aria-pressed={mode === 'signal'} onClick={() => chooseView('signal')}>
            시그널
          </button>
        </div>
        {mode === 'portfolio' && current && canAdvise && (
          <button className="chip view-head-action" onClick={() => setAiPortfolio(true)}>
            ✦ AI 포트폴리오 진단
          </button>
        )}
        {/* 두 보기 모두 AI 는 같은 자리 — 전환 옆 (디자인 1차). 담은 종목 전체를 AI 가 한 장으로 (3c-2).
            누르면 창만 열린다 — 부르는 것은 창에서 한 번 더 */}
        {mode === 'signal' && (
          <button className="chip view-head-action" onClick={() => setAiAll(true)}>
            ✦ AI 전체 정리
          </button>
        )}
      </div>

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

      {mode === 'portfolio' && current ? (
        <PortfolioView
          current={current}
          cards={cards}
          stocks={stocks}
          narrow={narrow}
          onChart={openChart}
          onSignal={goToSignal}
          onOpenSignals={openSignals}
          onSaved={notifyDataChanged}
        />
      ) : (
      <>
      {/* 구분 입력 추천값 — 편집 모드의 구분 칸에서 쓴다 */}
      <datalist id="category-options">
        {categories.map(([name]) => (
          <option key={name} value={name === CATEGORY_UNSET ? '' : name} />
        ))}
      </datalist>

      {/* 매크로는 한 줄만. 홈의 주인공은 종목이다 (components/MacroStrip.tsx) */}
      <MacroStrip />

      {/* 신호 요약 한 장 (디자인 1차) — 시그널 넷(매수·관망·매도·비중조절)을 한 줄에, 비중조절의 갈래는 그 아래.
          예전에는 "종합 신호등"과 "비중조절" 두 장이라 폰 첫 화면을 다 썼다. */}
      <section className="kpi signal-summary" aria-label="신호 요약">
        <div className="kpi-head">
          <span className="kpi-title">신호 요약</span>
          <span className="hint mono">{cards.length}종목</span>
        </div>
        {/* 칸이 단추처럼 생겨 누르게 된다 — 누르면 아래 "신호" 거르기가 그 종류로 (디자인 2차, 주인 결정).
            관망은 거르기가 없어 누르지 않는 칸이다 */}
        <div className="kpi-counts">
          <button
            type="button"
            className="count-chip green"
            aria-pressed={quick === 'knee'}
            onClick={() => setQuick(quick === 'knee' ? 'all' : 'knee')}
          >
            <span className="num">{summary.buy}</span>
            <span className="lbl">
              <SignalShape kind="buy" size={9} /> 매수
            </span>
          </button>
          <span className="count-chip amber">
            <span className="num">{summary.watch}</span>
            <span className="lbl">관망</span>
          </span>
          <button
            type="button"
            className="count-chip red"
            aria-pressed={quick === 'sell'}
            onClick={() => setQuick(quick === 'sell' ? 'all' : 'sell')}
          >
            <span className="num">{summary.hot}</span>
            <span className="lbl">
              <SignalShape kind="sell" size={9} /> 매도
            </span>
          </button>
          <button
            type="button"
            className="count-chip purple"
            aria-pressed={quick === 'rebalance'}
            onClick={() => setQuick(quick === 'rebalance' ? 'all' : 'rebalance')}
          >
            <span className="num">{summary.rebalanceCount}</span>
            <span className="lbl">
              <SignalShape kind="rebalance" size={9} /> 비중조절
            </span>
          </button>
        </div>
        <div className="badge-row">
          {/* 비중조절은 보라 ◆ — 매도·매수 시그널(빨강·초록)이나 오르내림 색과 섞이지 않게 (8-4).
              초과·미달은 누르면 그 종목만 — 테두리 있는 칩(누르는 것), 정기 리뷰·밴드 이내는 그대로 배지(표시만) (0.45.3 A) */}
          {summary.sellReview > 0 && (
            <button
              type="button"
              className={`chip weight-chip${quick === 'over' ? ' active' : ''}`}
              aria-pressed={quick === 'over'}
              onClick={() => setQuick(quick === 'over' ? 'all' : 'over')}
            >
              <SignalShape kind="rebalance" size={9} /> 비중 초과 {summary.sellReview}
            </button>
          )}
          {summary.buyReview > 0 && (
            <button
              type="button"
              className={`chip weight-chip${quick === 'under' ? ' active' : ''}`}
              aria-pressed={quick === 'under'}
              onClick={() => setQuick(quick === 'under' ? 'all' : 'under')}
            >
              <SignalShape kind="rebalance" size={9} /> 비중 미달 {summary.buyReview}
            </button>
          )}
          {summary.periodicReview > 0 && (
            <span className="badge badge-purple">정기 리뷰 {summary.periodicReview}</span>
          )}
          {summary.rebalanceCount === 0 && <span className="badge badge-grey">비중 모두 밴드 이내</span>}
        </div>
        <p className="kpi-foot">
          {summary.stale > 0
            ? `${summary.stale}종목은 시세가 오래되어 판정에서 제외됐습니다.`
            : '모든 종목의 시세가 최신 상태입니다.'}
        </p>
        {/* 내 기준을 쓰는 사람에게만 (0.42.0) — 저장이 됐는지, 지금 어느 기준으로 보는지 */}
        {rules.custom && (
          <p className="kpi-foot mine-note" role="note">
            <strong>내 기준</strong>으로 본 판정 · 오늘 매수 {summary.buy}개
            {summary.buyDefault === summary.buy ? ' · 기본 기준과 같습니다' : ` (기본 기준이면 ${summary.buyDefault}개)`}
            {/* 어느 종목이 달라졌는지 — 숫자만으로는 찾을 수 없었다 (0.42.0 사용자 확인) */}
            {summary.buyDiffers.length > 0 && ` · 다른 종목: ${summary.buyDiffers.join(', ')}`}
            {' · '}
            <button type="button" className="link-btn" onClick={() => setShowThresholds(true)}>
              시그널 기준
            </button>
          </p>
        )}
        {/* 정의를 바꾼 뒤 30일 — 지난 차트의 점이 왜 달라졌는지 알 수 있게 (주인 결정, 0.41.0) */}
        {rules.change_notice && (
          <p className="kpi-foot" role="note">
            {rules.change_notice}
          </p>
        )}
      </section>

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
          {/* 이름은 짧게 — 모양이 종류를 말한다 (8-4 배지와 같은 규칙) */}
          <button className={`chip${quick === 'knee' ? ' active' : ''}`} onClick={() => setQuick('knee')}>
            <SignalShape kind="buy" size={9} /> 매수 {summary.buy}
          </button>
          <button className={`chip${quick === 'sell' ? ' active' : ''}`} onClick={() => setQuick('sell')}>
            <SignalShape kind="sell" size={9} /> 매도 {summary.hot}
          </button>
          {/* 위 요약의 초과·미달을 켜면 여기서는 비중조절 칩이 켜져 그 갈래를 말한다 — 아무것도 안 켜진 줄이 됐다(계획 검토).
              칩을 따로 더하면 폰에서 이 줄이 한 줄 늘어 첫 카드가 640 화면 끝까지 밀렸다(다시 보기) */}
          <button
            className={`chip${quick === 'rebalance' || quick === 'over' || quick === 'under' ? ' active' : ''}`}
            onClick={() => setQuick('rebalance')}
          >
            <SignalShape kind="rebalance" size={9} /> 비중조절{' '}
            {quick === 'over' ? `· 초과 ${summary.sellReview}` : quick === 'under' ? `· 미달 ${summary.buyReview}` : summary.rebalanceCount}
          </button>
          {narrow && (
            <button
              className={`chip${viewToolsOpen || ordering || view === 'edit' ? ' active' : ''}`}
              aria-expanded={viewToolsOpen || ordering || view === 'edit'}
              aria-controls="signal-view-tools"
              onClick={() => setViewToolsOpen((o) => !o)}
            >
              {/* ▾/▴ = 눌러서 펼친다/접는다 (용어 사전 · 어포던스). ⋯ 는 폰 메뉴의 기호라 쓰지 않는다 */}
              보기·설정 {viewToolsOpen || ordering || view === 'edit' ? '▴' : '▾'}
            </button>
          )}
        </div>
        {(!narrow || viewToolsOpen || ordering || view === 'edit') && (
        <div className="chip-row spacer" id="signal-view-tools">
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
            ⚙ 종목 설정
          </button>
          {/* 내 기준 (0.42.0). 옛 서버면 숨긴다 — 바꿀 길이 없다 */}
          {canCustomize(rules) && (
            <button className="chip" onClick={() => setShowThresholds(true)} aria-haspopup="dialog">
              시그널 기준{rules.custom ? ' · 내 기준' : ''}
            </button>
          )}
          {narrow && (
            <button
              className={`chip${ordering ? ' active' : ''}`}
              aria-pressed={ordering}
              onClick={() => setOrdering((o) => !o)}
            >
              {ordering ? '순서 편집 끝' : '↕ 순서 편집'}
            </button>
          )}
        </div>
        )}
      </div>

      {thresholdsNote && (
        <p className="hint saved-note" role="status">
          {thresholdsNote}
        </p>
      )}

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
          weights={weights}
          onChart={openChart}
          onAi={openAi}
          controls={rowControls}
        />
      )}
      </div>

      {/* "—" 의 풀이가 툴팁에만 있으면 폰·키보드로는 볼 수 없다(B 검토·사용자) — 화면에 한 줄로 */}
      <p className="hint signal-key" style={{ marginTop: 14 }}>
        <strong>시그널</strong> 줄은 지표로 본 매수·매도이고, 흐린 <span className="traffic-watch" aria-hidden="true">—</span>는 관망(매수·매도 조건 미충족)입니다.{' '}
        <strong>비중</strong> 줄은 지표와 따로, 목표 비중에서 벗어났는지(비중 초과·비중 미달)를 말합니다.
      </p>
      <p className="hint" style={{ marginTop: 6 }}>
        {rules.custom && <strong>내 기준: </strong>}
        {buyRuleSentence(rules)} 표에서는 각 조건이 해당 지표 칸에, 카드에서는 "매수 조건" 줄에 ✓로 표시됩니다. 매도 시그널은 참고용이며 실제
        매도는 리밸런싱 리뷰 때 비중을 보고 정합니다.
      </p>
      </>
      )}

      {chart && (
        <Suspense
          fallback={
            <ModalLoading
              title={stockLabel(chart.card)}
              subtitle={stockLabel(chart.card) !== chart.card.ticker ? chart.card.ticker : undefined}
              onClose={() => setChart(null)}
            />
          }
        >
          <ChartModal
            // 같은 종목이라도 다른 버튼으로 열면 그 탭부터 — 새로 띄운다
            key={`${chart.card.ticker}:${chart.tab}`}
            ticker={chart.card.ticker}
            name={stockLabel(chart.card)}
            card={chart.card}
            initialTab={chart.tab}
            onClose={() => setChart(null)}
          />
        </Suspense>
      )}

      {showThresholds && (
        <Suspense fallback={null}>
          <SignalThresholdsModal
            rules={rules}
            onClose={() => setShowThresholds(false)}
            onSaved={(message) => {
              setThresholdsNote(message)
              notifyDataChanged()
            }}
          />
        </Suspense>
      )}

      {aiAll && (
        <Suspense fallback={null}>
          <AiSummaryModal kind="watchlist" account={pushAccount(user)} onClose={closeAiAll} />
        </Suspense>
      )}
      {aiPortfolio && canAdvise && (
        <Suspense fallback={null}>
          <AiSummaryModal kind="portfolio" account={pushAccount(user)} onClose={closeAiPortfolio} />
        </Suspense>
      )}
    </div>
  )
}

interface RowControlProps {
  tickers: string[]
  busy: boolean
  /** 폰 폭 — 끌기 대신 "순서 편집" 버튼 */
  narrow: boolean
  ordering: boolean
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
  const rules = useSignalRules()
  // 지표 칸이 없는 매수 조건 — 지금 규칙에는 없다. 생기면(정의 변경) 칸 하나에 모아 보인다. 없으면 표는 그대로
  // (디자인 2차: 칸 수에 묶이지 않게. 예전에는 칸 없는 조건이 표에서 사라졌다)
  const extras = buyRule(rules).conditions.filter((c) => !METRIC_ORDER.includes(c.metric))
  // 그 칸의 폭은 가장 긴 조건 이름에 맞춘다 — 이름이 길면 칩이 세 줄로 접혔다(자동 검사 "조건 하나 더")
  const extraWidth = extras.length
    ? Math.min(320, Math.max(140, 56 + 13 * Math.max(...extras.map((c) => c.label.length))))
    : 0
  return (
    <div className="table-scroll">
      <table className="data-table fixed signal-table" style={{ minWidth: 1302 + extraWidth }}>
        <thead>
          <tr>
            <th style={{ width: 44 }} aria-label="순서" />
            <th style={{ width: 146 }}>
              구분 / 종목
              <span className="th-cond">매수 조건 →</span>
            </th>
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
            {extras.length > 0 && (
              <th style={{ width: extraWidth }}>
                그 밖의 조건
                <span className="th-cond">{extras.map((c) => c.header).join(' · ')}</span>
              </th>
            )}
            {/* 이름표 + 배지가 한 줄에 들어가는 폭 — "비중 ◆ 비중 미달" (8-4, 0.44.0 에 두 줄로) */}
            <th style={{ width: 196 }}>신호</th>
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
            const adx = readAdx(ind.adx, rules.thresholds.adx_trend)
            const di = readDi(ind.plus_di, ind.minus_di)
            const vol = readVolume(ind.vol_ratio, rules.thresholds.vol_ratio_expand)
            const ma200 = readMa200(ind.close, ind.ma200)

            return (
              <tr key={card.ticker} data-ticker={card.ticker} {...dragProps(card.ticker, controls)}>
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
                    conditions={cardConditions(card)}
                  />
                </td>
                <td>
                  <Metric
                    value={num(ind.adx, 1)}
                    tone={adx.tone}
                    note={adx.note}
                    metric="adx"
                    conditions={cardConditions(card)}
                  />
                </td>
                <td>
                  <Metric
                    value={`${num(ind.plus_di, 1)} / ${num(ind.minus_di, 1)}`}
                    tone={di.tone}
                    note={di.note}
                    metric="di"
                    conditions={cardConditions(card)}
                  />
                </td>
                <td>
                  <Metric
                    value={`${num(ind.vol_ratio, 2)}x`}
                    tone={vol.tone}
                    note={vol.note}
                    metric="volume"
                    conditions={cardConditions(card)}
                  />
                </td>
                <td>
                  <Metric value={signed(ma200.pct, 1, '%')} tone={ma200.tone} note={ma200.note} />
                </td>
                {extras.length > 0 && (
                  <td>
                    <div className="badge-row">
                      {extras.map((condition) => {
                        const met = cardConditions(card)[condition.key]
                        const mark = conditionMark(met)
                        return (
                          <span key={condition.key} className="extra-cond">
                            <span
                              className={`cond-mark${met === true ? ' met' : ''}`}
                              title={conditionTitle(condition.detail, mark.word, condition.label)}
                              aria-label={`${condition.label} ${mark.word}`}
                            >
                              {mark.sign}
                            </span>{' '}
                            {condition.label}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                )}
                <td>
                  {/* 시그널 · 비중 이름표 두 줄 — 카드와 같은 모양 (0.44.0) */}
                  <div className="signal-rows signal-cell-rows">
                    <SignalAndWeightRows card={card} rules={rules} />
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
            ? controls.narrow
              ? '고칠 값을 바로 입력하세요. 순서는 위의 "순서 편집"으로 바꿉니다.'
              : '고칠 값을 바로 입력하세요. 순서는 맨 앞 ⠿를 끌어서 바꿉니다.'
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
  weights,
  onChart,
  onAi,
  controls,
}: {
  cards: DashboardCard[]
  weights?: Map<string, WeightNumbers>
  onChart: (card: DashboardCard) => void
  onAi: (card: DashboardCard) => void
  controls: RowControlProps
}) {
  const rules = useSignalRules()
  return (
    <div className="card-grid">
      {cards.map((card) => {
        const ind = card.indicators
        const disparity = readDisparity(ind.disparity)
        const adx = readAdx(ind.adx, rules.thresholds.adx_trend)
        const di = readDi(ind.plus_di, ind.minus_di)
        const vol = readVolume(ind.vol_ratio, rules.thresholds.vol_ratio_expand)
        const ma200 = readMa200(ind.close, ind.ma200)
        const change = ind.change_pct
        const drag = dragProps(card.ticker, controls)

        return (
          <article
            key={card.ticker}
            data-ticker={card.ticker}
            className={`stock-card signal-card ${drag.className}`.trim()}
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

            {/* 시그널 · 비중 · 매수 조건 — 왼쪽 이름표로 종류를 가른다 (디자인 2차, 주인 결정 시안 v4).
                "▼ 매도"와 "◆ 매수 검토"가 이름표 없이 붙어 있으면 "팔라는데 사라고도?"로 읽혔다 */}
            <div className="signal-rows">
              <SignalAndWeightRows card={card} rules={rules} numbers={weights?.get(card.ticker)} />
              <BuyConditions card={card} />
            </div>

            {/* 지표는 값과 풀이만 — 조건 칩은 위 "매수 조건" 줄로 옮겼다. 폰에서는 한 줄씩의 목록 (index.css) */}
            <div className="stat-grid">
              <div className="stat-box">
                <span className="k stat-name">이격도 (MA20)</span>
                <span className={`v ${disparity.tone === 'grey' ? '' : disparity.tone}`}>
                  {signed(ind.disparity, 2, '%')}
                </span>
                <span className="k stat-note">{disparity.note}</span>
              </div>
              <div className="stat-box">
                <span className="k stat-name">ADX 추세강도</span>
                <span className="v">{num(ind.adx, 1)}</span>
                <span className="k stat-note">{adx.note}</span>
              </div>
              <div className="stat-box">
                <span className="k stat-name">DI 방향 (+DI / -DI)</span>
                {/* 표의 칩과 같은 부호 색 — 카드만 흰 글자였다 (B 사용자 확인) */}
                <span className={`v ${di.tone === 'grey' ? '' : di.tone}`}>
                  {num(ind.plus_di, 1)} / {num(ind.minus_di, 1)}
                </span>
                <span className="k stat-note">{di.note}</span>
              </div>
              <div className="stat-box">
                <span className="k stat-name">거래량비</span>
                <span className="v">{num(ind.vol_ratio, 2)}x</span>
                <span className="k stat-note">{vol.note}</span>
              </div>
              <div className="stat-box">
                <span className="k stat-name">200일선 대비</span>
                <span className={`v ${ma200.tone === 'grey' ? '' : ma200.tone}`}>{signed(ma200.pct, 1, '%')}</span>
                <span className="k stat-note">{ma200.note}</span>
              </div>
              <div className="stat-box stat-box-wide-note">
                <span className="k stat-name">MA20 / MA50</span>
                {/* 가격마다 한 덩어리 — 좁으면 "/" 뒤에서만 꺾인다 (디자인 2차, 확대 150%) */}
                <span className="v">
                  <span className="nowrap">{price(ind.ma20, card.currency)} /</span>{' '}
                  <span className="nowrap">{price(ind.ma50, card.currency)}</span>
                </span>
                {/* 좁으면 "·" 에서 꺾인다 — 날짜와 출처는 각자 한 덩어리 (디자인 1차) */}
                <span className="k stat-note">
                  기준일 <span className="nowrap">{ind.date ?? '—'}</span>
                  {providerLabel(card.price_source) && (
                    <>
                      {' · '}
                      <span className="nowrap">{providerLabel(card.price_source)} 시세</span>
                    </>
                  )}
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
