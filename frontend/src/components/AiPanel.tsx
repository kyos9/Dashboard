import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api/client'
import {
  QUESTION_MAX,
  aiTargetKey,
  providerLabel,
  readAiQuestion,
  readAiResult,
  saveAiQuestion,
  saveAiResult,
  useAiSettings,
} from '../lib/aiKey'
import type { AiAnalysis, AiContext, AiProviderName, AiScope, AiTarget } from '../types'
import { AiKeyForm } from './AiKeyForm'
import { AiText } from './AiText'
import { ErrorNotice } from './ErrorNotice'

/** 정리의 종류마다 다른 글 — 무엇을 보내는지, 무엇을 물을 수 있는지 */
const COPY: Record<AiScope, { intro: string; examples: string[]; help: string; placeholder: string }> = {
  stock: {
    intro:
      '앱이 계산한 이 종목의 숫자(시세·지표·시그널·재무·시장 배경)를 AI 가 글로 풀어 줍니다. 사라·팔라는 말은 하지 않도록 요청합니다. 보유수량·비중 같은 내 포트폴리오는 보내지 않습니다.',
    examples: [
      '초보자도 알 수 있게 쉽게 설명해 줘',
      '재무 숫자 위주로 정리해 줘',
      '매수 시그널 네 조건이 각각 어떤 상태인지 자세히',
      '다섯 줄로 짧게',
    ],
    help: '무엇을 물어도 이 종목의 숫자를 보고 답하고, 사라·팔라는 판단이나 가격 예측은 하지 않습니다. 요청은 이 기기에 기억해 다른 종목에도 그대로 씁니다.',
    placeholder: '예: 최근 1년 흐름을 초보자도 알 수 있게 설명해 줘',
  },
  watchlist: {
    intro:
      '대시보드에 담은 종목 전체(활성 종목, 30개까지)의 공용 숫자를 AI 가 한 장으로 정리합니다. 보유수량·비중·평단가는 보내지 않습니다 — 담아 둔 목록의 숫자만 봅니다. 어느 종목을 고르라는 말은 하지 않도록 요청합니다.',
    examples: ['종목별로 한 줄씩만', '오늘 매수 시그널이 뜬 종목 위주로', '재무 숫자를 나란히 비교해 줘', '초보자도 알 수 있게 쉽게'],
    help: '무엇을 물어도 담은 종목의 숫자를 보고 답하고, 사라·팔라는 판단이나 순위 매기기, 가격 예측은 하지 않습니다.',
    placeholder: '예: 요즘 흐름이 비슷한 종목끼리 묶어서 정리해 줘',
  },
  portfolio: {
    intro:
      '내 포트폴리오의 비중(현재·목표·차이)·수익률·쏠림을 % 로만 AI 에게 보내 전체를 진단받습니다. 평가금액·수량·평단가·현금 액수는 보내지 않습니다. 무엇을 사고팔지는 정하지 않도록 요청합니다.',
    examples: ['쏠림 위주로 짧게', '목표와 차이가 큰 종목부터', '환율이 수익률에 준 영향만', '다섯 줄로 요약해 줘'],
    help: '무엇을 물어도 내 비중·수익률 숫자를 보고 답하고, 사고팔 종목이나 수량을 정하거나 가격을 예측하지는 않습니다.',
    placeholder: '예: 반도체·AI 쪽에 얼마나 몰려 있는지 봐 줘',
  },
  research: {
    intro:
      '이 종목의 재무(PER·PBR·ROE·FCF 수익률·3·5년 성장률 등)와 내 포트폴리오 비중(%)을 AI 에게 보내, 알파 버킷 편입 판단을 돕는 리포트를 받습니다. 앱에 없는 값(동종 업계 비교·선행 PER·최근 실적)은 AI 가 웹에서 찾아 출처와 함께 적습니다 — 검색 요금이 조금 더 나갑니다. 금액·수량은 보내지 않고, 검색어에 내 비중을 넣지 않게 합니다.',
    examples: ['리스크 위주로 자세히', '경쟁사와 비교를 자세히', '비슷한 익스포저가 있는지 먼저', '표 없이 짧게'],
    help: '숫자는 앱이 모은 것을 먼저 쓰고, 없는 값은 웹에서 찾아 출처를 붙이게 합니다. 찾지 못한 것만 "확인 필요"로 남습니다. 매수·매도를 단정하거나 목표주가를 내지는 않습니다.',
    placeholder: '예: 보유 중인 반도체 종목과 겹치는 부분을 자세히',
  },
  macro: {
    intro:
      '앱이 모아 둔 매크로 지표와 국면 배지를 AI 가 글로 풀어 줍니다. 각 지표가 무엇을 재는지, 지금 값이 어디쯤인지를 설명하고 앞으로의 방향은 점치지 않도록 요청합니다.',
    examples: ['초보자도 알 수 있게 쉽게 설명해 줘', '금리 지표만 자세히', '각 지표가 무엇을 재는지부터', '다섯 줄로 짧게'],
    help: '무엇을 물어도 지표의 숫자를 보고 답하고, 금리·주가가 어떻게 될지는 점치지 않습니다.',
    placeholder: '예: 장단기 금리차가 무엇인지부터 설명해 줘',
  },
}

/** 키를 다시 넣어야 풀리는 오류 — 이때는 키 입력을 바로 펼친다 */
// 키나 모델을 바꾸면 풀리는 문제 — 키·모델 칸을 열어 둔다 (모델 목록은 열자마자 불러온다)
const KEY_PROBLEMS = new Set([
  'key_invalid',
  'bad_key_shape',
  'model_denied',
  'search_unavailable',
  'free_tier_model',
  'daily_limit',
  'quota_exceeded',
])

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** 어느 시점의 숫자로 쓴 글인가 — 종목·진단·분석은 종가, 매크로는 발표된 지표 */
function basis(scope: AiScope, asOf: string | null): string {
  if (!asOf) return ''
  return scope === 'macro' ? `${asOf}까지 발표된 지표 · ` : `${asOf} 종가까지 · `
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError'
}

/** 받는 중이거나 도중에 멈춘 글 */
interface Draft {
  text: string
  provider: AiProviderName
  model: string
  as_of: string | null
  /** 멈추기·오류로 끝까지 쓰지 않았다 */
  cut: boolean
  /** 웹 검색을 몇 번 시작했나 (종목 분석, 9-13) */
  searches: number
}

/** AI 가 찾아본 곳 — 출처를 눌러 직접 확인할 수 있게. 새 창으로, 이 앱의 주소를 넘기지 않고 */
function Sources({ result }: { result: AiAnalysis }) {
  const sources = result.sources ?? []
  if (result.web_searches == null) return null
  return (
    <section className="ai-sources">
      <h5>
        AI 가 찾아본 자료 <span className="hint">웹 검색 {result.web_searches}번</span>
      </h5>
      {sources.length === 0 ? (
        <p className="hint">출처가 없습니다 — 글의 값 가운데 출처가 적히지 않은 것은 AI 가 확인하지 못한 것으로 보세요.</p>
      ) : (
        <ol>
          {sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * AI 정리 (ROADMAP 3c) — 종목 팝업의 "AI 분석" 탭, 대시보드의 "AI 전체 정리", 매크로의 "AI 정리".
 *
 * **써지는 대로 보인다 (3c-2).** 긴 글은 30초~1분 걸린다. 다 쓸 때까지 빈 화면을 두지 않고 받는
 * 대로 붙인다. **멈추기**(또는 팝업 닫기)를 누르면 서버가 AI 와의 연결을 끊어 더 쓰지 않는다 —
 * 요금은 그때까지 쓴 만큼이다. 멈춘 글은 화면에만 남기고 저장하지 않는다(끝까지 쓴 글이 아니다).
 *
 * **내 요청을 붙일 수 있다** — 비우면 정해진 형식의 정리, 넣으면 그 요청에 맞춰 답한다. 다만 서버의
 * 지시문(권유·예측·가치 판단 금지)은 요청이 무엇이든 그대로다. 요청은 정리의 종류마다 이 기기에
 * 하나 기억한다.
 *
 * **누를 때만 부른다** — 여는 것만으로 남의 돈(사용자의 키)이 나가면 안 된다. 받은 글은 이 기기에
 * 하나씩 남겨, 다시 열면 그걸 먼저 보여준다.
 */
export function AiPanel({ target, account }: { target: AiTarget; account: string }) {
  const scope = target.kind
  const copy = COPY[scope]
  const storeKey = aiTargetKey(target)
  const domId = storeKey.replace(/[^A-Za-z0-9_-]/g, '_')
  const settings = useAiSettings(account)
  const [result, setResult] = useState<AiAnalysis | null>(() => readAiResult(account, storeKey))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [editing, setEditing] = useState(false)
  const [context, setContext] = useState<AiContext | null>(null)
  const [contextError, setContextError] = useState<unknown>(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [question, setQuestion] = useState(() => readAiQuestion(account, scope))
  const alive = useRef(true)
  const running = useRef<AbortController | null>(null)
  const tooLong = question.trim().length > QUESTION_MAX

  function changeQuestion(text: string) {
    setQuestion(text)
    saveAiQuestion(account, text, scope)
    // 보내는 내용이 바뀌었다 — 펼쳐 볼 때 다시 받는다
    setContext(null)
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // 팝업을 닫으면 받던 것도 멈춘다 — 아무도 안 보는 글에 요금이 나가지 않게
      running.current?.abort()
    }
  }, [])

  async function run() {
    if (!settings) return
    const controller = new AbortController()
    running.current = controller
    setBusy(true)
    setError(null)
    setDraft({ text: '', provider: settings.provider, model: settings.model, as_of: null, cut: false, searches: 0 })
    try {
      const got = await api.aiAnalyzeStream(target, settings.provider, settings.model, settings.key, question, {
        signal: controller.signal,
        onStart: (info) => alive.current && setDraft((d) => d && { ...d, ...info }),
        onDelta: (text) => alive.current && setDraft((d) => d && { ...d, text: d.text + text }),
        // 찾기 전에 쓴 "찾아보겠습니다" 같은 머리말은 서버가 버렸다 — 화면에서도 지운다
        onSearch: ({ count, reset }) =>
          alive.current && setDraft((d) => d && { ...d, searches: count, text: reset ? '' : d.text }),
      })
      saveAiResult(account, storeKey, got)
      if (alive.current) {
        setResult(got)
        setDraft(null)
      }
    } catch (e) {
      if (!alive.current) return
      // 쓰던 글은 남긴다 — 멈췄든 끊겼든, 거기까지 읽은 것을 지우지 않는다
      setDraft((d) => (d && d.text.trim() ? { ...d, cut: true } : null))
      if (isAbort(e)) return
      setError(e)
      if (e instanceof ApiError && e.code && KEY_PROBLEMS.has(e.code)) setEditing(true)
    } finally {
      if (running.current === controller) running.current = null
      if (alive.current) setBusy(false)
    }
  }

  function stop() {
    running.current?.abort()
  }

  function loadContext() {
    if (context || tooLong || loadingContext) return
    setContextError(null)
    setLoadingContext(true)
    api
      .aiContext(target, question)
      .then((c) => alive.current && setContext(c))
      .catch((e) => alive.current && setContextError(e))
      .finally(() => alive.current && setLoadingContext(false))
  }

  return (
    <div className="ai-panel">
      <p className="hint ai-intro">{copy.intro}</p>

      {!settings || editing ? (
        <section className="ai-key-box">
          <h4>{settings ? 'AI 키 바꾸기' : '내 AI 키 넣기'}</h4>
          {!settings && (
            <p className="hint">
              AI 분석은 <b>본인의 AI 키</b>로 동작합니다. 키가 없어도 나머지 기능은 모두 그대로 쓸 수 있습니다.
            </p>
          )}
          <AiKeyForm
            account={account}
            onSaved={() => {
              // 키나 모델을 바꿨다 — 앞의 오류는 이제 맞지 않는다
              setEditing(false)
              setError(null)
            }}
          />
          {settings && (
            <button className="link-btn" onClick={() => setEditing(false)}>
              닫기
            </button>
          )}
        </section>
      ) : (
        <div className="ai-run">
          {busy ? (
            <button className="ghost" onClick={stop}>
              ■ 멈추기
            </button>
          ) : (
            <button className="primary" onClick={() => void run()} disabled={tooLong}>
              {result ? '다시 받기' : 'AI 분석 받기'}
            </button>
          )}
          <span className="hint ai-using">
            {providerLabel(settings.provider)} · <span className="mono">{settings.model}</span>{' '}
            {!busy && (
              <button className="link-btn" onClick={() => setEditing(true)}>
                키·모델 바꾸기
              </button>
            )}
          </span>
        </div>
      )}

      <section className="ai-question">
        <label htmlFor={`ai-question-${domId}`}>
          내 요청 <span className="hint">(선택 — 비우면 정해진 형식으로 정리합니다)</span>
        </label>
        <textarea
          id={`ai-question-${domId}`}
          value={question}
          onChange={(e) => changeQuestion(e.target.value)}
          rows={3}
          placeholder={copy.placeholder}
          aria-describedby={`ai-question-help-${domId}`}
        />
        <div className="ai-question-foot">
          <div className="chip-row ai-examples">
            {copy.examples.map((example) => (
              <button key={example} className="chip" onClick={() => changeQuestion(example)}>
                {example}
              </button>
            ))}
            {question && (
              <button className="chip" onClick={() => changeQuestion('')}>
                지우기
              </button>
            )}
          </div>
          <span className={`hint mono${tooLong ? ' error-inline' : ''}`}>
            {question.trim().length.toLocaleString('ko-KR')}/{QUESTION_MAX.toLocaleString('ko-KR')}
          </span>
        </div>
        <p id={`ai-question-help-${domId}`} className="hint">
          {copy.help}
        </p>
      </section>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {draft ? (
        <article className="ai-result" aria-label="AI 분석" aria-busy={busy}>
          <p className="hint ai-meta">
            {basis(scope, draft.as_of)}
            {providerLabel(draft.provider)} <span className="mono">{draft.model}</span> ·{' '}
            {busy ? (
              <span className="ai-writing">
                {draft.searches > 0 && !draft.text.trim() ? `웹에서 자료를 찾는 중… (${draft.searches}번째 검색)` : '쓰는 중…'}
              </span>
            ) : (
              <>
                <span className="error-inline">끝까지 쓰지 않은 글입니다 — 저장하지 않았습니다</span>
                {result && (
                  <>
                    {' '}
                    <button className="link-btn" onClick={() => setDraft(null)}>
                      지난 글 보기
                    </button>
                  </>
                )}
              </>
            )}
          </p>
          {draft.text.trim() ? (
            <AiText text={draft.text} />
          ) : (
            <p className="hint">
              {scope === 'research'
                ? 'AI 가 숫자를 읽고 웹에서 비교할 자료를 찾고 있습니다. 찾은 뒤에 글이 써지는 대로 여기에 보입니다 (보통 1~2분). '
                : 'AI 가 숫자를 읽고 있습니다. 글이 써지는 대로 여기에 보입니다 (다 쓰는 데 보통 20초~1분). '}
              멈추거나 창을 닫으면 거기서 멈추고, 그때까지 쓴 만큼만 요금이 나갑니다.
            </p>
          )}
          <p className="ai-disclaimer">
            AI 가 앱의 숫자를 풀어 쓴 참고 글이며 틀릴 수 있습니다. 투자 권유가 아니고, 판단과 책임은 본인에게
            있습니다.
          </p>
        </article>
      ) : (
        result && (
          <article className="ai-result" aria-label="AI 분석">
            <p className="hint ai-meta">
              {basis(scope, result.as_of)}
              {providerLabel(result.provider)} <span className="mono">{result.model}</span> · {when(result.generated_at)}
              {result.input_tokens != null &&
                result.output_tokens != null &&
                ` · 토큰 ${result.input_tokens.toLocaleString('ko-KR')} + ${result.output_tokens.toLocaleString('ko-KR')}`}
            </p>
            {result.question && (
              <p className="ai-asked">
                <span className="hint">내 요청</span> {result.question}
              </p>
            )}
            <AiText text={result.text} />
            {result.truncated && (
              <p className="hint">⚠ 길이 제한에 걸려 끝부분이 잘렸습니다. 다시 받거나 다른 모델을 골라 보세요.</p>
            )}
            <Sources result={result} />
            <p className="ai-disclaimer">
              AI 가 앱의 숫자를 풀어 쓴 참고 글이며 틀릴 수 있습니다. 투자 권유가 아니고, 판단과 책임은 본인에게
              있습니다.
            </p>
          </article>
        )
      )}

      <details className="ai-context" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadContext()}>
        <summary>AI 에게 보내는 내용 보기</summary>
        <ErrorNotice error={contextError} />
        {!context &&
          !contextError &&
          (loadingContext ? (
            <p className="hint">불러오는 중…</p>
          ) : (
            <button className="link-btn" onClick={loadContext} disabled={tooLong}>
              지금 요청을 넣어 다시 보기
            </button>
          ))}
        {context && (
          <>
            {context.search && (
              <p className="hint">
                웹 검색을 켜고 보냅니다 — AI 가 회사·업종 이름으로 찾아봅니다. 검색어에 내 비중을 넣지 않도록 지시문에
                적어 두었습니다.
              </p>
            )}
            <h5>지시문</h5>
            <pre>{context.system}</pre>
            <h5>데이터</h5>
            <pre>{context.prompt}</pre>
          </>
        )}
      </details>
    </div>
  )
}
