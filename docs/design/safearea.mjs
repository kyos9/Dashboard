// 폰 팝업 안전영역 검사 (디자인 3차) — audit.mjs 는 상태바·노치·홈 표시줄을 흉내 내지 않는다.
//
//   cd backend && python -m devtools.fake_server --reset      # 가짜 서버 (8150)
//   cd frontend && npm run build
//   # 작업 폴더(저장소 밖)에서:
//   node <저장소>/docs/design/safearea.mjs --out <작업 폴더>/safearea [--base http://127.0.0.1:8150] [--shots]
//
// 흉내 내는 법: CSS 응답의 env(safe-area-inset-*) 를 아이폰 값으로 바꿔 끼운다. 서비스 워커는 막는다 — 막지 않으면
// 두 번째 화면부터 바꾸기 전 CSS 를 캐시에서 꺼내 검사가 헛돈다. 바꿔 끼운 곳이 0이면 그 조합은 실패(sim-missing).
//
// 조건:
//   ph390 · ph360   세로 폰 — 위 47 · 아래 34
//   ph640side       폭 640 이하인데 옆 안전영역이 있는 경우(작은 가로 폰) — 옆 47 · 아래 21. 저장 줄 계산을 실제로 재려고
//   land844         가로 폰(카드로 뜨는 폭) — 옆 47 · 아래 21
//   pc1400 · zoom150  안전영역 없음 — 카드 팝업이 화면 세로 안에 들어오나(바깥 여백 계산을 바꿨다)
//
// 재는 것(팝업마다):
//   head-under-bar   제목 글자(h3)의 위가 위쪽 안전영역보다 아래인가
//   close-first-row  ✕ 가 제목 글자와 같은 줄(세로로 겹침)에 있나 — 칩 줄에 밀려 혼자 다음 줄로 가지 않았나
//   close-in-view    ✕ 가 화면과 옆 안전영역 안에 다 들어오나
//   title-in-side    제목이 왼쪽 안전영역 밖(노치 밑)으로 나가지 않았나
//   title-overlap    제목 글자가 ✕ 와 겹치거나 팝업 밖으로 넘치지 않나(긴 종목명)
//   sticky-head      (폰 전체화면 팝업, 차트 빼고) 끝까지 내려도 제목·✕ 가 위쪽 안전영역 밑에 남나.
//                    알림은 종목별 알림을 펼쳐 내릴 거리를 만든다. 내릴 거리가 40 안 되면 sticky-untested(참고)
//   status-strip     (일반 화면 — 종목 관리·리밸런싱) 내린 뒤 화면 위에 안전영역 높이의 띠가 헤더 바탕색으로 있나
//   foot-aligned     (종목 한 번에 수정) 아래 붙은 저장 줄이 창 폭과 정확히 맞고, 저장 단추가 홈 표시줄 위에 있나
//   card-gap         (가운데 카드 — 확인창) 카드 위 끝에서 제목까지 24 이하, 카드가 위·아래 안전영역 안
//   modal-in-view    (카드로 뜨는 폭) 팝업이 화면 세로 안, 위아래 20 이상 띄워져 있나
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(join(process.cwd(), 'noop.js'))
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const OUT = arg('--out', 'safearea-out')
const BASE = arg('--base', 'http://127.0.0.1:8150')
const SHOTS = args.includes('--shots')
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'

const NONE = { top: 0, right: 0, bottom: 0, left: 0 }
const CONDS = [
  { name: 'ph390', width: 390, height: 844, dsf: 2, mobile: true, inset: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'ph360', width: 360, height: 780, dsf: 2, mobile: true, inset: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'ph640side', width: 640, height: 360, dsf: 2, mobile: true, inset: { top: 0, right: 47, bottom: 21, left: 47 } },
  { name: 'land844', width: 844, height: 390, dsf: 2, mobile: true, inset: { top: 0, right: 47, bottom: 21, left: 47 } },
  { name: 'pc1400', width: 1400, height: 900, dsf: 1, mobile: false, inset: NONE },
  { name: 'zoom150', width: 933, height: 600, dsf: 1.5, mobile: false, inset: NONE },
]

// 폰은 ⋯ 메뉴 안, PC 폭은 헤더 단추(이름이 짧을 수 있다: pcLabel).
// 메뉴 안에서는 .menu-item 으로만 찾는다 — 메뉴 단추 자신의 이름("메뉴 — 진단을 확인하세요")에도 '진단'이 들어 있다
async function openMenu(page, label, pcLabel = label) {
  for (const name of [label, pcLabel]) {
    const direct = page.getByRole('button', { name, exact: true })
    if (await direct.first().isVisible().catch(() => false)) return direct.first().click()
  }
  await page.getByRole('button', { name: /^메뉴/ }).first().click()
  await page.locator('.menu-item', { hasText: label }).first().click()
}
const clickText = (re) => async (page) => page.getByRole('button', { name: re }).first().click()
// 폰 시그널 보기는 보기·설정 단추를 "보기·설정 ⋯" 안에 접는다 (audit.mjs 와 같다)
async function clickViewTool(page, name) {
  const target = page.getByRole('button', { name }).first()
  if (!(await target.isVisible().catch(() => false))) {
    const fold = page.getByRole('button', { name: /^보기·설정/ })
    if (await fold.count()) await fold.first().click()
  }
  await page.getByRole('button', { name }).first().click()
}

// 데모 종목 중 이름이 가장 긴 것의 차트 — 제목이 ✕ 와 한 줄을 나눠 쓰므로 긴 이름이 넘치지 않는지 본다
async function openLongestChart(page) {
  const names = page.locator('button.stock-name')
  await names.first().waitFor({ timeout: 10000 })
  const texts = await names.allInnerTexts()
  let best = 0
  texts.forEach((t, i) => {
    if (t.trim().length > texts[best].trim().length) best = i
  })
  await names.nth(best).click()
  await page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {})
}

const SCREENS = [
  {
    name: 'menu-push',
    act: async (p) => {
      await openMenu(p, '알림 설정')
      // 끝까지 내릴 거리를 만든다 — 종목별 알림을 펼친다
      const fold = p.locator('.push-stocks > summary')
      if (await fold.count().catch(() => 0)) await fold.first().click().catch(() => {})
    },
    sticky: true,
  },
  { name: 'menu-ai-key', act: (p) => openMenu(p, 'AI 키 설정') },
  { name: 'menu-display', act: (p) => openMenu(p, '화면 설정', '화면') },
  { name: 'menu-diagnostics', act: (p) => openMenu(p, '진단') },
  { name: 'menu-users', act: (p) => openMenu(p, /사용자/) },
  {
    name: 'menu-confirm-logout-all',
    // 폰은 ⋯ 메뉴 안, PC 폭은 이름 단추(.account-btn)를 누르면 뜨는 메뉴 안
    act: async (p) => {
      const account = p.locator('button.account-btn')
      if (await account.first().isVisible().catch(() => false)) await account.first().click()
      else await p.getByRole('button', { name: /^메뉴/ }).first().click()
      await p.locator('.menu-item', { hasText: '모든 기기에서 나가기' }).first().click()
    },
    card: true,
  },
  { name: 'page-stocks', path: '/stocks', page: true },
  { name: 'page-rebalance', path: '/rebalance', page: true },
  { name: 'modal-stock-edit', view: 'portfolio', act: clickText(/종목 한 번에 수정/), foot: true },
  { name: 'modal-chart-longest', view: 'signal', act: openLongestChart },
  {
    name: 'modal-macro-chart',
    path: '/macro',
    act: async (p) => {
      await p.locator('button.macro-title').first().click()
      await p.waitForSelector('canvas', { timeout: 15000 }).catch(() => {})
    },
  },
  { name: 'modal-ai-summary', view: 'portfolio', act: clickText(/AI 포트폴리오 진단/) },
  { name: 'modal-thresholds', view: 'signal', act: (p) => clickViewTool(p, /^시그널 기준/) },
]

async function loginState(browser, who) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(BASE + '/api/auth/google/start')
  await page.click(`text=${who}`)
  await page.waitForURL(BASE + '/')
  const state = await ctx.storageState()
  await ctx.close()
  return state
}

function measurePage({ inset }) {
  const out = []
  window.scrollTo(0, document.body.scrollHeight)
  const strip = getComputedStyle(document.body, '::before')
  const h = parseFloat(strip.height) || 0
  if (inset.top > 0 && (strip.position !== 'fixed' || h < inset.top - 0.5))
    out.push({ check: 'status-strip', detail: `띠 ${strip.position} 높이 ${h} < ${inset.top}` })
  const header = document.querySelector('.app-header')
  if (inset.top > 0 && header) {
    const want = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim()
    const probe = document.createElement('div')
    probe.style.color = want
    document.body.appendChild(probe)
    const wantRgb = getComputedStyle(probe).color
    probe.remove()
    if (strip.backgroundColor !== wantRgb) out.push({ check: 'status-strip', detail: `띠 색 ${strip.backgroundColor} ≠ ${wantRgb}` })
  }
  return out
}

function measure({ inset, sticky, foot, card }) {
  const out = []
  const modal = [...document.querySelectorAll('.modal')].pop()
  if (!modal) return [{ check: 'no-modal' }]
  const vw = innerWidth
  const vh = innerHeight
  const m = modal.getBoundingClientRect()
  // 폰 폭에서는 위아래를 다 채운다(폭은 팝업마다 상한이 있어 640 에선 가운데 560 일 수 있다)
  const fullscreen = m.top < 2 && m.bottom > vh - 2

  // 제목 글자는 h3 를 먼저 — querySelector 에 여럿을 쉼표로 주면 문서 순서로 고르므로 따로 찾는다
  const title = modal.querySelector('.modal-title h3') ?? modal.querySelector('.modal-head h3, h3')
  if (!title) return [{ check: 'no-title' }]
  const t = title.getBoundingClientRect()
  const close = modal.querySelector('.modal-head .icon-btn')

  if (card) {
    if (t.top - m.top > 24) out.push({ check: 'card-gap', detail: `카드 위에서 제목까지 ${(t.top - m.top).toFixed(0)}` })
    if (m.top < inset.top || m.bottom > vh - inset.bottom)
      out.push({ check: 'card-gap', detail: `카드 ${m.top.toFixed(0)}~${m.bottom.toFixed(0)} · 안전 ${inset.top}~${vh - inset.bottom}` })
    return out
  }

  if (!fullscreen && (m.top < 19 || m.bottom > vh - 19))
    out.push({ check: 'modal-in-view', detail: `팝업 ${m.top.toFixed(0)}~${m.bottom.toFixed(0)} · 화면 ${vh}` })
  if (t.top < inset.top) out.push({ check: 'head-under-bar', detail: `제목 위 ${t.top.toFixed(0)} < ${inset.top}` })
  if (t.left < inset.left) out.push({ check: 'title-in-side', detail: `제목 왼쪽 ${t.left.toFixed(0)} < ${inset.left}` })
  if (t.right > m.right) out.push({ check: 'title-overlap', detail: `제목 오른쪽 ${t.right.toFixed(0)} > 팝업 ${m.right.toFixed(0)}` })
  if (close) {
    const c = close.getBoundingClientRect()
    if (c.top > t.bottom || c.bottom < t.top)
      out.push({ check: 'close-first-row', detail: `✕ ${c.top.toFixed(0)}~${c.bottom.toFixed(0)} · 제목 ${t.top.toFixed(0)}~${t.bottom.toFixed(0)}` })
    if (c.right > vw - inset.right || c.left < inset.left || c.top < inset.top)
      out.push({ check: 'close-in-view', detail: `✕ 오른쪽 ${c.right.toFixed(0)} · 위 ${c.top.toFixed(0)}` })
    const overlapX = Math.min(t.right, c.right) - Math.max(t.left, c.left)
    const overlapY = Math.min(t.bottom, c.bottom) - Math.max(t.top, c.top)
    if (overlapX > 0 && overlapY > 0) out.push({ check: 'title-overlap', detail: '제목 글자가 ✕ 와 겹침' })
  } else out.push({ check: 'close-in-view', detail: '✕ 없음' })

  if (fullscreen && !modal.classList.contains('chart-modal')) {
    const room = modal.scrollHeight - modal.clientHeight
    if (room < 40) {
      if (sticky) out.push({ check: 'sticky-untested', detail: `내릴 거리 ${room}` })
    } else {
      modal.scrollTop = modal.scrollHeight
      const t2 = title.getBoundingClientRect()
      if (t2.top < inset.top) out.push({ check: 'sticky-head', detail: `내린 뒤 제목 위 ${t2.top.toFixed(0)}` })
      if (close && close.getBoundingClientRect().top < inset.top) out.push({ check: 'sticky-head', detail: '내린 뒤 ✕ 가 상태바 밑' })
      modal.scrollTop = 0
    }
  }
  if (foot) {
    const f = modal.querySelector('.stock-edit-foot')
    if (f) {
      const r = f.getBoundingClientRect()
      const innerLeft = m.left + modal.clientLeft
      const innerRight = innerLeft + modal.clientWidth
      if (Math.abs(r.left - innerLeft) > 1 || Math.abs(r.right - innerRight) > 1)
        out.push({ check: 'foot-aligned', detail: `저장 줄 ${r.left.toFixed(0)}~${r.right.toFixed(0)} · 창 안쪽 ${innerLeft.toFixed(0)}~${innerRight.toFixed(0)}` })
      const buttons = [...f.querySelectorAll('button')]
      const lowest = Math.max(...buttons.map((b) => b.getBoundingClientRect().bottom))
      const rightmost = Math.max(...buttons.map((b) => b.getBoundingClientRect().right))
      const leftmost = Math.min(...buttons.map((b) => b.getBoundingClientRect().left))
      if (lowest > vh - inset.bottom + 1) out.push({ check: 'foot-aligned', detail: `저장 단추 아래 ${lowest.toFixed(0)} > 홈 표시줄 위 ${vh - inset.bottom}` })
      if (rightmost > vw - inset.right + 1 || leftmost < inset.left - 1)
        out.push({ check: 'foot-aligned', detail: `저장 단추 ${leftmost.toFixed(0)}~${rightmost.toFixed(0)} · 옆 안전 ${inset.left}~${vw - inset.right}` })
    } else out.push({ check: 'foot-aligned', detail: '저장 줄 없음' })
  }
  return out
}

const CHECKS = [
  'head-under-bar', 'close-first-row', 'close-in-view', 'title-in-side', 'title-overlap', 'sticky-head',
  'sticky-untested', 'foot-aligned', 'card-gap', 'modal-in-view', 'status-strip', 'sim-missing', 'failed', 'no-modal', 'no-title',
]

async function main() {
  mkdirSync(OUT, { recursive: true })
  if (SHOTS) mkdirSync(join(OUT, 'shots'), { recursive: true })
  const browser = await chromium.launch({ executablePath: EXEC })
  const state = await loginState(browser, 'owner@example.com')
  const rows = []
  for (const cond of CONDS)
    for (const theme of ['dark', 'light'])
      for (const s of SCREENS) {
        const ctx = await browser.newContext({
          storageState: state,
          viewport: { width: cond.width, height: cond.height },
          deviceScaleFactor: cond.dsf,
          isMobile: cond.mobile,
          hasTouch: cond.mobile,
          colorScheme: theme,
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        })
        await ctx.addInitScript(
          ([theme, view]) => {
            try {
              localStorage.setItem('dashboard.theme', theme)
              if (view) localStorage.setItem('dashboard.view', view)
              localStorage.setItem('dashboard.install-hint-dismissed', '1')
            } catch {}
          },
          [theme, s.view || null],
        )
        const page = await ctx.newPage()
        let replaced = 0
        await page.route('**/assets/*.css', async (route) => {
          const res = await route.fetch()
          let css = await res.text()
          for (const side of ['top', 'right', 'bottom', 'left'])
            css = css.replace(new RegExp(`env\\(safe-area-inset-${side}(,\\s*0(px)?)?\\)`, 'g'), () => {
              replaced++
              return `${cond.inset[side]}px`
            })
          await route.fulfill({ response: res, body: css })
        })
        const tag = `${cond.name}-${theme}`
        let issues
        try {
          await page.goto(BASE + (s.path || '/'), { waitUntil: 'networkidle' })
          if (s.page) {
            await page.waitForTimeout(500)
            issues = await page.evaluate(measurePage, { inset: cond.inset })
          } else {
            await s.act(page)
            await page.waitForSelector('.modal', { timeout: 10000 })
            await page.waitForTimeout(500)
            issues = await page.evaluate(measure, { inset: cond.inset, sticky: !!s.sticky, foot: !!s.foot, card: !!s.card })
          }
          if (replaced === 0) issues.push({ check: 'sim-missing', detail: 'CSS 의 env() 를 하나도 바꿔 끼우지 못함' })
          if (SHOTS) await page.screenshot({ path: join(OUT, 'shots', `${tag}-${s.name}.png`) })
        } catch (e) {
          issues = [{ check: 'failed', detail: String(e.message || e).split('\n')[0] }]
        }
        rows.push({ cond: tag, screen: s.name, issues })
        console.log(`${tag} ${s.name}: ${issues.length ? issues.map((i) => i.check).join(',') : 'ok'}`)
        await ctx.close()
      }
  await browser.close()
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(rows, null, 2))
  const lines = ['| 조건 · 화면 | ' + CHECKS.join(' | ') + ' |', '|' + ' --- |'.repeat(CHECKS.length + 1)]
  for (const r of rows) lines.push(`| ${r.cond} ${r.screen} | ` + CHECKS.map((c) => r.issues.filter((i) => i.check === c).length || '').join(' | ') + ' |')
  const total = rows.reduce((n, r) => n + r.issues.length, 0)
  const byCheck = CHECKS.map((c) => `${c} ${rows.reduce((n, r) => n + r.issues.filter((i) => i.check === c).length, 0)}`).join(' · ')
  lines.push('', `문제 합계: ${total} (${rows.length} 조합) — ${byCheck}`)
  writeFileSync(join(OUT, 'summary.md'), lines.join('\n') + '\n')
  console.log(`문제 합계: ${total} (${rows.length} 조합) — ${byCheck}`)
}

main()
