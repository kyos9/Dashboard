import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preloadChartModal } from './chartChunk'
import { preloadPages, resetPreload } from './pageChunks'

/** 첫 화면 뒤 한가할 때 다른 탭 코드를 받아 둔다 (ROADMAP 8-5) */

const idle = vi.fn()

beforeEach(() => {
  resetPreload()
  idle.mockReset()
  vi.stubGlobal('requestIdleCallback', idle)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('preloadPages', () => {
  it('바로 받지 않고 한가할 때로 미룬다 — 첫 화면의 요청과 다투지 않게', () => {
    preloadPages()
    expect(idle).toHaveBeenCalledTimes(1)
    expect(idle.mock.calls[0][1]).toEqual({ timeout: 4000 })
  })

  it('한 번만 — 화면이 다시 그려져도 또 받지 않는다', () => {
    preloadPages()
    preloadPages()
    expect(idle).toHaveBeenCalledTimes(1)
  })

  it('데이터 절약 모드면 미리 받지 않는다 — 탭을 열 때 받는다', () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    preloadPages()
    expect(idle).not.toHaveBeenCalled()
  })

  it('requestIdleCallback 이 없는 브라우저(사파리)는 조금 뒤에 받는다', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const later = vi.spyOn(globalThis, 'setTimeout')
    preloadPages()
    expect(later).toHaveBeenCalledWith(expect.any(Function), 1500)
    later.mockRestore()
  })
})

describe('preloadChartModal', () => {
  it('데이터 절약 모드면 차트 조각도 미리 받지 않는다 — 탭 조각과 같은 규칙', () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    preloadChartModal()
    expect(idle).not.toHaveBeenCalled()
  })
})
