import { useEffect, useRef } from 'react'
import { NumberInput } from '../NumberInput'
import { Sheet } from '../ui/Sheet'

export interface TargetLine {
  ticker: string
  label: string
  /** "30주, 현재 11.5%" */
  sub: string
  /** PC 표 칸 — "30주" */
  qty?: string
  /** PC 표 칸 — "11.5%" */
  now?: string
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
  note,
  noteSeq = 0,
  onChange,
  onSave,
  onReset,
  onClose,
  center = false,
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
  /** 저장한 뒤 한 줄 — 버튼 글자만 바뀌어 저장됐는지 몰랐다 (사용자 확인 4) */
  note?: string | null
  /** 저장할 때마다 바뀌는 수 — 같은 글이어도 다시 끌어오게 */
  noteSeq?: number
  onChange: (ticker: string, patch: { target?: string; band?: string }) => void
  onSave: () => void
  onReset: () => void
  onClose: () => void
  /** PC 가운데 창 — 한 줄 표 (디자인 5차 목업 07 가) */
  center?: boolean
}) {
  const noteRef = useRef<HTMLParagraphElement>(null)
  // 아래쪽 줄을 고치고 저장하면 시트가 내려간 채라 맨 위 줄이 화면 밖이었다 — 저장 줄을 보이는 곳으로 (묶음 4 검토 7 조건 1)
  useEffect(() => {
    if (note) noteRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [note, noteSeq])
  return (
    <Sheet
      title="목표 수정"
      label="목표 수정"
      closeLabel="목표 수정 닫기"
      className="target-sheet"
      center={center}
      onClose={onClose}
      initialFocus={() => document.querySelector<HTMLInputElement>('.target-sheet input')}
      sub={
        <>
          합계 <b className={sumOk ? 'tone-good' : 'tone-warn'}>{sum}</b>, {cashNote}.
          {sumOk ? '' : ' 100%가 되게 맞추세요.'}
        </>
      }
    >
      {/* 저장한 뒤 한 줄은 맨 위에 — 긴 목록 맨 아래에 있어 보이지 않았다(묶음 4 사용자 확인 2) */}
      {note && (
        <p ref={noteRef} className="hint saved-note" role="status">
          {note}
        </p>
      )}
      {center ? (
        <>
          <div className="sheet-body">
            <table className="target-table">
              <thead>
                <tr>
                  <th className="l">종목</th>
                  <th>수량</th>
                  <th>현재</th>
                  <th>목표</th>
                  <th>
                    밴드 <span className="hint">비우면 기본 {defaultBand}%p</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.ticker} className={l.dirty ? 'dirty' : undefined}>
                    <th scope="row" className="l">
                      {l.label}
                      {l.dirty && (
                        <span className="dirty-mark" title="저장 안 한 변경">
                          ●
                        </span>
                      )}
                    </th>
                    <td className="mono hint">{l.qty}</td>
                    <td className="mono hint">{l.now}</td>
                    <td>
                      <span className="input-with-button tight">
                        <NumberInput value={l.target} onChange={(v) => onChange(l.ticker, { target: v })} aria-label={`${l.label} 목표 비중`} />
                        <span className="unit">%</span>
                      </span>
                    </td>
                    <td>
                      <span className="input-with-button tight">
                        <NumberInput
                          value={l.band}
                          placeholder={`기본 ${defaultBand}`}
                          onChange={(v) => onChange(l.ticker, { band: v })}
                          aria-label={`${l.label} 밴드 임계값`}
                        />
                        <span className="unit">%p</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sheet-foot">
            <p className="hint">수량, 평단가, 산 환율은 종목 수정에서 고칩니다.</p>
            <button type="button" className="ghost" onClick={onReset} disabled={saving || dirtyCount === 0}>
              되돌리기
            </button>
            <button type="button" className="primary" onClick={onSave} disabled={saving || dirtyCount === 0}>
              {saving ? '저장 중…' : dirtyCount > 0 ? `바뀐 ${dirtyCount}줄 저장` : '저장'}
            </button>
          </div>
        </>
      ) : (
        <>
      <div className="target-head" aria-hidden="true">
        <span>종목</span>
        <span>목표</span>
        <span>밴드 (기본 {defaultBand}%p)</span>
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
              <NumberInput value={l.target} onChange={(v) => onChange(l.ticker, { target: v })} aria-label={`${l.label} 목표 비중`} />
              <span className="unit">%</span>
            </span>
            <span className="input-with-button tight">
              <NumberInput
                value={l.band}
                placeholder={`기본 ${defaultBand}`}
                onChange={(v) => onChange(l.ticker, { band: v })}
                aria-label={`${l.label} 밴드 임계값`}
              />
              <span className="unit">%p</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        밴드를 비워 두면 기본 밴드 {defaultBand}%p를 씁니다(설정에서 바꿉니다). 수량, 평단가, 산 환율은 종목 수정에서 고칩니다.
      </p>
      <div className="target-actions">
        <button type="button" onClick={onReset} disabled={saving || dirtyCount === 0}>
          되돌리기
        </button>
        <button type="button" className="primary" onClick={onSave} disabled={saving || dirtyCount === 0}>
          {saving ? '저장 중…' : dirtyCount > 0 ? `바뀐 ${dirtyCount}줄 저장` : '저장'}
        </button>
      </div>
        </>
      )}
    </Sheet>
  )
}
