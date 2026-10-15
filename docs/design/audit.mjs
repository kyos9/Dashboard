// 디자인 자동 검사 (DESIGN_PROMPT 3-2) — 기획자의 기준선과 검토자의 판정이 같은 잣대를 쓴다.
//
//   cd backend && python -m devtools.fake_server --reset      # 가짜 서버 (8150)
//   cd frontend && npm run build                                # 가짜 서버가 dist 를 연다
//   # 작업 폴더(저장소 밖)에서: npm i playwright
//   node <저장소>/docs/design/audit.mjs --out <작업 폴더>/audit [--quick] [--shots]
//
// 결과: <out>/results.json (문제 하나하나), <out>/summary.md (화면 × 조건 × 검사 수치)
// --quick: 폰 390 다크 + PC 1400 다크만.  --shots: 화면마다 첫 화면 스크린샷.
// --only <이름,...>: 그 화면만.  --base <주소>: 기본 http://127.0.0.1:8150
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// playwright 는 저장소에 넣지 않는다 — 실행하는 폴더의 node_modules 에서 찾는다
const require = createRequire(join(process.cwd(), 'noop.js'))
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const OUT = arg('--out', 'audit-out')
const BASE = arg('--base', 'http://127.0.0.1:8150')
const QUICK = args.includes('--quick')
const SHOTS = args.includes('--shots')
const ONLY = arg('--only', '')?.split(',').filter(Boolean)
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'

/* ---------- 조건 ---------- */

const VIEWPORTS = [
  { name: 'pc1400', width: 1400, height: 900, dsf: 1, phone: false },
  { name: 'ph390', width: 390, height: 844, dsf: 3, phone: true },
  { name: 'ph360', width: 360, height: 780, dsf: 3, phone: true },
]
// PC 브라우저 확대 150% = 창 폭 1400/1.5 ≈ 933 에 배율 1.5
const ZOOM150 = { name: 'pc-zoom150', width: 933, height: 600, dsf: 1.5, phone: false }

function conditions() {
  if (QUICK)
    return [
      { vp: VIEWPORTS[1], theme: 'dark', rise: 'green' },
      { vp: VIEWPORTS[0], theme: 'dark', rise: 'green' },
    ]
  const out = []
  for (const vp of VIEWPORTS) for (const theme of ['dark', 'light']) out.push({ vp, theme, rise: 'green' })
  out.push({ vp: VIEWPORTS[1], theme: 'dark', rise: 'red' })
  out.push({ vp: VIEWPORTS[1], theme: 'light', rise: 'red' }) // 2차: 빨강 + 라이트 대비
  out.push({ vp: ZOOM150, theme: 'dark', rise: 'green' })
  return out
}

/* ---------- 화면 ----------
   who: 누구로 들어가나 (null = 손님). path: 주소. act: 열고 나서 할 일(팝업 열기 등). */

// 2차: 폰 시그널 보기는 보기·설정 단추를 "보기·설정 ⋯" 안에 접는다(주인 결정). 접혀 있으면 펴고 누른다
async function clickViewTool(page, name, exact = false) {
  const target = page.getByRole('button', { name, exact }).first()
  if (!(await target.isVisible().catch(() => false))) {
    const fold = page.getByRole('button', { name: /^보기·설정/ })
    if (await fold.count()) await fold.first().click()
  }
  await page.getByRole('button', { name, exact }).first().click()
}

const clickText = (re) => async (page) => {
  await page.getByRole('button', { name: re }).first().click()
}
async function openMenu(page, label, pcLabel = label) {
  // PC 는 헤더 버튼(이름이 다를 수 있다), 폰은 ⋯ 메뉴 안
  for (const name of [label, pcLabel]) {
    const direct = page.getByRole('button', { name, exact: true })
    if (await direct.first().isVisible().catch(() => false)) return direct.first().click()
  }
  await page.getByRole('button', { name: /^메뉴/ }).first().click()
  await page.getByRole('button', { name: label }).first().click()
}

const SCREENS = [
  { name: 'guest-home', who: null, path: '/' },
  { name: 'guest-rebalance', who: null, path: '/rebalance' },
  { name: 'guest-macro', who: null, path: '/macro' },
  { name: 'pending', who: 'pending@example.com', path: '/' },
  { name: 'new-dashboard', who: 'new@example.com', path: '/' },
  { name: 'new-stocks', who: 'new@example.com', path: '/stocks' },
  { name: 'friend-dashboard', who: 'friend@example.com', path: '/' },
  { name: 'dash-portfolio', who: 'owner@example.com', path: '/', view: 'portfolio' },
  { name: 'dash-signal', who: 'owner@example.com', path: '/', view: 'signal' },
  {
    name: 'dash-holding-open',
    phoneOnly: true, // PC 는 표라 펼칠 줄이 없다
    who: 'owner@example.com',
    path: '/',
    view: 'portfolio',
    act: async (page) => page.locator('.holding-toggle').nth(1).click(),
  },
  {
    name: 'modal-stock-edit',
    who: 'owner@example.com',
    path: '/',
    view: 'portfolio',
    act: clickText(/종목 한 번에 수정/),
  },
  {
    name: 'modal-chart',
    who: 'owner@example.com',
    path: '/',
    view: 'signal',
    act: async (page) => {
      await page.locator('button.stock-name').first().click()
      await page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {})
    },
  },
  {
    name: 'modal-ai-summary',
    who: 'owner@example.com',
    path: '/',
    view: 'portfolio',
    act: clickText(/AI 포트폴리오 진단/),
  },
  { name: 'fundamentals', who: 'owner@example.com', path: '/fundamentals' },
  { name: 'rebalance', who: 'owner@example.com', path: '/rebalance' },
  { name: 'macro', who: 'owner@example.com', path: '/macro' },
  { name: 'history', who: 'owner@example.com', path: '/history' },
  { name: 'stocks', who: 'owner@example.com', path: '/stocks' },
  { name: 'policy', who: null, path: '/policy' },
  // 2차에서 더한 화면 — 차트 팝업의 다른 탭, 카드 보기, 시그널 기준, 매크로 차트, 종목 설정 표
  {
    name: 'dash-signal-cards',
    who: 'owner@example.com',
    path: '/',
    view: 'signal',
    act: async (page) => clickViewTool(page, '카드 보기', true),
  },
  {
    name: 'dash-signal-edit',
    who: 'owner@example.com',
    path: '/',
    view: 'signal',
    act: async (page) => clickViewTool(page, /종목 설정/),
  },
  {
    name: 'modal-thresholds',
    who: 'owner@example.com',
    path: '/',
    view: 'signal',
    act: async (page) => clickViewTool(page, /^시그널 기준/),
  },
  ...[
    ['modal-chart-fund', /재무/],
    ['modal-chart-ai', /AI/],
  ].map(([name, tab]) => ({
    name,
    who: 'owner@example.com',
    path: '/',
    view: 'signal',
    act: async (page) => {
      // 재무 탭은 재무가 있는 종목에만 있다(ETF 는 없다) — 탭이 있는 종목을 찾을 때까지 연다
      const names = page.locator('button.stock-name')
      for (let i = 0, n = await names.count(); i < n; i++) {
        await names.nth(i).click()
        await page.waitForSelector('[role=dialog] [role=tab]', { timeout: 15000 })
        const want = page.locator('[role=dialog]').getByRole('tab', { name: tab })
        if (await want.count()) return want.first().click()
        await page.locator('[role=dialog]').getByRole('button', { name: '닫기' }).first().click()
      }
    },
  })),
  // 조건이 하나 늘었다고 가정 (PROMPT 0장) — 규칙과 카드 응답에 긴 이름의 매수 조건을 하나 더한다.
  // DOM 에 끼워 넣지 않고 응답을 바꾼다: 칸 없는 조건이 그려지지 않는 문제(cond-missing)까지 잡으려고
  ...['dash-signal', 'dash-signal-cards'].map((base) => ({
    name: base + '-xcond',
    who: 'owner@example.com',
    path: '/',
    view: 'signal',
    xcond: true,
    act: base.endsWith('cards')
      ? async (page) => clickViewTool(page, '카드 보기', true)
      : undefined,
  })),
  {
    name: 'modal-macro-chart',
    who: 'owner@example.com',
    path: '/macro',
    act: async (page) => {
      await page.locator('button.macro-title').first().click()
      await page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {})
    },
  },
  { name: 'menu-display', who: 'owner@example.com', path: '/', act: (p) => openMenu(p, '화면 설정', '화면') },
  { name: 'menu-ai-key', who: 'owner@example.com', path: '/', act: (p) => openMenu(p, 'AI 키 설정') },
  { name: 'menu-push', who: 'owner@example.com', path: '/', act: (p) => openMenu(p, '알림 설정') },
  { name: 'menu-diagnostics', who: 'owner@example.com', path: '/', act: (p) => openMenu(p, '진단') },
  { name: 'menu-users', who: 'owner@example.com', path: '/', act: (p) => openMenu(p, /사용자/) },
]

/* ---------- 브라우저 안에서 재는 것 ---------- */

function measure(opts) {
  const { phone } = opts
  const out = []
  const add = (check, el, detail) => {
    out.push({ check, where: describe(el), text: (el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), ...detail })
  }
  function describe(el) {
    if (!el || el === document) return 'document'
    const parts = []
    let n = el
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase()
      if (n.id) s += '#' + n.id
      const cls = [...n.classList].slice(0, 2).join('.')
      if (cls) s += '.' + cls
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  function visible(el) {
    if (el.closest('[aria-hidden="true"], [hidden]')) return false
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false // 화면 읽기 전용(sr-only) 포함
    if (el.type === 'hidden') return false
    return true
  }
  function ownText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true
    return false
  }

  // 1. 페이지 가로 넘침
  if (document.documentElement.scrollWidth > innerWidth + 1)
    out.push({ check: 'page-overflow', where: 'document', text: '', px: document.documentElement.scrollWidth - innerWidth })

  // 팝업이 열려 있으면 팝업 안만 잰다 — 뒤 화면은 그 화면의 검사가 잰다
  const modals = [...document.querySelectorAll('.modal-backdrop, [role=dialog]')].filter(visible)
  const root = modals.length ? modals[modals.length - 1] : document.body
  const all = [root, ...root.querySelectorAll('*')].filter(
    (el) => !['SCRIPT', 'STYLE', 'svg', 'SVG', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) && !el.closest('svg'),
  )
  const textEls = all.filter((el) => ownText(el) && visible(el))

  // 2. 잘린 글 — 자기나 조상의 overflow 가 hidden/clip 이고 글이 그 밖으로 나간다 (스크롤 영역은 허용)
  const clipping = (cs) => /hidden|clip/.test(cs.overflowX + cs.overflowY)
  for (const el of textEls) {
    const cs = getComputedStyle(el)
    if (clipping(cs) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      add('clipped', el, { how: 'self' })
      continue
    }
    const r = el.getBoundingClientRect()
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a)
      if (!clipping(acs)) continue
      const ar = a.getBoundingClientRect()
      if (ar.width < 2 || ar.height < 2) break // sr-only 묶음
      if (r.right > ar.right + 1 || r.left < ar.left - 1 || r.bottom > ar.bottom + 1 || r.top < ar.top - 1) {
        add('clipped', el, { how: 'ancestor', ancestor: describe(a) })
      }
      break
    }
  }

  // 줄 나누기: 글자마다 Range 를 만들어 top 으로 묶는다
  function lines(el) {
    const tops = []
    const counts = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.parentElement || !visible(t.parentElement)) continue
      const s = t.textContent
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i])) continue
        range.setStart(t, i)
        range.setEnd(t, i + 1)
        const rect = range.getClientRects()[0]
        if (!rect || rect.width === 0) continue
        const lh = rect.height || 16
        let k = tops.findIndex((y) => Math.abs(y - rect.top) < lh * 0.5)
        if (k < 0) {
          tops.push(rect.top)
          counts.push(0)
          k = tops.length - 1
        }
        counts[k]++
      }
    }
    const order = tops.map((y, i) => [y, counts[i]]).sort((a, b) => a[0] - b[0])
    return order.map((x) => x[1])
  }
  function kind(el) {
    if (el.closest('button, [role=button], [role=tab], .tab-bar a')) return 'button'
    if (/badge|chip|pill|tag|\bcond\b/.test(el.className && el.className.baseVal === undefined ? el.className : ''))
      return 'badge'
    if (el.closest('h1,h2,h3,h4,h5,h6,.kpi-title,.modal-title')) return 'title'
    if (el.closest('label, th, dt')) return 'label'
    return 'para'
  }
  // 줄을 재는 단위: 인라인이 아닌 글 요소 (인라인 조각은 부모가 함께 잰다)
  const blocks = textEls.filter((el) => {
    const d = getComputedStyle(el).display
    return d !== 'inline' && d !== 'contents'
  })
  for (const el of blocks) {
    // 일부러 <br> 로 나눈 글(표 머리 "현재가 / (전일 대비)")은 줄 수가 뜻이다 — 외톨이·접힘에서 뺀다
    if (el.querySelector('br')) continue
    const ls = lines(el)
    const k = kind(el)
    // 3. 외톨이 줄
    if (ls.length >= 2 && ls[ls.length - 1] <= 4) add('orphan', el, { kind: k, lines: ls.length, last: ls[ls.length - 1] })
    // 5. 접힌 짧은 요소
    if (k !== 'para' && k !== 'title') {
      if (ls.length >= 3) add('folded3', el, { kind: k, lines: ls.length })
      else if (ls.length === 2 && opts.width <= 360 && k === 'button') add('folded2-360', el, { kind: k })
    }
  }

  // 4. 숫자·단위 갈라짐
  // 2차: 앞에 붙는 부호·통화 기호도 본다 — 리밸런싱 "· +" 줄 끝, "₩81,312,880" 다음 줄 (1차 식은 뒤 단위만 봤다)
  const NUM = /[+\-−]?[\d,.]+\s?(원|%p?|주|개|달러|엔|배|억|만)|[+\-−]?\s?[₩$¥€]\s?\d[\d,.]*|[+\-−]\d[\d,.]*/g
  const range = document.createRange()
  for (const el of textEls) {
    for (const t of el.childNodes) {
      if (t.nodeType !== 3) continue
      for (const m of t.textContent.matchAll(NUM)) {
        range.setStart(t, m.index)
        range.setEnd(t, m.index + m[0].length)
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)))
        if (tops.size > 1) add('num-split', el, { match: m[0] })
      }
    }
  }

  // 4-2. 묶음 깨짐 (2차) — .nowrap 으로 묶은 요소가 두 줄 이상. 글을 span 으로 나누면 4 의 식이 못 본다
  for (const el of root.querySelectorAll('.nowrap')) {
    if (!visible(el)) continue
    if (lines(el).length > 1) add('nowrap-split', el, {})
  }

  // 4-3. 가로 sticky (2차) — 붙이기로 한 표(.signal-table, .sticky-first — 주인 결정 ②) 밖에서 left 로 붙는 칸이 생기면 회귀
  for (const el of root.querySelectorAll('th, td')) {
    const cs = getComputedStyle(el)
    if (cs.position === 'sticky' && cs.left !== 'auto' && !el.closest('.signal-table, .sticky-first')) add('sticky-left', el, {})
  }

  // 4-4. 어포던스 (2차, 주인 요청 "어포던스도 고려해줘") — 보이는 꼴과 할 수 있는 일이 맞는가.
  //   fake-button: 누를 수 없는데 단추처럼 생긴 것 — 테두리나 바탕이 있는 둥근 상자, 높이 34px 이상, 글 짧음
  //   quiet-target: 누를 수 있는데 단추·링크로 안 보이는 것 — 테두리·바탕·밑줄이 없고 글자색도 본문과 같다
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, label, [role=button], [role=tab], [role=link], [role=switch], [tabindex]:not([tabindex="-1"])'
  const px = (v) => parseFloat(v) || 0
  const opaque = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return false
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return parts.length < 4 || parts[3] > 0.02
  }
  const bodyColor = getComputedStyle(document.body).color
  // 펼침·이동 표시(▸ ▾ › → ↓ ▴)를 ::before/::after 로 단 것은 단서가 있는 것으로 본다
  const cue = (el) => {
    for (const n of [el, ...el.querySelectorAll('*')].slice(0, 40))
      for (const pseudo of ['::before', '::after'])
        if (/[▸▾›→↓▴⌄]/.test(getComputedStyle(n, pseudo).content)) return true
    // 안쪽 글에 밑줄(링크처럼)이 있어도 단서다
    for (const n of el.querySelectorAll('*')) if (/underline/.test(getComputedStyle(n).textDecorationLine)) return true
    return false
  }
  for (const el of all) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const interactive = el.matches(INTERACTIVE)
    if (!interactive && !el.closest(INTERACTIVE) && !el.querySelector(INTERACTIVE) && !el.closest('.chart, .chart-box, .tv-lightweight-charts, table, svg')) {
      const boxed =
        (px(cs.borderTopWidth) >= 1 && opaque(cs.borderTopColor)) || (opaque(cs.backgroundColor) && cs.backgroundColor !== getComputedStyle(el.parentElement || el).backgroundColor)
      const text = (el.textContent || '').trim()
      if (
        boxed &&
        px(cs.borderTopLeftRadius) >= 6 &&
        r.height >= 34 &&
        r.height <= 80 &&
        r.width <= 260 &&
        text.length > 0 &&
        text.length <= 14 &&
        el.children.length <= 4 &&
        cs.cursor !== 'pointer'
      )
        add('fake-button', el, { h: Math.round(r.height), w: Math.round(r.width) })
    }
    if (el.matches('button, a[href], [role=button], summary') && !el.closest('nav, .tab-bar, .tv-lightweight-charts')) {
      const flat =
        !(px(cs.borderTopWidth) >= 1 && opaque(cs.borderTopColor)) &&
        !(px(cs.borderBottomWidth) >= 1 && opaque(cs.borderBottomColor)) &&
        !opaque(cs.backgroundColor) &&
        !/underline/.test(cs.textDecorationLine) &&
        !el.querySelector('svg, img') &&
        !cue(el) &&
        cs.color === bodyColor
      if (flat && (el.textContent || '').trim()) add('quiet-target', el, { cursor: cs.cursor })
    }
  }

  // 6. 터치 대상 (폰만)
  if (phone) {
    const targets = [...root.querySelectorAll('button, a[href], input, select, textarea, [role=button], summary')]
    for (const el of targets) {
      if (!visible(el) || el.disabled) continue
      if (el.closest('.chart, .chart-box, .tv-lightweight-charts')) continue
      let r = el.getBoundingClientRect()
      if (el.tagName === 'INPUT' && /checkbox|radio/.test(el.type)) {
        const lab = el.closest('label')
        if (lab) r = lab.getBoundingClientRect()
      }
      // 문장 속 링크는 예외
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
        const p = el.parentElement
        if (p && [...p.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)) continue
      }
      if (r.width < 43.5 || r.height < 43.5)
        add('touch', el, { w: Math.round(r.width), h: Math.round(r.height) })
    }
  }

  // 7. 대비
  function parse(c) {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  })
  function background(el) {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage)) return null
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) {
        layers.push(c)
        if (c.a >= 1) break
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg)
    return bg
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  for (const el of textEls) {
    if (el.closest(':disabled, [aria-disabled="true"]')) continue
    const cs = getComputedStyle(el)
    const fg0 = parse(cs.color)
    const bg = background(el)
    if (!fg0 || !bg) continue
    let alpha = fg0.a
    for (let n = el; n; n = n.parentElement) alpha *= +getComputedStyle(n).opacity
    const fg = over({ ...fg0, a: alpha }, bg)
    const L1 = lum(fg), L2 = lum(bg)
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    if (ratio < 4.5) add('contrast', el, { ratio: +ratio.toFixed(2), color: cs.color, size: cs.fontSize })
  }
  return out
}

/* ---------- 실행 ---------- */

const CHECKS = ['page-overflow', 'clipped', 'orphan', 'num-split', 'folded3', 'folded2-360', 'touch', 'contrast', 'console', 'cond-missing', 'nowrap-split', 'sticky-left', 'fake-button', 'quiet-target']

const XCOND = {
  key: 'audit_extra_condition',
  metric: 'audit_extra',
  label: '변동성 축소(20일) 길게 쓴 조건',
  detail: '자동 검사가 더한 가짜 조건 — 이름이 긴 경우',
  header: '긴 조건 머리',
  formula: '변동성 축소(20일) 길게 쓴 조건',
}
async function routeExtraCondition(page) {
  await page.route('**/api/signal-rules', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const buy = body.rules?.find((r) => r.key === 'buy')
    if (buy) buy.conditions.push(XCOND)
    await route.fulfill({ response: res, json: body })
  })
  await page.route('**/api/dashboard', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    if (Array.isArray(body))
      for (const c of body) {
        c.buy_conditions = { ...(c.buy_conditions || c.knee_conditions || {}), [XCOND.key]: true }
      }
    await route.fulfill({ response: res, json: body })
  })
}

// 카드마다 그려진 매수 조건 칩 수가 규칙의 조건 수와 같은가 + 카드 높이
async function cardChecks(page) {
  return page.evaluate(async () => {
    // 시그널 카드만(매크로 카드도 .stock-card 다) — 그 밖의 화면에서는 규칙을 받지 않는다(손님은 401)
    const cards = [...document.querySelectorAll('article.stock-card[data-ticker]')].filter((c) => c.getBoundingClientRect().height > 0)
    if (!cards.length && !document.querySelector('.cond-mark')) return { issues: [], heights: [] }
    let want = null
    try {
      const rules = await (await fetch('/api/signal-rules')).json()
      want = rules.rules?.find((r) => r.key === 'buy')?.conditions.length ?? null
    } catch {}
    const issues = []
    // 표 보기: 줄마다 조건 표시(.cond-mark) 수
    const rows = [...document.querySelectorAll('tr[data-ticker], tbody tr')].filter(
      (tr) => tr.querySelector('.cond-mark') && tr.getBoundingClientRect().height > 0,
    )
    for (const tr of rows) {
      const got = tr.querySelectorAll('.cond-mark').length
      if (want !== null && got !== want)
        issues.push({ check: 'cond-missing', where: 'tr', text: tr.dataset.ticker || tr.textContent.trim().slice(0, 20), got, want })
    }
    for (const c of cards) {
      const got = c.querySelectorAll('.cond').length
      if (want !== null && got !== want)
        issues.push({ check: 'cond-missing', where: 'article.stock-card', text: c.dataset.ticker || '', got, want })
    }
    const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height)).sort((a, b) => a - b)
    return { issues, heights }
  })
}

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

async function main() {
  mkdirSync(OUT, { recursive: true })
  if (SHOTS) mkdirSync(join(OUT, 'shots'), { recursive: true })
  const browser = await chromium.launch({ executablePath: EXEC })
  const states = {}
  const results = []
  const screens = SCREENS.filter((s) => !ONLY?.length || ONLY.includes(s.name))
  for (const s of screens) if (s.who && !states[s.who]) states[s.who] = await loginState(browser, s.who)

  for (const cond of conditions()) {
    const tag = `${cond.vp.name}-${cond.theme}${cond.rise === 'red' ? '-risered' : ''}`
    for (const s of screens) {
      if (s.phoneOnly && !cond.vp.phone) continue
      const ctx = await browser.newContext({
        storageState: s.who ? states[s.who] : undefined,
        viewport: { width: cond.vp.width, height: cond.vp.height },
        deviceScaleFactor: cond.vp.dsf,
        isMobile: cond.vp.phone,
        hasTouch: cond.vp.phone,
        colorScheme: cond.theme,
        reducedMotion: 'reduce',
      })
      await ctx.addInitScript(
        ([theme, rise, view]) => {
          try {
            localStorage.setItem('dashboard.theme', theme)
            localStorage.setItem('dashboard.rise', rise)
            if (view) localStorage.setItem('dashboard.view', view)
            localStorage.setItem('dashboard.install-hint-dismissed', '1')
          } catch {}
        },
        [cond.theme, cond.rise, s.view || null],
      )
      const page = await ctx.newPage()
      if (s.xcond) await routeExtraCondition(page)
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e.message || e)))
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      let issues = []
      let failed = null
      let heights = []
      try {
        await page.goto(BASE + s.path, { waitUntil: 'networkidle' })
        if (s.act) {
          await s.act(page)
          if (s.name.startsWith('modal-') || s.name.startsWith('menu-'))
            await page.waitForSelector('.modal-backdrop, [role=dialog]', { timeout: 10000 })
          await page.waitForLoadState('networkidle')
        }
        await page.waitForTimeout(400)
        issues = await page.evaluate(measure, { phone: cond.vp.phone, width: cond.vp.width })
        const cc = await cardChecks(page)
        issues.push(...cc.issues)
        heights = cc.heights
        if (SHOTS) await page.screenshot({ path: join(OUT, 'shots', `${s.name}--${tag}.png`) })
      } catch (e) {
        failed = String(e.message || e).split('\n')[0]
      }
      for (const e of errors) issues.push({ check: 'console', where: 'console', text: e.slice(0, 200) })
      results.push({ screen: s.name, cond: tag, failed, issues, cardHeights: heights })
      await ctx.close()
      process.stdout.write(`${tag} ${s.name}: ${failed ? 'FAILED ' + failed : issues.length}\n`)
    }
  }
  await browser.close()
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1))
  writeFileSync(join(OUT, 'summary.md'), summarize(results))
}

function summarize(results) {
  const total = Object.fromEntries(CHECKS.map((c) => [c, 0]))
  const orphanByKind = {}
  const rows = []
  const cardRows = []
  for (const r of results) {
    const n = Object.fromEntries(CHECKS.map((c) => [c, 0]))
    for (const i of r.issues) {
      n[i.check]++
      total[i.check]++
      if (i.check === 'orphan') orphanByKind[i.kind] = (orphanByKind[i.kind] || 0) + 1
    }
    if (r.cardHeights?.length) {
      const h = r.cardHeights
      cardRows.push(`| ${r.screen} | ${r.cond} | ${h.length} | ${h[Math.floor((h.length - 1) / 2)]} | ${h[0]}~${h[h.length - 1]} |`)
    }
    rows.push(`| ${r.screen} | ${r.cond} | ${r.failed ? '실패: ' + r.failed.slice(0, 40) : ''} | ${CHECKS.map((c) => n[c]).join(' | ')} |`)
  }
  return [
    '# 자동 검사 결과',
    '',
    `화면×조건 ${results.length}개, 열지 못한 것 ${results.filter((r) => r.failed).length}개`,
    '',
    '| 검사 | 합계 |',
    '| --- | --- |',
    ...CHECKS.map((c) => `| ${c} | ${total[c]} |`),
    '',
    `외톨이 줄 종류별: ${Object.entries(orphanByKind).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
    '',
    `| 화면 | 조건 | 상태 | ${CHECKS.join(' | ')} |`,
    `| --- | --- | --- | ${CHECKS.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
    '## 카드 높이 (px, 시그널 카드 보기)',
    '',
    '| 화면 | 조건 | 카드 수 | 중앙값 | 범위 |',
    '| --- | --- | --- | --- | --- |',
    ...cardRows,
    '',
  ].join('\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
