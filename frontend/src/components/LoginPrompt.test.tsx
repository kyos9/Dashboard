import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { AuthStatus } from '../types'
import { AuthGate } from './AuthGate'
import { RequireLogin } from './LoginPrompt'

beforeEach(() => {
  vi.restoreAllMocks()
})

function renderAs(status: AuthStatus) {
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status)
  return render(
    <AuthGate>
      <RequireLogin title="로그인하면 종목을 담을 수 있습니다">
        <p>내 종목 화면</p>
      </RequireLogin>
    </AuthGate>,
  )
}

describe('내 종목이 필요한 화면', () => {
  it('손님에게는 화면 대신 무엇을 얻는지와 로그인 버튼을 보여준다', async () => {
    renderAs({ locked: true, authenticated: false, mode: 'google', user: null, config_problem: null })
    expect(await screen.findByText('로그인하면 종목을 담을 수 있습니다')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument()
    expect(screen.queryByText('내 종목 화면')).not.toBeInTheDocument()
  })

  it('들어와 있으면 화면을 그대로 보여준다', async () => {
    renderAs({
      locked: true, authenticated: true, mode: 'google',
      user: { email: 'f@x.y', name: '친구', is_owner: false }, config_problem: null,
    })
    expect(await screen.findByText('내 종목 화면')).toBeInTheDocument()
  })

  it('혼자 쓰는 PC에서는 안내가 끼어들지 않는다', async () => {
    renderAs({ locked: false, authenticated: true, mode: 'open' })
    expect(await screen.findByText('내 종목 화면')).toBeInTheDocument()
  })
})
