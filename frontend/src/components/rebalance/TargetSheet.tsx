import { NumberInput } from '../NumberInput'
import { Sheet } from '../ui/Sheet'

export interface TargetLine {
  ticker: string
  label: string
  /** "30주 · 지금 11.5%" */
  sub: string
  target: string
  band: string
  dirty: boolean
}

/**
 * 목표 비중 · 밴드 한 번에 고치기 (디자인 4차 목업 12c · 주인 답 "목표 · 밴드만 한 시트").
 * 수량 · 평단가 · 산 환율은 종목 탭의 "한 번에 수정"과 종목 안 "보유"에서 고친다 — 같은 칸이 두 곳에 있었다.
 * 값 · 저장 · 되돌리기는 리밸런싱 화면이 들고 있다(지금까지의 "바뀐 N줄 저장"과 같은 일).
 */
export function TargetSheet({
  lines,
  sum,
  sumOk,
  cashNote,
  defaultBand,
  dirtyCount,
  saving,
  onChange,
  onSave,
  onReset,
  onClose,
}: {
  lines: TargetLine[]
  /** "90.0%" */
  sum: string
  sumOk: boolean
  /** "현금 목표 0% 포함" */
  cashNote: string
  defaultBand: string
  dirtyCount: number
  saving: boolean
  onChange: (ticker: string, patch: { target?: string; band?: string }) => void
  onSave: () => void
  onReset: () => void
  onClose: () => void
}) {
  return (
    <Sheet
      title="목표 비중 · 밴드"
      label="목표 비중 · 밴드 고치기"
      closeLabel="목표 · 밴드 닫기"
      className="target-sheet"
      onClose={onClose}
      initialFocus={() => document.querySelector<HTMLInputElement>('.target-sheet input')}
      sub={
        <>
          합계 <b className={sumOk ? 'tone-good' : 'tone-warn'}>{sum}</b> · {cashNote}
          {sumOk ? ' — 100%로 맞습니다' : ' — 100%가 되게 맞추면 주문 계산이 맞습니다'}
        </>
      }
    >
      <div className="target-head" aria-hidden="true">
        <span>종목</span>
        <span>목표</span>
        <span>밴드</span>
      </div>
      <ul className="target-list">
        {lines.map((l) => (
          <li key={l.ticker} className={l.dirty ? 'dirty' : undefined}>
            <span className="target-name">
              <b>
                {l.label}
                {l.dirty && (
                  <span className="dirty-mark" title="저장 안 한 변경">
                    ●
                  </span>
                )}
              </b>
              <span className="hint mono">{l.sub}</span>
            </span>
            <span className="input-with-button tight">
              <NumberInput value={l.target} onChange={(v) => onChange(l.ticker, { target: v })} aria-label={`${l.ticker} 목표 비중`} />
              <span className="unit">%</span>
            </span>
            <span className="input-with-button tight">
              <NumberInput
                value={l.band}
                placeholder="기본"
                onChange={(v) => onChange(l.ticker, { band: v })}
                aria-label={`${l.ticker} 밴드 임계값`}
              />
              <span className="unit">%p</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        밴드를 비워 두면 설정의 기본 밴드({defaultBand}%p)를 씁니다. 수량 · 평단가 · 산 환율은 종목 탭의 ⋯ &ldquo;한 번에 수정&rdquo;이나 종목 안
        &ldquo;보유&rdquo;에서 고칩니다.
      </p>
      <div className="target-actions" role="status">
        <button type="button" onClick={onReset} disabled={saving || dirtyCount === 0}>
          되돌리기
        </button>
        <button type="button" className="primary" onClick={onSave} disabled={saving || dirtyCount === 0}>
          {saving ? '저장 중…' : dirtyCount > 0 ? `바뀐 ${dirtyCount}줄 저장` : '바뀐 것 없음'}
        </button>
      </div>
    </Sheet>
  )
}
