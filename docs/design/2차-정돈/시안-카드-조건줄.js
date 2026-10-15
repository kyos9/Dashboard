// 시안 둘째 판 — A2(조건 칩을 "매수 조건" 한 줄로)·A6("비중" 이름표)은 마크업이라 CSS 로 못 보인다.
// 스크린샷용으로만 화면의 DOM 을 옮긴다(실제 구현은 Dashboard.tsx 같은 컴포넌트 안에서). 시안-카드.css 와 함께 얹는다.
for (const card of document.querySelectorAll('article.stock-card[data-ticker]')) {
  card.classList.add('signal-card')
  const chips = [...card.querySelectorAll('.stat-box .cond')]
  if (chips.length) {
    const row = document.createElement('div')
    row.className = 'cond-row'
    const k = document.createElement('span')
    k.className = 'cond-row-label'
    k.textContent = '매수 조건'
    row.append(k, ...chips)
    card.querySelector('.stat-grid').before(row)
  }
  const reasons = card.querySelector(':scope > .badge-row')
  if (reasons) {
    const k = document.createElement('span')
    k.className = 'badge-row-label'
    k.textContent = '비중'
    reasons.prepend(k)
  }
}
