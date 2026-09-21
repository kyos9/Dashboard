import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallButton } from './InstallButton'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/124'

const realUserAgent = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

/** 크롬이 "지금 설치할 수 있다"고 알려오는 순간. */
function announceInstallable(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompt = vi.fn(async () => {})
  event.userChoice = Promise.resolve({ outcome })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

afterEach(() => {
  if (realUserAgent) Object.defineProperty(window.navigator, 'userAgent', realUserAgent)
  Reflect.deleteProperty(window.navigator, 'standalone')
  localStorage.clear()
})

describe('InstallButton', () => {
  it('설치할 수 없는 상태에서는 아무것도 그리지 않는다', () => {
    setUserAgent(ANDROID)
    const { container } = render(<InstallButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('이미 홈 화면 아이콘으로 열었으면 권하지 않는다', () => {
    setUserAgent(IPHONE)
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
    const { container } = render(<InstallButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('브라우저가 알려오면 버튼이 뜨고, 누르면 설치창이 열린다', async () => {
    setUserAgent(ANDROID)
    render(<InstallButton />)
    const event = announceInstallable()

    const button = screen.getByRole('button', { name: '앱 설치' })
    await userEvent.click(button)

    expect(event.prompt).toHaveBeenCalled()
    // 설치했으면 더 권하지 않는다
    expect(screen.queryByRole('button', { name: '앱 설치' })).not.toBeInTheDocument()
  })

  it('설치를 거절하면 버튼만 거둔다 — 다음 방문에 브라우저가 다시 알려준다', async () => {
    setUserAgent(ANDROID)
    render(<InstallButton />)
    announceInstallable('dismissed')

    await userEvent.click(screen.getByRole('button', { name: '앱 설치' }))
    expect(screen.queryByRole('button', { name: '앱 설치' })).not.toBeInTheDocument()
  })

  it('다른 데서 설치되면(appinstalled) 버튼이 사라진다', () => {
    setUserAgent(ANDROID)
    render(<InstallButton />)
    announceInstallable()
    expect(screen.getByRole('button', { name: '앱 설치' })).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(screen.queryByRole('button', { name: '앱 설치' })).not.toBeInTheDocument()
  })

  describe('아이폰 — 알려주는 이벤트가 없어 말로 안내한다', () => {
    it('버튼을 누르면 공유 → 홈 화면에 추가 순서를 보여준다', async () => {
      setUserAgent(IPHONE)
      render(<InstallButton />)

      await userEvent.click(screen.getByRole('button', { name: '앱 설치' }))
      const dialog = screen.getByRole('dialog', { name: '홈 화면에 추가하는 방법' })
      expect(dialog).toHaveTextContent('공유')
      expect(dialog).toHaveTextContent('홈 화면에 추가')
    })

    it('"다시 보지 않기"를 누르면 그 기기에서는 더 묻지 않는다', async () => {
      setUserAgent(IPHONE)
      const { unmount } = render(<InstallButton />)
      await userEvent.click(screen.getByRole('button', { name: '앱 설치' }))
      await userEvent.click(screen.getByRole('button', { name: '다시 보지 않기' }))

      expect(screen.queryByRole('button', { name: '앱 설치' })).not.toBeInTheDocument()

      unmount()
      const { container } = render(<InstallButton />)
      expect(container).toBeEmptyDOMElement()
    })

    it('"알겠습니다"로 닫으면 버튼은 남는다 — 나중에 다시 볼 수 있게', async () => {
      setUserAgent(IPHONE)
      render(<InstallButton />)
      await userEvent.click(screen.getByRole('button', { name: '앱 설치' }))
      await userEvent.click(screen.getByRole('button', { name: '알겠습니다' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '앱 설치' })).toBeInTheDocument()
    })

    it('크롬이 직접 알려올 수 있으면 안내창 대신 설치창을 쓴다', async () => {
      // 아이패드가 아니라 안드로이드 크롬인데 UA만 비슷한 경우까지 포함해, 이벤트가
      // 있으면 언제나 그쪽이 낫다 — 한 번에 설치된다.
      setUserAgent(IPHONE)
      render(<InstallButton />)
      const event = announceInstallable()

      await userEvent.click(screen.getByRole('button', { name: '앱 설치' }))
      expect(event.prompt).toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
