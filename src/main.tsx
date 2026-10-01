import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (this.state.failed) return <main className="fatal-error"><h1>PR Match hit a snag</h1><p>Your saved settings are still in Chrome. Reload the extension to try again.</p><button onClick={() => window.location.reload()}>Reload PR Match</button></main>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>)
