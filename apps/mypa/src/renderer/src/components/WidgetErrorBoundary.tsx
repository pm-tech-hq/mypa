import { Component, type ReactNode } from "react";

/**
 * Keeps one broken widget from taking the whole board down: if a widget
 * throws while drawing, only its own body is replaced with a short notice.
 */
export class WidgetErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[widget] ${this.props.name} crashed:`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="widget-crash" role="alert">
        <p className="widget-crash__title">This widget hit a problem</p>
        <p className="widget-crash__detail">{this.state.error.message || String(this.state.error)}</p>
        <button type="button" className="widget-crash__retry" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
