// 시안 v4 — A2(조건 칩 한 줄)·A6(이름표)은 마크업이라 CSS 로 못 보인다. 스크린샷용으로만 DOM 을 옮긴다
// (실제 구현은 Dashboard.tsx SignalCards 안에서). 시안-카드.css 와 함께 얹는다.
// 줄 셋에 왼쪽 이름표: 시그널 [▲▼ 배지 · 매도 조건도] / 비중 [◆ 비중조절 배지 — 있을 때만] / 매수 조건 n/전체 [칩 전부]
for (const card of document.querySelectorAll('article.stock-card[data-ticker]')) {
  card.classList.add('signal-card')
  const rows = document.createElement('div')
  rows.className = 'signal-rows'
  const row = (label, items) => {
    const r = document.createElement('div')
    r.className = 'signal-row'
    const k = document.createElement('span')
    k.className = 'signal-row-label'
    k.textContent = label
    const v = document.createElement('div')
    v.className = 'signal-row-items'
    v.append(...items)
    r.append(k, v)
    rows.append(r)
  }
  const traffic = card.querySelector(':scope > .traffic')
  const badgeRow = card.querySelector(':scope > .badge-row')
  const sellToo = badgeRow ? [...badgeRow.children].filter((b) => !b.classList.contains('badge-purple')) : []
  const reasons = badgeRow ? [...badgeRow.children].filter((b) => b.classList.contains('badge-purple')) : []
  row('시그널', [traffic, ...sellToo].filter(Boolean))
  if (reasons.length) row('비중', reasons)
  const chips = [...card.querySelectorAll('.stat-box .cond')]
  const met = chips.filter((c) => c.classList.contains('met')).length
  if (chips.length) row(`매수 조건 ${met}/${chips.length}`, chips)
  card.querySelector('.stock-card-head').after(rows)
  badgeRow?.remove()
}
