import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import type { DashboardCard, FundamentalsResponse, HistoryResponse } from '../../types'
import { useNarrow } from '../../lib/narrow'
import { showsSellConditions } from '../../lib/signalRules'
import { emptyReason, type ChartTab } from '../../lib/fundamentals'
import { cardSignals, tone as toneOf } from '../../lib/portfolio'
import { MARKET_LABEL, price, signed } from '../../lib/display'
import { pushAccount } from '../../lib/push'
import { BuyConditions, SellConditions } from '../BuyConditions'
import { useAuth } from '../AuthGate'
import { ChartLegend, PriceChart } from '../PriceChart'
import { ErrorNotice } from '../ErrorNotice'
import { FundamentalsPanel } from '../FundamentalsPanel'
import { AiPanel } from '../AiPanel'
import { ReasonTag } from '../SignalShape'
import { SignalBadges } from '../ui/SignalBadges'
import { Icon } from '../icons/Icon'
import { ChartCoverage } from './ChartCoverage'
import { RANGE_OPTIONS, type Range } from '../../lib/chartRange'
import { HoldingTab } from './HoldingTab'

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
  /** 머리줄 왼쪽 자리 — 화면이면 ‹(뒤로), 팝업이면 비움(✕ 는 오른쪽) */
  lead?: ReactNode
  /** 머리줄 오른쪽 자리 — 팝업의 ✕ */
  trail?: ReactNode
  /** 종목을 지웠을 때 (보유 탭) — 화면이면 종목 목록으로 */
  onPurged?: () => void
}

/**
 * 종목 안 — 머리(이름 · 현재가 · 등락 · 신호) + 위 탭 넷(차트 · 신호 · 재무 · 보유) + AI 분석 (디자인 4차 목업 11 가, 주인 고름).
 *
 * 종목 탭에서 들어오는 화면(/stocks/:ticker)과 홈·시그널 목록의 차트 팝업이 이 하나를 쓴다 —
 * 어디서 열든 같은 자리에 같은 것이 있게. 데이터는 화면이 받던 그대로(시세·재무·카드), 새 계산은 없다.
 */
export function StockDetail({ ticker, name, card, initialTab = 'chart', lead, trail, onPurged }: Props) {
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
    let alive = true
    setFundFailed(false)
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
  const tabs = (['chart', 'signal', 'fundamentals', ...(member ? (['holding'] as const) : [])] as const).map((key) => ({
    key,
    label: TAB_LABEL[key],
  }))
  const activeTab: ChartTab = (tab === 'ai' || tab === 'holding') && !member ? 'chart' : tab

  const label = name ?? card?.name ?? ticker
  const signals = card ? cardSignals(card) : []
  const ind = card?.indicators
  const change = ind?.change_pct ?? null

  return (
    <div className="stock-detail">
      <div className="stock-detail-bar">
        {lead}
        <h2 className="stock-detail-name">{label}</h2>
        {trail}
      </div>
      <div className="stock-hero">
        <p className="stock-hero-sub">
          {label !== ticker && <span className="nowrap">{ticker} · </span>}
          {card && (
            <span className="nowrap">
              {MARKET_LABEL[card.market] ?? ''}
              {card.category && ` · ${card.category}`}
            </span>
          )}
        </p>
        {card && ind?.close != null && (
          <p className="stock-hero-price">
            <span className="stock-hero-close mono">{price(ind?.close ?? null, card.currency)}</span>
            <span className={`stock-hero-change mono ${toneOf(change)}`}>{signed(change, 2, '%')}</span>
            {ind?.date && <span className="hint nowrap">{ind.date} 종가</span>}
          </p>
        )}
        <SignalBadges signals={signals} className="stock-hero-badges" />
      </div>

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

      <div className="stock-detail-body">
        {activeTab === 'chart' && (
          <>
            <div className="chip-row stock-ranges" aria-label="기간">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`chip${range === r.value ? ' active' : ''}`}
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

        {activeTab === 'holding' && <HoldingTab ticker={ticker} onPurged={onPurged} />}

        {activeTab === 'ai' && (
          <section className="stock-ai" aria-label="AI 분석">
            <h3 className="detail-card-title">AI 분석</h3>
            <AiPanel
              // AI 분석은 하나 (9-13) — 웹을 찾아보는 종목 분석(내 비중 % 포함, 9-8). 관리자가 사용자에게 닫아 두면(9-15)
              // 그 사용자는 공용 숫자만 보내는 종목 정리를 받는다.
              target={canAdvise ? { kind: 'research', ticker } : { kind: 'stock', ticker }}
              account={pushAccount(user)}
            />
          </section>
        )}

        {member && activeTab !== 'ai' && activeTab !== 'holding' && (
          <div className="detail-row">
            <button type="button" className="detail-row-link" onClick={() => setTab('ai')}>
              <span className="detail-row-icon">
                <Icon name="ai" />
              </span>
              <span className="detail-row-text">AI 분석</span>
            </button>
            <p className="hint detail-row-hint">신호 근거와 소식을 글로 정리합니다 · AI 키 필요</p>
          </div>
        )}
      </div>
    </div>
  )
}
