import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { num, price, rowLabel, signed } from '../../lib/display'
import { bigAmount, emptyReason, growth, METRIC_GROUPS, metricValue, quarterName } from '../../lib/fundamentals'
import { tone } from '../../lib/portfolio'
import type { FundamentalQuarter, FundamentalsResponse } from '../../types'

const SOURCE_LABEL: Record<string, string> = { sec: 'SEC', dart: 'DART', yahoo: '야후' }

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

function Change({ label, value }: { label: string; value: number | null }) {
  return (
    <small>
      <em>{label}</em> <span className={tone(value)}>{signed(value, 1, '%')}</span>
    </small>
  )
}

type Results = { quarters: FundamentalQuarter[]; years: FundamentalQuarter[] }

// 목록 응답에는 분기 · 연 표가 없다 — 고른 종목만 따로 받아 둔다
const resultCache = new Map<string, Results>()

function useResults(row: FundamentalsResponse): Results | null {
  const [, bump] = useState(0)
  const ticker = row.ticker
  const inline = row.quarters.length > 0
  const want = row.metrics.length > 0 && !inline && !resultCache.has(ticker)
  useEffect(() => {
    if (!want) return
    let live = true
    api
      .getFundamentals(ticker)
      .then((full) => resultCache.set(ticker, { quarters: full.quarters, years: full.years ?? [] }))
      .catch(() => resultCache.set(ticker, { quarters: [], years: [] }))
      .finally(() => live && bump((n) => n + 1))
    return () => {
      live = false
    }
  }, [ticker, want])
  if (inline) return { quarters: row.quarters, years: row.years ?? [] }
  return resultCache.get(ticker) ?? null
}

type Mode = 'quarter' | 'year'


function ResultsTable({ row, results, mode }: { row: FundamentalsResponse; results: Results; mode: Mode }) {
  const all = mode === 'quarter' ? results.quarters : results.years
  const shown = all.slice(0, 4)
  if (shown.length === 0) {
    return <p className="hint">{mode === 'quarter' ? '분기 실적이 없습니다.' : '연 실적이 없습니다.'}</p>
  }
  return (
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
          {shown.map((q, i) => {
            // 분기는 전분기비만, 연은 최신 분기와 같은 분기를 해마다 — 바로 아랫줄이 1년 전 (주인 요청)
            const prev = all[i + 1]
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
                      <Change label={mode === 'quarter' ? '전분기' : '전년'} value={growth(value, pick(prev))} />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Card({ title, lines }: { title: string; lines: { label: string; value: string; help?: string; sub?: boolean }[] }) {
  return (
    <section className="fd-card" aria-label={title}>
      <h4>{title}</h4>
      <ul>
        {lines.map((l) => (
          <li key={l.label} title={l.help} className={l.sub ? 'sub' : undefined}>
            <span>{l.label}</span>
            <b>{l.value}</b>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Detail({ row }: { row: FundamentalsResponse }) {
  const results = useResults(row)
  const [mode, setMode] = useState<Mode>('quarter')
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
  const latest = results?.quarters[0]
  const priceDay = dayLabel(row.price_date)

  return (
    <article className="sig-detail fd-detail" aria-label={`${rowLabel(row)} 재무`}>
      <header className="sig-detail-head">
        <h3>{rowLabel(row)}</h3>
        <span className="hint">
          {latest ? `${quarterName(latest.period_end)}까지 ${SOURCE_LABEL[row.source ?? ''] ?? ''} 공시` : '공시'}
          {priceDay ? `, 종가는 ${priceDay}` : ''}
        </span>
      </header>

      {/* PER 카드는 다른 묶음과 같은 모양 · 같은 글자 크기 (주인: PER 만 크면 통일성이 없다) */}
      <div className="fd-cards">
        <Card
          title="PER"
          lines={[
            { label: '현재', value: perNow == null ? metricValue(byKey.per, row.currency) : `${num(perNow, 1)}배` },
            { label: '5년 평균', value: perMean == null ? '—' : `${num(perMean, 1)}배` },
            {
              label: '5년 범위',
              value: range ? `${num(range.min, 1)} ~ ${num(range.max, 1)}배` : '—',
              sub: true,
            },
            { label: '평균과 차이', value: signed(gap, 0, '%') },
          ]}
        />
        {METRIC_GROUPS.map((group) => (
          <Card
            key={group.title}
            title={group.short}
            lines={group.items
              .filter((item) => item.key !== 'per')
              .map((item) => ({ label: item.label, value: metricValue(byKey[item.key], row.currency), help: item.help }))}
          />
        ))}
      </div>

      <div className="fd-line" aria-label="회사 가이던스">
        <h4>회사 가이던스</h4>
        <span>아직 모으지 않습니다</span>
      </div>

      <section className="fd-sec" aria-label="실적">
        <div className="fd-sec-head">
          <h4>실적</h4>
          <div className="seg fd-seg" role="group" aria-label="실적 단위">
            {(['quarter', 'year'] as const).map((m) => (
              <button key={m} type="button" className={mode === m ? 'active' : undefined} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'quarter' ? '분기' : '연'}
              </button>
            ))}
          </div>
        </div>
        {results === null ? <p className="hint">실적을 받는 중입니다.</p> : <ResultsTable row={row} results={results} mode={mode} />}

      </section>
    </article>
  )
}

/**
 * PC 재무 화면 (디자인 5차 목업 04 나 · 04c · 04d 가) — 왼쪽 종목명 목록, 오른쪽에 고른 종목의 카드 다섯
 * (PER, 가치, 수익성, 성장, 안정), 회사 가이던스 한 줄, 실적(분기는 전분기비, 연은 최신 분기와 같은 분기를 해마다, 전년비).
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
