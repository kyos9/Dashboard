import { useCallback, useEffect, useState } from 'react'
import { isIos, isStandalone } from '../lib/pwa'

/** 크롬 계열이 "지금 설치할 수 있다"고 알려줄 때 주는 이벤트. 표준 타입이 아직 없다. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const HINT_DISMISSED = 'signalboard.installHintDismissed'

function hintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DISMISSED) === '1'
  } catch {
    return false
  }
}

/**
 * 홈 화면에 앱으로 얹는 버튼.
 *
 * 브라우저마다 방식이 다르다.
 *
 * - 크롬 계열: `beforeinstallprompt` 를 가로채 두었다가 버튼을 눌렀을 때 띄운다.
 *   가로채지 않으면 브라우저가 제 타이밍에 작은 배너를 띄우는데, 그건 눌러야 할 때
 *   안 뜨고 안 눌러도 될 때 뜬다.
 * - 아이폰: 그런 이벤트가 없다. **사파리의 공유 버튼으로만** 설치되므로 말로 알려주는
 *   수밖에 없다. 한 번 "다시 보지 않기"를 누르면 그 기기에서는 더 묻지 않는다.
 *
 * 이미 설치해서 연 경우에는 아무것도 그리지 않는다.
 */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => isStandalone())
  const [showIosHint, setShowIosHint] = useState(false)
  const [iosDismissed, setIosDismissed] = useState(hintDismissed)

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    // 한 번 띄운 이벤트는 다시 못 쓴다. 거절했다면 다음 방문에 브라우저가 다시 준다.
    setPrompt(null)
    if (outcome === 'accepted') setInstalled(true)
  }, [prompt])

  const dismissIosHint = useCallback(() => {
    setIosDismissed(true)
    setShowIosHint(false)
    try {
      localStorage.setItem(HINT_DISMISSED, '1')
    } catch {
      // 저장소를 막아둔 브라우저에서는 이번 세션에만 적용된다
    }
  }, [])

  if (installed) return null

  const iosHintAvailable = !prompt && isIos() && !iosDismissed
  if (!prompt && !iosHintAvailable) return null

  return (
    <>
      <button
        className="ghost"
        onClick={() => (prompt ? void install() : setShowIosHint(true))}
        title="홈 화면에 앱으로 추가합니다"
      >
        앱 설치
      </button>

      {showIosHint && (
        <div className="modal-backdrop" onClick={() => setShowIosHint(false)}>
          <div
            className="modal install-hint"
            role="dialog"
            aria-modal="true"
            aria-label="홈 화면에 추가하는 방법"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">
                <h3>홈 화면에 추가</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowIosHint(false)} aria-label="닫기">
                ✕
              </button>
            </div>

            <div className="install-hint-body">
              <p>아이폰·아이패드는 사파리에서 직접 추가해야 합니다.</p>
              <ol>
                <li>
                  아래쪽 <strong>공유</strong> 버튼을 누릅니다 (네모에서 화살표가 올라오는 모양).
                </li>
                <li>
                  목록을 내려 <strong>홈 화면에 추가</strong>를 고릅니다.
                </li>
                <li>
                  오른쪽 위 <strong>추가</strong>를 누릅니다.
                </li>
              </ol>
              <p className="hint-note">
                추가하고 나면 주소창 없이 앱처럼 열리고, 서버가 잠깐 안 잡혀도 마지막 화면이
                뜹니다.
              </p>
            </div>

            <div className="btn-group">
              <button onClick={dismissIosHint}>다시 보지 않기</button>
              <button className="primary" onClick={() => setShowIosHint(false)}>
                알겠습니다
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
