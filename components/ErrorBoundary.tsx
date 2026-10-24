'use client'
import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { reportError } from '@/lib/error-reporting'

interface Props {
  children: ReactNode
  /** Short label for what failed, e.g. "the dashboard" - used in the fallback copy. */
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

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Solara caught a render error:', error)
    // A no-op unless the build has a Sentry DSN (lib/error-reporting.ts).
    reportError(error, {
      source: 'error-boundary',
      label: this.props.label,
      componentStack: info.componentStack,
    })
  }

  handleReset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  override render() {
    if (this.state.error) {
      const what = this.props.label ?? 'this section'
      return (
        <div className="card mx-auto my-6 max-w-[480px] px-[22px] py-7 text-center">
          <p className="mb-2.5 text-[34px]">🌥️</p>
          <h2 className="mb-2 text-[18px] font-[750] text-ink">
            Something went wrong loading {what}
          </h2>
          <p className="mb-[18px] text-[14px] leading-normal text-ink-3">
            This usually clears up on a retry. If it keeps happening, your saved data may be out of
            date.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <button className="btn btn-primary" onClick={this.handleReset}>
              Try again
            </button>
            <button
              className="btn"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload()
              }}
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
