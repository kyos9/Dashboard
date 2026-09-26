import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { readAiResult, readAiSettings, saveAiResult, saveAiSettings } from '../lib/aiKey'
import type { AiAnalysis } from '../types'
import { AiKeyForm } from './AiKeyForm'
import { AiPanel } from './AiPanel'

const ME = 'a@example.com'
const KEY = 'sk-ant-secret-1234'

const RESULT: AiAnalysis = {
  ticker: 'GOOG', provider: 'anthropic', model: 'claude-x', text: '## 한눈에 보기\n- 종가가 MA20 아래',
  truncated: false, as_of: '2026-09-25', generated_at: '2026-09-26T01:00:00Z', input_tokens: 1500, output_tokens: 900,
}

function withKey() {
  saveAiSettings({ provider: 'anthropic', key: KEY, model: 'claude-x', remember: true, account: ME })
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('AI 키 넣기', () => {
  it('키를 확인해 모델 목록을 받고, 고른 모델로 저장한다', async () => {
    const models = vi.spyOn(api, 'aiModels').mockResolvedValue({
      provider: 'openai', models: [{ id: 'gpt-a', label: 'gpt-a' }, { id: 'gpt-b', label: 'gpt-b' }],
    })
    const user = userEvent.setup()
    render(<AiKeyForm account={ME} />)

    await user.selectOptions(screen.getByLabelText('AI 회사'), 'openai')
    const save = screen.getByRole('button', { name: '저장' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/API 키/), 'sk-typed-9999')
    // 확인하기 전에는 저장할 수 없다 — 틀린 키를 저장해 두고 나중에 놀라지 않게
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '키 확인' }))
    expect(models).toHaveBeenCalledWith('openai', 'sk-typed-9999')
    await user.selectOptions(await screen.findByLabelText('모델'), 'gpt-b')
    await user.click(save)

    expect(readAiSettings(ME)).toMatchObject({ provider: 'openai', key: 'sk-typed-9999', model: 'gpt-b', remember: true })
    expect(screen.getByText(/저장된 키/)).toHaveTextContent('…9999')
    // 넣은 키는 입력칸에서 지운다
    expect(screen.getByLabelText(/API 키/)).toHaveValue('')
  })

  it('틀린 키면 이유를 보여주고 저장하지 않는다', async () => {
    vi.spyOn(api, 'aiModels').mockRejectedValue(
      new ApiError(400, 'AI 키가 맞지 않습니다.', 'anthropic HTTP 401', 'key_invalid'),
    )
    const user = userEvent.setup()
    render(<AiKeyForm account={ME} />)
    await user.type(screen.getByLabelText(/API 키/), 'sk-wrong-0000')
    await user.click(screen.getByRole('button', { name: '키 확인' }))
    expect(await screen.findByText('AI 키가 맞지 않습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(readAiSettings(ME)).toBeNull()
  })

  it('기억을 끄면 탭을 닫을 때 지워지는 곳에 둔다', async () => {
    vi.spyOn(api, 'aiModels').mockResolvedValue({ provider: 'anthropic', models: [{ id: 'c', label: 'C' }] })
    const user = userEvent.setup()
    render(<AiKeyForm account={ME} />)
    await user.type(screen.getByLabelText(/API 키/), 'sk-ant-temp-5555')
    await user.click(screen.getByRole('button', { name: '키 확인' }))
    await user.click(await screen.findByLabelText(/이 기기에 기억/))
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(localStorage.getItem('signalboard:ai-key')).toBeNull()
    expect(sessionStorage.getItem('signalboard:ai-key')).toContain('sk-ant-temp-5555')
  })

  it('저장된 키가 있어도, 새로 넣은 키는 확인해야 저장된다', async () => {
    withKey()
    const user = userEvent.setup()
    render(<AiKeyForm account={ME} />)
    const save = screen.getByRole('button', { name: '저장' })
    // 저장된 키·모델 그대로면 (기억 설정만 바꿀 때) 저장할 수 있다
    expect(save).toBeEnabled()
    await user.type(screen.getByLabelText(/API 키/), 'sk-ant-new-unchecked-2222')
    expect(save).toBeDisabled()
  })

  it('키 지우기', async () => {
    withKey()
    const user = userEvent.setup()
    render(<AiKeyForm account={ME} />)
    await user.click(screen.getByRole('button', { name: '키 지우기' }))
    expect(readAiSettings(ME)).toBeNull()
    expect(screen.queryByText(/저장된 키/)).toBeNull()
  })

  it('이 기기에만 저장되고 서버에는 남지 않는다고 적는다', () => {
    render(<AiKeyForm account={ME} />)
    expect(screen.getByText(/서버는 키를 저장하지도 기록하지도 않습니다/)).toBeInTheDocument()
  })
})

describe('AI 정리 탭', () => {
  it('키가 없으면 키 넣기부터 — 부르지 않는다', () => {
    const analyze = vi.spyOn(api, 'aiAnalyze')
    render(<AiPanel ticker="GOOG" account={ME} />)
    expect(screen.getByRole('heading', { name: '내 AI 키 넣기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 정리 받기' })).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('탭을 여는 것만으로는 부르지 않고, 누르면 받아 보여주고 남겨둔다', async () => {
    withKey()
    const analyze = vi.spyOn(api, 'aiAnalyze').mockResolvedValue(RESULT)
    const user = userEvent.setup()
    render(<AiPanel ticker="GOOG" account={ME} />)
    expect(analyze).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'AI 정리 받기' }))
    expect(analyze).toHaveBeenCalledWith('GOOG', 'anthropic', 'claude-x', KEY)
    expect(await screen.findByRole('heading', { name: '한눈에 보기' })).toBeInTheDocument()
    expect(screen.getByText(/2026-09-25 종가까지/)).toHaveTextContent('토큰 1,500 + 900')
    expect(screen.getByText(/투자 권유가 아니고/)).toBeInTheDocument()
    expect(readAiResult(ME, 'GOOG')?.text).toBe(RESULT.text)
    expect(screen.getByRole('button', { name: '다시 받기' })).toBeInTheDocument()
  })

  it('다시 열면 받아 둔 글을 먼저 보여준다 (돈을 다시 내지 않게)', () => {
    withKey()
    saveAiResult(ME, RESULT)
    const analyze = vi.spyOn(api, 'aiAnalyze')
    render(<AiPanel ticker="GOOG" account={ME} />)
    expect(screen.getByRole('heading', { name: '한눈에 보기' })).toBeInTheDocument()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('키가 틀렸다면 이유와 함께 키 입력을 펼친다', async () => {
    withKey()
    vi.spyOn(api, 'aiAnalyze').mockRejectedValue(
      new ApiError(400, 'AI 키가 맞지 않습니다.', 'anthropic HTTP 401', 'key_invalid'),
    )
    const user = userEvent.setup()
    render(<AiPanel ticker="GOOG" account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 정리 받기' }))
    expect(await screen.findByText('AI 키가 맞지 않습니다.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI 키 바꾸기' })).toBeInTheDocument()
  })

  it('잔액 부족처럼 키와 상관없는 오류는 이유만 보여준다', async () => {
    withKey()
    vi.spyOn(api, 'aiAnalyze').mockRejectedValue(new ApiError(402, '잔액이 부족합니다.', 'x', 'no_credit'))
    const user = userEvent.setup()
    render(<AiPanel ticker="GOOG" account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 정리 받기' }))
    expect(await screen.findByText('잔액이 부족합니다.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI 키 바꾸기' })).toBeNull()
  })

  it('보내는 내용을 펼치면 그대로 보여준다', async () => {
    const context = vi.spyOn(api, 'aiContext').mockResolvedValue({
      ticker: 'GOOG', as_of: '2026-09-25', system: '지시문 본문', prompt: '[가격]\n- 종가 100',
    })
    const user = userEvent.setup()
    render(<AiPanel ticker="GOOG" account={ME} />)
    await user.click(screen.getByText('AI 에게 보내는 내용 보기'))
    await waitFor(() => expect(context).toHaveBeenCalledWith('GOOG'))
    expect(await screen.findByText('지시문 본문')).toBeInTheDocument()
    expect(screen.getByText(/종가 100/)).toBeInTheDocument()
  })
})
