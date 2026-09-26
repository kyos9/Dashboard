import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api/client'
import { providerLabel, readAiResult, saveAiResult, useAiSettings } from '../lib/aiKey'
import type { AiAnalysis, AiContext } from '../types'
import { AiKeyForm } from './AiKeyForm'
import { AiText } from './AiText'
import { ErrorNotice } from './ErrorNotice'

/** 키를 다시 넣어야 풀리는 오류 — 이때는 키 입력을 바로 펼친다 */
const KEY_PROBLEMS = new Set(['key_invalid', 'bad_key_shape', 'model_denied'])

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * 차트 팝업의 "AI 정리" 탭 (ROADMAP 3c).
 *
 * **누를 때만 부른다** — 탭을 여는 것만으로 남의 돈(사용자의 키)이 나가면 안 된다. 받은 글은
 * 이 기기에 종목마다 하나씩 남겨, 다시 열면 그걸 먼저 보여준다.
 */
export function AiPanel({ ticker, account }: { ticker: string; account: string }) {
  const settings = useAiSettings(account)
  const [result, setResult] = useState<AiAnalysis | null>(() => readAiResult(account, ticker))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [editing, setEditing] = useState(false)
  const [context, setContext] = useState<AiContext | null>(null)
  const [contextError, setContextError] = useState<unknown>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function run() {
    if (!settings) return
    setBusy(true)
    setError(null)
    try {
      const got = await api.aiAnalyze(ticker, settings.provider, settings.model, settings.key)
      saveAiResult(account, got)
      if (alive.current) setResult(got)
    } catch (e) {
      if (!alive.current) return
      setError(e)
      if (e instanceof ApiError && e.code && KEY_PROBLEMS.has(e.code)) setEditing(true)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  function loadContext() {
    if (context) return
    api
      .aiContext(ticker)
      .then((c) => alive.current && setContext(c))
      .catch((e) => alive.current && setContextError(e))
  }

  return (
    <div className="ai-panel">
      <p className="hint ai-intro">
        앱이 계산한 이 종목의 숫자(시세·지표·시그널·재무·시장 배경)를 AI 가 글로 풀어 줍니다. 사라·팔라는 말은
        하지 않도록 요청합니다. 보유수량·비중 같은 내 포트폴리오는 보내지 않습니다.
      </p>

      {!settings || editing ? (
        <section className="ai-key-box">
          <h4>{settings ? 'AI 키 바꾸기' : '내 AI 키 넣기'}</h4>
          {!settings && (
            <p className="hint">
              AI 정리는 <b>본인의 AI 키</b>로 동작합니다. 키가 없어도 나머지 기능은 모두 그대로 쓸 수 있습니다.
            </p>
          )}
          <AiKeyForm account={account} onSaved={() => setEditing(false)} />
          {settings && (
            <button className="link-btn" onClick={() => setEditing(false)}>
              닫기
            </button>
          )}
        </section>
      ) : (
        <div className="ai-run">
          <button className="primary" onClick={() => void run()} disabled={busy}>
            {busy ? '정리하는 중…' : result ? '다시 받기' : 'AI 정리 받기'}
          </button>
          <span className="hint ai-using">
            {providerLabel(settings.provider)} · <span className="mono">{settings.model}</span>{' '}
            <button className="link-btn" onClick={() => setEditing(true)}>
              키·모델 바꾸기
            </button>
          </span>
        </div>
      )}

      {busy && <p className="hint">AI 가 쓰는 중입니다. 보통 20초~1분 걸립니다. 팝업을 닫아도 요금은 청구될 수 있습니다.</p>}
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {result && (
        <article className="ai-result" aria-label="AI 정리">
          <p className="hint ai-meta">
            {result.as_of ? `${result.as_of} 종가까지 · ` : ''}
            {providerLabel(result.provider)} <span className="mono">{result.model}</span> · {when(result.generated_at)}
            {result.input_tokens != null && result.output_tokens != null &&
              ` · 토큰 ${result.input_tokens.toLocaleString('ko-KR')} + ${result.output_tokens.toLocaleString('ko-KR')}`}
          </p>
          <AiText text={result.text} />
          {result.truncated && (
            <p className="hint">⚠ 길이 제한에 걸려 끝부분이 잘렸습니다. 다시 받거나 다른 모델을 골라 보세요.</p>
          )}
          <p className="ai-disclaimer">
            AI 가 앱의 숫자를 풀어 쓴 참고 글이며 틀릴 수 있습니다. 투자 권유가 아니고, 판단과 책임은 본인에게
            있습니다.
          </p>
        </article>
      )}

      <details className="ai-context" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadContext()}>
        <summary>AI 에게 보내는 내용 보기</summary>
        <ErrorNotice error={contextError} />
        {!context && !contextError && <p className="hint">불러오는 중…</p>}
        {context && (
          <>
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
