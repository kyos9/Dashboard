import { NavLink } from 'react-router-dom'

const linkStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: '8px 14px',
  borderRadius: 8,
  textDecoration: 'none',
  color: isActive ? '#fff' : '#333',
  background: isActive ? '#2563eb' : 'transparent',
  fontWeight: 600,
  fontSize: 14,
})

export function NavBar() {
  return (
    <nav
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 20px',
        borderBottom: '1px solid #e5e7eb',
        alignItems: 'center',
      }}
    >
      <strong style={{ marginRight: 16, fontSize: 16 }}>신호판</strong>
      <NavLink to="/" style={linkStyle} end>
        대시보드
      </NavLink>
      <NavLink to="/history" style={linkStyle}>
        히스토리 차트
      </NavLink>
      <NavLink to="/rebalance" style={linkStyle}>
        리밸런싱
      </NavLink>
      <NavLink to="/stocks" style={linkStyle}>
        종목 관리
      </NavLink>
    </nav>
  )
}
