'use client'
import type { ReactNode } from 'react'
import { Component } from 'react'

interface Props {
  children: ReactNode
  /** Short label for what failed, e.g. "the dashboard" — used in the fallback copy. */
  label?: string
  /** Optional callback to recover (e.g. refetch). When provided, a Retry button is shown. */
  onReset?: () => void
}

interface State {
  error: Error | null
}

/**
 * Catches render/runtime errors in a subtree so one bad weather payload (or any
 * component crash) shows a recoverable card instead of white-screening the whole app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error) {
    // Surface in the console for debugging; analytics hook can attach here later.
    console.error('Solara caught a render error:', error)
  }

  handleReset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  override render() {
    if (this.state.error) {
      const what = this.props.label ?? 'this section'
      return (
        <div className="card" style={{ textAlign: 'center', padding: '28px 22px', maxWidth: '480px', margin: '24px auto' }}>
          <p style={{ fontSize: '34px', margin: '0 0 10px' }}>🌥️</p>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 750, color: 'var(--text)' }}>
            Something went wrong loading {what}
          </h2>
          <p style={{ margin: '0 0 18px', fontSize: '14px', color: 'var(--text-3)', lineHeight: 1.5 }}>
            This usually clears up on a retry. If it keeps happening, your saved data may be out of date.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={this.handleReset}>Try again</button>
            <button
              className="btn"
              onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}
            >
              Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
