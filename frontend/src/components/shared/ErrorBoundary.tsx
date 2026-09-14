import React, { Component } from 'react';
import { RotateCw, WifiOff } from 'lucide-react';
import { EmptyIllustration } from './EmptyIllustration';
import { isChunkFailureMessage, recoverFromChunkFailure } from '../../lib/chunk-error';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  recovering: boolean;
  networkChunkError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, recovering: false, networkChunkError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error: error instanceof Error ? error : new Error(String(error)), recovering: false, networkChunkError: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);

    if (!isChunkFailureMessage(error.message)) return;

    // The error looks chunk-related.  Try the self-heal (which only fires
    // when the message names a specific hashed chunk file — the hallmark of
    // a stale build).  If the heal is exhausted or skipped (generic network
    // error), tell the user what actually happened instead of showing a
    // misleading "new version" panel.
    const healResult = recoverFromChunkFailure();
    if (healResult === 'reloading') {
      this.setState({ recovering: true, networkChunkError: false });
    } else {
      // recoverFromChunkFailure returned 'exhausted' — either the cooldown
      // is active (already tried) or the error didn't match the stale-build
      // pattern.  Show a network-aware message.
      this.setState({ networkChunkError: true });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, networkChunkError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.state.recovering) {
        return (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-3xl, 48px)', gap: 'var(--space-lg, 16px)', textAlign: 'center',
          }}>
            <RotateCw size={18} className="animate-spin" />
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
              Ứng dụng vừa được cập nhật — đang tải phiên bản mới…
            </p>
          </div>
        );
      }
      if (this.state.networkChunkError) {
        return (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-3xl, 48px)', gap: 'var(--space-lg, 16px)', textAlign: 'center',
          }}>
            <WifiOff size={24} style={{ color: 'var(--ink-3)' }} />
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>
                Không thể tải trang
              </h3>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                Thiết bị đang mất kết nối hoặc máy chủ không phản hồi.
                Vui lòng kiểm tra mạng và tải lại trang.
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 'var(--r-sm, 8px)', border: '1px solid var(--line)',
                background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              <RotateCw size={14} /> Tải lại trang
            </button>
          </div>
        );
      }
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
