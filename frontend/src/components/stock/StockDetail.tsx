import { useEffect, useState, type ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { useBackToClose } from '../../lib/backToClose'
import { api } from '../../api/client'
import type { DashboardCard, FundamentalKey, FundamentalsResponse, HistoryResponse, RebalanceCurrent, RebalanceRow } from '../../types'
import { useAppState } from '../../AppState'
import { useCachedLoad } from '../../lib/cache'
import { useNarrow } from '../../lib/narrow'
import { showsSellConditions, useSignalRules } from '../../lib/signalRules'
import { METRIC_GROUPS, emptyReason, metricValue, type ChartTab } from '../../lib/fundamentals'
import { cardSignals, tone as toneOf } from '../../lib/portfolio'
import { MARKET_LABEL, num, price, signed, trafficLight } from '../../lib/display'
import { pushAccount } from '../../lib/push'
import { BuyConditions, SellConditions } from '../BuyConditions'
import { useAuth } from '../AuthGate'
import { ChartLegend, PriceChart } from '../PriceChart'
import { ErrorNotice } from '../ErrorNotice'
import { FundamentalsPanel } from '../FundamentalsPanel'
import { FundamentalsDetail } from '../fundamentals/DesktopFundamentals'
import { AiPanel } from '../AiPanel'
import { ReasonTag } from '../SignalShape'
import { SignalBadges } from '../ui/SignalBadges'
import { ChartCoverage } from './ChartCoverage'
import { RANGE_OPTIONS, type Range } from '../../lib/chartRange'
import { HoldingTab } from './HoldingTab'

/**
 * 이 종목의 평가금액 · 수익률 · 지금 비중 — 홈·리밸런싱과 같은 응답(새 계산 없음). 못 받으면 그 칸만 빈다.
 * 신호·보유 탭에서만 그린다 — 차트만 보는 팝업은 돈 응답을 기다릴 까닭이 없다.
 */
function CurrentLoader({ onLoad }: { onLoad: (value: RebalanceCurrent | null) => void }) {
  const { refreshKey } = useAppState()
  useCachedLoad('page:stocks:current', api.getRebalanceCurrent, onLoad, () => onLoad(null), [refreshKey])
  return null
}

/** AI 분석 보기 — 뒤로가기로 닫히면 차트로 돌아간다(종목 목록으로 나가지 않게, 사용자 확인 찾지 못한 것 1) */
function AiView({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  useBackToClose(onBack)
  return (
    <section className="stock-ai" aria-label="AI 분석">
      <h3 className="detail-card-title">AI 분석</h3>
      {children}
    </section>
  )
}

/**
 * PC 오른쪽 "비중" 카드 — 목업 11 나(주인 고름): 같은 자 위 막대 둘(현재 · 목표)과 한 줄 풀이.
 * 자 끝은 현재 · 허용 끝 중 큰 쪽의 1.2배. 숫자는 홈·리밸런싱과 같은 응답
 */
function WeightCard({ row, card }: { row: RebalanceRow | null; card: DashboardCard }) {
  const reasons = card.rebalance_signal?.reasons ?? []
  const badges = reasons.length > 0 && (
    <span className="badge-row">
      {reasons.map((r) => (
        <ReasonTag key={r} reason={r} />
      ))}
    </span>
  )
  if (!row) {
    return (
      <section className="detail-card side-card" aria-label="비중">
        <h3 className="detail-card-title">비중</h3>
        <p className="hint">보유수량을 적으면 지금 비중이 나옵니다.</p>
      </section>
    )
  }
  const lo = Math.max(0, row.target_weight_pct - row.band_pct)
  const hi = row.target_weight_pct + row.band_pct
  const top = Math.max(row.actual_weight_pct, hi) * 1.2 || 1
  const width = (v: number) => `${Math.min(100, Math.max(0, (v / top) * 100))}%`
  const gap = row.actual_weight_pct - row.target_weight_pct
  const out = row.actual_weight_pct < lo || row.actual_weight_pct > hi
  const line =
    Math.abs(gap) < 0.05
      ? '목표와 같습니다.'
      : `목표보다 ${num(Math.abs(gap), 1)}%p ${gap > 0 ? '많습니다' : '적습니다'}. 허용은 ${num(lo, 1)} ~ ${num(hi, 1)}%.`
  return (
    <section className="detail-card side-card" aria-label="비중">
      <div className="detail-card-head">
        <h3 className="detail-card-title">비중</h3>
        {badges}
      </div>
      <div className="side-bars">
        <div className="side-bar">
          <span className="side-bar-label">현재</span>
          <span className="side-bar-track" aria-hidden="true">
            <i className="now" style={{ width: width(row.actual_weight_pct) }} />
          </span>
          <b className={`mono${out ? ' side-weight-out' : ''}`}>{num(row.actual_weight_pct, 1)}%</b>
        </div>
        <div className="side-bar">
          <span className="side-bar-label">목표</span>
          <span className="side-bar-track" aria-hidden="true">
            <i className="target" style={{ width: width(row.target_weight_pct) }} />
          </span>
          <b className="mono">{num(row.target_weight_pct, 1)}%</b>
        </div>
      </div>
      <p className="hint side-weight-line">{line}</p>
    </section>
  )
}

const SUMMARY_KEYS: FundamentalKey[] = ['roe', 'revenue_yoy', 'debt_ratio']
const METRIC_LABEL = Object.fromEntries(METRIC_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.key === 'revenue_yoy' ? '매출 (전년 같은 분기)' : i.label])))

/** PC 오른쪽 "재무 요약" 카드 — 넷만, 자세히는 아래 (목업 10 나) */
function FundSummary({ data, failed, onMore }: { data: FundamentalsResponse | null; failed: boolean; onMore: () => void }) {
  const byKey = new Map(data?.metrics.map((m) => [m.key, m]) ?? [])
  const perMean = data?.per_range?.mean ?? null
  const has = !!data && data.state !== 'none' && data.metrics.length > 0
  return (
    <section className="detail-card side-card" aria-label="재무 요약">
      <div className="detail-card-head">
        <h3 className="detail-card-title">재무 요약</h3>
        {has && (
          <button type="button" className="link-like" onClick={onMore}>
            재무 자세히
          </button>
        )}
      </div>
      {has ? (
        <>
          <dl className="detail-kv side-kv">
            <div>
              <dt>PER</dt>
              <dd className="mono">{metricValue(byKey.get('per'), data.currency)}</dd>
            </div>
            <div>
              <dt>PER 5년 평균</dt>
              <dd className="mono">{perMean == null ? '—' : `${num(perMean, 1)}배`}</dd>
            </div>
            {SUMMARY_KEYS.map((key) => (
              <div key={key}>
                <dt>{METRIC_LABEL[key]}</dt>
                <dd className="mono">{metricValue(byKey.get(key), data.currency)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="hint">{data ? emptyReason(data) : failed ? '재무를 불러오지 못했습니다.' : '재무를 불러오는 중…'}</p>
      )}
    </section>
  )
}

const TAB_LABEL: Record<Exclude<ChartTab, 'ai'>, string> = {
  chart: '차트',
  signal: '신호',
  fundamentals: '재무',
  holding: '보유',
}

interface Props {
  ticker: string
  name?: string | null
  /** 그 종목의 오늘 카드 — 시세·신호. 없으면(시세를 아직 못 받음) 머리에 값이 비고 신호 탭이 안내만 */
  card?: DashboardCard
  initialTab?: ChartTab
  /** 머리줄 왼쪽 자리 — 화면이면 ‹(뒤로), 팝업이면 비움(✕ 는 오른쪽). AI 를 연 채인지 알아야 하면 함수로 */
  lead?: ReactNode | ((ctx: { aiOpen: boolean }) => ReactNode)
  /** 머리줄 오른쪽 자리 — 팝업의 ✕ */
  trail?: ReactNode
  /** 종목을 지웠을 때 (보유 탭) — 화면이면 종목 목록으로 */
  onPurged?: () => void
  /**
   * PC 종목 안 화면 (디자인 5차 목업 10 나) — 탭 없이 두 단: 왼쪽 차트와 매수 · 매도 조건, 오른쪽 보유 · 비중 · 재무 요약,
   * 아래 재무 자세히. 맨 위에 경로 줄 "홈 › 이름"(‹ 대신). 팝업과 폰은 탭 그대로
   */
  wide?: boolean
}

/**
 * 종목 안 — 머리(이름 · 현재가 · 등락 · 신호) + 위 탭 넷(차트 · 신호 · 재무 · 보유) + AI 분석 (디자인 4차 목업 11 가, 주인 고름).
 *
 * 종목 탭에서 들어오는 화면(/stocks/:ticker)과 홈·시그널 목록의 차트 팝업이 이 하나를 쓴다 —
 * 어디서 열든 같은 자리에 같은 것이 있게. 데이터는 화면이 받던 그대로(시세·재무·카드), 새 계산은 없다.
 */
export function StockDetail({ ticker, name, card, initialTab = 'chart', lead, trail, onPurged, wide = false }: Props) {
  const narrow = useNarrow()
  // 차트 위 매수 조건 한 줄이 있으면 폰 첫 화면에 날짜 축이 들어오게 줄인다 (0.45.0 C · 0.45.2 C2 와 같은 이유)
  const chartHeight = !narrow ? 380 : card && showsSellConditions(card) ? 256 : 316
  const [tab, setTab] = useState<ChartTab>(initialTab)
  const [fundamentals, setFundamentals] = useState<FundamentalsResponse | null>(null)
  const [fundFailed, setFundFailed] = useState(false)
  const [range, setRange] = useState<Range>('1y')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getHistory(ticker, range)
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [ticker, range, reloadKey])

  // 재무는 한 번만 — 차트 기간을 바꿀 때마다 다시 물을 이유가 없다. 못 받아도 차트는 그대로다.
  useEffect(() => {
    // 종목이 바뀌면 부품을 새로 만든다(key) — 실패 표시는 처음 값(false)에서 시작한다
    let alive = true
    api
      .getFundamentals(ticker)
      .then((data) => alive && setFundamentals(data))
      .catch(() => {
        if (!alive) return
        setFundamentals(null)
        setFundFailed(true)
      })
    return () => {
      alive = false
    }
  }, [ticker])

  const { user, guest, pending, canAdvise } = useAuth()
  // 보유 · AI 분석은 들어와 쓰는 사람만 — 손님·승인 대기는 담은 종목이 없다
  const member = !guest && !pending
  // 이 종목의 평가금액 · 수익률 · 지금 비중 — 신호·보유 탭을 열 때 받는다(CurrentLoader)
  const [current, setCurrent] = useState<RebalanceCurrent | null>(null)
  const row = current?.rows.find((r) => r.ticker === ticker) ?? null
  const tabs = (['chart', 'signal', 'fundamentals', ...(member ? (['holding'] as const) : [])] as const).map((key) => ({
    key,
    label: TAB_LABEL[key],
  }))
  const activeTab: ChartTab = (tab === 'ai' || tab === 'holding') && !member ? 'chart' : tab

  const rules = useSignalRules()
  const inRouter = useInRouterContext()
  const label = name ?? card?.name ?? ticker
  const signals = card ? cardSignals(card) : []
  const ind = card?.indicators
  const state = card ? trafficLight(card, rules).state : null
  const quiet = state === 'watch'
  const change = ind?.change_pct ?? null

  const rangeSeg = (
    <div className={`seg stock-ranges${wide ? '' : ' full'}`} role="group" aria-label="기간">
      {RANGE_OPTIONS.map((r) => (
        <button key={r.value} type="button" className={range === r.value ? 'active' : undefined} aria-pressed={range === r.value} onClick={() => setRange(r.value)}>
          {r.label}
        </button>
      ))}
    </div>
  )
  const conditions = card && (
    <div className="signal-rows chart-conditions">
      <BuyConditions card={card} explain />
      <SellConditions card={card} explain />
    </div>
  )
  const coverage = (
    <ChartCoverage ticker={ticker} history={history} range={range} onReloaded={() => setReloadKey((k) => k + 1)} onError={setError} />
  )
  const hero = (
      <div className="stock-hero">
        <p className="stock-hero-sub">
          {/* 띄어 쓴 가운뎃점 대신 사이 띄움으로 (목업 13 ④) */}
          {label !== ticker && <span className="nowrap">{ticker}</span>}
          {card && <span className="nowrap">{MARKET_LABEL[card.market] ?? ''}</span>}
          {card?.category && <span className="nowrap">{card.category}</span>}
        </p>
        {card && ind?.close != null && (
          <p className="stock-hero-price">
            <span className="stock-hero-close mono">{price(ind?.close ?? null, card.currency)}</span>
            <span className={`stock-hero-change mono ${toneOf(change)}`}>{signed(change, 2, '%')}</span>
            {ind?.date && <span className="hint nowrap">{ind.date} 종가</span>}
          </p>
        )}
        <SignalBadges signals={signals} className="stock-hero-badges" />
        {/* 오늘 매수·매도가 아니면 한 줄로 — 아래 "매수 조건 n/4"가 사라는 뜻으로 읽혔다(사용자 확인 헷갈린 말 1) */}
        {card && quiet && <p className="hint stock-hero-state">오늘은 매수·매도 신호가 없습니다. 아래 조건 줄은 몇 개가 맞는지만 보입니다.</p>}
      </div>
  )

  if (wide) {
    const toFund = () => document.getElementById('stock-fund')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    return (
      <div className="stock-detail stock-wide">
        <nav className="crumbs" aria-label="경로">
          {inRouter ? <Link to="/">홈</Link> : <span>홈</span>}
          <span className="crumbs-sep" aria-hidden="true">
            ›
          </span>
          <span aria-current="page">{label}</span>
        </nav>
        <div className="stock-wide-head">
          <div className="stock-wide-title">
            <h2 className="stock-detail-name">{label}</h2>
            {hero}
          </div>
          {member && (
            <button type="button" className={`stock-wide-ai${activeTab === 'ai' ? ' active' : ''}`} aria-pressed={activeTab === 'ai'} onClick={() => setTab(activeTab === 'ai' ? 'chart' : 'ai')}>
              {activeTab === 'ai' ? '차트로' : 'AI 분석'}
            </button>
          )}
        </div>
        {member && <CurrentLoader onLoad={setCurrent} />}
        {activeTab === 'ai' ? (
          <AiView onBack={() => setTab('chart')}>
            <AiPanel target={canAdvise ? { kind: 'research', ticker } : { kind: 'stock', ticker }} account={pushAccount(user)} />
          </AiView>
        ) : (
          <>
            <div className="stock-wide-two">
              <section className="stock-wide-chart" aria-label="차트">
                <div className="stock-wide-chart-head">
                  <ChartLegend history={history} loading={loading} />
                  {rangeSeg}
                </div>
                <ErrorNotice error={error} onDismiss={() => setError(null)} />
                <PriceChart history={history} height={400} zoomControls />
                {conditions}
                {coverage}
              </section>
              <aside className="stock-wide-side" aria-label="이 종목">
                {member && <HoldingTab side ticker={ticker} row={row} baseCurrency={current?.base_currency ?? 'KRW'} onPurged={onPurged} />}
                {member && card && <WeightCard row={row} card={card} />}
                <FundSummary data={fundamentals} failed={fundFailed} onMore={toFund} />
              </aside>
            </div>
            {fundamentals && fundamentals.state !== 'none' && fundamentals.metrics.length > 0 && (
              <section id="stock-fund" className="stock-wide-fund" aria-label="재무 자세히">
                <div className="stock-wide-fund-head">
                  <h3>재무 자세히</h3>
                  {inRouter && member && (
                    <Link to="/fundamentals" className="detail-link">
                      여러 종목 재무 한눈에 ›
                    </Link>
                  )}
                </div>
                <FundamentalsDetail row={fundamentals} embedded />
              </section>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="stock-detail">
      <div className="stock-detail-bar">
        {typeof lead === 'function' ? lead({ aiOpen: activeTab === 'ai' }) : lead}
        <h2 className="stock-detail-name">{label}</h2>
        {/* AI 분석은 머리 오른쪽 작은 한 줄 — 첫 화면에서 보이게(사용자 확인 찾지 못한 것 1). 시그널 목록 머리의 "AI 종목 정리"와 같은 모양 */}
        {member && (
          <button type="button" className={`ai-mini${activeTab === 'ai' ? ' active' : ''}`} aria-pressed={activeTab === 'ai'} onClick={() => setTab('ai')}>
            AI 분석
          </button>
        )}
        {trail}
      </div>
      {hero}

      <div className="stock-tabs" role="tablist" aria-label={`${label} 보기`}>
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={activeTab === t.key}
            className={`stock-tab${activeTab === t.key ? ' active' : ''}${t.key === 'signal' && signals.length > 0 ? ' has-dot' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'signal' && signals.length > 0 && <span className="sr-only"> (신호 있음)</span>}
          </button>
        ))}
      </div>

      {member && (activeTab === 'signal' || activeTab === 'holding') && <CurrentLoader onLoad={setCurrent} />}
      <div className="stock-detail-body">
        {activeTab === 'chart' && (
          <>
            {/* 기간은 하나만 고르는 것이라 한 줄 고르기 (목업 13 ③) */}
            <div className="seg full stock-ranges" role="group" aria-label="기간">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={range === r.value ? 'active' : undefined}
                  aria-pressed={range === r.value}
                  onClick={() => setRange(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
            {/* 신호의 근거를 차트 위에 한 줄 — 닫고 카드로 돌아가 읽지 않게 (과업 3). 이름표를 누르면 풀이 */}
            {card && (
              <div className="signal-rows chart-conditions">
                <BuyConditions card={card} explain />
                <SellConditions card={card} explain />
              </div>
            )}
            <PriceChart history={history} height={chartHeight} />
            <ChartLegend history={history} loading={loading} />
            <ChartCoverage
              ticker={ticker}
              history={history}
              range={range}
              onReloaded={() => setReloadKey((k) => k + 1)}
              onError={setError}
            />
          </>
        )}

        {activeTab === 'signal' &&
          (card ? (
            <div className="stock-signal">
              <section className="detail-card">
                <div className="signal-rows">
                  <BuyConditions card={card} explain />
                  <SellConditions card={card} explain />
                </div>
              </section>
              <section className="detail-card">
                <h3 className="detail-card-title">비중조절</h3>
                {row && (
                  <p className="detail-weight">
                    현재 <b className="mono">{num(row.actual_weight_pct, 1)}%</b> · 목표 <span className="mono">{num(row.target_weight_pct, 1)}%</span>{' '}
                    <span className="hint nowrap">(허용 ±{num(row.band_pct, 1)}%p)</span>
                  </p>
                )}
                {(card.rebalance_signal?.reasons.length ?? 0) > 0 ? (
                  <div className="badge-row">
                    {card.rebalance_signal.reasons.map((r) => (
                      <ReasonTag key={r} reason={r} />
                    ))}
                  </div>
                ) : (
                  <p className="hint">목표 비중에서 벗어나지 않았습니다.</p>
                )}
              </section>
              <p className="hint">시그널은 참고용이며 투자 권유가 아닙니다.</p>
            </div>
          ) : (
            <p className="hint detail-empty">시세를 받으면 이 종목의 매수·매도 조건이 여기에 보입니다.</p>
          ))}

        {activeTab === 'fundamentals' &&
          (fundamentals ? (
            fundamentals.state === 'none' ? (
              <p className="hint detail-empty">{emptyReason(fundamentals)}</p>
            ) : (
              <FundamentalsPanel data={fundamentals} />
            )
          ) : (
            <p className="hint detail-empty">{fundFailed ? '재무를 불러오지 못했습니다. 잠시 뒤 다시 열어 보세요.' : '재무를 불러오는 중…'}</p>
          ))}

        {/* 여러 종목 비교로 가는 길 — 재무 탭에서 바로(사용자 확인 찾지 못한 것 2) */}
        {activeTab === 'fundamentals' && inRouter && member && (
          <Link to="/fundamentals" className="detail-link">
            여러 종목 재무 한눈에 ›
          </Link>
        )}

        {activeTab === 'holding' && <HoldingTab ticker={ticker} row={row} baseCurrency={current?.base_currency ?? 'KRW'} onPurged={onPurged} />}

        {activeTab === 'ai' && (
          <AiView onBack={() => setTab('chart')}>
            <AiPanel
              // AI 분석은 하나 (9-13) — 웹을 찾아보는 종목 분석(내 비중 % 포함, 9-8). 관리자가 사용자에게 닫아 두면(9-15)
              // 그 사용자는 공용 숫자만 보내는 종목 정리를 받는다.
              target={canAdvise ? { kind: 'research', ticker } : { kind: 'stock', ticker }}
              account={pushAccount(user)}
            />
          </AiView>
        )}

      </div>
    </div>
  )
}
