import { useEffect } from 'react'
import { useBackToClose } from '../lib/backToClose'
import { setRise, setThemeChoice, usePrefs, type Rise, type ThemeChoice } from '../lib/prefs'

/**
 * 화면 설정 — 테마 · 상승 색 (ROADMAP 8-4).
 *
 * 이 기기에만 적용된다. 고르는 즉시 바뀐다(저장 버튼이 없다) — 보면서 고르게.
 */

const THEMES: { key: ThemeChoice; label: string }[] = [
  { key: 'system', label: '기기 설정' },
  { key: 'light', label: '밝게' },
  { key: 'dark', label: '어둡게' },
]

const RISES: { key: Rise; label: string }[] = [
  { key: 'green', label: '초록' },
  { key: 'red', label: '빨강' },
]

export function DisplayModal({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs()

  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal display-modal"
        role="dialog"
        aria-modal="true"
        aria-label="화면 설정"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>화면 설정</h3>
            <span className="hint">이 기기에만 적용됩니다</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <section className="display-row">
          <h4 id="display-theme">테마</h4>
          <div className="view-switch" role="group" aria-labelledby="display-theme">
            {THEMES.map((t) => (
              <button key={t.key} aria-pressed={prefs.choice === t.key} onClick={() => setThemeChoice(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {prefs.choice === 'system'
              ? `기기가 ${prefs.theme === 'light' ? '밝은' : '어두운'} 테마라 ${prefs.theme === 'light' ? '밝게' : '어둡게'} 보입니다. 기기 설정을 바꾸면 따라 바뀝니다.`
              : '기기 설정과 상관없이 고른 테마로 보입니다.'}
          </p>
        </section>

        <section className="display-row">
          <h4 id="display-rise">상승 색</h4>
          <div className="view-switch" role="group" aria-labelledby="display-rise">
            {RISES.map((r) => (
              <button key={r.key} aria-pressed={prefs.rise === r.key} onClick={() => setRise(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          {/* 고른 색으로 바로 보여준다 — 말보다 빠르다 */}
          <p className="rise-sample mono" aria-label="보기">
            <span className="up">+2.40%</span>
            <span className="down">−1.15%</span>
          </p>
          <p className="hint">
            {prefs.rise === 'red'
              ? '오르면 빨강, 내리면 파랑입니다 (한국 증권 앱 방식).'
              : '오르면 초록, 내리면 빨강입니다.'}{' '}
            가격 등락·수익률·평가손익에 쓰입니다. 시그널 색은 그대로 — 매수 ▲ 초록, 매도 ▼ 빨강, 비중조절 ◆ 보라이고,
            늘 글자나 모양이 같이 붙습니다.
          </p>
        </section>
      </div>
    </div>
  )
}
