// 폰 팝업 안전영역 검사 (디자인 3차) — audit.mjs 는 상태바·노치·홈 표시줄을 흉내 내지 않는다.
//
//   cd backend && python -m devtools.fake_server --reset      # 가짜 서버 (8150)
//   cd frontend && npm run build
//   # 작업 폴더(저장소 밖)에서:
//   node <저장소>/docs/design/safearea.mjs --out <작업 폴더>/safearea [--base http://127.0.0.1:8150] [--shots]
//
// 흉내 내는 법: CSS 응답의 env(safe-area-inset-*) 를 아이폰 값으로 바꿔 끼운다(서비스 워커는 막는다 — 막지 않으면
// 두 번째 화면부터 바꾸기 전 CSS 를 캐시에서 꺼내 검사가 헛돈다).
//   세로 390·360: 위 47 · 아래 34      가로 844×390: 왼쪽·오른쪽 47 · 아래 21
//
// 재는 것(팝업마다):
//   head-under-bar   제목 글자의 위가 위쪽 안전영역보다 아래인가
//   close-first-row  ✕ 가 제목과 같은 줄(세로로 겹침)에 있나 — 칩 줄에 밀려 혼자 다음 줄로 가지 않았나
//   close-in-view    ✕ 가 화면과 옆 안전영역 안에 다 들어오나
//   title-in-side    제목이 왼쪽 안전영역 밖(노치 밑)으로 나가지 않았나
//   sticky-head      (알림) 끝까지 내려도 제목이 위쪽 안전영역 밑에 남나
//   foot-aligned     (종목 한 번에 수정) 아래 붙은 저장 줄이 창 폭과 정확히 맞나(좌우가 비거나 넘치지 않나)
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

const CONDS = [
  { name: 'ph390', width: 390, height: 844, inset: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'ph360', width: 360, height: 780, inset: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'land844', width: 844, height: 390, inset: { top: 0, right: 47, bottom: 21, left: 47 } },
]

// 폰은 ⋯ 메뉴 안, PC 폭(가로 844)은 헤더 단추(이름이 짧을 수 있다: pcLabel).
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

const SCREENS = [
  { name: 'menu-push', act: (p) => openMenu(p, '알림 설정'), sticky: true },
  { name: 'menu-ai-key', act: (p) => openMenu(p, 'AI 키 설정') },
  { name: 'menu-display', act: (p) => openMenu(p, '화면 설정', '화면') },
  { name: 'menu-diagnostics', act: (p) => openMenu(p, '진단') },
  { name: 'menu-users', act: (p) => openMenu(p, /사용자/) },
  { name: 'modal-stock-edit', view: 'portfolio', act: clickText(/종목 한 번에 수정/), foot: true },
  {
    name: 'modal-chart',
    view: 'signal',
    act: async (p) => {
      await p.locator('button.stock-name').first().click()
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

function measure({ inset, sticky, foot }) {
  const out = []
  const modal = [...document.querySelectorAll('.modal')].pop()
  if (!modal) return [{ check: 'no-modal' }]
  const vw = innerWidth
  const title = modal.querySelector('.modal-title h3, .modal-title, h3')
  const close = modal.querySelector('.modal-head .icon-btn')
  const t = title.getBoundingClientRect()
  if (t.top < inset.top) out.push({ check: 'head-under-bar', detail: `제목 위 ${t.top.toFixed(0)} < ${inset.top}` })
  if (t.left < inset.left) out.push({ check: 'title-in-side', detail: `제목 왼쪽 ${t.left.toFixed(0)} < ${inset.left}` })
  if (close) {
    const c = close.getBoundingClientRect()
    if (c.top > t.bottom || c.bottom < t.top)
      out.push({ check: 'close-first-row', detail: `✕ ${c.top.toFixed(0)}~${c.bottom.toFixed(0)} · 제목 ${t.top.toFixed(0)}~${t.bottom.toFixed(0)}` })
    if (c.right > vw - inset.right || c.left < inset.left || c.top < inset.top)
      out.push({ check: 'close-in-view', detail: `✕ 오른쪽 ${c.right.toFixed(0)} · 위 ${c.top.toFixed(0)}` })
  } else out.push({ check: 'close-in-view', detail: '✕ 없음' })
  if (sticky) {
    modal.scrollTop = modal.scrollHeight
    const t2 = title.getBoundingClientRect()
    if (t2.top < inset.top) out.push({ check: 'sticky-head', detail: `내린 뒤 제목 위 ${t2.top.toFixed(0)}` })
    modal.scrollTop = 0
  }
  if (foot) {
    const f = modal.querySelector('.stock-edit-foot')
    if (f) {
      const m = modal.getBoundingClientRect()
      const r = f.getBoundingClientRect()
      const innerLeft = m.left + modal.clientLeft
      const innerRight = innerLeft + modal.clientWidth
      if (Math.abs(r.left - innerLeft) > 1 || Math.abs(r.right - innerRight) > 1)
        out.push({ check: 'foot-aligned', detail: `저장 줄 ${r.left.toFixed(0)}~${r.right.toFixed(0)} · 창 안쪽 ${innerLeft.toFixed(0)}~${innerRight.toFixed(0)}` })
      if (r.bottom > innerHeight + 1) out.push({ check: 'foot-aligned', detail: `저장 줄 아래 ${r.bottom.toFixed(0)} > 화면 ${innerHeight}` })
    } else out.push({ check: 'foot-aligned', detail: '저장 줄 없음' })
  }
  return out
}

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
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
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
        await page.route('**/assets/*.css', async (route) => {
          const res = await route.fetch()
          let css = await res.text()
          for (const side of ['top', 'right', 'bottom', 'left'])
            css = css.replace(new RegExp(`env\\(safe-area-inset-${side}(,\\s*0(px)?)?\\)`, 'g'), `${cond.inset[side]}px`)
          await route.fulfill({ response: res, body: css })
        })
        const tag = `${cond.name}-${theme}`
        let issues
        try {
          await page.goto(BASE + '/', { waitUntil: 'networkidle' })
          await s.act(page)
          await page.waitForSelector('.modal', { timeout: 10000 })
          await page.waitForTimeout(500)
          issues = await page.evaluate(measure, { inset: cond.inset, sticky: !!s.sticky, foot: !!s.foot })
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
  const checks = ['head-under-bar', 'close-first-row', 'close-in-view', 'title-in-side', 'sticky-head', 'foot-aligned', 'failed', 'no-modal']
  const lines = ['| 조건 · 화면 | ' + checks.join(' | ') + ' |', '|' + ' --- |'.repeat(checks.length + 1)]
  for (const r of rows) lines.push(`| ${r.cond} ${r.screen} | ` + checks.map((c) => r.issues.filter((i) => i.check === c).length || '').join(' | ') + ' |')
  const total = rows.reduce((n, r) => n + r.issues.length, 0)
  lines.push('', `문제 합계: ${total} (${rows.length} 조합)`)
  writeFileSync(join(OUT, 'summary.md'), lines.join('\n') + '\n')
  console.log(`문제 합계: ${total} (${rows.length} 조합)`)
}

main()
