import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './api/client'
import { resetPreload } from './lib/pageChunks'

/**
 * 탭 코드를 나눈 뒤 (ROADMAP 8-5) — 한 탭의 조각을 못 받아도 앱이 통째로 비지 않는다.
 *
 * 매크로 화면 파일을 "받을 수 없는" 것으로 만든다. 오프라인에서 한 번도 안 연 탭을 누르거나,
 * 새 버전이 올라와 한 번 새로고침한 뒤에도 옛 조각을 못 찾는 경우다.
 */
vi.mock('./pages/MacroPanel', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.34.0' })
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
    locked: true,
    authenticated: false,
    mode: 'google',
    user: null,
    config_problem: null,
  })
  vi.spyOn(api, 'getMacroPinned').mockResolvedValue({ codes: [], series: [], badges: [] })
  // 이미 한 번 새로고침해 본 뒤라고 둔다 — 그래야 loadChunk 가 새로고침 대신 오류를 올린다
  sessionStorage.setItem('chunk-reloaded', '1')
})

afterEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('탭 조각을 못 받으면', () => {
  it('그 자리에만 안내를 띄우고 헤더·탭은 남는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '/macro')
    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('이 화면을 불러오지 못했습니다')
    expect(within(alert).getByRole('button', { name: '다시 불러오기' })).toBeInTheDocument()
    // 다른 탭으로 갈 길이 남아 있다
    expect(screen.getAllByRole('link', { name: /대시보드/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '개인정보처리방침 · 이용약관' })).toBeInTheDocument()
  })

  it('다른 탭으로 옮기면 그 탭은 제대로 그린다 — 안내가 따라오지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '/macro')
    render(<App />)
    await screen.findByRole('alert')

    // 나눠 받는 다른 탭(방침)으로 — 앱 안에서 주소만 바뀐다(뒤로가기와 같은 길)
    act(() => {
      window.history.pushState(null, '', '/privacy')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByRole('article')).toBeInTheDocument()
    expect(screen.queryByText('이 화면을 불러오지 못했습니다.')).toBeNull()
  })

  it('"다시 불러오기"는 페이지를 새로 받는다 — 새 index.html 이 새 조각 이름을 가리킨다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    window.history.replaceState(null, '', '/macro')
    vi.stubGlobal('location', { ...window.location, pathname: '/macro', reload })
    try {
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '다시 불러오기' }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('다른 탭 코드를 미리 받기', () => {
  it('앱이 뜨면 한가할 때로 미뤄 둔다 — 첫 화면 요청과 다투지 않게', async () => {
    const idle = vi.fn()
    vi.stubGlobal('requestIdleCallback', idle)
    resetPreload() // 앞 테스트의 앱이 이미 한 번 걸어 두었다
    try {
      render(<App />)
      await screen.findByRole('link', { name: '개인정보처리방침 · 이용약관' })
      expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

