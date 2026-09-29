import { useState } from 'react'
import { num, rowLabel } from '../lib/display'
import {
  currentPer,
  perAxis,
  perAxisPos,
  perChartRows,
  perTooltip,
  type PerOrder,
} from '../lib/fundamentals'
import type { FundamentalsResponse } from '../types'

/**
 * 재무 화면 위의 "PER 한눈에" — 담은 종목의 PER 을 한 그래프에.
 *
 * 종목마다 한 줄: 지난 5년 범위(막대), 중앙값(세로 눈금), 지금(동그라미). 모든 줄이 **같은 로그
 * 눈금**이라 종목끼리의 높낮이와, 각 종목이 제 범위의 어디쯤인지가 한 번에 보인다. "싸다·비싸다"는
 * 적지 않는다 — 위치와 숫자만. 줄을 누르면 그 종목의 재무 팝업이 열린다.
 */
export function PerChart({ rows, onOpen }: { rows: FundamentalsResponse[]; onOpen: (row: FundamentalsResponse) => void }) {
  const [order, setOrder] = useState<PerOrder>('list')
  const axis = perAxis(rows)
  const shown = perChartRows(rows, order)
  if (!axis || shown.length === 0) return null

  return (
    <section className="section per-chart" aria-labelledby="per-chart-title">
      <div className="section-head per-chart-head">
        <h3 id="per-chart-title">PER 한눈에</h3>
        <div className="chip-row" role="group" aria-label="줄 순서">
          <button className={`chip${order === 'list' ? ' active' : ''}`} aria-pressed={order === 'list'}
            onClick={() => setOrder('list')}>
            대시보드 순
          </button>
          <button className={`chip${order === 'position' ? ' active' : ''}`} aria-pressed={order === 'position'}
            onClick={() => setOrder('position')}>
            5년 위치 순
          </button>
        </div>
      </div>
      <p className="hint per-key">
        <span className="per-key-item"><i className="per-key-dot" aria-hidden="true" /> 지금</span>
        <span className="per-key-item"><i className="per-key-median" aria-hidden="true" /> 5년 중앙값</span>
        <span className="per-key-item"><i className="per-key-track" aria-hidden="true" /> 지난 5년 범위</span>
        <span className="per-key-item">눈금은 배율(로그) — 두 배 차이는 어디서나 같은 간격</span>
      </p>

      <ul className="per-rows">
        {shown.map((row) => {
          const r = row.per_range
          const now = currentPer(row)
          const tip = perTooltip(row)
          return (
            <li key={row.ticker}>
              <button className="per-row" onClick={() => onOpen(row)} aria-label={`${rowLabel(row)} — ${tip}`}>
                <span className="per-row-name">{rowLabel(row)}</span>
                <span className="per-row-plot" aria-hidden="true">
                  {axis.ticks.map((t) => (
                    <span key={t} className="per-grid" style={{ left: `${perAxisPos(axis, t)}%` }} />
                  ))}
                  {r && (
                    <span
                      className="per-bar"
                      style={{ left: `${perAxisPos(axis, r.min)}%`, right: `${100 - perAxisPos(axis, r.max)}%` }}
                    />
                  )}
                  {r && <span className="per-median" style={{ left: `${perAxisPos(axis, r.median)}%` }} />}
                  {now !== null && <span className="per-now" style={{ left: `${perAxisPos(axis, now)}%` }} />}
                </span>
                <span className="per-row-value mono">
                  {now === null ? '적자' : `${num(now, 1)}배`}
                  <span className="hint">
                    {r?.position_pct != null ? ` · 5년 위치 ${num(r.position_pct, 0)}%` : r ? '' : ' · 5년 기록 없음'}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="per-axis" aria-hidden="true">
        <span className="per-row-name" />
        <span className="per-axis-ticks">
          {axis.ticks.map((t) => (
            <span key={t} style={{ left: `${perAxisPos(axis, t)}%` }}>
              {t}배
            </span>
          ))}
        </span>
        <span className="per-row-value" />
      </div>
      <p className="hint">
        5년 위치는 지난 5년 중 PER이 지금 이하였던 날의 비율입니다(그날까지 공시된 EPS로 날마다 계산, 적자였던 날
        제외). 줄을 누르면 분기 표가 열립니다.
      </p>
    </section>
  )
}
