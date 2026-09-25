/**
 * 뒤로가기로 팝업 닫기.
 *
 * 지켜야 할 것은 셋이다: 뒤로가기가 **팝업만** 닫고 탭은 그대로 둔다, 다른 길로 닫으면 쌓은
 * 칸을 치워 다음 뒤로가기가 헛돌지 않는다, 라우터의 이동은 절대 되돌리지 않는다.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { resetBackToClose, useBackToClose } from './backToClose'

function level() {
  return (window.history.state as { __modal?: number } | null)?.__modal ?? 0
}

/** 뒤로가기 한 번 — jsdom 도 브라우저처럼 한 박자 뒤에 popstate 를 준다 */
async function back() {
  await act(async () => {
    window.history.back()
    await new Promise((r) => setTimeout(r, 30))
  })
}

/** 닫힌 팝업의 칸을 치우는 박자까지 기다린다 */
async function settled() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

function Popup({ name, onClose, canClose = true }: { name: string; onClose: () => void; canClose?: boolean }) {
  useBackToClose(onClose, canClose)
  return (
    <div role="dialog" aria-label={name}>
      <button onClick={onClose}>{name} 닫기</button>
    </div>
  )
}

/** 팝업 둘을 겹쳐 열 수 있는 화면 */
function Screen({ onPop = () => {} }: { onPop?: (name: string) => void }) {
  const [first, setFirst] = useState(false)
  const [second, setSecond] = useState(false)
  return (
    <>
      <button onClick={() => setFirst(true)}>첫째 열기</button>
      {first && (
        <Popup
          name="첫째"
          onClose={() => {
            onPop('첫째')
            setFirst(false)
          }}
        />
      )}
      {first && <button onClick={() => setSecond(true)}>둘째 열기</button>}
      {second && (
        <Popup
          name="둘째"
          onClose={() => {
            onPop('둘째')
            setSecond(false)
          }}
        />
      )}
      <button
        onClick={() => {
          setFirst(false)
          setSecond(false)
        }}
      >
        모두 닫기
      </button>
    </>
  )
}

beforeEach(() => {
  resetBackToClose()
  window.history.replaceState({ idx: 0, key: 'base' }, '', '/')
})

afterEach(async () => {
  cleanup()
  await settled()
})

describe('뒤로가기', () => {
  it('열면 같은 주소로 한 칸 쌓고 — 라우터의 idx·key 는 그대로 옮긴다', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '첫째 열기' }))
    expect(window.history.state).toEqual({ idx: 0, key: 'base', __modal: 1 })
    expect(window.location.pathname).toBe('/')
  })

  it('뒤로가기는 팝업을 닫는다', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '첫째 열기' }))
    await back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(level()).toBe(0)
    expect(window.history.state).toEqual({ idx: 0, key: 'base' })
  })

  it('겹쳐 있으면 맨 위 하나만 닫는다', async () => {
    const closed = vi.fn()
    render(<Screen onPop={closed} />)
    await userEvent.click(screen.getByRole('button', { name: '첫째 열기' }))
    await userEvent.click(screen.getByRole('button', { name: '둘째 열기' }))
    expect(level()).toBe(2)

    await back()
    expect(closed.mock.calls).toEqual([['둘째']])
    expect(screen.getByRole('dialog', { name: '첫째' })).toBeInTheDocument()

    await back()
    expect(closed.mock.calls).toEqual([['둘째'], ['첫째']])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('지금은 닫을 수 없으면(지우는 중) 닫지 않고 칸을 다시 쌓는다', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<Popup name="확인" onClose={onClose} canClose={false} />)
    await back()
    expect(onClose).not.toHaveBeenCalled()
    expect(level()).toBe(1) // 다음 뒤로가기도 팝업이 받는다

    rerender(<Popup name="확인" onClose={onClose} canClose />)
    await back()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('다른 길로 닫을 때', () => {
  it('✕ 로 닫으면 쌓은 칸을 치운다 — 다음 뒤로가기가 헛돌지 않는다', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '첫째 열기' }))
    await userEvent.click(screen.getByRole('button', { name: '첫째 닫기' }))
    await settled()
    expect(level()).toBe(0)
    expect(window.history.state).toEqual({ idx: 0, key: 'base' })
  })

  it('겹친 둘이 한꺼번에 닫혀도 둘 다 치운다 — 딱 두 칸만, 그 앞 기록까지 넘어가지 않고', async () => {
    window.history.pushState({ idx: 1, key: 'here' }, '', '/rebalance')
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '첫째 열기' }))
    await userEvent.click(screen.getByRole('button', { name: '둘째 열기' }))
    await userEvent.click(screen.getByRole('button', { name: '모두 닫기' }))
    await settled()
    expect(window.history.state).toEqual({ idx: 1, key: 'here' })
    expect(window.location.pathname).toBe('/rebalance')
  })

  it('위만 닫으면 아래 팝업의 칸은 남긴다', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '첫째 열기' }))
    await userEvent.click(screen.getByRole('button', { name: '둘째 열기' }))
    await userEvent.click(screen.getByRole('button', { name: '둘째 닫기' }))
    await settled()
    expect(level()).toBe(1)
    expect(screen.getByRole('dialog', { name: '첫째' })).toBeInTheDocument()
  })

  it('닫자마자 다른 기록이 쌓였으면 되돌리지 않는다', async () => {
    const { unmount } = render(<Popup name="팝업" onClose={() => {}} />)
    unmount()
    window.history.pushState({ idx: 1, key: 'next' }, '', '/rebalance') // 같은 박자의 화면 이동
    await settled()
    expect(window.location.pathname).toBe('/rebalance')
    expect(window.history.state).toEqual({ idx: 1, key: 'next' })
  })

  it('칸을 빼는 도중에 다른 팝업을 열어도 그 팝업은 닫히지 않는다', async () => {
    const onClose = vi.fn()
    const { unmount } = render(<Popup name="앞" onClose={() => {}} />)
    unmount()
    // 치우는 박자(setTimeout 0)는 지났고, 브라우저가 칸을 빼는 중이다
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    render(<Popup name="뒤" onClose={onClose} />)
    await settled()
    expect(onClose).not.toHaveBeenCalled()
    expect(level()).toBe(1)

    await back() // 이 뒤로가기는 새 팝업이 받는다
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('StrictMode 로 한 번 닫혔다 다시 열려도 칸은 하나, 팝업은 열린 채', async () => {
    const onClose = vi.fn()
    render(
      <StrictMode>
        <Popup name="팝업" onClose={onClose} />
      </StrictMode>,
    )
    await settled()
    expect(level()).toBe(1)
    expect(onClose).not.toHaveBeenCalled()

    await back() // 칸이 둘이었다면 아직 1 이다
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.history.state).toEqual({ idx: 0, key: 'base' })
  })
})

describe('라우터와 함께', () => {
  function Where() {
    return <p data-testid="where">{useLocation().pathname}</p>
  }

  function App() {
    const [open, setOpen] = useState(false)
    return (
      <BrowserRouter>
        <NavLink to="/">홈</NavLink>
        <NavLink to="/rebalance">리밸런싱</NavLink>
        <Where />
        <Routes>
          <Route path="*" element={<button onClick={() => setOpen(true)}>팝업 열기</button>} />
        </Routes>
        {open && <Popup name="팝업" onClose={() => setOpen(false)} />}
      </BrowserRouter>
    )
  }

  it('탭을 옮긴 뒤 팝업을 열고 뒤로가기 — 팝업만 닫히고 탭은 그대로, 한 번 더 누르면 앞 탭', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('link', { name: '리밸런싱' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/rebalance')

    await userEvent.click(screen.getByRole('button', { name: '팝업 열기' }))
    await back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/rebalance')

    await back()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('✕ 로 닫은 뒤의 뒤로가기도 앞 탭으로 간다 (헛도는 칸이 없다)', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('link', { name: '리밸런싱' }))
    await userEvent.click(screen.getByRole('button', { name: '팝업 열기' }))
    await userEvent.click(screen.getByRole('button', { name: '팝업 닫기' }))
    await settled()
    expect(screen.getByTestId('where')).toHaveTextContent('/rebalance')

    await back()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })
})

describe('확인 창', () => {
  it('뒤로가기는 "취소"와 같다 — 지우는 중에는 닫히지 않는다', async () => {
    const onCancel = vi.fn()
    const dialog = (busy: boolean) => (
      <ConfirmDialog title="삭제할까요?" confirmLabel="삭제" busy={busy} onConfirm={() => {}} onCancel={onCancel}>
        <p>되돌릴 수 없습니다.</p>
      </ConfirmDialog>
    )
    const { rerender } = render(dialog(true))
    await back()
    expect(onCancel).not.toHaveBeenCalled()

    rerender(dialog(false))
    await back()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
