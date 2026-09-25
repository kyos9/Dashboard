/**
 * 알림 설정 창 · 헤더의 🔔 · 나가기/탈퇴가 이 기기의 알림을 거두는지.
 *
 * 브라우저 쪽 동작(`lib/push.ts`)은 따로 본다 (`lib/push.test.ts`). 여기서는 그걸 가짜로 두고
 * 화면이 **무엇을 언제 부르는지**만 본다.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/push')>()
  return {
    ...real,
    pushState: vi.fn(),
    enablePush: vi.fn(),
    disablePush: vi.fn(),
    forgetPushDevice: vi.fn(),
    syncPush: vi.fn(),
  }
})

import { AppStateProvider } from '../AppState'
import { ApiError, api } from '../api/client'
import { disablePush, enablePush, forgetPushDevice, pushState, syncPush } from '../lib/push'
import type { AuthUser, PushSettings } from '../types'
import { AppHeader } from './AppHeader'
import { AuthGate, browser } from './AuthGate'
import { STATE_TEXT } from '../lib/pushText'
import { PushModal } from './PushModal'

const USER_SETTINGS: PushSettings = { kinds: ['buy', 'band', 'review'], available: ['buy', 'band', 'review'], devices: 0 }

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(pushState).mockReset().mockResolvedValue('off')
  vi.mocked(enablePush).mockReset().mockResolvedValue(undefined)
  vi.mocked(disablePush).mockReset().mockResolvedValue(undefined)
  vi.mocked(forgetPushDevice).mockReset().mockResolvedValue(undefined)
  vi.mocked(syncPush).mockReset().mockResolvedValue(undefined)
  vi.spyOn(api, 'getPushSettings').mockResolvedValue(USER_SETTINGS)
})

function renderModal(onClose = vi.fn()) {
  render(<PushModal account="me@example.com" onClose={onClose} />)
  return onClose
}

describe('이 기기', () => {
  it('꺼져 있으면 켜는 버튼 — 누르면 이 계정으로 켜고 상태를 다시 읽는다', async () => {
    renderModal()
    await userEvent.click(await screen.findByRole('button', { name: '이 기기에서 알림 켜기' }))
    expect(enablePush).toHaveBeenCalledWith('me@example.com')
    expect(await screen.findByText('켰습니다. 시험 알림으로 확인해 보세요.')).toBeInTheDocument()
    expect(pushState).toHaveBeenCalledTimes(2) // 연 때 한 번, 켠 뒤 한 번
  })

  it('켜 있으면 시험 알림과 끄기', async () => {
    vi.mocked(pushState).mockResolvedValue('on')
    const test = vi.spyOn(api, 'sendTestPush').mockResolvedValue({ sent: 1, failed: 0 })
    renderModal()

    await userEvent.click(await screen.findByRole('button', { name: '시험 알림 보내기' }))
    expect(test).toHaveBeenCalled()
    expect(await screen.findByText('시험 알림을 보냈습니다. 몇 초 안에 도착합니다.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '이 기기 알림 끄기' }))
    expect(disablePush).toHaveBeenCalled()
  })

  it('시험 알림이 하나도 안 닿았으면 그렇다고 말한다', async () => {
    vi.mocked(pushState).mockResolvedValue('on')
    vi.spyOn(api, 'sendTestPush').mockResolvedValue({ sent: 0, failed: 1 })
    renderModal()
    await userEvent.click(await screen.findByRole('button', { name: '시험 알림 보내기' }))
    expect(await screen.findByText('알림 서버에 보내지 못했습니다. 잠시 뒤 다시 눌러 주세요.')).toBeInTheDocument()
  })

  it('권한을 거절해서 못 켜면 이유를 — "Error:" 없이 문장만', async () => {
    vi.mocked(enablePush).mockRejectedValue(new Error('알림이 차단되었습니다.'))
    renderModal()
    await userEvent.click(await screen.findByRole('button', { name: '이 기기에서 알림 켜기' }))
    expect(await screen.findByText('알림이 차단되었습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/^Error:/)).not.toBeInTheDocument()
  })

  it('서버가 거절한 이유는 서버의 안내로', async () => {
    vi.mocked(enablePush).mockRejectedValue(new ApiError(400, '이 브라우저의 알림 서버는 지원하지 않습니다.', 'bad'))
    renderModal()
    await userEvent.click(await screen.findByRole('button', { name: '이 기기에서 알림 켜기' }))
    expect(await screen.findByText('이 브라우저의 알림 서버는 지원하지 않습니다.')).toBeInTheDocument()
  })

  it.each(['needs-install', 'insecure', 'unsupported', 'denied'] as const)(
    '켤 수 없는 기기(%s)는 버튼 대신 할 일을 적는다',
    async (state) => {
      vi.mocked(pushState).mockResolvedValue(state)
      renderModal()
      expect(await screen.findByText(STATE_TEXT[state])).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '이 기기에서 알림 켜기' })).not.toBeInTheDocument()
    },
  )

  it('아이폰 안내는 홈 화면에 추가하라고 말한다', () => {
    expect(STATE_TEXT['needs-install']).toContain('홈 화면에 추가')
    expect(STATE_TEXT['needs-install']).toContain('iOS 16.4')
  })
})

describe('받을 알림', () => {
  it('사용자는 셋, 끄면 바로 저장한다', async () => {
    const save = vi
      .spyOn(api, 'setPushKinds')
      .mockResolvedValue({ ...USER_SETTINGS, kinds: ['buy', 'review'] })
    renderModal()
    const band = await screen.findByRole('checkbox', { name: /비중조절/ })
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByRole('checkbox', { name: /가입 신청/ })).not.toBeInTheDocument()
    expect(band).toBeChecked()

    await userEvent.click(band)
    expect(save).toHaveBeenCalledWith(['buy', 'review'])
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /비중조절/ })).not.toBeChecked())
  })

  it('누르는 즉시 바뀌고, 저장이 실패하면 되돌린다', async () => {
    let fail: (e: unknown) => void = () => {}
    vi.spyOn(api, 'setPushKinds').mockReturnValue(new Promise((_, reject) => (fail = reject)))
    renderModal()
    const buy = await screen.findByRole('checkbox', { name: /매수 시그널/ })
    await userEvent.click(buy)
    expect(buy).not.toBeChecked() // 서버를 기다리지 않는다
    fail(new ApiError(500, '저장하지 못했습니다.', 'boom'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /매수 시그널/ })).toBeChecked())
    expect(await screen.findByText('저장하지 못했습니다.')).toBeInTheDocument()
  })

  it('관리자에게는 가입 신청이 하나 더 있다', async () => {
    vi.spyOn(api, 'getPushSettings').mockResolvedValue({
      kinds: ['buy'], available: ['buy', 'band', 'review', 'signup'], devices: 2,
    })
    const save = vi.spyOn(api, 'setPushKinds').mockResolvedValue({
      kinds: ['buy', 'signup'], available: ['buy', 'band', 'review', 'signup'], devices: 2,
    })
    renderModal()
    const signup = await screen.findByRole('checkbox', { name: /가입 신청/ })
    expect(signup).not.toBeChecked()
    expect(screen.getByText('알림을 켜 둔 기기 2대')).toBeInTheDocument()
    await userEvent.click(signup)
    expect(save).toHaveBeenCalledWith(['buy', 'signup'])
  })
})

it('Esc·바깥·✕ 로 닫힌다', async () => {
  const onClose = renderModal()
  await screen.findByRole('dialog', { name: '알림' })
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: '닫기' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})

// ---------------------------------------------------------------------------
//  헤더 · 나가기 · 탈퇴
// ---------------------------------------------------------------------------

function renderApp(user: AuthUser | null) {
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok' })
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
    locked: true, authenticated: user !== null, mode: 'google', user, config_problem: null,
  })
  vi.spyOn(browser, 'go').mockImplementation(() => {})
  return render(
    <MemoryRouter>
      <AuthGate>
        <AppStateProvider>
          <AppHeader />
        </AppStateProvider>
      </AuthGate>
    </MemoryRouter>,
  )
}

const FRIEND: AuthUser = { email: 'friend@example.com', name: '친구', is_owner: false, status: 'active' }

describe('헤더', () => {
  it('들어온 사람에게 🔔 — 누르면 알림 창, 열 때 이 기기를 한 번 맞춘다', async () => {
    renderApp(FRIEND)
    await userEvent.click(await screen.findByRole('button', { name: '알림 설정' }))
    expect(await screen.findByRole('dialog', { name: '알림' })).toBeInTheDocument()
    expect(syncPush).toHaveBeenCalledWith('friend@example.com')
    expect(pushState).toHaveBeenCalledWith('friend@example.com')
  })

  it('손님·승인 대기에게는 없다 — 보낼 것이 없다', async () => {
    const { unmount } = renderApp(null)
    await screen.findByRole('button', { name: '로그인' })
    expect(screen.queryByRole('button', { name: '알림 설정' })).not.toBeInTheDocument()
    unmount()

    renderApp({ ...FRIEND, status: 'pending' })
    await screen.findByText('승인 대기')
    expect(screen.queryByRole('button', { name: '알림 설정' })).not.toBeInTheDocument()
    expect(syncPush).not.toHaveBeenCalled()
  })

  it('나가기는 이 기기의 알림부터 끄고 나간다 — 쪽지가 살아 있을 때 해야 서버에서도 지워진다', async () => {
    const order: string[] = []
    vi.mocked(disablePush).mockImplementation(async () => {
      order.push('disable')
    })
    renderApp(FRIEND)
    vi.spyOn(api, 'logout').mockImplementation(async () => {
      order.push('logout')
      return { locked: true, authenticated: false }
    })
    await userEvent.click(await screen.findByRole('button', { name: '나가기' }))
    await waitFor(() => expect(order).toEqual(['disable', 'logout']))
  })

  it('알림 끄기가 실패해도 나가기는 된다', async () => {
    vi.mocked(disablePush).mockRejectedValue(new Error('offline'))
    renderApp(FRIEND)
    const logout = vi.spyOn(api, 'logout').mockResolvedValue({ locked: true, authenticated: false })
    await userEvent.click(await screen.findByRole('button', { name: '나가기' }))
    await waitFor(() => expect(logout).toHaveBeenCalled())
  })

  it('탈퇴하면 브라우저 쪽 구독도 거둔다', async () => {
    renderApp(FRIEND)
    vi.spyOn(api, 'withdraw').mockResolvedValue(undefined)
    await userEvent.click(await screen.findByRole('button', { name: '탈퇴' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '탈퇴' }))
    await waitFor(() => expect(forgetPushDevice).toHaveBeenCalled())
    expect(disablePush).not.toHaveBeenCalled()
  })
})
