import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { num, price, rowLabel, signed } from '../../lib/display'
import { bigAmount, emptyReason, growth, METRIC_GROUPS, metricValue, quarterName } from '../../lib/fundamentals'
import { tone } from '../../lib/portfolio'
import type { FundamentalQuarter, FundamentalsResponse } from '../../types'

const SOURCE_LABEL: Record<string, string> = { sec: 'SEC', dart: 'DART', yahoo: '야후' }
/** 카드 머리 — 팝업의 묶음 이름보다 짧게 (디자인 5차 목업 04) */
const GROUP_TITLES = ['가치', '수익성', '성장', '안정']

const QUARTER_COLUMNS: { key: keyof FundamentalQuarter; label: string }[] = [
  { key: 'revenue', label: '매출' },
  { key: 'operating_income', label: '영업이익' },
  { key: 'net_income', label: '순이익' },
  { key: 'eps_diluted', label: 'EPS' },
]

/** "2026-10-30" → "10월 30일" */
function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [, m, d] = iso.split('-').map(Number)
  return m && d ? `${m}월 ${d}일` : null
}

/** 결산일이 1년 전 같은 달인 분기 */
function yearBefore(quarters: FundamentalQuarter[], q: FundamentalQuarter): FundamentalQuarter | undefined {
  const [y, m] = q.period_end.split('-').map(Number)
  return quarters.find((o) => {
    const [oy, om] = o.period_end.split('-').map(Number)
    return oy === y - 1 && om === m
  })
}

function Change({ label, value }: { label: string; value: number | null }) {
  return (
    <small>
      <em>{label}</em> <span className={tone(value)}>{signed(value, 1, '%')}</span>
    </small>
  )
}

// 목록 응답에는 분기 표가 없다 — 고른 종목만 따로 받아 둔다
const quarterCache = new Map<string, FundamentalQuarter[]>()

function useQuarters(row: FundamentalsResponse): FundamentalQuarter[] | null {
  const [, bump] = useState(0)
  const ticker = row.ticker
  const want = row.metrics.length > 0 && row.quarters.length === 0 && !quarterCache.has(ticker)
  useEffect(() => {
    if (!want) return
    let live = true
    api
      .getFundamentals(ticker)
      .then((full) => quarterCache.set(ticker, full.quarters))
      .catch(() => quarterCache.set(ticker, []))
      .finally(() => live && bump((n) => n + 1))
    return () => {
      live = false
    }
  }, [ticker, want])
  if (row.quarters.length > 0) return row.quarters
  return quarterCache.get(ticker) ?? null
}

function Detail({ row }: { row: FundamentalsResponse }) {
  const all = useQuarters(row)
  if (row.metrics.length === 0) {
    return (
      <article className="sig-detail fd-detail" aria-label={`${rowLabel(row)} 재무`}>
        <header className="sig-detail-head">
          <h3>{rowLabel(row)}</h3>
        </header>
        <p className="hint fd-empty">{emptyReason(row)}</p>
      </article>
    )
  }
  const byKey = Object.fromEntries(row.metrics.map((m) => [m.key, m]))
  const range = row.per_range
  const perNow = byKey.per?.value ?? null
  const perMean = range?.mean ?? null
  const gap = perNow != null && perMean ? (perNow / perMean - 1) * 100 : null
  const latest = all?.[0]
  const priceDay = dayLabel(row.price_date)
  const quarters = (all ?? []).slice(0, 4)

  return (
    <article className="sig-detail fd-detail" aria-label={`${rowLabel(row)} 재무`}>
      <header className="sig-detail-head">
        <h3>{rowLabel(row)}</h3>
        <span className="hint">
          {latest ? `${quarterName(latest.period_end)}까지 ${SOURCE_LABEL[row.source ?? ''] ?? ''} 공시` : '공시'}
          {priceDay ? `, 종가는 ${priceDay}` : ''}
        </span>
      </header>

      <div className="fd-cards">
        {METRIC_GROUPS.map((group, i) => (
          <section key={group.title} className="fd-card" aria-label={GROUP_TITLES[i]}>
            <h4>{GROUP_TITLES[i]}</h4>
            <ul>
              {group.items.map((item) => (
                <li key={item.key} title={item.help}>
                  <span>{item.label}</span>
                  <b>{metricValue(byKey[item.key], row.currency)}</b>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="fd-sec" aria-label="PER">
        <h4>PER</h4>
        <div className="fd-per">
          <div className="now">
            <span>지금 PER</span>
            <b>{perNow == null ? metricValue(byKey.per, row.currency) : <>{num(perNow, 1)}<small>배</small></>}</b>
          </div>
          <div>
            <span>5년 평균 PER</span>
            <b>{perMean == null ? '—' : <>{num(perMean, 1)}<small>배</small></>}</b>
          </div>
          <div>
            <span>평균과 차이</span>
            <b className={tone(gap)}>{signed(gap, 0, '%')}</b>
            {range ? (
              <p>
                5년 범위 {num(range.min, 1)} ~ {num(range.max, 1)}배
              </p>
            ) : (
              <p>5년 기록이 없습니다</p>
            )}
          </div>
        </div>
      </section>

      <section className="fd-sec" aria-label="회사 가이던스">
        <h4>회사 가이던스</h4>
        <p className="fd-none">회사 가이던스는 아직 모으지 않습니다.</p>
      </section>

      <section className="fd-sec" aria-label="최근 분기">
        <h4>최근 분기</h4>
        {all === null ? (
          <p className="hint">분기 실적을 받는 중입니다.</p>
        ) : quarters.length === 0 ? (
          <p className="hint">분기 실적이 없습니다.</p>
        ) : (
          <div className="fd-table-wrap">
            <table className="fd-quarters">
              <thead>
                <tr>
                  <th>분기</th>
                  {QUARTER_COLUMNS.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quarters.map((q, i) => {
                  const prev = all?.[i + 1]
                  const year = yearBefore(all ?? [], q)
                  return (
                    <tr key={q.period_end}>
                      <th scope="row">
                        {quarterName(q.period_end)}
                        <small>
                          공시 {dayLabel(q.filed_at)}
                          {q.estimated ? ' (추정)' : ''}
                        </small>
                      </th>
                      {QUARTER_COLUMNS.map((c) => {
                        const value = q[c.key] as number | null
                        const pick = (o: FundamentalQuarter | undefined) => (o ? (o[c.key] as number | null) : null)
                        return (
                          <td key={c.key}>
                            <b>{c.key === 'eps_diluted' ? price(value, row.currency) : bigAmount(value, row.currency)}</b>
                            <Change label="전년" value={growth(value, pick(year))} />
                            <Change label="전분기" value={growth(value, pick(prev))} />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  )
}

/**
 * PC 재무 화면 (디자인 5차 목업 04 나 · 04c) — 왼쪽 종목명 목록, 오른쪽에 고른 종목의 묶음 카드 넷,
 * PER(지금 · 5년 평균 · 차이), 회사 가이던스, 최근 분기(전년비 · 전분기비).
 */
export function DesktopFundamentals({
  rows,
  selected,
  onSelect,
}: {
  rows: FundamentalsResponse[]
  selected: string | null
  onSelect: (ticker: string) => void
}) {
  const shown = rows.filter((r) => r.metrics.length > 0)
  const hidden = rows.filter((r) => r.metrics.length === 0)
  const row = rows.find((r) => r.ticker === selected) ?? shown[0] ?? rows[0]
  const item = (r: FundamentalsResponse) => (
    <li key={r.ticker} role="option" aria-selected={r.ticker === row.ticker}>
      <button
        type="button"
        className={`sig-item fd-item${r.ticker === row.ticker ? ' active' : ''}${r.metrics.length === 0 ? ' off' : ''}`}
        onClick={() => onSelect(r.ticker)}
      >
        {rowLabel(r)}
      </button>
    </li>
  )
  return (
    <div className="sig-panel fd-panel">
      <ul className="sig-list" role="listbox" aria-label="종목">
        {shown.map(item)}
        {hidden.length > 0 && (
          <li className="fd-group" role="presentation">
            재무가 없는 종목
          </li>
        )}
        {hidden.map(item)}
      </ul>
      <Detail row={row} />
    </div>
  )
}
