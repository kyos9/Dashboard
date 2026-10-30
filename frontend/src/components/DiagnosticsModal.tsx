import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { backupWarnings } from '../lib/backupWarnings'
import { parseInstant, whenText } from '../lib/diagTime'
import { useBackToClose } from '../lib/backToClose'
import { ErrorNotice } from './ErrorNotice'
import type { BackupStatus, LogsResponse, RecordsStatus, SignalRulesStatus, SlowRequestsResponse } from '../types'
import { lockBodyScroll } from '../lib/scrollLock'

/**
 * 진단 — 서버가 남긴 기록 중 **잘못된 것만** 본다.
 *
 * 전체 로그를 그대로 쏟으면 대부분이 "정상 동작 기록"이라 스크롤하다 안 읽게 된다.
 * 실제로 알고 싶은 건 "어제 VOO 시세를 왜 못 받았나" 한 줄이다. 그래서 기본은 경고
 * 이상만 보여주고, 전체가 필요하면 파일을 받게 한다.
 *
 * 예전에는 이 내용이 검은 콘솔 창으로 흘러가고 사라졌다. 창을 닫는 순간(그리고 서버에
 * 올린 뒤에는 애초에) 볼 방법이 없었다.
 */

const LEVEL_CLASS: Record<string, string> = {
  CRITICAL: 'badge-red',
  ERROR: 'badge-red',
  WARNING: 'badge-amber',
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 맨 위 한 줄. 무엇을 센 것인지("서버 로그")를 말에 넣고, 백업 칸에 경고가 있으면 끝에 붙인다 —
 * 로그만 세면서 "경고·오류가 없습니다"라고 하면 바로 아래 백업 경고와 어긋났다(0.45.1 C1).
 */
export function summarize(logs: LogsResponse | null, backupWarn = false): string {
  const { head, tail } = summaryParts(logs, backupWarn)
  return [head, tail].filter(Boolean).join(' · ')
}

/** 꼬리(백업)만 경고 모양으로 그리려고 둘로 나눈다 — 같은 작은 회색 글이라 눈에 띄지 않았다(0.45.2 B1) */
const BACKUP_TAIL = '백업 확인 필요 — 아래 백업 칸'

function summaryParts(logs: LogsResponse | null, backupWarn: boolean): { head: string; tail: string } {
  const tail = backupWarn ? BACKUP_TAIL : ''
  if (!logs) return { head: '', tail }
  const bad = (logs.counts.ERROR ?? 0) + (logs.counts.CRITICAL ?? 0)
  const warn = logs.counts.WARNING ?? 0
  const head = !logs.available
    ? '서버 로그: 아직 없음'
    : bad === 0 && warn === 0
      ? '서버 로그: 최근 경고·오류 없음'
      : `서버 로그: 오류 ${bad}건 · 경고 ${warn}건`
  return { head, tail }
}

function SummaryLine({ logs, backupWarn }: { logs: LogsResponse | null; backupWarn: boolean }) {
  const { head, tail } = summaryParts(logs, backupWarn)
  return (
    <span className="hint diag-summary">
      {head}
      {head && tail && ' · '}
      {tail && <b className="diag-warn">{tail}</b>}
    </span>
  )
}

/** 1234ms → "1.2초" */
function secondsText(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`
}

/**
 * 시간대가 붙은 시각은 보는 사람의 시간대로 다른 줄과 같은 꼴("10월 22일 09:30", 0.45.2 B5).
 * 붙지 않았으면(옛 서버의 느린 요청 — 서버 현지) 어느 시간대인지 몰라 지금처럼 숫자만 "09-28 10:12".
 * `naive` — 시간대가 없을 때 무엇으로 읽나(다시 계산은 UTC 로 남긴다)
 */
function shortTime(iso: string | null, naive: 'utc' | null = null): string {
  if (!iso) return ''
  const ms = parseInstant(iso, naive)
  if (ms !== null) return whenText(ms)
  const m = iso.match(/^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : iso
}

/** 느렸던 것을 이만큼만 — 틀이 수십 개라도 위의 몇 개가 고칠 곳이다 */
const SLOW_SHOWN = 10

/**
 * 느린 요청 (ROADMAP 8-5) — 서버가 1초 넘게 걸린 요청을 경로의 틀마다 모은 것.
 * 서버를 켠 뒤로만 모으고, 사람·실제 주소는 담지 않는다. 못 받으면(옛 서버) 이 칸을 그리지 않는다.
 */
function SlowRequests({ slow }: { slow: SlowRequestsResponse }) {
  const shown = slow.items.slice(0, SLOW_SHOWN)
  return (
    <section className="diag-slow" aria-labelledby="diag-slow-title">
      <h4 id="diag-slow-title">
        느린 요청{' '}
        <span className="hint">
          {secondsText(slow.threshold_ms)} 넘게 · 서버를 켠 {shortTime(slow.since)} 뒤로
        </span>
      </h4>
      {shown.length === 0 ? (
        <p className="hint">없습니다.</p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={`${item.method} ${item.route}`} className="diag-slow-row">
              <span className="mono diag-slow-route">
                {item.method} {item.route}
              </span>
              <span className="hint">
                {item.count}번 · 가장 길게 {secondsText(item.max_ms)} · 최근 {secondsText(item.last_ms)}
                {item.last_at ? ` (${shortTime(item.last_at)})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const RECOMPUTE_REASON: Record<string, string> = {
  first: '처음 켤 때',
  definition_changed: '정의가 바뀌어서',
  manual: '손으로',
}

/**
 * 시그널 기준 (0.41.0) — 정의의 판과, 정의가 바뀌어 지난 판정을 마지막으로 다시 계산한 것.
 * 정의를 바꿔 배포한 뒤 "지난 차트의 점이 다 바뀌었나"를 여기서 본다. 못 받으면(옛 서버) 그리지 않는다.
 */
function SignalRulesLine({ status }: { status: SignalRulesStatus }) {
  const last = status.last_recompute
  return (
    <section className="diag-slow" aria-labelledby="diag-rules-title">
      <h4 id="diag-rules-title">
        시그널 기준{' '}
        <span className="hint">
          {status.changed_on ? `${status.changed_on}에 바뀜 · ` : ''}정의 지문 <span className="mono">{status.version}</span>
        </span>
      </h4>
      {!status.up_to_date && <p className="hint">지난 판정을 아직 새 기준으로 다시 계산하지 않았습니다 — 다음에 켤 때 합니다.</p>}
      {last ? (
        <p className="hint">
          마지막 다시 계산 {shortTime(last.at, 'utc')} ({RECOMPUTE_REASON[last.reason] ?? last.reason}) — {last.tickers}종목 중{' '}
          {last.changed_tickers}종목, 판정이 바뀐 날 {last.changed_rows}개 · {last.seconds}초
          {last.failed.length > 0 && ` · 실패: ${last.failed.join(', ')}`}
        </p>
      ) : (
        <p className="hint">아직 다시 계산한 적이 없습니다.</p>
      )}
    </section>
  )
}

/**
 * 기록이 살아 있나 (0.44.0) — 날마다의 평가금액. 다시 만들 수 없는 기록이라 멈추면 그날치가 영영 없다.
 * 누구의 금액도 보이지 않는다(합계만). 못 받으면(옛 서버) 그리지 않는다.
 */
function bytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/** 보는 사람의 시간대로 "10월 16일 08:30" — 백업 시각은 서버가 시간대를 붙여 보낸다 */
function when(iso: string): string {
  const ms = parseInstant(iso, 'utc')
  return ms === null ? iso : whenText(ms)
}

/**
 * 백업 상태 한두 줄 (0.44.0 D0) — 마지막 백업 시각·크기·개수(화면 말은 0.45.2 부터 '벌' 대신 '개'), 실패했으면 그 갈래. 파일 이름·경로는 서버가 보내지 않는다.
 * 서버 밖으로 꺼낸 것은 꺼낸 쪽(`server-backup-pull.bat`)이 적은 시각만 안다(0.45.0) — 밖에 지금 무엇이 있는지는 모른다.
 */
export function BackupLines({ backup, now }: { backup: BackupStatus; now: number }) {
  const { stale, offsiteStaleDays } = backupWarnings(backup, now)
  return (
    <>
      <p className="hint">
        {backup.last_at
          ? `백업: 마지막 ${when(backup.last_at)}${backup.last_size !== null ? ` · ${bytes(backup.last_size)}` : ''} · ${keptText(backup)}`
          : '백업: 아직 없습니다 — 매일 하나씩 서버 안에 뜹니다.'}
      </p>
      {backup.premigrate && backup.premigrate.count > 0 && backup.premigrate.last_at && (
        <p className="hint">
          {backup.premigrate.keep !== undefined
            ? `업데이트 직전 백업 ${backup.premigrate.count}개(최대 ${backup.premigrate.keep}개, 7일 안) · 마지막 ${when(backup.premigrate.last_at)}`
            : `업그레이드 직전 백업 ${backup.premigrate.count}개 · 마지막 ${when(backup.premigrate.last_at)} (위 개수에 들어 있습니다)`}
        </p>
      )}
      {stale && (
        <p className="hint diag-warn" role="note">
          하루 넘게 새 백업이 없습니다 — 서버 로그를 보세요.
        </p>
      )}
      {backup.last_failure && (
        <p className="hint diag-warn" role="note">
          마지막 실패: {when(backup.last_failure.at)} — {backup.last_failure.reason}
        </p>
      )}
      {backup.offsite && (
        <OffsiteLine lastAt={backup.offsite.last_at} staleDays={offsiteStaleDays} warnings={backup.offsite.warnings ?? []} />
      )}
    </>
  )
}

/**
 * 몇 개 남겨 두나 — 0.46.0 부터 서버가 매일 백업과 업데이트 직전 백업을 따로 센다(`daily`). 옛 서버는 둘을 합친 수만 보낸다.
 */
function keptText(backup: BackupStatus): string {
  if (backup.daily) return `매일 백업 ${backup.daily.count}개 보관(최대 ${backup.daily.keep}개)`
  return `${backup.count}개 보관(최대 ${backup.keep}개)`
}

/** PC 사본 폴더에 대한 경고 (0.46.0 A4) — bat 이 꺼낼 때 알려 준다. 작업 스케줄러로 돌면 창이 안 보여서 여기 남긴다 */
const OFFSITE_WARNING_TEXT: Record<string, string> = {
  onedrive: 'PC 사본 폴더가 OneDrive 아래에 있습니다 — 사본이 클라우드로 올라갈 수 있습니다. backup-pull.local.txt 의 DEST 를 OneDrive 밖으로 옮기세요.',
  noacl: 'PC 사본 폴더를 나만 열게 하지 못했습니다 — USB·네트워크 드라이브일 수 있습니다. 받기는 그대로 됩니다.',
}

function OffsiteLine({ lastAt, staleDays, warnings }: { lastAt: string | null; staleDays: number | null; warnings: string[] }) {
  if (!lastAt) {
    return <p className="hint">밖에 꺼낸 기록이 없습니다 — 서버가 사라지면 이 백업도 같이 사라집니다. 내 PC 로 가져오는 법은 PC 의 Dashboard 폴더 DEPLOY.md 10-0.</p>
  }
  return (
    <>
      <p className="hint">밖에 꺼낸 것: 마지막 {when(lastAt)} (관리자 PC)</p>
      {warnings
        .filter((w) => OFFSITE_WARNING_TEXT[w])
        .map((w) => (
          <p key={w} className="hint diag-warn" role="note">
            {OFFSITE_WARNING_TEXT[w]}
          </p>
        ))}
      {staleDays !== null && (
        <p className="hint diag-warn" role="note">
          {staleDays}일 동안 밖에 꺼내지 않았습니다 — PC 에서 server-backup-pull.bat 을 실행하세요.
        </p>
      )}
    </>
  )
}

/** `now` — 응답을 받은 때(멈춤 경고의 기준) */
export function RecordsLine({ status, now }: { status: RecordsStatus; now: number }) {
  const value = status.value_record
  return (
    <section className="diag-slow" aria-labelledby="diag-records-title">
      {/* "기록"만으로는 아래 서버 로그와 헷갈렸다(A 사용자 확인) */}
      <h4 id="diag-records-title">평가금액 기록 · 백업</h4>
      <p className="hint">
        {!value.enabled
          ? '평가금액 기록: 꺼져 있습니다(SIGNAL_DASHBOARD_VALUE_RECORD).'
          : value.last_date
            ? // 사람 수·줄 수의 뜻을 같이 — "그날 2명"이 승인된 사람 수와 왜 다른지, "줄"이 무엇인지 (0.44.0 A 사용자 확인)
              `평가금액 기록: 마지막 ${value.last_date} · 그날 ${value.users}명(보유·현금이 있는 사람만) · 지금까지 ${value.rows}줄(사람마다 하루 한 줄)`
            : '평가금액 기록: 아직 없습니다 — 매일 아침 미국 시세를 받은 뒤 남깁니다.'}
      </p>
      {status.backup && <BackupLines backup={status.backup} now={now} />}
    </section>
  )
}

export function DiagnosticsModal({ onClose }: { onClose: () => void }) {
  const [level, setLevel] = useState<'warning' | 'all'>('warning')
  const [logs, setLogs] = useState<LogsResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState<SlowRequestsResponse | null>(null)
  const [rules, setRules] = useState<SignalRulesStatus | null>(null)
  const [records, setRecords] = useState<{ status: RecordsStatus; at: number } | null>(null)

  useEffect(() => {
    api
      .getRecordsStatus()
      .then((status) => setRecords({ status, at: Date.now() }))
      .catch(() => setRecords(null))
  }, [])

  useEffect(() => {
    api
      .getSignalRulesStatus()
      .then(setRules)
      .catch(() => setRules(null))
  }, [])

  useEffect(() => {
    api
      .getSlowRequests()
      .then(setSlow)
      .catch(() => setSlow(null))
  }, [])

  useEffect(() => {
    setLoading(true)
    api
      .getLogs(level)
      .then(setLogs)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [level])

  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal diag-modal"
        role="dialog"
        aria-modal="true"
        aria-label="진단"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>진단</h3>
            <SummaryLine logs={logs} backupWarn={records?.status.backup ? backupWarnings(records.status.backup, records.at).any : false} />
          </div>
          <div className="chip-row">
            <button
              className={`chip${level === 'warning' ? ' active' : ''}`}
              onClick={() => setLevel('warning')}
            >
              경고·오류만
            </button>
            <button
              className={`chip${level === 'all' ? ' active' : ''}`}
              onClick={() => setLevel('all')}
            >
              전체
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />

        <div className="diag-body">
          {rules && <SignalRulesLine status={rules} />}
          {records && <RecordsLine status={records.status} now={records.at} />}
          {slow && <SlowRequests slow={slow} />}
          {loading && <p className="hint">불러오는 중…</p>}
          {!loading && logs?.available === false && (
            <p className="hint">서버를 켜고 잠시 쓰면 여기에 쌓입니다.</p>
          )}
          {!loading && logs?.available && logs.entries.length === 0 && (
            <p className="hint">
              {level === 'warning'
                ? '걸러낼 것이 없습니다 — 전체를 누르면 정상 기록까지 볼 수 있습니다.'
                : '보여줄 기록이 없습니다.'}
            </p>
          )}
          {logs?.entries.map((entry, i) => (
            <div className="diag-row" key={`${entry.time}-${i}`}>
              <span className={`badge ${LEVEL_CLASS[entry.level] ?? 'badge-grey'}`}>
                {entry.level}
              </span>
              {/* 서버가 시간대를 붙여 주면 다른 줄과 같은 꼴·같은 시간대로, 옛 서버면 글자 그대로 (0.45.2 B5) */}
              <span className="mono hint diag-time" title={entry.time}>
                {entry.at && parseInstant(entry.at) !== null ? whenText(parseInstant(entry.at)!, { seconds: true }) : entry.time}
              </span>
              <div className="diag-text">
                <span className="hint">{entry.logger}</span>
                <pre>{entry.message}</pre>
              </div>
            </div>
          ))}
        </div>

        <div className="diag-foot">
          <span className="hint mono">
            {logs?.available
              ? `${logs.path} · ${sizeText(logs.size_bytes)}`
              : ''}
          </span>
          {/* fetch로 받아 Blob을 만들 이유가 없다 — 브라우저가 직접 내려받게 둔다 */}
          <a className="diag-download" href={api.logsDownloadUrl()} download>
            로그 파일 받기
          </a>
        </div>
      </div>
    </div>
  )
}
