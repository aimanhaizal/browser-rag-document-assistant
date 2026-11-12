import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LocalDoc AI recovered from a rendering error.', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="error-fallback" role="alert">
        <span className="eyebrow">INTERFACE ERROR</span>
        <h1>LocalDoc AI hit an unexpected display error.</h1>
        <p>Your indexed documents remain in this browser. Try restoring the interface; reload the page if the problem continues.</p>
        <details>
          <summary>Technical details</summary>
          <code>{this.state.error.message}</code>
        </details>
        <button className="primary-button" onClick={() => this.setState({ error: null })}>Restore interface</button>
      </main>
    )
  }
}
