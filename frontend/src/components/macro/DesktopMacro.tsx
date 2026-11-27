import { Suspense, type ReactNode } from 'react'
import { lazyChunk } from '../../lib/lazyChunk'
import { macroChange, macroValue, zoneTone } from '../../lib/macro'
import type { MacroBadge, MacroSeriesInfo, TermSpread } from '../../types'

// 차트 코드는 화면을 연 뒤에 받는다 (lib/chartChunk — 첫 화면에 싣지 않는다)
const MacroDetail = lazyChunk(() => import('./MacroDetail'), 'MacroDetail')

/** 묶음 — 서버는 묶음을 주지 않아 코드로 나눈다. 모르는 코드는 "그 밖" */
const GROUP_OF: Record<string, string> = {
  SP500: '주식',
  KOSPI: '주식',
  VIX: '주식',
  FEARGREED: '주식',
  DFF: '금리',
  DGS10: '금리',
  DGS2: '금리',
  PCEPILFE: '물가',
  PCEPI: '물가',
  CPILFESL: '물가',
  CPIAUCSL: '물가',
  UNRATE: '고용',
}
const GROUPS = ['주식', '금리', '물가', '고용', '그 밖']

function macroGroups(series: MacroSeriesInfo[]): [string, MacroSeriesInfo[]][] {
  return GROUPS.map((g) => [g, series.filter((s) => (GROUP_OF[s.code] ?? '그 밖') === g)] as [string, MacroSeriesInfo[]]).filter(
    ([, list]) => list.length > 0,
  )
}

/**
 * 국면 한 줄 — 흩어져 있던 "눈에 띄는 국면 없음" 글 · 파란 금리차 상자 · 시그널 안내를 한 줄로 (목업 06 공통).
 * 칸으로 나누지 않는다 — 넷으로 나눈 띠는 뜻 없이 갈라 보였다(주인). 공포·탐욕은 목록에 있어 뺐다.
 */
export function RegimeStrip({ badges, spread }: { badges: MacroBadge[]; spread: TermSpread | null }) {
  const inverted = spread != null && spread.value < 0
  return (
    <section className="macro-regime" aria-label="국면">
      {badges.length === 0 ? (
        <b>눈에 띄는 국면 없음</b>
      ) : (
        <span className="macro-strip-badges">
          {badges.map((b) => (
            <span key={b.key} className={`badge badge-${b.tone}`} title={b.detail}>
              {b.label}
            </span>
          ))}
        </span>
      )}
      {spread && (
        <span className="macro-regime-spread" title={`${spread.long_code} − ${spread.short_code}, ${spread.as_of} 기준`}>
          장단기 금리차{' '}
          <b className={`mono${inverted ? ' tone-warn' : ''}`}>
            {spread.value > 0 ? '+' : ''}
            {spread.value.toFixed(2)}%p
          </b>{' '}
          {inverted ? '역전' : '정상'}
        </span>
      )}
      <span className="hint macro-regime-note">여기 숫자는 매수, 매도 시그널에 들어가지 않습니다.</span>
    </section>
  )
}

/**
 * PC 매크로 (디자인 5차 목업 06 나) — 재무와 같은 틀. 왼쪽 지표 목록(내 지표 + 묶음), 오른쪽에 고른 지표의 차트.
 * 차트 창은 띄우지 않는다. ★ 은 목록 줄 앞에 그대로(누르면 내 지표로).
 */
export function DesktopMacro({
  mine,
  rest,
  pinned,
  selected,
  onSelect,
  onTogglePin,
  detailProps,
}: {
  mine: MacroSeriesInfo[]
  rest: MacroSeriesInfo[]
  pinned: string[]
  selected: MacroSeriesInfo
  onSelect: (code: string) => void
  /** 없으면 별 없음 (손님) */
  onTogglePin?: (code: string) => void
  detailProps: {
    canEditForecast: boolean
    onSaveForecast: (code: string, month: string, value: number) => Promise<boolean>
    onClearForecast: (code: string, month: string) => Promise<boolean>
    forecastError: unknown
    onForecastErrorDismiss: () => void
  }
}) {
  const item = (s: MacroSeriesInfo) => {
    const on = s.code === selected.code
    const change = macroChange(s.change, s.unit)
    return (
      <li key={s.code} role="option" aria-selected={on} className={`macro-item${on ? ' active' : ''}`}>
        {onTogglePin ? (
          <button
            type="button"
            className={`pin-btn${pinned.includes(s.code) ? ' on' : ''}`}
            data-pin={s.code}
            onClick={() => onTogglePin(s.code)}
            aria-pressed={pinned.includes(s.code)}
            title={pinned.includes(s.code) ? '내 지표에서 빼기' : '내 지표로'}
            aria-label={`${s.name} 내 지표로`}
          >
            {pinned.includes(s.code) ? '★' : '☆'}
          </button>
        ) : (
          <span className="macro-row-pad" aria-hidden="true" />
        )}
        <button type="button" className="macro-item-open" onClick={() => onSelect(s.code)}>
          <span className="macro-item-name">
            {s.name}
            {s.zone && <span className={`macro-zone-dot ${zoneTone(s.zone)}`} title={`${s.zone.label} 구간 ${s.zone.range}`} />}
          </span>
          <span className="macro-item-value">
            <b className="mono">{macroValue(s.value, s.unit)}</b>
            {change && <small className="mono">{change}</small>}
          </span>
        </button>
      </li>
    )
  }
  const group = (title: ReactNode, list: MacroSeriesInfo[], key: string) =>
    list.length > 0 && [
      <li key={`g-${key}`} className="macro-group" role="presentation">
        {title}
      </li>,
      ...list.map(item),
    ]

  return (
    <div className="sig-panel macro-panel-pc">
      <ul className="sig-list macro-list-pc" role="listbox" aria-label="지표">
        {group('내 지표', mine, 'mine')}
        {macroGroups(rest).map(([g, list]) => group(g, list, g))}
      </ul>
      <Suspense fallback={<div className="sig-detail macro-detail" />}>
        <MacroDetail key={selected.code} series={selected} {...detailProps} />
      </Suspense>
    </div>
  )
}
