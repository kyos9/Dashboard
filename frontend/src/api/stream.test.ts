import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, UNAUTHORIZED_EVENT, api, takeSseEvents } from './client'
import type { AiAnalysis } from '../types'

const DONE: AiAnalysis = {
  scope: 'stock', ticker: 'GOOG', provider: 'anthropic', model: 'claude-x', text: '가나다', truncated: false,
  as_of: '2026-09-25', generated_at: '2026-09-26T01:00:00Z', input_tokens: 1, output_tokens: 2,
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** 바이트를 아무 데서나 잘라 조금씩 흘려주는 응답 — 한글 한 글자가 두 조각으로 갈라지기도 한다 */
function streamed(body: string, cuts: number[], status = 200): Response {
  const bytes = new TextEncoder().encode(body)
  const edges = [0, ...cuts, bytes.length]
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < edges.length - 1; i++) controller.enqueue(bytes.slice(edges[i], edges[i + 1]))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => vi.restoreAllMocks())

describe('SSE 나누기', () => {
  it('끝난 이벤트만 떼고 남은 조각은 다음으로 넘긴다', () => {
    const { events, rest } = takeSseEvents('event: a\ndata: 1\n\ndata: 첫\ndata: 둘\r\n\r\nevent: b\ndata: 반')
    expect(events).toEqual([{ event: 'a', data: '1' }, { event: 'message', data: '첫\n둘' }])
    expect(rest).toBe('event: b\ndata: 반')
  })
})

describe('AI 글 흘려받기', () => {
  const GOOG = { kind: 'stock', ticker: 'GOOG' } as const

  it('조각이 어디서 잘려 와도 순서대로 붙이고, done 으로 끝난다', async () => {
    const body = sse('start', { provider: 'anthropic', model: 'm', as_of: '2026-09-25' }) +
      sse('delta', { text: '가나' }) + sse('delta', { text: '다' }) + sse('done', DONE)
    const bytes = new TextEncoder().encode(body).length
    // 1바이트 간격으로 잘라도 (한글 3바이트가 갈라진다)
    const cuts = Array.from({ length: bytes - 1 }, (_, i) => i + 1)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed(body, cuts))
    const pieces: string[] = []
    const onStart = vi.fn()
    const got = await api.aiAnalyzeStream(GOOG, 'anthropic', 'm', 'sk-key-1234', ' 짧게 ', {
      onStart, onDelta: (t) => pieces.push(t),
    })
    expect(pieces.join('')).toBe('가나다')
    expect(onStart).toHaveBeenCalledWith({ provider: 'anthropic', model: 'm', as_of: '2026-09-25' })
    expect(got).toEqual(DONE)
    const [url, init = {}] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ai/analyze/GOOG/stream')
    expect((init.headers as Record<string, string>)['X-AI-Key']).toBe('sk-key-1234')
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'anthropic', model: 'm', question: '짧게' })
    // 키는 본문에 없다
    expect(String(init.body)).not.toContain('sk-key-1234')
  })

  it('전체·매크로 정리는 각자의 주소로 간다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockImplementation(async () => streamed(sse('done', DONE), []))
    await api.aiAnalyzeStream({ kind: 'watchlist' }, 'openai', 'm', 'k'.repeat(10), '', { onDelta: () => {} })
    await api.aiAnalyzeStream({ kind: 'macro' }, 'openai', 'm', 'k'.repeat(10), '', { onDelta: () => {} })
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/ai/watchlist/stream', '/api/ai/macro/stream'])
  })

  it('도중의 error 이벤트는 ApiError 로 — 안내와 코드를 그대로', async () => {
    const body = sse('delta', { text: '앞' }) +
      sse('error', { hint: '과부하입니다', message: 'anthropic HTTP 200: busy', code: 'overloaded', status: 502 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed(body, [5]))
    const pieces: string[] = []
    const run = api.aiAnalyzeStream(GOOG, 'anthropic', 'm', 'k'.repeat(10), '', { onDelta: (t) => pieces.push(t) })
    await expect(run).rejects.toMatchObject({ status: 502, hint: '과부하입니다', code: 'overloaded' })
    expect(pieces).toEqual(['앞'])
  })

  it('done 없이 끊기면 끊겼다고 알린다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed(sse('delta', { text: '앞' }), []))
    const run = api.aiAnalyzeStream(GOOG, 'anthropic', 'm', 'k'.repeat(10), '', { onDelta: () => {} })
    await expect(run).rejects.toBeInstanceOf(ApiError)
    await expect(run).rejects.toMatchObject({ code: 'cut' })
  })

  it('글을 쓰기 전의 거절은 평소 오류(JSON)와 같다 — 401 은 로그인이 풀린 것', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: { hint: '키가 맞지 않습니다', message: 'x', code: 'key_invalid' } }), { status: 400 }),
    )
    await expect(
      api.aiAnalyzeStream(GOOG, 'anthropic', 'm', 'k'.repeat(10), '', { onDelta: () => {} }),
    ).rejects.toMatchObject({ status: 400, code: 'key_invalid', hint: '키가 맞지 않습니다' })

    const loggedOut = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, loggedOut)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"login"}', { status: 401 }))
    await expect(api.aiAnalyzeStream(GOOG, 'anthropic', 'm', 'k'.repeat(10), '', { onDelta: () => {} })).rejects.toThrow()
    expect(loggedOut).toHaveBeenCalled()
    window.removeEventListener(UNAUTHORIZED_EVENT, loggedOut)
  })

  it('흘려받기를 못 하는 브라우저에서도 다 온 뒤에 같은 결과', async () => {
    const body = sse('delta', { text: '가' }) + sse('done', DONE)
    const res = new Response(body, { status: 200 })
    Object.defineProperty(res, 'body', { value: null })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res)
    const pieces: string[] = []
    expect(await api.aiAnalyzeStream(GOOG, 'anthropic', 'm', 'k'.repeat(10), '', { onDelta: (t) => pieces.push(t) })).toEqual(DONE)
    expect(pieces).toEqual(['가'])
  })

  it('멈추기 신호를 fetch 에 넘긴다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed(sse('done', DONE), []))
    const controller = new AbortController()
    await api.aiAnalyzeStream(GOOG, 'anthropic', 'm', 'k'.repeat(10), '', { onDelta: () => {}, signal: controller.signal })
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})
