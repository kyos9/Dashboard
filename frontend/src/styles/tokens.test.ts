import { describe, expect, it } from 'vitest'

/*
 * 색표 지키기 — 디자인 4차 (DESIGN_PROMPT v6 "만드는 법 다섯" 3).
 * 색 값은 styles/tokens.css 에만 쓴다. CSS 변수를 못 쓰는 곳(index.html 의 theme-color, manifest)은
 * tokens.css 의 --bg 와 같은 값이어야 한다.
 *
 * 테스트 설정이 CSS 를 싣지 않아(css: false) `?raw` 로 읽은 CSS 가 빈 글이 된다 — 그래서 파일을 직접 읽는다.
 * (tsconfig 에 node 타입이 없어 이름을 변수로 불러온다)
 */
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string
  readdirSync(path: string): string[]
  statSync(path: string): { isDirectory(): boolean }
}
const fsName = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsName)) as Fs
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd() // vitest 는 frontend 에서 돈다
const read = (rel: string) => fs.readFileSync(`${cwd}/${rel}`, 'utf8')

function files(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(`${cwd}/${dir}`).flatMap((name) => {
    const rel = `${dir}/${name}`
    if (fs.statSync(`${cwd}/${rel}`).isDirectory()) return files(rel, ext)
    return ext.test(name) ? [rel] : []
  })
}

const tokens = read('src/styles/tokens.css')

function bgOf(selector: string): string {
  const block = tokens.slice(tokens.indexOf(selector))
  const m = /--bg:\s*(#[0-9a-fA-F]{6})/.exec(block)
  if (!m) throw new Error(`${selector} 에 --bg 가 없다`)
  return m[1].toLowerCase()
}

// 색 값 — hex, rgb()/hsl()/oklch(), color-mix(). currentColor 를 섞는 것만 허용(색표의 색이 아니라 글자색의 옅은 꼴)
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|color-mix\((?![^)]*currentColor)/
// CSS 속성 값 안의 이름 색(white·black …) — 변수 이름(--red)은 빼고
const NAMED = /^\s*[a-z-]+\s*:[^;{]*(?<![-\w])(?:white|black|red|blue|green|gray|grey|orange|purple|yellow|navy|silver)\b/

describe('색표 (tokens.css)', () => {
  it('index.html 과 manifest 의 바탕색이 tokens.css 의 --bg 와 같다', () => {
    const dark = bgOf(':root {\n  color-scheme: dark;')
    const light = bgOf(":root[data-theme='light']")
    const html = read('index.html').toLowerCase()
    expect(html).toContain(`name="theme-color" content="${dark}"`)
    expect(html).toContain(`'${light}'`)
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { background_color: string; theme_color: string }
    expect(manifest.background_color.toLowerCase()).toBe(dark)
    expect(manifest.theme_color.toLowerCase()).toBe(dark)
  })

  it('tokens.css 밖의 스타일과 화면 코드에 색 값을 직접 쓰지 않는다', () => {
    const css = [...files('src/styles', /\.css$/).filter((f) => !f.endsWith('/tokens.css')), 'src/index.css']
    const code = files('src', /\.tsx?$/).filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('src/test/'))
    expect(css.length).toBeGreaterThan(30)
    expect(code.length).toBeGreaterThan(50)
    const found = [...css, ...code].flatMap((f) =>
      read(f)
        .split('\n')
        .map((line, i) => ({ f, n: i + 1, line }))
        .filter(({ f, line }) => COLOR.test(line) || (f.endsWith('.css') && !/white-space/.test(line) && NAMED.test(line))),
    )
    expect(found.map(({ f, n, line }) => `${f}:${n} ${line.trim()}`)).toEqual([])
  })

  it('라이트의 글자 회색 · 뜻 색은 Tailwind 기본값이 아니다 — 청람 먹으로 다시 뽑았고 바탕 위 대비 4.5 이상 (목업 13 ①)', () => {
    const light = tokens.slice(tokens.indexOf(":root[data-theme='light']"))
    const block = light.slice(0, light.indexOf('}'))
    const val = (name: string) => {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)
      if (!m) throw new Error(`라이트에 --${name} 가 없다`)
      return m[1].toLowerCase()
    }
    // gray-900 · gray-700 · green-800 · red-700 · amber-800 · blue-700 · teal-700
    const TAILWIND = ['#111827', '#374151', '#166534', '#b91c1c', '#92400e', '#1d4ed8', '#0f766e']
    const names = ['text', 'text-dim', 'text-faint', 'green', 'red', 'amber', 'rise-down', 'teal-sig']
    for (const n of names) expect(TAILWIND).not.toContain(val(n))
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    for (const n of names) for (const bg of [val('bg'), val('panel'), val('panel-soft')]) expect(ratio(val(n), bg)).toBeGreaterThanOrEqual(4.5)
  })
})
