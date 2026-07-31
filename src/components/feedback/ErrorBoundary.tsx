import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorPanel } from './ErrorPanel'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('VibeCheck render error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return <main className="page-container"><ErrorPanel title="页面出现问题" message="原型未能完成本次渲染。" detail={this.state.error.message} onRetry={() => this.setState({ error: null })} /></main>
    }
    return this.props.children
  }
}
