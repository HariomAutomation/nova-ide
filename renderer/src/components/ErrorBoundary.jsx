import { Component } from 'react';

/**
 * Turns an invisible render crash (white screen) into a readable message.
 * A React error inside a component tree otherwise unmounts the whole app.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Nova UI error:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="err-boundary">
        <div className="err-boundary-title">{this.props.title || 'Something broke in this view'}</div>
        <pre className="err-boundary-msg">{String((error && error.message) || error)}</pre>
        <div className="err-boundary-actions">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
