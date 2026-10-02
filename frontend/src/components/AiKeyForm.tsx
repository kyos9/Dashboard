import { useEffect, useState } from 'react'
import { api } from '../api/client'
import {
  AI_PROVIDERS,
  clearAi,
  maskKey,
  providerLabel,
  saveAiSettings,
  useAiSettings,
  type AiSettings,
} from '../lib/aiKey'
import type { AiModel, AiProviderName } from '../types'
import { ErrorNotice } from './ErrorNotice'

/**
 * AI 키 넣기·모델 바꾸기. 헤더의 "AI" 팝업과 "AI 분석" 탭이 같이 쓴다.
 *
 * 두 가지 모양이다 (9-14):
 * - **저장된 키가 있으면** 그 키로 모델 목록을 바로 불러온다. 모델을 고르면 그 자리에서 저장된다 —
 *   키를 다시 넣거나 "키 확인"을 누를 일이 없다. 키를 바꾸려면 "다른 키 넣기".
 * - **새 키**는 제공자 고르기 → 키 붙여넣기 → "키 확인"(모델 목록을 받아 키가 맞는지 본다) → 모델 고르기 → 저장.
 *   확인하지 않은 키는 저장하지 않는다.
 *
 * **모델을 코드에 박지 않는다.** 그 키로 쓸 수 있는 모델을 제공자에게 물어 고르게 한다
 * (서버 `providers/ai.py` 참고).
 */
export function AiKeyForm({ account, onSaved }: { account: string; onSaved?: () => void }) {
  const saved = useAiSettings(account)
  const [provider, setProvider] = useState<AiProviderName>(saved?.provider ?? 'anthropic')
  // 저장된 키가 있어도 새 키를 넣는 중인가
  const [replacing, setReplacing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const current = saved && saved.provider === provider && !replacing ? saved : null

  function pickProvider(next: AiProviderName) {
    setProvider(next)
    setReplacing(false)
    setNotice(null)
  }

  function forget() {
    clearAi()
    setReplacing(false)
    setNotice('이 기기에서 키를 지웠습니다.')
  }

  return (
    <div className="ai-key-form">
      {saved && (
        <div className="ai-saved-row">
          <p className="ai-saved">
            저장된 키: <b>{providerLabel(saved.provider)}</b> <span className="mono">{maskKey(saved.key)}</span>
            {!saved.remember && ' · 이 탭을 닫으면 지워짐'}
          </p>
          <div className="ai-key-actions">
            {current && (
              <button className="ghost" onClick={() => setReplacing(true)}>
                다른 키 넣기
              </button>
            )}
            <button className="ghost" onClick={forget}>
              키 지우기
            </button>
          </div>
        </div>
      )}

      {current ? (
        <SavedKey
          // 키가 바뀌면 목록을 다시 받는다
          key={`${current.provider}:${current.key}`}
          saved={current}
          provider={provider}
          onProvider={pickProvider}
          onSaved={onSaved}
        />
      ) : (
        <NewKey
          key={provider}
          account={account}
          provider={provider}
          onProvider={pickProvider}
          defaultRemember={saved?.remember ?? true}
          onCancel={saved && saved.provider === provider ? () => setReplacing(false) : undefined}
          onSaved={() => {
            setReplacing(false)
            setNotice('저장했습니다.')
            onSaved?.()
          }}
        />
      )}

      {notice && <p className="ok-text">{notice}</p>}

      <ul className="hint ai-key-notes">
        <li>
          키는 <b>이 기기의 브라우저에만</b> 저장됩니다. 정리를 요청할 때만 서버를 거쳐 AI 회사로 전달되고,
          서버는 키를 저장하지도 기록하지도 않습니다. 다른 기기에서는 한 번 더 넣어야 합니다.
        </li>
        <li>
          사용료는 이 키의 계정에 청구됩니다. 제공자 사이트에서 <b>월 사용 한도</b>를 걸어 두면 안전합니다.
        </li>
      </ul>
    </div>
  )
}

function ProviderSelect({ value, onChange }: { value: AiProviderName; onChange: (p: AiProviderName) => void }) {
  return (
    <label>
      <span>AI 회사</span>
      <select value={value} onChange={(e) => onChange(e.target.value as AiProviderName)}>
        {AI_PROVIDERS.map((p) => (
          <option key={p.name} value={p.name}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ModelSelect({
  models,
  value,
  onChange,
  disabled,
}: {
  models: AiModel[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  return (
    <div className="ai-model-pick">
      <label>
        <span>모델</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {/* 선택칸 안의 글자는 줄을 못 바꾼다 — 긴 모델 이름은 여기서 줄을 바꿔 다 보여준다 */}
      <span className="hint mono ai-model-id">{value}</span>
    </div>
  )
}

/** 저장된 키 — 모델 목록을 바로 불러오고, 고르면 바로 저장한다 */
function SavedKey({
  saved,
  provider,
  onProvider,
  onSaved,
}: {
  saved: AiSettings
  provider: AiProviderName
  onProvider: (p: AiProviderName) => void
  onSaved?: () => void
}) {
  const [models, setModels] = useState<AiModel[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .aiModels(saved.provider, saved.key)
      .then((got) => alive && setModels(got.models))
      .catch((e) => alive && setError(e))
    return () => {
      alive = false
    }
    // 키·제공자가 바뀌면 이 칸이 새로 만들어진다 (key) — 모델만 바꿀 때는 다시 받지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const missing = models !== null && !models.some((m) => m.id === saved.model)
  // 목록에 없는 저장된 모델도 고른 채로 보여준다 — 바꾸라고 적는다
  const options: AiModel[] =
    models === null || missing ? [{ id: saved.model, label: missing ? `${saved.model} (목록에 없음)` : saved.model }, ...(models ?? [])] : models

  function pickModel(id: string) {
    if (id === saved.model) return
    saveAiSettings({ ...saved, model: id })
    setNotice(`모델을 ${id} 로 바꿨습니다.`)
    onSaved?.()
  }

  function pickRemember(remember: boolean) {
    saveAiSettings({ ...saved, remember })
    setNotice(remember ? '이 기기에 기억합니다.' : '이 탭을 닫으면 지웁니다.')
  }

  return (
    <>
      <div className="form-grid ai-key-grid">
        <ProviderSelect value={provider} onChange={onProvider} />
        <ModelSelect models={options} value={saved.model} onChange={pickModel} disabled={models === null} />
      </div>
      {models === null && !error && <p className="hint ai-saved">이 키로 쓸 수 있는 모델을 불러오는 중…</p>}
      {models !== null && (
        <p className="hint ai-saved">
          {missing
            ? `저장된 모델 ${saved.model} 는 이 키로 더 이상 쓸 수 없습니다. 다른 모델을 고르세요.`
            : '모델을 고르면 바로 저장됩니다.'}
        </p>
      )}
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <label className="check-line">
        <input type="checkbox" checked={saved.remember} onChange={(e) => pickRemember(e.target.checked)} />
        이 기기에 기억 (끄면 이 탭을 닫을 때 지워집니다 — 공용 PC 라면 끄세요)
      </label>
      {notice && <p className="ok-text">{notice}</p>}
    </>
  )
}

/** 새 키 — 확인(모델 목록을 받는다)해야 저장할 수 있다 */
function NewKey({
  account,
  provider,
  defaultRemember,
  onProvider,
  onCancel,
  onSaved,
}: {
  account: string
  provider: AiProviderName
  defaultRemember: boolean
  onProvider: (p: AiProviderName) => void
  onCancel?: () => void
  onSaved: () => void
}) {
  const info = AI_PROVIDERS.find((p) => p.name === provider)!
  const [keyInput, setKeyInput] = useState('')
  const [models, setModels] = useState<AiModel[] | null>(null)
  // 목록을 어느 키로 받았나 — 확인한 뒤 키를 고치면 다시 확인해야 한다
  const [checkedKey, setCheckedKey] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [remember, setRemember] = useState(defaultRemember)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const key = keyInput.trim()
  const canSave = key !== '' && checkedKey === key && model !== '' && !busy

  async function check() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const found = (await api.aiModels(provider, key)).models
      if (found.length === 0) {
        setError('키는 맞지만 이 키로 쓸 수 있는 글쓰기 모델이 없습니다. 제공자 사이트에서 권한을 확인하세요.')
        return
      }
      setModels(found)
      setCheckedKey(key)
      setModel((now) => (found.some((m) => m.id === now) ? now : found[0].id))
      setNotice(`키가 맞습니다. 모델 ${found.length}개를 쓸 수 있습니다. 모델을 고르고 저장하세요.`)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  function save() {
    saveAiSettings({ provider, key, model, remember, account })
    setKeyInput('')
    onSaved()
  }

  return (
    <>
      <div className="form-grid ai-key-grid">
        <ProviderSelect value={provider} onChange={onProvider} />
        <label>
          <span>
            API 키{' '}
            <a href={info.keyUrl} target="_blank" rel="noreferrer noopener" className="hint">
              키 만들기 ↗
            </a>
          </span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value)
              setNotice(null)
            }}
            placeholder={info.placeholder}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="ai-key-actions">
        <button onClick={() => void check()} disabled={busy || key === ''}>
          {busy ? '확인 중…' : '키 확인'}
        </button>
        {models && checkedKey === key && <ModelSelect models={models} value={model} onChange={setModel} />}
      </div>

      <label className="check-line">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        이 기기에 기억 (끄면 이 탭을 닫을 때 지워집니다 — 공용 PC 라면 끄세요)
      </label>

      <div className="ai-key-actions">
        <button className="primary" onClick={save} disabled={!canSave}>
          저장
        </button>
        {onCancel && (
          <button className="ghost" onClick={onCancel}>
            취소 (저장된 키 쓰기)
          </button>
        )}
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {notice && <p className="ok-text">{notice}</p>}
    </>
  )
}
