import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { IosInstallHint } from '../components/IosInstallHint'
import { isIos, isStandalone } from './pwa'

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
 * 홈 화면에 앱으로 얹기.
 *
 * 브라우저마다 방식이 다르다.
 *
 * - 크롬 계열: `beforeinstallprompt` 를 가로채 두었다가 버튼을 눌렀을 때 띄운다.
 *   가로채지 않으면 브라우저가 제 타이밍에 작은 배너를 띄우는데, 그건 눌러야 할 때
 *   안 뜨고 안 눌러도 될 때 뜬다.
 * - 아이폰: 그런 이벤트가 없다. **사파리의 공유 버튼으로만** 설치되므로 말로 알려주는
 *   수밖에 없다. 한 번 "다시 보지 않기"를 누르면 그 기기에서는 더 묻지 않는다.
 *
 * 이미 설치해서 연 경우에는 `available` 이 거짓이다.
 *
 * 버튼과 안내창을 나눠 준다 — 폰에서는 버튼이 헤더 메뉴 안에 있고(ROADMAP 8-2), 메뉴는
 * 누르면 닫힌다. 안내창이 메뉴 안에 있으면 메뉴와 함께 사라진다.
 */
export function useInstall(): { available: boolean; start: () => void; hint: ReactNode } {
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

  const closeIosHint = useCallback(() => setShowIosHint(false), [])

  const iosHintAvailable = !prompt && isIos() && !iosDismissed
  const available = !installed && (prompt !== null || iosHintAvailable)
  const start = useCallback(() => (prompt ? void install() : setShowIosHint(true)), [prompt, install])

  return {
    available,
    start,
    hint: !installed && showIosHint ? <IosInstallHint onClose={closeIosHint} onDismiss={dismissIosHint} /> : null,
  }
}
