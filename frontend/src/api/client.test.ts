import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiPath, api, ApiError, UNAUTHORIZED_EVENT } from './client'

interface FakeResponse {
  ok?: boolean
  status?: number
  statusText?: string
  /** 응답 본문 (Response.body와 타입이 달라 이름을 따로 둔다) */
  text?: string
}

function mockFetch({ text = '', ok, status = 200, statusText = 'OK' }: FakeResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: ok ?? status < 400,
      status,
      statusText,
      text: async () => text,
      json: async () => JSON.parse(text || '{}'),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('오류 응답 해석', () => {
  it('백엔드의 hint/message를 나눠 담는다', async () => {
    // 이렇게 나뉘어야 화면에서 "할 일"을 앞세우고 기술적 원인은 접어둘 수 있다
    mockFetch({
      status: 502,
      statusText: 'Bad Gateway',
      text: JSON.stringify({
        detail: {
          hint: '네트워크에서 시세 서버로 나가지 못하고 있습니다.',
          message: 'VOO 시세를 받지 못했습니다 — yahoo: 403',
        },
      }),
    })

    const error = await api.getDashboard().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(502)
    expect(error.hint).toBe('네트워크에서 시세 서버로 나가지 못하고 있습니다.')
    expect(error.detail).toContain('yahoo: 403')
    // message는 사용자에게 먼저 보일 문장이어야 한다
    expect(error.message).toBe('네트워크에서 시세 서버로 나가지 못하고 있습니다.')
  })

  it('detail이 문자열이면 그대로 기술적 원인으로 쓴다', async () => {
    mockFetch({
      status: 409,
      statusText: 'Conflict',
      text: JSON.stringify({ detail: 'VOO already exists' }),
    })

    const error = await api.getDashboard().catch((e) => e)
    expect(error.hint).toBeNull()
    expect(error.detail).toBe('VOO already exists')
  })

  it('422 의 detail 목록은 칸 이름 + 범위의 한국어 한 줄 — 영어 JSON 원문을 보이지 않는다 (0.44.0 C2)', async () => {
    mockFetch({
      status: 422,
      statusText: 'Unprocessable Entity',
      text: JSON.stringify({
        detail: [
          { type: 'less_than_equal', loc: ['body', 'items', 0, 'rebalance_band_pct'], msg: 'Input should be less than or equal to 100', input: 201, ctx: { le: 100 } },
          { type: 'greater_than_equal', loc: ['body', 'items', 1, 'quantity'], msg: 'Input should be greater than or equal to 0', input: -1, ctx: { ge: 0 } },
          { type: 'less_than_equal', loc: ['body', 'items', 2, 'rebalance_band_pct'], msg: 'Input should be less than or equal to 100', input: 300, ctx: { le: 100 } },
        ],
      }),
    })

    const error = await api.getDashboard().catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    // 같은 칸의 같은 말은 한 번만
    expect(error.message).toBe('입력값을 확인해 주세요 — 밴드는 100 이하여야 합니다 · 수량은 0 이상이어야 합니다')
    expect(error.message).not.toMatch(/Input should|\{/)
    // 기술적 원인은 영어 msg 만 이어 붙인 것 — JSON 원문(본문 전체)이 아니다
    expect(error.detail).toBe(
      'Input should be less than or equal to 100; Input should be greater than or equal to 0; Input should be less than or equal to 100',
    )
  })

  it('422 범위 말 — 양쪽 범위·글자 수·빠진 값·숫자 아님·모르는 칸', async () => {
    const cases: [object, string][] = [
      [{ type: 'less_than_equal', loc: ['body', 'target_weight_pct'], ctx: { ge: 0, le: 100 } }, '목표 비중은 0~100 사이여야 합니다'],
      [{ type: 'string_too_long', loc: ['body', 'note'], ctx: { max_length: 200 } }, '메모는 200자 이하여야 합니다'],
      [{ type: 'missing', loc: ['body', 'quantity'] }, '수량은 필요합니다'],
      [{ type: 'float_parsing', loc: ['body', 'avg_cost'] }, '평단가는 숫자여야 합니다'],
      [{ type: 'greater_than', loc: ['body', 'avg_fx'], ctx: { gt: 0 } }, '산 환율은 0보다 커야 합니다'],
      [{ type: 'value_error', loc: ['body', 'mystery'] }, '입력값은 올바르지 않습니다'],
      [{ type: 'less_than', loc: ['body', 'quantity'], ctx: { lt: 10 } }, '수량은 10보다 작아야 합니다'],
    ]
    for (const [item, line] of cases) {
      mockFetch({ status: 422, text: JSON.stringify({ detail: [item] }) })
      const error = await api.getDashboard().catch((e) => e)
      expect(error.message).toBe(`입력값을 확인해 주세요 — ${line}`)
    }
  })

  it('422 의 msg 가 없는 칸은 기술적 원인에서 빠진다 — 빈 칸이 "; ;" 로 남지 않는다', async () => {
    mockFetch({
      status: 422,
      text: JSON.stringify({
        detail: [
          { type: 'missing', loc: ['body', 'quantity'] },
          { type: 'greater_than', loc: ['body', 'avg_fx'], msg: 'Input should be greater than 0', ctx: { gt: 0 } },
        ],
      }),
    })
    const error = await api.getDashboard().catch((e) => e)
    expect(error.detail).toBe('Input should be greater than 0')
  })

  it('422 의 detail 이 빈 목록이면 한국어 한 줄을 만들지 않는다 — 칸 없는 "입력값을 확인해 주세요 — " 가 뜨지 않는다', async () => {
    const body = JSON.stringify({ detail: [] })
    mockFetch({ status: 422, statusText: 'Unprocessable Entity', text: body })
    const error = await api.getDashboard().catch((e) => e)
    expect(error.message).not.toMatch(/입력값을 확인해 주세요/)
    expect(error.detail).toBe(body)
  })

  it('JSON이 아니면 본문을 그대로 보여준다', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error', text: '<html>500</html>' })

    const error = await api.getDashboard().catch((e) => e)
    expect(error.detail).toBe('<html>500</html>')
  })

  it('본문이 비어도 상태코드로 말이 되는 메시지를 만든다', async () => {
    mockFetch({ ok: false, status: 504, statusText: 'Gateway Timeout', text: '' })

    const error = await api.getDashboard().catch((e) => e)
    expect(error.detail).toBe('504 Gateway Timeout')
  })
})

describe('요청 경로', () => {
  it('종목 검색어를 URL 인코딩한다 (한글·공백이 깨지지 않게)', async () => {
    mockFetch({ text: '[]' })
    await api.searchSymbols('삼성 전자')

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain(encodeURIComponent('삼성 전자'))
    expect(url).toContain('/api/symbols/search')
  })

  it('204 응답은 본문을 파싱하지 않는다', async () => {
    mockFetch({ status: 204, text: '' })
    await expect(api.refreshStock('VOO')).resolves.toBeUndefined()
  })

  it('AI 정리마다의 주소 — 종목 정리는 옛 모양, 종목 분석은 research, 나머지는 종류 이름', () => {
    expect(aiPath({ kind: 'stock', ticker: '005930.KS' }, 'context')).toBe('/ai/context/005930.KS')
    expect(aiPath({ kind: 'stock', ticker: 'A/B' }, 'stream')).toBe('/ai/analyze/A%2FB/stream')
    expect(aiPath({ kind: 'research', ticker: 'NVDA' }, 'context')).toBe('/ai/research/NVDA/context')
    expect(aiPath({ kind: 'research', ticker: 'A/B' }, 'stream')).toBe('/ai/research/A%2FB/stream')
    expect(aiPath({ kind: 'portfolio' }, 'stream')).toBe('/ai/portfolio/stream')
    expect(aiPath({ kind: 'watchlist' }, 'context')).toBe('/ai/watchlist/context')
  })

  it('보내는 내용 보기에 요청을 붙인다', async () => {
    mockFetch({ text: '{}' })
    await api.aiContext({ kind: 'research', ticker: 'NVDA' }, '리스크만')
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(`/api/ai/research/NVDA/context?question=${encodeURIComponent('리스크만')}`)
  })
})

describe('세션이 끊겼을 때', () => {
  it('401이 오면 로그인 화면이 들을 수 있게 알린다', async () => {
    mockFetch({ status: 401, text: JSON.stringify({ detail: { hint: '로그인이 필요합니다.' } }) })
    const heard = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, heard)

    await expect(api.getDashboard()).rejects.toBeInstanceOf(ApiError)
    expect(heard).toHaveBeenCalled()

    window.removeEventListener(UNAUTHORIZED_EVENT, heard)
  })

  it('로그인 실패의 401은 알리지 않는다 — 로그인 화면이 직접 다룬다', async () => {
    mockFetch({ status: 401, text: JSON.stringify({ detail: { hint: '비밀번호가 틀렸습니다.' } }) })
    const heard = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, heard)

    await expect(api.login('틀린값')).rejects.toBeInstanceOf(ApiError)
    expect(heard).not.toHaveBeenCalled()

    window.removeEventListener(UNAUTHORIZED_EVENT, heard)
  })
})

describe('보유수량 저장', () => {
  it('평단가를 안 넘기면 보내지 않는다 — 서버는 보낸 칸만 바꾼다', async () => {
    mockFetch({ text: '{}' })
    await api.updateHolding('VOO', 3)
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ quantity: 3 })
  })

  it('null을 넘기면 "모름"으로 지우라고 보낸다', async () => {
    mockFetch({ text: '{}' })
    await api.updateHolding('VOO', 3, null)
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ quantity: 3, avg_cost: null })
  })
})
