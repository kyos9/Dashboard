import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider, STALE_AFTER_MS, useAppState } from './AppState'
import { api } from './api/client'
import { cacheGeneration, peekCache, putCache } from './lib/cache'

function Probe() {
  const { refreshKey, notifyDataChanged, refreshAll } = useAppState()
  return (
    <>
      <p>{`다시 받기 ${refreshKey}`}</p>
      <button onClick={notifyDataChanged}>저장했다</button>
      <button onClick={() => void refreshAll()}>전체 새로고침</button>
    </>
  )
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('앱으로 돌아왔을 때 (ROADMAP 8-1)', () => {
  it('받은 지 5분이 넘었으면 다시 받는다', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T09:00:00Z'))
    render(<AppStateProvider><Probe /></AppStateProvider>)
    putCache('page:dashboard', '어제', cacheGeneration())

    setVisibility('hidden')
    vi.setSystemTime(Date.now() + STALE_AFTER_MS + 1000)
    act(() => setVisibility('visible'))

    expect(screen.getByText('다시 받기 1')).toBeInTheDocument()
    // 캐시는 비우지 않는다 — 보던 값을 두고 뒤에서 바꾼다
    expect(peekCache('page:dashboard')).toBe('어제')
  })

  it('방금 받았으면 그대로 둔다', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T09:00:00Z'))
    render(<AppStateProvider><Probe /></AppStateProvider>)
    putCache('page:dashboard', '방금', cacheGeneration())

    setVisibility('hidden')
    vi.setSystemTime(Date.now() + STALE_AFTER_MS - 1000)
    act(() => setVisibility('visible'))

    expect(screen.getByText('다시 받기 0')).toBeInTheDocument()
  })

  it('숨겨질 때는 받지 않는다', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T09:00:00Z'))
    render(<AppStateProvider><Probe /></AppStateProvider>)
    putCache('page:dashboard', '값', cacheGeneration())
    vi.setSystemTime(Date.now() + STALE_AFTER_MS * 2)
    act(() => setVisibility('hidden'))
    expect(screen.getByText('다시 받기 0')).toBeInTheDocument()
  })
})

describe('고쳤다고 알리면', () => {
  it('화면 캐시를 비우고 다시 받게 한다', async () => {
    render(<AppStateProvider><Probe /></AppStateProvider>)
    putCache('page:rebalance', '고치기 전', cacheGeneration())
    await userEvent.click(screen.getByRole('button', { name: '저장했다' }))
    expect(peekCache('page:rebalance')).toBeUndefined()
    expect(screen.getByText('다시 받기 1')).toBeInTheDocument()
  })
})

describe('전체 새로고침 뒤', () => {
  it('화면 캐시를 비운다 — 새 시세가 들어왔으니 다른 탭도 옛 값을 보이면 안 된다', async () => {
    vi.spyOn(api, 'refreshAll').mockResolvedValue([])
    render(<AppStateProvider><Probe /></AppStateProvider>)
    putCache('page:fundamentals', '어제 종가 기준', cacheGeneration())
    await userEvent.click(screen.getByRole('button', { name: '전체 새로고침' }))
    expect(peekCache('page:fundamentals')).toBeUndefined()
    expect(await screen.findByText('다시 받기 1')).toBeInTheDocument()
  })
})
