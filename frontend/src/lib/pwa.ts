/** 폰에 설치해 앱처럼 쓰기 위한 잔손질들.
 *
 * 여기 있는 것은 전부 **없어도 화면은 돌아가는** 기능이다. 서비스 워커가 못 붙어도,
 * 설치 버튼이 안 떠도 대시보드는 그대로 뜬다. 그래서 어느 것도 예외를 위로 던지지 않는다.
 */

/** 이미 홈 화면 아이콘으로 열린 상태인가. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch {
    // matchMedia 가 없는 환경(테스트 등)
  }
  // 아이폰 사파리는 display-mode 대신 이 값을 쓴다
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** 아이폰·아이패드인가. 이 기기들은 설치 버튼을 띄워줄 방법이 없어 따로 안내해야 한다. */
export function isIos(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  // iPadOS 13부터 자신을 맥이라고 말한다. 손가락이 닿는 맥은 아이패드뿐이다.
  return /Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1
}

/**
 * 서비스 워커를 붙인다. 붙지 않는 세 경우가 있고, 셋 다 정상이다.
 *
 * - 개발 서버: 캐시가 HMR을 가린다. 아예 붙이지 않는다.
 * - 안전하지 않은 연결: 브라우저가 https 나 localhost 에서만 허용한다. **집 안에서
 *   `http://192.168.0.x:8000` 으로 접속하면 설치도 오프라인도 되지 않는다** — 막힌 게
 *   아니라 브라우저의 규칙이다. 도메인을 붙이고 https 로 들어가면 된다.
 * - 지원하지 않는 브라우저.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof window === 'undefined' || !('serviceWorker' in window.navigator)) return
  if (!window.isSecureContext) return

  const start = () => {
    window.navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      // 등록 실패는 화면을 막을 일이 아니다. 콘솔에만 남긴다.
      console.warn('[pwa] 서비스 워커를 붙이지 못했습니다:', err)
    })
  }

  // 첫 화면이 다 뜬 뒤에 붙인다 — 설치 과정이 초기 로딩 대역폭을 뺏지 않게.
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
