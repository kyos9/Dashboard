import { Suspense, useEffect, useState } from 'react'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { lazyChunk } from '../lib/lazyChunk'
import { num, rowLabel } from '../lib/display'
import { emptyReason, latestQuarter, metricValue, quarterLabel } from '../lib/fundamentals'
import type { FundamentalKey, FundamentalsResponse } from '../types'

// 팝업은 누를 때 받는다 (대시보드와 같은 이유 — 차트 라이브러리가 크다)
const ChartModal = lazyChunk(() => import('../components/ChartModal'), 'ChartModal')

/** 표의 칸 — 팝업 재무 탭과 같은 지표, 같은 글자 */
const COLUMNS: { key: FundamentalKey; label: string; help: string }[] = [
  { key: 'per', label: 'PER', help: '종가 ÷ 최근 4분기 희석 EPS 합' },
  { key: 'pbr', label: 'PBR', help: '종가 ÷ (최근 자본 ÷ 주식 수)' },
  { key: 'dividend_yield', label: '배당수익률', help: '최근 4분기 주당 배당 합 ÷ 종가' },
  { key: 'roe', label: 'ROE', help: '최근 4분기 순이익 합 ÷ 최근 자본' },
  { key: 'operating_margin', label: '영업이익률', help: '최근 4분기 영업이익 합 ÷ 매출 합' },
  { key: 'revenue_yoy', label: '매출 성장', help: '최근 분기 매출 ÷ 1년 전 같은 분기' },
  { key: 'operating_income_yoy', label: '영업이익 성장', help: '최근 분기 영업이익 ÷ 1년 전 같은 분기' },
  { key: 'eps_yoy', label: 'EPS 성장', help: '최근 분기 희석 EPS ÷ 1년 전 같은 분기' },
  { key: 'debt_ratio', label: '부채비율', help: '부채 ÷ 자본' },
  { key: 'fcf', label: 'FCF(1년)', help: '최근 4분기 영업현금흐름 − 설비투자' },
]

const PER_POSITION_HELP = '지난 5년 중 PER이 지금 이하였던 날의 비율'

/**
 * "재무" 화면 — 담은 종목의 재무 지표를 한 표에 (ROADMAP 3b).
 *
 * 대시보드는 시그널만 본다. 재무는 여기와, 종목 이름을 눌러 여는 팝업의 재무 탭에 있다.
 * 이름을 누르면 같은 팝업이 재무 탭으로 열린다 — 분기 표와 PER 5년 막대는 거기에 있다.
 */
export function FundamentalsPage() {
  const [rows, setRows] = useState<FundamentalsResponse[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<FundamentalsResponse | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listFundamentals()
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e))
    return () => {
      alive = false
    }
  }, [])

  const shown = (rows ?? []).filter((r) => r.metrics.length > 0)
  const hidden = (rows ?? []).filter((r) => r.metrics.length === 0)
  const priceDate = shown.map((r) => r.price_date).find(Boolean)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>재무</h2>
          <p className="hint">
            공시된 숫자로 계산했습니다. PER·PBR·배당수익률은 최근 종가{priceDate ? `(${priceDate})` : ''} 기준이고,
            성장은 1년 전 같은 분기와 비교한 값입니다. 종목 이름을 누르면 분기 표와 PER 5년 위치가 열립니다.
          </p>
        </div>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {rows === null ? (
        !error && <p className="hint">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <h3>담은 종목이 없습니다</h3>
          <p>종목 관리에서 종목을 담으면 여기에 재무가 보입니다.</p>
        </div>
      ) : (
        <>
          {shown.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table fund-list">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th title={COLUMNS[0].help}>PER</th>
                    <th title={PER_POSITION_HELP}>PER 5년 위치</th>
                    {COLUMNS.slice(1).map((c) => (
                      <th key={c.key} title={c.help}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const byKey = Object.fromEntries(row.metrics.map((m) => [m.key, m]))
                    const until = latestQuarter(row.metrics)
                    const position = row.per_range?.position_pct ?? null
                    return (
                      <tr key={row.ticker}>
                        <th scope="row">
                          <button className="stock-name" onClick={() => setOpen(row)} title="재무 자세히 보기">
                            {rowLabel(row)}
                          </button>
                          {until && <span className="hint nobr">{quarterLabel(until)} 분기까지</span>}
                        </th>
                        <td data-label="PER" className="mono">
                          {metricValue(byKey.per, row.currency)}
                        </td>
                        <td data-label="PER 5년 위치" className="mono" title={PER_POSITION_HELP}>
                          {position === null ? '—' : `${num(position, 0)}%`}
                        </td>
                        {COLUMNS.slice(1).map((c) => (
                          <td key={c.key} data-label={c.label} className="mono">
                            {metricValue(byKey[c.key], row.currency)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">아직 재무가 있는 종목이 없습니다.</p>
          )}

          <p className="hint fund-foot">
            PER 5년 위치는 {PER_POSITION_HELP}입니다 (그날까지 공시된 EPS로 날마다 다시 계산). 빈칸(—)은 공시에
            없거나 계산할 수 없는 값입니다.
          </p>

          {hidden.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h3>재무를 보여주지 않는 종목</h3>
              </div>
              <ul className="fund-hidden">
                {hidden.map((row) => (
                  <li key={row.ticker}>
                    <b>{rowLabel(row)}</b>
                    <span className="hint">{emptyReason(row)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {open && (
        <Suspense fallback={null}>
          <ChartModal
            ticker={open.ticker}
            name={rowLabel(open)}
            initialTab="fundamentals"
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </>
  )
}
