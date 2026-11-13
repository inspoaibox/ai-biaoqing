import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('应用运行异常', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32, background: '#f7f8fa', color: '#20242b', fontFamily: 'system-ui, sans-serif' }}>
        <section style={{ width: 'min(560px, 100%)', padding: 28, borderRadius: 18, background: '#fff', boxShadow: '0 18px 60px rgba(32, 36, 43, .12)' }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>页面遇到异常，但数据仍然保留</h1>
          <p style={{ margin: '0 0 18px', lineHeight: 1.7, color: '#68707d' }}>请刷新页面继续使用。如果问题反复出现，可以到任务记录查看最后一次请求的原始记录。</p>
          <button type="button" onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: '10px 16px', background: '#2f6bff', color: '#fff', cursor: 'pointer' }}>刷新页面</button>
        </section>
      </main>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
