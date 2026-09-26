import type { FundamentalQuarter, FundamentalsResponse } from '../types'
import { price, num } from '../lib/display'
import {
  bigAmount,
  METRIC_GROUPS,
  metricBasisParts,
  metricValue,
  perMarker,
  perPositionText,
  quarterLabel,
} from '../lib/fundamentals'

const SOURCE_LABEL: Record<string, string> = { sec: 'SEC 공시', dart: 'DART 공시', yahoo: '야후' }

/** 아직 보여줄 숫자가 없을 때 왜 없는지 */
function emptyText(data: FundamentalsResponse): string {
  if (data.state === null) return '아직 재무를 받지 않았습니다. 새벽 작업이 받아오면 여기에 보입니다.'
  if (data.state === 'none') return data.message ?? '재무제표가 없는 종목입니다.'
  if (data.state === 'unsupported') return data.message ?? '아직 이 종목의 재무를 읽지 못합니다.'
  return `재무를 받지 못했습니다${data.message ? ` — ${data.message}` : ''}. 다음 날 다시 시도합니다.`
}

const COLUMNS: { key: keyof FundamentalQuarter; label: string }[] = [
  { key: 'revenue', label: '매출' },
  { key: 'operating_income', label: '영업이익' },
  { key: 'net_income', label: '순이익' },
  { key: 'eps_diluted', label: 'EPS(희석)' },
  { key: 'operating_cf', label: '영업현금흐름' },
  { key: 'fcf', label: 'FCF' },
]

/**
 * 차트 팝업의 "재무" 탭.
 *
 * 값마다 **어느 분기까지, 언제 공시된 숫자인지**를 붙인다. PER 은 공시일에야 바뀌는데,
 * 그걸 모르고 보면 "실적이 나왔는데 왜 그대로지?"가 된다.
 */
export function FundamentalsPanel({ data }: { data: FundamentalsResponse }) {
  if (data.metrics.length === 0) {
    return <p className="hint fund-empty">{emptyText(data)}</p>
  }
  const byKey = Object.fromEntries(data.metrics.map((m) => [m.key, m]))
  const range = data.per_range
  const position = range ? perPositionText(range) : null

  return (
    <div className="fund-panel">
      <p className="hint">
        {SOURCE_LABEL[data.source ?? ''] ?? data.source ?? '공시'} 기준 · PER·PBR·배당수익률은{' '}
        {data.price_date ?? '—'} 종가 {price(data.price, data.currency)}로 계산
      </p>

      <div className="fund-groups">
        {METRIC_GROUPS.map((group) => (
          <section key={group.title} className="fund-group">
            <h4>{group.title}</h4>
            <div className="stat-grid">
              {group.items.map((item) => (
                <div className="stat-box" key={item.key} title={item.help}>
                  <span className="k">{item.label}</span>
                  <span className="v">{metricValue(byKey[item.key], data.currency)}</span>
                  <span className="k">
                    {metricBasisParts(byKey[item.key]).map((part, i) => (
                      <span key={part} className="nobr">
                        {i > 0 && ' · '}
                        {part}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {range && (
        <section className="fund-group">
          <h4>PER — 지난 5년 중 어디쯤</h4>
          <div className="per-range" aria-hidden="true">
            <div className="per-track" />
            <span className="per-median" style={{ left: `${perMarker(range, range.median)}%` }} />
            {range.current !== null && (
              <span className="per-now" style={{ left: `${perMarker(range, range.current)}%` }} />
            )}
          </div>
          <div className="per-scale">
            <span>최저 {num(range.min, 1)}</span>
            <span>중앙값 {num(range.median, 1)}</span>
            <span>최고 {num(range.max, 1)}</span>
          </div>
          <p className="hint">
            {position ?? '지금은 PER을 계산할 수 없습니다 (최근 1년 이익이 0 이하).'} 그날까지 공시된 EPS로
            날마다 다시 계산한 값이고, 적자였던 날은 뺐습니다.
          </p>
        </section>
      )}

      <section className="fund-group">
        <h4>최근 분기</h4>
        <table className="fund-table">
          <thead>
            <tr>
              <th>결산 · 공시</th>
              {COLUMNS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.quarters.map((q) => (
              <tr key={q.period_end}>
                <th scope="row">
                  <span className="mono">{quarterLabel(q.period_end)}</span>
                  <span className="hint nobr">
                    공시 {q.filed_at}
                    {q.estimated && ' (추정)'}
                    {q.revised && ' · 정정됨'}
                  </span>
                </th>
                {COLUMNS.map((c) => {
                  const value = q[c.key] as number | null
                  return (
                    <td key={c.key} data-label={c.label} className="mono">
                      {c.key === 'eps_diluted' ? price(value, data.currency) : bigAmount(value, data.currency)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="hint">
        공시된 값을 그대로 옮겼고, 분기 현금흐름·4분기 값은 누적 값에서 빼서 만들었습니다. EPS는 그 뒤의
        액면분할을 반영했습니다. 빈칸(—)은 공시에 없는 항목입니다.
        {data.message && ` ${data.message}.`}
        {data.state === 'error' && ' 마지막 확인은 실패해 전에 받은 값을 보여줍니다.'}
      </p>
    </div>
  )
}
