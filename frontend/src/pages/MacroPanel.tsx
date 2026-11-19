import { Suspense, useCallback, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ErrorNotice } from '../components/ErrorNotice'
import { monthOf, periodOf, surpriseWord } from '../components/macro/period'
import { Icon } from '../components/icons/Icon'
import { RegimeBadges } from '../components/RegimeBadges'
import { useAppState } from '../AppState'
import { lazyChunk } from '../lib/lazyChunk'
import { useCachedLoad } from '../lib/cache'
import { PageSkeleton } from '../components/Skeleton'
import { pushAccount } from '../lib/push'
import {
  checkedLabel,
  macroChange,
  macroValue,
  statusOf,
  zoneTone,
} from '../lib/macro'
import type { MacroOverview, MacroSeriesInfo, TermSpread } from '../types'

// 차트는 누를 때 받는다 (첫 화면에 차트 코드를 싣지 않는다 — lib/chartChunk)
const MacroChartModal = lazyChunk(() => import('../components/MacroChartModal'), 'MacroChartModal')
const AiSummaryModal = lazyChunk(() => import('../components/AiSummaryModal'), 'AiSummaryModal')

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
  // ★ 은 달지 않는다 — 늘 목록 맨 위라 "내 지표"로 모을 줄이 아니다(목업 14 ① 가)
  if (!spread) {
    return (
      <p className="hint">
        장단기 금리차는 10년물과 2년물이 <b>같은 날</b> 값으로 있어야 계산됩니다. 아직 둘 중 하나가 안
        들어왔습니다.
      </p>
    )
  }

  const inverted = spread.value < 0
  return (
    <div className={`callout ${inverted ? 'amber' : 'blue'}`}>
      {/* 정상일 때 붙던 📐 는 뺐다 — 이모지 장식(목업 13 ④). 역전은 경고라 ⚠ 를 둔다 */}
      {inverted && (
        <span className="ico" aria-hidden="true">
          ⚠
        </span>
      )}
      <div>
        <b>
          장단기 금리차 {spread.value > 0 ? '+' : ''}
          {spread.value.toFixed(2)}%p
        </b>
        {inverted ? ', 장단기 금리가 역전돼 있습니다.' : ', 정상(장기 > 단기)'}
        {' '}
        <span className="hint nowrap" title={`${spread.long_code} − ${spread.short_code}`}>
          ({spread.as_of} 기준)
        </span>
      </div>
    </div>
  )
}

/** 같은 값이 가장 많은 것 — 지표마다 같은 "받은 시각 · 출처"를 위에 한 번만 쓰려고 (목업 13 ④) */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = ''
  let n = 0
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c]
  return best
}

/** 예상치를 줄 안 한 마디로 — 넣는 칸은 차트 창 안에 있다(목업 14 ②) */
function forecastWord(series: MacroSeriesInfo): string {
  const { forecast, pending_forecast: pending } = series
  if (forecast) {
    const base = `예상 ${macroValue(forecast.value, series.unit)}`
    return forecast.surprise !== null ? `${base}, ${surpriseWord(forecast.surprise, series.unit)}` : base
  }
  if (pending) return `${monthOf(pending.as_of)} 예상 ${macroValue(pending.value, series.unit)}(발표 전)`
  return ''
}

/**
 * 지표 한 줄 (디자인 4차 목업 13 ② · 14 ② — 카드 열두 장 대신 한 목록, 줄 높이가 고르게).
 * 줄을 누르면 차트(예상치 입력도 거기). 꼬리표(전년비) · 예상 · 주기는 풀이 줄 안에, 국면 구간은 이름 옆 꼬리표.
 * 받은 시각 · 출처가 위의 공통 줄과 같으면 줄에는 적지 않는다. 못 받은 까닭 · 상태만 줄 아래에 남는다.
 */
function MacroRow({
  series,
  pinned,
  commonChecked,
  commonSource,
  onOpen,
  onTogglePin,
}: {
  series: MacroSeriesInfo
  pinned: boolean
  commonChecked: string
  commonSource: string
  onOpen: () => void
  /** 없으면 별을 안 띄운다 (손님) */
  onTogglePin?: () => void
}) {
  const status = statusOf(series)
  const change = macroChange(series.change, series.unit)
  const value = macroValue(series.value, series.unit)
  const checked = checkedLabel(series.last_checked_at)
  const daily = series.frequency === 'daily'
  const meta = [
    series.transform_label,
    periodOf(series),
    series.released_at && `${series.released_at} 발표`,
    daily && series.stale && series.as_of && `${series.as_of} 값`,
    !checked ? '받아본 적 없음' : checked !== commonChecked && `${checked} 확인`,
    series.source && series.source !== commonSource && `출처 ${series.source}`,
  ].filter(Boolean)
  const sub = [series.note, ...meta].filter(Boolean).join(', ')
  const fc = forecastWord(series)
  const zone = series.zone ? `${series.zone.label} 구간` : ''
  const zoneSpoken = series.zone ? `${zone} ${series.zone.range}` : ''

  return (
    <li className="macro-row">
      <div className="macro-row-main">
        {onTogglePin ? (
          // ★ = 자주 보는 지표 — 켜면 목록 맨 위 "내 지표"로 모인다(목업 14 ① 가). 홈에 올리던 뜻은 4차 ㉡ 에서 홈 줄을 빼며 없어졌다
          <button
            className={`pin-btn${pinned ? ' on' : ''}`}
            data-pin={series.code}
            onClick={onTogglePin}
            aria-pressed={pinned}
            title={pinned ? '내 지표에서 빼기' : '내 지표로 — 목록 맨 위에 모입니다'}
            aria-label={`${series.name} 내 지표로`}
          >
            {pinned ? '★' : '☆'}
          </button>
        ) : (
          <span className="macro-row-pad" aria-hidden="true" />
        )}
        <button
          type="button"
          className="macro-row-open"
          onClick={onOpen}
          // 읽는 이름에 구간 · 풀이 · 예상 · 받은 시각도 — 이름만 덮어 쓰면 "받아본 적 없음" 같은 글을 듣지 못했다(검토 6 참고)
          aria-label={[series.name, zoneSpoken, sub, fc, `${value}${change ? ` ${change}` : ''} — 차트`].filter(Boolean).join(', ')}
        >
          <span className="macro-row-name">
            <b>
              {series.name}
              {/* 어느 구간인지. 점수만으로는 33.7이 높은지 낮은지 알 수 없고, 범위를 같이 적으면 숫자만 보고도 읽힌다 (`services/regime.py`) */}
              {series.zone && (
                <span className={`macro-zone-tag ${zoneTone(series.zone)}`}>
                  {zone} <span className="macro-zone-range">{series.zone.range}</span>
                </span>
              )}
            </b>
            {sub && <small>{sub}</small>}
            {fc && <small>{fc}</small>}
          </span>
          <span className="macro-row-value">
            <b className="mono">{value}</b>
            {change && <small className="mono">{change}</small>}
          </span>
          <Icon name="forward" size={18} className="macro-row-go" />
        </button>
      </div>

      {(status || series.last_error) && (
        <div className="macro-row-more">
          {status && (
            <div className="badge-row">
              <span className={`badge ${status.tone}`}>{status.text}</span>
            </div>
          )}
          {series.last_error && (
            <details className="error-detail">
              <summary>왜 못 받았는지 보기</summary>
              <p>{series.last_error}</p>
            </details>
          )}
        </div>
      )}
    </li>
  )
}

export function MacroPanel() {
  // 별(서버의 pinned_macro)은 이제 "내 지표" 순서만 바꾼다. 다른 화면이 같은 값을 읽을 수 있어 바꾼 뒤 알린다(예전에는 홈 매크로 줄)
  const { notifyDataChanged, refreshKey } = useAppState()
  // 손님은 둘러보기만, 사용자는 별(내 지표)까지, 관리자는 받아오기·예상치(전원 것)까지
  const { guest, isAdmin, pending, user } = useAuth()
  const [aiOpen, setAiOpen] = useState(false)
  const closeAi = useCallback(() => setAiOpen(false), [])
  const [data, setData] = useState<MacroOverview | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<MacroSeriesInfo | null>(null)
  const [pinning, setPinning] = useState(false)
  const [pinNote, setPinNote] = useState('')
  // 예상치 저장 실패 까닭은 그 창 것 — 화면 까닭과 하나를 같이 쓰면 다른 지표 창에도 남아 떴다(묶음 5 검토 조건 1)
  const [forecastError, setForecastError] = useState<unknown>(null)
  const openChart = (item: MacroSeriesInfo | null) => {
    setForecastError(null)
    setOpen(item)
  }

  // 탭을 옮겨 와도 들고 있던 값을 먼저 그린다 (ROADMAP 8-1)
  const { loading } = useCachedLoad('page:macro', api.getMacro, setData, setError, [refreshKey])

  /** 받아오기·예상치 뒤에 다시 읽는다. 실패는 부른 쪽이 보여준다. */
  const load = useCallback(async () => {
    setData(await api.getMacro())
  }, [])

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

  /**
   * ☆ 를 켜고 끈다.
   *
   * 화면을 **먼저** 바꾸고 저장한다. 별은 누르면 바로 반응해야 하는 종류의 버튼이고,
   * 왕복을 기다리면 두 번 눌리기 십상이다. 실패하면 원래대로 되돌린다 — 되돌리지
   * 않으면 저장 안 된 별이 켜진 채로 남아서 홈에 왜 안 뜨는지 알 수 없게 된다.
   */
  const togglePin = async (code: string) => {
    if (!data || pinning) return
    const next = data.pinned.includes(code)
      ? data.pinned.filter((item) => item !== code)
      : [...data.pinned, code]

    const before = data.pinned
    setData({ ...data, pinned: next })
    setPinning(true)
    // 줄이 "내 지표" ↔ "모든 지표"로 옮겨 간다 — 폰 320 에서 누른 줄이 화면 밖으로 사라져 어디 갔는지 몰랐다(묶음 5 사용자 확인).
    // 옮긴 자리의 별로 포커스와 화면을 데려간다
    const name = data.series.find((item) => item.code === code)?.name ?? code
    setPinNote(next.includes(code) ? `${name} 을(를) 맨 위 내 지표로 옮겼습니다` : `${name} 을(를) 내 지표에서 뺐습니다`)
    requestAnimationFrame(() => {
      const star = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pin]')).find((el) => el.dataset.pin === code)
      star?.focus({ preventScroll: true })
      // 움직임 줄이기를 켠 사람에게는 부드럽게 굴리지 않는다 (재검토 참고)
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      star?.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' })
    })
    try {
      const saved = await api.setMacroPinned(next)
      setData((current) => (current ? { ...current, pinned: saved.codes } : current))
      // 홈이 다음에 열릴 때 새 목록을 읽게 한다
      notifyDataChanged()
    } catch (e) {
      setData((current) => (current ? { ...current, pinned: before } : current))
      setPinNote(`${name} 을(를) 옮기지 못했습니다`) // "옮겼습니다"로 남아 있었다 (재검토 참고)
      setError(e)
    } finally {
      setPinning(false)
    }
  }

  /**
   * 예상치를 넣거나 지운 뒤.
   *
   * 화면 전체를 다시 읽는다. 바뀐 카드만 갈아끼우면 **배지가 안 따라온다** —
   * "물가 상회"는 예상치를 보고 뜨는 것이라, 예상치를 지웠는데 배지가 남아 있는
   * 화면이 된다. 요청 한 번이고 이 화면은 자주 여는 곳이 아니다.
   */
  const afterForecast = async (run: () => Promise<unknown>): Promise<boolean> => {
    setForecastError(null)
    try {
      await run()
      await load()
      // 홈의 배지도 달라진다 — 저장 요청이 화면 캐시를 이미 비웠으므로(api/client.ts) 홈은
      // 다음에 열릴 때 새로 읽는다. 여기서 또 다시 읽게 하면 같은 요청을 두 번 보낸다.
      return true
    } catch (e) {
      setForecastError(e)
      return false
    }
  }

  const saveForecast = (code: string, month: string, value: number) =>
    // 입력칸은 달까지만 고르므로 그 달 1일로 보낸다 (값이 그렇게 저장돼 있다)
    afterForecast(() => api.setMacroForecast(code, `${month}-01`, value))

  const clearForecast = (code: string, month: string) =>
    afterForecast(() => api.clearMacroForecast(code, `${month}-01`))

  const series = data?.series ?? []
  const pinned = data?.pinned ?? []
  const badges = data?.badges ?? []
  const commonChecked = mostCommon(series.map((item) => checkedLabel(item.last_checked_at)))
  const commonSource = mostCommon(series.map((item) => item.source ?? ''))
  // ★ 켠 지표는 맨 위 "내 지표"로 — 손님은 별이 없어 한 목록 (목업 14 ① 가)
  const mine = guest ? [] : series.filter((item) => pinned.includes(item.code))
  const rest = guest ? series : series.filter((item) => !pinned.includes(item.code))
  const row = (item: MacroSeriesInfo) => (
    <MacroRow
      key={item.code}
      series={item}
      pinned={pinned.includes(item.code)}
      commonChecked={commonChecked}
      commonSource={commonSource}
      onOpen={() => openChart(item)}
      onTogglePin={guest ? undefined : () => void togglePin(item.code)}
    />
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h2>매크로 지표</h2>
          {/* 이 한 줄이 이 화면의 전부다. 여기 숫자는 매수·매도 판정에 들어가지 않는다 */}
          <p className="hint">여기 숫자는 매수·매도 시그널에 들어가지 않습니다.</p>
        </div>
        <div className="page-actions">
          {/* 지표를 AI 가 글로 (3c-2). 손님·승인 대기는 AI 를 쓰지 않는다 — 키도 계정에 묶여 있다 */}
          {!guest && !pending && series.length > 0 && (
            <button className="ghost" onClick={() => setAiOpen(true)}>
              AI 매크로 정리
            </button>
          )}
          {isAdmin && (
            <button className="primary" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? '받는 중…' : '지금 받아오기'}
            </button>
          )}
        </div>
      </div>

      {aiOpen && (
        <Suspense fallback={null}>
          <AiSummaryModal kind="macro" account={pushAccount(user)} onClose={closeAi} />
        </Suspense>
      )}

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {loading ? (
        <PageSkeleton blocks={6} rows={0} />
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
          {badges.length > 0 ? (
            <RegimeBadges badges={badges} />
          ) : (
            /* 이 화면은 국면을 보러 오는 곳이라, 조용하면 조용하다고 적어야 한다.
               빈 자리는 "아직 안 불러왔나"로 보인다. */
            <p className="hint regime-quiet">지금 눈에 띄는 국면은 없습니다.</p>
          )}
          <TermSpreadLine spread={data?.term_spread ?? null} />
          <p className="sr-only" role="status">
            {pinNote}
          </p>
          {/* "언제 받아본 것인가"는 "값이 언제 것인가"와 다른 질문이다 — 대부분 같아서 위에 한 번, 다른 줄만 줄에 적는다 */}
          {mine.length > 0 && (
            <>
              <div className="macro-list-head">
                <h3 id="macro-mine">내 지표</h3>
                <span className="hint">★ 을 끄면 아래로</span>
              </div>
              <ul className="macro-list" aria-labelledby="macro-mine">
                {mine.map(row)}
              </ul>
            </>
          )}
          <div className="macro-list-head">
            <h3 id="macro-all">{mine.length > 0 ? '모든 지표' : '지표'}</h3>
            <span className="hint">
              {commonChecked ? `${commonChecked}에 받음` : '아직 받지 않음'}
              {commonSource && ` (출처 ${commonSource})`}
            </span>
          </div>
          {!guest && mine.length === 0 && <p className="hint macro-mine-hint">★ 을 누르면 그 지표가 맨 위 &ldquo;내 지표&rdquo;로 모입니다.</p>}
          <ul className="macro-list" aria-labelledby="macro-all">
            {rest.map(row)}
          </ul>
        </>
      )}

      {open && (
        <Suspense fallback={null}>
          <MacroChartModal
            code={open.code}
            name={open.name}
            // 저장한 뒤 다시 읽은 값을 쓰도록 목록에서 다시 찾는다
            series={series.find((item) => item.code === open.code) ?? open}
            canEditForecast={isAdmin}
            onSaveForecast={saveForecast}
            onClearForecast={clearForecast}
            forecastError={forecastError}
            onForecastErrorDismiss={() => setForecastError(null)}
            onClose={() => openChart(null)}
          />
        </Suspense>
      )}
    </>
  )
}
