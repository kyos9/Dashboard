import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/pwa'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 화면을 띄운 다음에 붙인다. 안 붙어도(개발 서버·http 접속) 화면은 그대로 돈다.
registerServiceWorker()
