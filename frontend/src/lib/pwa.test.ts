import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isIos, isStandalone, registerServiceWorker } from './pwa'

const originalDescriptors = {
  userAgent: Object.getOwnPropertyDescriptor(window.navigator, 'userAgent'),
  maxTouchPoints: Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints'),
}

function setNavigator(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(window.navigator, key, { value, configurable: true })
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const [key, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor) Object.defineProperty(window.navigator, key, descriptor)
  }
  Reflect.deleteProperty(window.navigator, 'serviceWorker')
  Reflect.deleteProperty(window.navigator, 'standalone')
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('registerServiceWorker', () => {
  let register: ReturnType<typeof vi.fn>

  beforeEach(() => {
    register = vi.fn(async () => ({}))
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  })

  it('개발 서버에서는 붙이지 않는다 — 캐시가 HMR을 가린다', () => {
    vi.stubEnv('PROD', false)
    registerServiceWorker()
    expect(register).not.toHaveBeenCalled()
  })

  it('https(또는 localhost)가 아니면 붙이지 않는다', () => {
    vi.stubEnv('PROD', true)
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    registerServiceWorker()
    expect(register).not.toHaveBeenCalled()
  })

  it('빌드된 화면을 https로 열면 붙인다', () => {
    vi.stubEnv('PROD', true)
    registerServiceWorker()
    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('등록이 실패해도 화면을 막지 않는다', async () => {
    vi.stubEnv('PROD', true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    register.mockRejectedValue(new Error('거부됨'))
    expect(() => registerServiceWorker()).not.toThrow()
    await Promise.resolve()
  })

  it('서비스 워커를 모르는 브라우저에서도 터지지 않는다', () => {
    vi.stubEnv('PROD', true)
    Reflect.deleteProperty(window.navigator, 'serviceWorker')
    expect(() => registerServiceWorker()).not.toThrow()
  })
})

describe('isStandalone', () => {
  // jsdom에는 matchMedia가 아예 없다 — 그래서 코드도 없을 수 있다고 보고 쓴다.
  function setDisplayMode(standalone: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: standalone }),
      configurable: true,
    })
  }

  it('브라우저 탭으로 열었으면 false', () => {
    setDisplayMode(false)
    expect(isStandalone()).toBe(false)
  })

  it('홈 화면 아이콘으로 열었으면 true', () => {
    setDisplayMode(true)
    expect(isStandalone()).toBe(true)
  })

  it('아이폰은 display-mode 대신 navigator.standalone 을 쓴다', () => {
    setDisplayMode(false)
    setNavigator({ standalone: true })
    expect(isStandalone()).toBe(true)
  })

  it('matchMedia 가 없는 브라우저에서도 터지지 않는다', () => {
    Reflect.deleteProperty(window, 'matchMedia')
    expect(isStandalone()).toBe(false)
  })
})

describe('isIos', () => {
  it('아이폰', () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari' })
    expect(isIos()).toBe(true)
  })

  it('손가락이 닿는 맥은 아이패드뿐이다 (iPadOS 13부터 자신을 맥이라고 말한다)', () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', maxTouchPoints: 5 })
    expect(isIos()).toBe(true)
  })

  it('진짜 맥은 아니다', () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', maxTouchPoints: 0 })
    expect(isIos()).toBe(false)
  })

  it('안드로이드는 아니다', () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome', maxTouchPoints: 5 })
    expect(isIos()).toBe(false)
  })
})
