import { NavLink } from 'react-router-dom'

export function NavBar() {
  return (
    <nav className="navbar">
      <strong className="navbar-brand">신호판</strong>
      <NavLink to="/" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} end>
        대시보드
      </NavLink>
      <NavLink to="/history" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
        히스토리 차트
      </NavLink>
      <NavLink to="/rebalance" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
        리밸런싱
      </NavLink>
      <NavLink to="/stocks" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
        종목 관리
      </NavLink>
    </nav>
  )
}
