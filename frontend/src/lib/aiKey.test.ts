import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { AiAnalysis } from '../types'
import {
  aiTargetKey,
  clearAi,
  maskKey,
  readAiQuestion,
  readAiResult,
  saveAiQuestion,
  readAiSettings,
  saveAiResult,
  saveAiSettings,
  useAiSettings,
  type AiSettings,
} from './aiKey'

const MINE: AiSettings = {
  provider: 'anthropic', key: 'sk-ant-secret-1234', model: 'claude-x', remember: true, account: 'a@example.com',
}

function result(ticker: string, text = '정리'): AiAnalysis {
  return {
    scope: 'stock', ticker, provider: 'anthropic', model: 'claude-x', text, truncated: false, as_of: '2026-09-25',
    generated_at: '2026-09-26T01:00:00Z', input_tokens: 1, output_tokens: 2,
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('AI 키 보관', () => {
  it('기억을 켜면 localStorage, 끄면 sessionStorage 에만 둔다', () => {
    saveAiSettings(MINE)
    expect(localStorage.getItem('signalboard:ai-key')).toContain('sk-ant-secret-1234')
    expect(sessionStorage.getItem('signalboard:ai-key')).toBeNull()

    saveAiSettings({ ...MINE, remember: false })
    expect(localStorage.getItem('signalboard:ai-key')).toBeNull()
    expect(readAiSettings('a@example.com')?.remember).toBe(false)
  })

  it('다른 계정의 키는 없는 것이다 — 남의 잔액으로 정리를 받지 않게', () => {
    saveAiSettings(MINE)
    expect(readAiSettings('a@example.com')?.key).toBe('sk-ant-secret-1234')
    expect(readAiSettings('b@example.com')).toBeNull()
  })

  it('지우면 키와 받아 둔 글, 적어 둔 요청이 함께 사라진다', () => {
    saveAiSettings(MINE)
    saveAiResult('a@example.com', 'VOO', result('VOO'))
    saveAiQuestion('a@example.com', '쉽게')
    clearAi()
    expect(readAiQuestion('a@example.com')).toBe('')
    expect(readAiSettings('a@example.com')).toBeNull()
    expect(readAiResult('a@example.com', 'VOO')).toBeNull()
  })

  it('끝 네 자리만 보여준다', () => {
    expect(maskKey('sk-ant-secret-1234')).toBe('…1234')
    expect(maskKey('abc')).toBe('…')
  })

  it('다른 화면에서 저장·삭제하면 구독한 쪽도 바뀐다', () => {
    const { result: hook } = renderHook(() => useAiSettings('a@example.com'))
    expect(hook.current).toBeNull()
    act(() => saveAiSettings(MINE))
    expect(hook.current?.model).toBe('claude-x')
    act(() => clearAi())
    expect(hook.current).toBeNull()
  })
})

describe('받아 둔 정리 글', () => {
  it('종목마다 마지막 것 하나, 계정별로', () => {
    saveAiResult('a@example.com', 'VOO', result('VOO', '첫'))
    saveAiResult('a@example.com', 'VOO', result('VOO', '둘'))
    expect(readAiResult('a@example.com', 'VOO')?.text).toBe('둘')
    expect(readAiResult('b@example.com', 'VOO')).toBeNull()
    // 다른 계정이 저장하면 앞사람 것은 버린다
    saveAiResult('b@example.com', 'QQQ', result('QQQ'))
    expect(readAiResult('a@example.com', 'VOO')).toBeNull()
  })

  it('스무 종목까지만 — 오래된 것부터 버린다', () => {
    for (let i = 0; i < 22; i++) saveAiResult('a@example.com', `T${i}`, result(`T${i}`))
    expect(readAiResult('a@example.com', 'T0')).toBeNull()
    expect(readAiResult('a@example.com', 'T1')).toBeNull()
    expect(readAiResult('a@example.com', 'T2')).not.toBeNull()
    expect(readAiResult('a@example.com', 'T21')).not.toBeNull()
  })
})

describe('전체·매크로 정리 (3c-2)', () => {
  it('받아 둔 글은 티커와 겹치지 않는 이름으로 따로 둔다', () => {
    expect(aiTargetKey({ kind: 'stock', ticker: 'VOO' })).toBe('VOO')
    expect(aiTargetKey({ kind: 'watchlist' })).toBe('@watchlist')
    expect(aiTargetKey({ kind: 'macro' })).toBe('@macro')
    saveAiResult('a@example.com', '@macro', { ...result('VOO', '매크로 글'), scope: 'macro', ticker: null })
    expect(readAiResult('a@example.com', '@macro')?.text).toBe('매크로 글')
    expect(readAiResult('a@example.com', 'VOO')).toBeNull()
  })

  it('요청은 정리의 종류마다 하나 — 매크로의 "금리만"이 종목 정리로 따라가지 않는다', () => {
    saveAiQuestion('a@example.com', '쉽게')
    saveAiQuestion('a@example.com', '금리만', 'macro')
    expect(readAiQuestion('a@example.com')).toBe('쉽게')
    expect(readAiQuestion('a@example.com', 'macro')).toBe('금리만')
    expect(readAiQuestion('a@example.com', 'watchlist')).toBe('')
    saveAiQuestion('a@example.com', '', 'macro')
    expect(readAiQuestion('a@example.com', 'macro')).toBe('')
    expect(readAiQuestion('a@example.com')).toBe('쉽게')
    saveAiQuestion('a@example.com', '')
    expect(localStorage.getItem('signalboard:ai-question')).toBeNull()
  })

  it('예전(v0.25.1)에 적어 둔 요청은 종목 정리의 요청으로 이어진다', () => {
    localStorage.setItem('signalboard:ai-question', JSON.stringify({ account: 'a@example.com', text: '예전 요청' }))
    expect(readAiQuestion('a@example.com')).toBe('예전 요청')
    expect(readAiQuestion('a@example.com', 'macro')).toBe('')
    saveAiQuestion('a@example.com', '금리만', 'macro')
    expect(readAiQuestion('a@example.com')).toBe('예전 요청')
  })
})
