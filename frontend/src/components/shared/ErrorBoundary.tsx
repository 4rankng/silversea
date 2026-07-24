import React, { Component } from 'react';
import { RotateCw } from 'lucide-react';
import { EmptyIllustration } from './EmptyIllustration';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 'var(--space-3xl, 48px)', gap: 'var(--space-lg, 16px)', textAlign: 'center',
        }}>
          <EmptyIllustration name="empty-error" width={156} height={124} />
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>Đã xảy ra lỗi</h3>
            <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {this.state.error?.message || 'Không thể hiển thị nội dung này.'}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 'var(--r-sm, 8px)', border: '1px solid var(--line)',
              background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            <RotateCw size={14} /> Thử lại
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
