import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { MacroChartModal } from '../components/MacroChartModal'
import {
  FREQUENCY_LABEL,
  checkedLabel,
  fearGreedZone,
  macroChange,
  macroValue,
  statusOf,
} from '../lib/macro'
import type { MacroOverview, MacroSeriesInfo, TermSpread } from '../types'

/**
 * 장단기 금리차 한 줄.
 *
 * 지표 카드와 따로 둔다 — 받아온 값이 아니라 두 금리에서 계산한 것이라 갱신 상태도
 * 발표일도 없고, 카드 사이에 끼면 "이건 왜 상태가 없나"로 보인다.
 *
 * 역전(마이너스)일 때만 눈에 띄게 한다. **그게 곧 팔라는 뜻은 아니다** — 역전은
 * 과거에 침체보다 1~2년 앞섰고, 그 사이에 주가가 더 오른 적도 많다. 그래서 문구는
 * "역전됐다"까지만 말하고 다음에 뭘 하라는 말은 하지 않는다.
 */
export function TermSpreadLine({ spread }: { spread: TermSpread | null }) {
  if (!spread) {
    return (
      <p className="hint">
        장단기 금리차는 10년물과 2년물이 <b>같은 날</b> 값으로 있어야 계산됩니다 — 아직
        둘 중 하나가 안 들어왔습니다.
      </p>
    )
  }

  const inverted = spread.value < 0
  return (
    <div className={`callout ${inverted ? 'amber' : 'blue'}`}>
      <span className="ico" aria-hidden="true">
        {inverted ? '⚠' : '📐'}
      </span>
      <div>
        <b>
          장단기 금리차 {spread.value > 0 ? '+' : ''}
          {spread.value.toFixed(2)}%p
        </b>
        {inverted ? ' — 장단기 금리가 역전돼 있습니다.' : ' — 정상(장기 > 단기)입니다.'}
        <span className="hint">
          {' '}
          {spread.long_code} − {spread.short_code} · {spread.as_of} 기준
        </span>
      </div>
    </div>
  )
}

function MacroCard({ series, onOpen }: { series: MacroSeriesInfo; onOpen: () => void }) {
  const status = statusOf(series)
  // 구간 이름은 공포·탐욕 지수에만 있다 (`lib/macro.ts` 참고)
  const zone = series.code === 'FEARGREED' ? fearGreedZone(series.value) : null
  const change = macroChange(series.change, series.unit)

  return (
    <div className="stock-card macro-card">
      <div className="stock-card-head">
        <div className="macro-card-name">
          <button className="link-btn macro-title" onClick={onOpen}>
            {series.name}
          </button>
          {series.note && <span className="ticker-sub">{series.note}</span>}
        </div>
        <div className="badge-row">
          {series.transform_label && (
            <span className="badge badge-blue">{series.transform_label}</span>
          )}
          {zone && <span className={`badge ${zone.tone}`}>{zone.label}</span>}
          {status && <span className={`badge ${status.tone}`}>{status.text}</span>}
        </div>
      </div>

      <div className="macro-figure">
        <span className="big mono">{macroValue(series.value, series.unit)}</span>
        {change && <span className="macro-change mono">{change}</span>}
      </div>

      <p className="hint macro-foot">
        {series.as_of ? `${series.as_of} 기준` : '값 없음'}
        {' · '}
        {FREQUENCY_LABEL[series.frequency] ?? series.frequency}
        {series.released_at && ` · ${series.released_at} 발표`}
      </p>
      {/* "언제 받아본 것인가"는 "값이 언제 것인가"와 다른 질문이다. 둘 다 없으면
          날짜가 뒤처져 보일 때 출처 탓인지 우리 탓인지 가릴 수가 없다. */}
      <p className="hint macro-foot">
        {checkedLabel(series.last_checked_at)
          ? `${checkedLabel(series.last_checked_at)} 확인`
          : '받아본 적 없음'}
        {series.source && ` · ${series.source}`}
      </p>

      {series.last_error && (
        <details className="error-detail">
          <summary>왜 못 받았는지 보기</summary>
          <p>{series.last_error}</p>
        </details>
      )}
    </div>
  )
}

export function MacroPanel() {
  const [data, setData] = useState<MacroOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<MacroSeriesInfo | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.getMacro())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      await api.refreshMacro()
      await load()
    } catch (e) {
      setError(e)
    } finally {
      setRefreshing(false)
    }
  }

  const series = data?.series ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h2>매크로 지표</h2>
          {/* 이 한 줄이 이 화면의 전부다. 여기 숫자는 매수·매도 판정에 들어가지 않는다 */}
          <p className="hint">
            지금이 어떤 국면인지 보는 곳입니다 — 여기 숫자는 매수·매도 시그널 판정에
            들어가지 않습니다.
          </p>
        </div>
        <button className="primary" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? '받는 중…' : '지금 받아오기'}
        </button>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {loading ? (
        <p className="hint">불러오는 중…</p>
      ) : series.length === 0 ? (
        <div className="empty-state">
          <h3>아직 지표가 없습니다</h3>
          <p>
            서버를 다시 띄우면 기본 지표 목록이 채워집니다. 그래도 비어 있으면
            <code> docker compose exec app python diagnose.py </code>
            로 어디서 막히는지 볼 수 있습니다.
          </p>
        </div>
      ) : (
        <>
          <TermSpreadLine spread={data?.term_spread ?? null} />
          <div className="card-grid">
            {series.map((item) => (
              <MacroCard key={item.code} series={item} onOpen={() => setOpen(item)} />
            ))}
          </div>
        </>
      )}

      {open && (
        <MacroChartModal code={open.code} name={open.name} onClose={() => setOpen(null)} />
      )}
    </>
  )
}
