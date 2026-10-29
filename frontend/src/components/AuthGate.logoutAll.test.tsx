/**
 * 모든 기기에서 나가기 (0.45.4) — 이 기기 정리. 서버가 내 알림 기기를 다 지웠으니 브라우저 쪽 구독을 거두고(forgetPushDevice),
 * 나가기처럼 AI 키·받아 둔 글을 지운다. 둘 중 하나를 빼면 여기서 멈춘다 (B 검토 2: clearAi 를 지워도 화면 시험이 통과했다).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('../lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/push')>()
  return { ...real, forgetPushDevice: vi.fn().mockResolvedValue(undefined), disablePush: vi.fn().mockResolvedValue(undefined) }
})

import { api } from '../api/client'
import { saveAiSettings } from '../lib/aiKey'
import { forgetPushDevice } from '../lib/push'
import { AuthGate, browser, useAuth } from './AuthGate'

function Probe() {
  const { logoutEverywhere } = useAuth()
  return <button onClick={() => void logoutEverywhere()}>모든 기기에서 나가기</button>
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(forgetPushDevice).mockClear()
  localStorage.clear()
  sessionStorage.clear()
})

it('서버에 알리고, 이 기기의 알림 구독을 거두고, AI 키·글을 지운 뒤 첫 화면을 새로 연다', async () => {
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
    locked: true, authenticated: true, mode: 'google', config_problem: null,
    user: { email: 'a@b.c', name: null, is_owner: false, status: 'active' },
  })
  const logoutAll = vi.spyOn(api, 'logoutAll').mockResolvedValue({ locked: true, authenticated: false })
  const go = vi.spyOn(browser, 'go').mockImplementation(() => {})
  saveAiSettings({ provider: 'anthropic', key: 'sk-ant-mine-1111', model: 'm', remember: true, account: 'a@b.c' })
  sessionStorage.setItem('signalboard:ai-key', '{"key":"sk-session"}')
  localStorage.setItem('signalboard:ai-results', '{"account":"a@b.c","items":{}}')
  render(
    <AuthGate>
      <Probe />
    </AuthGate>,
  )
  await userEvent.click(await screen.findByRole('button', { name: '모든 기기에서 나가기' }))
  await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
  expect(logoutAll).toHaveBeenCalledOnce()
  expect(forgetPushDevice).toHaveBeenCalledOnce()
  expect(localStorage.getItem('signalboard:ai-key')).toBeNull()
  expect(sessionStorage.getItem('signalboard:ai-key')).toBeNull()
  expect(localStorage.getItem('signalboard:ai-results')).toBeNull()
})

it('서버가 거절하면 아무것도 지우지 않고 던진다 — 확인 창이 사유를 보인다', async () => {
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
    locked: true, authenticated: true, mode: 'google', config_problem: null,
    user: { email: 'a@b.c', name: null, is_owner: false, status: 'active' },
  })
  vi.spyOn(api, 'logoutAll').mockRejectedValue(new Error('boom'))
  const go = vi.spyOn(browser, 'go').mockImplementation(() => {})
  saveAiSettings({ provider: 'anthropic', key: 'sk-ant-mine-1111', model: 'm', remember: true, account: 'a@b.c' })
  let caught: unknown = null
  function Catcher() {
    const { logoutEverywhere } = useAuth()
    return <button onClick={() => logoutEverywhere().catch((e) => (caught = e))}>눌러</button>
  }
  render(
    <AuthGate>
      <Catcher />
    </AuthGate>,
  )
  await userEvent.click(await screen.findByRole('button', { name: '눌러' }))
  await waitFor(() => expect(caught).not.toBeNull())
  expect(go).not.toHaveBeenCalled()
  expect(forgetPushDevice).not.toHaveBeenCalled()
  expect(localStorage.getItem('signalboard:ai-key')).not.toBeNull()
})
