import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChartModal } from '../components/ChartModal'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import {
  amount,
  CATEGORY_UNSET,
  categoryOf,
  KNEE_CONDITION_LABELS,
  MARKET_LABEL,
  num,
  price,
  providerLabel,
  readAdx,
  readDi,
  readDisparity,
  readMa200,
  readVolume,
  signed,
  trafficLight,
  type Traffic,
} from '../lib/display'
import type { Currency, DashboardCard, KneeConditions, RebalanceRow } from '../types'

/* 비중 스택 바에 쓰는 색 (최대 8종목까지 구분되고, 그 이상은 반복) */
const SLICE_COLORS = ['#38bdf8', '#a855f7', '#22c55e', '#f0b429', '#f05252', '#2dd4bf', '#f472b6', '#818cf8']

type QuickFilter = 'all' | 'knee' | 'rebalance'
type ViewMode = 'table' | 'card'

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

/** 무릎매수 네 조건 중 무엇이 충족됐는지 — 시그널이 안 뜬 이유를 바로 알 수 있게 한다 */
function KneeConditionChips({ conditions }: { conditions: KneeConditions }) {
  return (
    <div className="metric">
      <div className="cond-row">
        {KNEE_CONDITION_LABELS.map(({ key, label, detail }) => (
          <span
            key={key}
            className={`cond${conditions[key] === true ? ' met' : ''}`}
            title={`${detail} — ${conditions[key] === true ? '충족' : conditions[key] === false ? '미충족' : '판정 불가'}`}
          >
            {conditions[key] === true ? '✓' : conditions[key] === false ? '·' : '?'} {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function Metric({ value, tone, note }: { value: string; tone: string; note: string }) {
  return (
    <div className="metric">
      <span className={`metric-chip ${tone}`}>{value}</span>
      <span className="metric-note">{note}</span>
    </div>
  )
}

/**
 * 통화별 금액을 나란히 적는다 ("₩1,500,000 · $300").
 *
 * 환율로 합쳐서 한 숫자로 보여줄 수도 있지만, 실제로 주문할 금액은 통화별로 따로이므로
 * 나눠서 보여주는 쪽이 바로 쓰인다.
 */
function formatAmountsByCurrency(amounts: Partial<Record<Currency, number>>): string {
  const parts = (Object.entries(amounts) as [Currency, number][])
    .filter(([, value]) => value > 0)
    .map(([currency, value]) => amount(value, currency))
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function PriceCell({ card }: { card: DashboardCard }) {
  const change = card.indicators.change_pct
  const dir = change === null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : ''
  return (
    <div className="metric">
      <span className="metric-value">{price(card.indicators.close, card.currency)}</span>
      <span className={`metric-note ${dir}`}>{change === null ? '전일 대비 —' : signed(change, 2, '%')}</span>
    </div>
  )
}

function BuyCell({
  card,
  busyId,
  onConfirm,
}: {
  card: DashboardCard
  busyId: number | null
  onConfirm: (id: number) => void
}) {
  const buy = card.current_period_buy
  if (!buy) return <span className="hint">이번 기간 추천 없음</span>

  return (
    <div className="metric">
      <div className="badge-row">
        <span className={`badge ${buy.type === 'signal' ? 'badge-green' : 'badge-blue'}`}>
          {buy.type === 'signal' ? '시그널 매수' : '정기(폴백) 매수'}
        </span>
        {buy.status === 'recommended' ? (
          <span className="badge badge-amber">추천 · 미확정</span>
        ) : (
          <span className="badge badge-grey">매수 확정됨</span>
        )}
      </div>
      <span className="metric-note mono">
        {buy.exec_date} · {amount(buy.amount, card.currency)}
      </span>
      {buy.status === 'recommended' && (
        <button className="success sm" disabled={busyId === buy.id} onClick={() => onConfirm(buy.id)}>
          {busyId === buy.id ? '처리 중…' : '매수완료 확인'}
        </button>
      )}
    </div>
  )
}

export function Dashboard() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const [cards, setCards] = useState<DashboardCard[]>([])
  const [weights, setWeights] = useState<RebalanceRow[]>([])
  const [baseCurrency, setBaseCurrency] = useState<Currency>('KRW')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [chartCard, setChartCard] = useState<DashboardCard | null>(null)

  const [category, setCategory] = useState<string>('전체')
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1100 ? 'card' : 'table',
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([api.getDashboard(), api.getRebalanceCurrent()])
      .then(([c, rebalance]) => {
        setCards(c)
        setWeights(rebalance.rows)
        setBaseCurrency(rebalance.base_currency)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [refreshKey])

  const handleConfirm = async (buyId: number) => {
    setBusyId(buyId)
    try {
      await api.confirmBuy(buyId, true)
      notifyDataChanged()
    } catch (e) {
      setError(e)
    } finally {
      setBusyId(null)
    }
  }

  const summary = useMemo(() => {
    const lights = cards.map(trafficLight)
    const buys = cards.map((c) => c.current_period_buy).filter((b) => b !== null)
    const recommended = buys.filter((b) => b!.status === 'recommended')
    const reasons = cards.flatMap((c) => (c.rebalance_signal.active ? c.rebalance_signal.reasons : []))
    return {
      buy: lights.filter((l) => l.state === 'buy').length,
      watch: lights.filter((l) => l.state === 'watch').length,
      hot: lights.filter((l) => l.state === 'hot').length,
      stale: lights.filter((l) => l.state === 'stale').length,
      recommendedCount: recommended.length,
      // 통화가 섞이면 그냥 더할 수 없다 — 통화별로 나눠서 보여준다
      recommendedAmounts: cards.reduce<Partial<Record<Currency, number>>>((acc, card) => {
        const buy = card.current_period_buy
        if (buy && buy.status === 'recommended') {
          acc[card.currency] = (acc[card.currency] ?? 0) + buy.amount
        }
        return acc
      }, {}),
      confirmedCount: buys.length - recommended.length,
      rebalanceCount: cards.filter((c) => c.rebalance_signal.active).length,
      sellReview: reasons.filter((r) => r.includes('매도')).length,
      buyReview: reasons.filter((r) => r.includes('매수')).length,
      periodicReview: reasons.filter((r) => r.includes('정기')).length,
    }
  }, [cards])

  const allocation = useMemo(() => {
    // 평가금액은 반드시 기준통화 환산값으로 합산한다 (현지 통화끼리 더하면 비중이 틀어진다)
    const invested = weights.filter((w) => w.current_value_base > 0)
    const total = invested.reduce((s, w) => s + w.current_value_base, 0)
    const worst = weights.reduce<RebalanceRow | null>(
      (acc, w) => (acc === null || Math.abs(w.excess_pct) > Math.abs(acc.excess_pct) ? w : acc),
      null,
    )
    return { invested, total, worst }
  }, [weights])

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

  const visible = useMemo(
    () =>
      cards.filter((c) => {
        if (category !== '전체' && categoryOf(c.category) !== category) return false
        if (quick === 'knee' && !c.knee_buy_v2) return false
        if (quick === 'rebalance' && !c.rebalance_signal.active) return false
        return true
      }),
    [cards, category, quick],
  )

  if (loading) return <p className="hint">불러오는 중…</p>
  if (error && cards.length === 0) return <ErrorNotice error={error} />

  if (cards.length === 0) {
    return (
      <div className="empty-state">
        <h3>아직 등록된 종목이 없습니다</h3>
        <p>
          <Link to="/stocks">종목 관리</Link>에서 티커를 추가하면 전체 히스토리를 내려받아 지표와 시그널을
          계산합니다. 예: VOO, QQQ, NVDA
        </p>
      </div>
    )
  }

  return (
    <div>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">종합 신호등 현황</span>
            <span className="hint mono">{cards.length}종목</span>
          </div>
          <div className="kpi-counts">
            <span className="count-chip green">
              <span className="num">{summary.buy}</span>
              <span className="lbl">무릎매수</span>
            </span>
            <span className="count-chip amber">
              <span className="num">{summary.watch}</span>
              <span className="lbl">추세 관망</span>
            </span>
            <span className="count-chip red">
              <span className="num">{summary.hot}</span>
              <span className="lbl">과열 주의</span>
            </span>
          </div>
          <p className="kpi-foot">
            {summary.stale > 0
              ? `${summary.stale}종목은 시세가 오래되어 판정에서 제외됐습니다.`
              : '모든 종목의 시세가 최신 상태입니다.'}
          </p>
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">이번 기간 매수</span>
          </div>
          <div className="kpi-figure">
            <span className="big">{summary.recommendedCount}</span>
            <span className="hint">건 확인 대기</span>
          </div>
          <p className="kpi-foot">
            추천 금액 합계 {formatAmountsByCurrency(summary.recommendedAmounts)} · 확정 완료{' '}
            {summary.confirmedCount}건
          </p>
        </div>

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
                    title={`${w.ticker} ${num(w.actual_weight_pct, 1)}%`}
                  />
                ))}
              </div>
              <div className="weight-legend">
                {allocation.invested.map((w, i) => (
                  <span key={w.ticker}>
                    <i
                      className="legend-dot"
                      style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                      aria-hidden="true"
                    />
                    {w.ticker} <span className="mono">{num(w.actual_weight_pct, 1)}%</span>
                  </span>
                ))}
              </div>
              <p className="kpi-foot">
                총 {amount(allocation.total, baseCurrency)} ·{' '}
                {allocation.worst && Math.abs(allocation.worst.excess_pct) >= 0.05
                  ? `목표 대비 최대 이탈: ${allocation.worst.ticker} ${signed(allocation.worst.excess_pct, 1, '%p')}`
                  : '목표 비중과 거의 일치합니다.'}
              </p>
            </>
          ) : (
            <p className="kpi-foot">
              보유수량이 없습니다. 리밸런싱 화면에서 수량을 입력하면 실제 비중이 계산됩니다.
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
            무릎매수 충족 {summary.buy}
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
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <h3>조건에 맞는 종목이 없습니다</h3>
          <p>필터를 바꾸거나 "모두 보기"를 선택해주세요.</p>
        </div>
      ) : view === 'table' ? (
        <SignalMatrix cards={visible} busyId={busyId} onConfirm={handleConfirm} onChart={setChartCard} />
      ) : (
        <SignalCards cards={visible} busyId={busyId} onConfirm={handleConfirm} onChart={setChartCard} />
      )}

      {chartCard && (
        <ChartModal
          ticker={chartCard.ticker}
          name={chartCard.name}
          onClose={() => setChartCard(null)}
        />
      )}

      <p className="hint" style={{ marginTop: 14 }}>
        무릎매수(v2) = -DI &gt; +DI · 이격도 &lt; 0 · (StdDev20 축소 또는 거래량비 &gt; 1.1) · ADX &gt; 20 —
        네 조건을 모두 만족할 때. 어깨매도는 참고 신호이며 실제 매도 실행일은 리밸런싱 리뷰 마감일입니다.
      </p>
    </div>
  )
}

function SignalMatrix({
  cards,
  busyId,
  onConfirm,
  onChart,
}: {
  cards: DashboardCard[]
  busyId: number | null
  onConfirm: (id: number) => void
  onChart: (card: DashboardCard) => void
}) {
  return (
    <div className="table-scroll">
      <table className="data-table" style={{ minWidth: 1280 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>구분 / 종목</th>
            <th style={{ minWidth: 104 }}>현재가</th>
            <th style={{ minWidth: 104 }}>
              이격도
              <br />
              (MA20 대비)
            </th>
            <th style={{ minWidth: 104 }}>
              ADX
              <br />
              (추세 강도)
            </th>
            <th style={{ minWidth: 118 }}>
              DI 방향
              <br />
              (+DI / -DI)
            </th>
            <th style={{ minWidth: 104 }}>
              거래량비
              <br />
              (MA5/MA20)
            </th>
            <th style={{ minWidth: 110 }}>
              200일선
              <br />
              (장기 추세)
            </th>
            <th style={{ minWidth: 218 }}>
              종합 신호등
              <br />
              (무릎매수 조건)
            </th>
            <th style={{ minWidth: 172 }}>이번 기간 매수</th>
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
              <tr key={card.ticker}>
                <td>
                  <div className="ticker-cell">
                    {card.category && <span className="cat-tag">{card.category}</span>}
                    <span className="ticker-name">{card.name ?? card.ticker}</span>
                    <button className="ticker-sub link" onClick={() => onChart(card)}>
                      {card.ticker} · {MARKET_LABEL[card.market]} · 차트 보기
                    </button>
                  </div>
                </td>
                <td>
                  <PriceCell card={card} />
                </td>
                <td>
                  <Metric value={signed(ind.disparity, 2, '%')} tone={disparity.tone} note={disparity.note} />
                </td>
                <td>
                  <Metric value={num(ind.adx, 1)} tone={adx.tone} note={adx.note} />
                </td>
                <td>
                  <Metric
                    value={`${num(ind.plus_di, 1)} / ${num(ind.minus_di, 1)}`}
                    tone={di.tone}
                    note={di.note}
                  />
                </td>
                <td>
                  <Metric value={`${num(ind.vol_ratio, 2)}x`} tone={vol.tone} note={vol.note} />
                </td>
                <td>
                  <Metric value={signed(ma200.pct, 1, '%')} tone={ma200.tone} note={ma200.note} />
                </td>
                <td>
                  <div className="metric">
                    <TrafficBadge traffic={trafficLight(card)} />
                    <KneeConditionChips conditions={card.knee_conditions} />
                    <div className="badge-row">
                      {card.shoulder_sell_ref && <span className="badge badge-amber">어깨매도(참고)</span>}
                      {card.rebalance_signal.reasons.map((r) => (
                        <span className="badge badge-purple" key={r}>
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                </td>
                <td>
                  <BuyCell card={card} busyId={busyId} onConfirm={onConfirm} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SignalCards({
  cards,
  busyId,
  onConfirm,
  onChart,
}: {
  cards: DashboardCard[]
  busyId: number | null
  onConfirm: (id: number) => void
  onChart: (card: DashboardCard) => void
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

        return (
          <article key={card.ticker} className="stock-card">
            <div className="stock-card-head">
              <div className="ticker-cell">
                {card.category && <span className="cat-tag">{card.category}</span>}
                <span className="ticker-name">{card.name ?? card.ticker}</span>
                <button className="ticker-sub link" onClick={() => onChart(card)}>
                  {card.ticker} · {MARKET_LABEL[card.market]} · 차트 보기
                </button>
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

            <KneeConditionChips conditions={card.knee_conditions} />

            {(card.shoulder_sell_ref || card.rebalance_signal.active) && (
              <div className="badge-row">
                {card.shoulder_sell_ref && <span className="badge badge-amber">어깨매도(참고)</span>}
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
              </div>
              <div className="stat-box">
                <span className="k">ADX 추세강도</span>
                <span className="v">{num(ind.adx, 1)}</span>
                <span className="k">{adx.note}</span>
              </div>
              <div className="stat-box">
                <span className="k">+DI / -DI</span>
                <span className="v">
                  {num(ind.plus_di, 1)} / {num(ind.minus_di, 1)}
                </span>
                <span className="k">{di.note}</span>
              </div>
              <div className="stat-box">
                <span className="k">거래량비</span>
                <span className="v">{num(ind.vol_ratio, 2)}x</span>
                <span className="k">{vol.note}</span>
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
              <BuyCell card={card} busyId={busyId} onConfirm={onConfirm} />
            </div>
          </article>
        )
      })}
    </div>
  )
}
