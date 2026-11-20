import { SignalBadges } from '../ui/SignalBadges'
import { num, price, signed, stockLabel, rowLabel } from '../../lib/display'
import { signalsOf, tone, type PortfolioItem } from '../../lib/portfolio'
import { cardConditions } from '../../lib/signalRules'

interface Props {
  /** 신호가 하나라도 뜬 종목 — 보유 · 관심 모두 */
  items: PortfolioItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 종목 화면(/stocks/:ticker)으로 */
  onOpen: (item: PortfolioItem) => void
}

function labelOf(item: PortfolioItem): string {
  return item.card ? stockLabel(item.card) : rowLabel(item.row)
}

/** "2026-11-19" → "11월 19일" */
function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [, m, d] = iso.split('-').map(Number)
  if (!m || !d) return null
  return `${m}월 ${d}일`
}

type Kind = 'buy' | 'sell' | 'weight'

interface Line {
  label: string
  value: string
  /** 조건을 채웠나 — 비중 줄은 없다 */
  ok?: boolean | null
}

function Card({ title, kind, count, lines }: { title: string; kind: Kind; count: string; lines: Line[] }) {
  return (
    <section className={`sig-card ${kind}`} aria-label={title}>
      <header className="sig-card-head">
        <h4>{title}</h4>
        <span className="sig-card-count">{count}</span>
      </header>
      <ul className="sig-card-body">
        {lines.map((line) => (
          <li key={line.label} className={`sig-line${line.ok ? ' ok' : ''}`}>
            {kind !== 'weight' && (
              <span className="sig-mark" aria-label={line.ok ? '채움' : line.ok === false ? '못 채움' : '판정 불가'}>
                {line.ok ? '✓' : line.ok === false ? '·' : '?'}
              </span>
            )}
            <span className="sig-name">{line.label}</span>
            <b className="sig-value">{line.value}</b>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 홈 시그널 탭 (디자인 5차 목업 02 다 · 02b~e) — 왼쪽 신호 뜬 종목 목록, 오른쪽에 고른 종목의 매수 조건 · 매도 조건 · 비중을
 * 같은 크기 카드 셋으로. 카드에는 지금 값만 — 기준은 "기준" 단추의 창에서 본다(주인 답).
 */
export function SignalPanel({ items, selected, onSelect, onOpen }: Props) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <h3>오늘은 신호가 뜬 종목이 없습니다</h3>
        <p>매수, 매도, 비중조절 모두 조용합니다.</p>
      </div>
    )
  }
  const item = items.find((i) => i.row.ticker === selected) ?? items[0]
  const card = item.card
  const ind = card?.indicators
  const buy = card ? cardConditions(card) : {}
  const sell = card?.sell_conditions ?? {}
  const buyLines: Line[] = [
    { label: '하락 우세 (−DI / +DI)', value: ind && ind.minus_di != null && ind.plus_di != null ? `${num(ind.minus_di, 1)} / ${num(ind.plus_di, 1)}` : '—', ok: buy.di_bearish },
    { label: '이격도 (MA20)', value: ind?.disparity != null ? signed(ind.disparity, 1, '%') : '—', ok: buy.disparity_negative },
    { label: '거래량 (20일 평균 대비)', value: ind?.vol_ratio != null ? `${num(ind.vol_ratio, 2)}배` : '—', ok: buy.volatility_or_volume },
    { label: 'ADX', value: ind?.adx != null ? num(ind.adx, 1) : '—', ok: buy.adx_trending },
  ]
  const ma50Gap = ind && ind.close != null && ind.ma50 ? ((ind.close / ind.ma50 - 1) * 100) : null
  const sellLines: Line[] = [
    { label: 'MA50 대비', value: ma50Gap != null ? signed(ma50Gap, 1, '%') : '—', ok: sell.above_ma50 ?? null },
    { label: 'ADX 오름', value: ind?.adx != null ? num(ind.adx, 1) : '—', ok: sell.adx_rising ?? null },
    { label: '5일 거래량 (20일 대비)', value: ind?.vol_ratio != null ? `${num(ind.vol_ratio, 2)}배` : '—', ok: sell.volume_strong ?? null },
  ]
  const row = item.row
  const weightLines: Line[] = [
    { label: '현재', value: `${num(row.actual_weight_pct, 1)}%` },
    { label: '목표', value: `${Number(row.target_weight_pct.toFixed(2))}%` },
    { label: '목표와 차이', value: signed(row.excess_pct, 1, '%p') },
  ]
  const met = (values: (boolean | null | undefined)[]) => values.filter((v) => v === true).length
  const lastBuy = dayLabel(card?.last_buy_signal_date)
  const signals = signalsOf(item)

  return (
    <div className="sig-panel">
      <ul className="sig-list" role="listbox" aria-label="신호가 뜬 종목">
        {items.map((it) => {
          const on = it.row.ticker === item.row.ticker
          return (
            <li key={it.row.ticker} role="option" aria-selected={on}>
              <button type="button" className={`sig-item${on ? ' active' : ''}`} onClick={() => onSelect(it.row.ticker)}>
                <span className="sig-item-name">
                  <b>{labelOf(it)}</b>
                  <small>
                    {price(it.row.last_close, it.row.currency)}{' '}
                    <span className={tone(it.row.change_pct ?? null)}>{signed(it.row.change_pct ?? null, 2, '%')}</span>
                  </small>
                </span>
                <SignalBadges signals={signalsOf(it)} />
              </button>
            </li>
          )
        })}
      </ul>
      <article className="sig-detail" aria-label={`${labelOf(item)} 신호`}>
        <header className="sig-detail-head">
          <h3>{labelOf(item)}</h3>
          <SignalBadges signals={signals} />
        </header>
        {card ? (
          <div className="sig-cards">
            <Card title="매수 조건" kind="buy" count={`${met(buyLines.map((l) => l.ok))} / ${buyLines.length}`} lines={buyLines} />
            <Card title="매도 조건" kind="sell" count={`${met(sellLines.map((l) => l.ok))} / ${sellLines.length}`} lines={sellLines} />
            <Card title="비중" kind="weight" count={signed(row.excess_pct, 1, '%p')} lines={weightLines} />
          </div>
        ) : (
          <p className="hint">지표를 아직 받지 못했습니다.</p>
        )}
        <footer className="sig-detail-foot">
          <span className="hint">{lastBuy ? `마지막 매수 신호는 ${lastBuy}입니다.` : '매수 신호가 뜬 적이 없습니다.'}</span>
          <button type="button" className="sm" onClick={() => onOpen(item)}>
            종목 화면 열기
          </button>
        </footer>
      </article>
    </div>
  )
}
