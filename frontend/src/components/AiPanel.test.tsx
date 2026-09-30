import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import {
  QUESTION_MAX,
  readAiQuestion,
  readAiResult,
  readAiSettings,
  saveAiResult,
  saveAiSettings,
} from '../lib/aiKey'
import type { AiStreamHandlers } from '../api/client'
import type { AiAnalysis } from '../types'
import { AiKeyForm } from './AiKeyForm'
import { AiPanel } from './AiPanel'

const ME = 'a@example.com'
const KEY = 'sk-ant-secret-1234'

const GOOG = { kind: 'stock', ticker: 'GOOG' } as const

const RESULT: AiAnalysis = {
  scope: 'stock', ticker: 'GOOG', provider: 'anthropic', model: 'claude-x', text: '## 한눈에 보기\n- 종가가 MA20 아래',
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

describe('AI 분석 탭', () => {
  it('키가 없으면 키 넣기부터 — 부르지 않는다', () => {
    const analyze = vi.spyOn(api, 'aiAnalyzeStream')
    render(<AiPanel target={GOOG} account={ME} />)
    expect(screen.getByRole('heading', { name: '내 AI 키 넣기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 분석 받기' })).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('탭을 여는 것만으로는 부르지 않고, 누르면 받아 보여주고 남겨둔다', async () => {
    withKey()
    const analyze = vi.spyOn(api, 'aiAnalyzeStream').mockResolvedValue(RESULT)
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    expect(analyze).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(analyze).toHaveBeenCalledWith(GOOG, 'anthropic', 'claude-x', KEY, '', expect.anything())
    expect(await screen.findByRole('heading', { name: '한눈에 보기' })).toBeInTheDocument()
    expect(screen.getByText(/2026-09-25 종가까지/)).toHaveTextContent('토큰 1,500 + 900')
    expect(screen.getByText(/투자 권유가 아니고/)).toBeInTheDocument()
    expect(readAiResult(ME, 'GOOG')?.text).toBe(RESULT.text)
    expect(screen.getByRole('button', { name: '다시 받기' })).toBeInTheDocument()
  })

  it('다시 열면 받아 둔 글을 먼저 보여준다 (돈을 다시 내지 않게)', () => {
    withKey()
    saveAiResult(ME, 'GOOG', RESULT)
    const analyze = vi.spyOn(api, 'aiAnalyzeStream')
    render(<AiPanel target={GOOG} account={ME} />)
    expect(screen.getByRole('heading', { name: '한눈에 보기' })).toBeInTheDocument()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('키가 틀렸다면 이유와 함께 키 입력을 펼친다', async () => {
    withKey()
    vi.spyOn(api, 'aiAnalyzeStream').mockRejectedValue(
      new ApiError(400, 'AI 키가 맞지 않습니다.', 'anthropic HTTP 401', 'key_invalid'),
    )
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(await screen.findByText('AI 키가 맞지 않습니다.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI 키 바꾸기' })).toBeInTheDocument()
  })

  it('잔액 부족처럼 키와 상관없는 오류는 이유만 보여준다', async () => {
    withKey()
    vi.spyOn(api, 'aiAnalyzeStream').mockRejectedValue(new ApiError(402, '잔액이 부족합니다.', 'x', 'no_credit'))
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(await screen.findByText('잔액이 부족합니다.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI 키 바꾸기' })).toBeNull()
  })

  it('내 요청을 붙여 부르고, 받은 글 위에 그 요청을 적는다', async () => {
    withKey()
    const analyze = vi.spyOn(api, 'aiAnalyzeStream').mockResolvedValue({ ...RESULT, question: '다섯 줄로 짧게' })
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    // 예시를 누르면 칸이 채워진다
    await user.click(screen.getByRole('button', { name: '다섯 줄로 짧게' }))
    expect(screen.getByLabelText(/내 요청/)).toHaveValue('다섯 줄로 짧게')
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(analyze).toHaveBeenCalledWith(GOOG, 'anthropic', 'claude-x', KEY, '다섯 줄로 짧게', expect.anything())
    expect(await screen.findByText('다섯 줄로 짧게', { selector: '.ai-asked' })).toBeInTheDocument()
  })

  it('요청은 이 기기에 기억해 다른 종목에서도 이어 쓴다 (계정별)', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AiPanel target={GOOG} account={ME} />)
    await user.type(screen.getByLabelText(/내 요청/), '재무 위주로')
    unmount()
    render(<AiPanel target={{ kind: 'stock', ticker: 'VOO' }} account={ME} />)
    expect(screen.getByLabelText(/내 요청/)).toHaveValue('재무 위주로')
    expect(readAiQuestion('b@example.com')).toBe('')
  })

  it('너무 긴 요청은 보내지 않는다', async () => {
    withKey()
    const analyze = vi.spyOn(api, 'aiAnalyzeStream')
    render(<AiPanel target={GOOG} account={ME} />)
    fireEvent.change(screen.getByLabelText(/내 요청/), { target: { value: '가'.repeat(QUESTION_MAX + 1) } })
    expect(screen.getByRole('button', { name: 'AI 분석 받기' })).toBeDisabled()
    expect(screen.getByText(`${(QUESTION_MAX + 1).toLocaleString('ko-KR')}/${QUESTION_MAX.toLocaleString('ko-KR')}`)).toHaveClass('error-inline')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('보내는 내용에는 지금 적은 요청까지 들어간다', async () => {
    const context = vi.spyOn(api, 'aiContext').mockResolvedValue({
      scope: 'stock', ticker: 'GOOG', as_of: null, system: 's', prompt: '[사용자의 요청]\n쉽게',
    })
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    await user.type(screen.getByLabelText(/내 요청/), '쉽게')
    await user.click(screen.getByText('AI 에게 보내는 내용 보기'))
    await waitFor(() => expect(context).toHaveBeenCalledWith(GOOG, '쉽게'))
    // 요청을 바꾸면 다시 받아야 한다
    await user.type(screen.getByLabelText(/내 요청/), '!')
    await user.click(await screen.findByRole('button', { name: '지금 요청을 넣어 다시 보기' }))
    await waitFor(() => expect(context).toHaveBeenLastCalledWith(GOOG, '쉽게!'))
  })

  it('보내는 내용을 펼치면 그대로 보여준다', async () => {
    const context = vi.spyOn(api, 'aiContext').mockResolvedValue({
      scope: 'stock', ticker: 'GOOG', as_of: '2026-09-25', system: '지시문 본문', prompt: '[가격]\n- 종가 100',
    })
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    await user.click(screen.getByText('AI 에게 보내는 내용 보기'))
    await waitFor(() => expect(context).toHaveBeenCalledWith(GOOG, ''))
    expect(await screen.findByText('지시문 본문')).toBeInTheDocument()
    expect(screen.getByText(/종가 100/)).toBeInTheDocument()
  })
})

/** 써지는 대로 오는 답을 흉내 낸다 — 조각을 보내고, 끝낼지 멈출지는 테스트가 정한다 */
function streaming() {
  let handlers: AiStreamHandlers | null = null
  let finish: (value: AiAnalysis) => void = () => {}
  let fail: (e: unknown) => void = () => {}
  const spy = vi.spyOn(api, 'aiAnalyzeStream').mockImplementation((...args) => {
    handlers = args[5]
    return new Promise<AiAnalysis>((resolve, reject) => {
      finish = resolve
      fail = reject
      handlers?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  })
  return {
    spy,
    send: (text: string) => act(() => handlers?.onDelta(text)),
    search: (count: number, reset: boolean) => act(() => handlers?.onSearch?.({ count, reset })),
    start: () => act(() => handlers?.onStart?.({ provider: 'anthropic', model: 'claude-x-0925', as_of: '2026-09-25' })),
    finish: (value: AiAnalysis) => act(() => finish(value)),
    fail: (e: unknown) => act(() => fail(e)),
    aborted: () => handlers?.signal?.aborted ?? false,
  }
}

describe('써지는 대로 보이기 (3c-2)', () => {
  it('받는 대로 붙이고, 다 쓰면 다 쓴 글로 바꿔 남긴다', async () => {
    withKey()
    const s = streaming()
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(screen.getByText(/글이 써지는 대로 여기에 보입니다/)).toBeInTheDocument()
    s.start()
    s.send('## 한눈')
    s.send('에 보기\n- 첫 줄')
    expect(screen.getByRole('heading', { name: '한눈에 보기' })).toBeInTheDocument()
    expect(screen.getByText('첫 줄')).toBeInTheDocument()
    expect(screen.getByText('쓰는 중…')).toBeInTheDocument()
    expect(screen.getByText(/claude-x-0925/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '■ 멈추기' })).toBeInTheDocument()
    expect(readAiResult(ME, 'GOOG')).toBeNull()

    s.finish(RESULT)
    expect(await screen.findByText(/토큰 1,500 \+ 900/)).toBeInTheDocument()
    expect(screen.queryByText('쓰는 중…')).toBeNull()
    expect(readAiResult(ME, 'GOOG')?.text).toBe(RESULT.text)
    expect(screen.getByRole('button', { name: '다시 받기' })).toBeInTheDocument()
  })

  it('멈추면 연결을 끊고, 쓴 데까지는 남기되 저장하지 않는다', async () => {
    withKey()
    saveAiResult(ME, 'GOOG', { ...RESULT, text: '## 지난 글' })
    const s = streaming()
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    await user.click(screen.getByRole('button', { name: '다시 받기' }))
    s.send('## 새로 쓰던 글')
    await user.click(screen.getByRole('button', { name: '■ 멈추기' }))
    expect(s.aborted()).toBe(true)
    expect(await screen.findByText(/끝까지 쓰지 않은 글입니다/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '새로 쓰던 글' })).toBeInTheDocument()
    // 멈춘 것은 오류가 아니다 — 오류 안내가 뜨지 않는다
    expect(screen.queryByRole('button', { name: '오류 메시지 닫기' })).toBeNull()
    expect(readAiResult(ME, 'GOOG')?.text).toBe('## 지난 글')
    await user.click(screen.getByRole('button', { name: '지난 글 보기' }))
    expect(screen.getByRole('heading', { name: '지난 글' })).toBeInTheDocument()
  })

  it('도중에 오류가 나면 쓴 데까지와 이유를 같이 보여준다', async () => {
    withKey()
    const s = streaming()
    const user = userEvent.setup()
    render(<AiPanel target={GOOG} account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    s.send('- 앞부분')
    s.fail(new ApiError(502, 'AI 제공자가 지금 바쁩니다(과부하).', 'x', 'overloaded'))
    expect(await screen.findByText('AI 제공자가 지금 바쁩니다(과부하).')).toBeInTheDocument()
    expect(screen.getByText('앞부분')).toBeInTheDocument()
    expect(screen.getByText(/끝까지 쓰지 않은 글입니다/)).toBeInTheDocument()
  })

  it('창을 닫으면 받던 것도 멈춘다 — 아무도 안 보는 글에 요금이 나가지 않게', async () => {
    withKey()
    const s = streaming()
    const user = userEvent.setup()
    const { unmount } = render(<AiPanel target={GOOG} account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    unmount()
    expect(s.aborted()).toBe(true)
  })
})

describe('담은 종목 전체 · 매크로 정리 (3c-2)', () => {
  it('전체 정리는 보유를 보내지 않는다고 밝히고, 따로 부르고 따로 남긴다', async () => {
    withKey()
    saveAiResult(ME, 'GOOG', RESULT)
    const analyze = vi
      .spyOn(api, 'aiAnalyzeStream')
      .mockResolvedValue({ ...RESULT, scope: 'watchlist', ticker: null, text: '## 종목별 한 줄' })
    const user = userEvent.setup()
    render(<AiPanel target={{ kind: 'watchlist' }} account={ME} />)
    expect(screen.getByText(/보유수량·비중·평단가는 보내지 않습니다/)).toBeInTheDocument()
    // 종목 정리의 글이 여기 섞이지 않는다
    expect(screen.queryByRole('heading', { name: '한눈에 보기' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '종목별로 한 줄씩만' }))
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(analyze).toHaveBeenCalledWith({ kind: 'watchlist' }, 'anthropic', 'claude-x', KEY, '종목별로 한 줄씩만', expect.anything())
    expect(await screen.findByRole('heading', { name: '종목별 한 줄' })).toBeInTheDocument()
    expect(readAiResult(ME, '@watchlist')?.text).toBe('## 종목별 한 줄')
    expect(readAiResult(ME, 'GOOG')?.text).toBe(RESULT.text)
    // 요청은 종류마다 — 종목 정리로 따라가지 않는다
    expect(readAiQuestion(ME)).toBe('')
    expect(readAiQuestion(ME, 'watchlist')).toBe('종목별로 한 줄씩만')
  })

  it('매크로 정리는 "발표된 지표" 기준으로 적는다', () => {
    withKey()
    saveAiResult(ME, '@macro', { ...RESULT, scope: 'macro', ticker: null })
    render(<AiPanel target={{ kind: 'macro' }} account={ME} />)
    expect(screen.getByText(/2026-09-25까지 발표된 지표/)).toBeInTheDocument()
    expect(screen.queryByText(/종가까지/)).toBeNull()
    expect(screen.getByText(/앞으로의 방향은 점치지 않도록/)).toBeInTheDocument()
  })
})

describe('종목 분석의 웹 검색 (9-13)', () => {
  const RESEARCH = { kind: 'research', ticker: 'GOOG' } as const
  const DONE: AiAnalysis = {
    ...RESULT, scope: 'research', text: '## 1. 기업 개요\n- 업종 평균 PER 24배 (예시, 2026년 9월)', web_searches: 3,
    sources: [
      { url: 'https://news.example.org/a', title: '기사 A — 아주 긴 제목이라도 줄을 바꿔 다 보인다' },
      { url: 'https://b.example/peers', title: '경쟁사 표' },
    ],
  }

  it('찾는 동안 그렇다고 알리고, 찾기 전 머리말은 지우고, 다 쓰면 찾아본 자료를 링크로 붙인다', async () => {
    withKey()
    const s = streaming()
    const user = userEvent.setup()
    render(<AiPanel target={RESEARCH} account={ME} />)
    expect(screen.getByText(/AI 가 웹에서 찾아 출처와 함께 적습니다/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(screen.getByText(/웹에서 비교할 자료를 찾고 있습니다/)).toBeInTheDocument()
    s.send('업종 평균을 검색해 보겠습니다.')
    expect(screen.getByText('업종 평균을 검색해 보겠습니다.')).toBeInTheDocument()
    s.search(1, true)
    expect(screen.queryByText('업종 평균을 검색해 보겠습니다.')).toBeNull()
    expect(screen.getByText('웹에서 자료를 찾는 중… (1번째 검색)')).toBeInTheDocument()
    s.search(2, false)
    expect(screen.getByText('웹에서 자료를 찾는 중… (2번째 검색)')).toBeInTheDocument()
    s.send('## 1. 기업 개요')
    expect(screen.getByText('쓰는 중…')).toBeInTheDocument()

    s.finish(DONE)
    expect(await screen.findByRole('heading', { name: /AI 가 찾아본 자료/ })).toBeInTheDocument()
    expect(screen.getByText('웹 검색 3번')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /기사 A/ })
    expect(link).toHaveAttribute('href', 'https://news.example.org/a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(readAiResult(ME, '@research:GOOG')?.sources).toHaveLength(2)
  })

  it('검색을 했는데 출처가 없으면 그렇다고 적는다', () => {
    withKey()
    saveAiResult(ME, '@research:GOOG', { ...DONE, web_searches: 0, sources: [] })
    render(<AiPanel target={RESEARCH} account={ME} />)
    expect(screen.getByText('웹 검색 0번')).toBeInTheDocument()
    expect(screen.getByText(/출처가 없습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('검색하지 않는 정리에는 찾아본 자료 칸이 없다', () => {
    withKey()
    saveAiResult(ME, 'GOOG', RESULT)
    render(<AiPanel target={GOOG} account={ME} />)
    expect(screen.queryByRole('heading', { name: /AI 가 찾아본 자료/ })).toBeNull()
  })

  it('검색을 못 쓰는 모델이면 이유와 함께 키·모델 바꾸기를 펼친다', async () => {
    withKey()
    vi.spyOn(api, 'aiAnalyzeStream').mockRejectedValue(
      new ApiError(400, '고른 모델이나 계정에서 웹 검색을 쓸 수 없어 요청이 거절됐습니다.', 'x', 'search_unavailable'),
    )
    const user = userEvent.setup()
    render(<AiPanel target={RESEARCH} account={ME} />)
    await user.click(screen.getByRole('button', { name: 'AI 분석 받기' }))
    expect(await screen.findByText(/웹 검색을 쓸 수 없어/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI 키 바꾸기' })).toBeInTheDocument()
  })
})
