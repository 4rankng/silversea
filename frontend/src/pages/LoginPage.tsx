import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { BRAND } from '../brand';
import './LoginPage.css';

export default function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setSubmitting(true);
    setError('');
    try {
      await login(username, password);
    } catch {
      setError('Sai thông tin đăng nhập. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-auth-panel">
          <header className="login-topbar">
            <div className="login-brand">
              <span className="login-brand__logo">
                <img src={BRAND.logoPath} alt="" />
              </span>
              <span className="login-brand__copy">
                <strong>{BRAND.name}</strong>
                <span>{BRAND.shellDescriptor}</span>
              </span>
            </div>

            <span className="login-security">
              <ShieldCheck size={15} aria-hidden="true" />
              Kết nối bảo mật
            </span>
          </header>

          <div className="login-form-wrap">
            <form className="login-form" onSubmit={submit}>
              <div className="login-intro">
                <p className="login-eyebrow">Cổng vận hành</p>
                <h1 id="login-title">Chào mừng trở lại</h1>
                <p className="login-subtitle">
                  Đăng nhập để tiếp tục quản lý vận tải và logistics.
                </p>
              </div>

              {sessionExpired && (
                <div className="login-session-notice" role="status">
                  Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.
                </div>
              )}

              <div className="field">
                <label htmlFor="username-input">Tên đăng nhập hoặc số điện thoại</label>
                <div className="input-icon">
                  <User size={18} aria-hidden="true" />
                  <input
                    id="username-input"
                    name="username"
                    className="input"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Nhập tên đăng nhập hoặc số điện thoại"
                    autoComplete="username"
                    autoCapitalize="none"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'login-error' : undefined}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="password-input">Mật khẩu</label>
                <div className="input-icon">
                  <Lock size={18} aria-hidden="true" />
                  <input
                    id="password-input"
                    name="password"
                    className="input"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                    autoComplete="current-password"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'login-error' : undefined}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPw(!showPw)}
                    aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-pressed={showPw}
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && (
                <div id="login-error" className="login-error" role="alert">
                  {error}
                </div>
              )}

              <button
                className="btn btn--primary btn--lg login-submit"
                type="submit"
                disabled={!username || !password || submitting}
                aria-busy={submitting}
              >
                <span>{submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}</span>
                {!submitting && <ArrowRight size={18} aria-hidden="true" />}
              </button>

              <p className="login-help">
                Tài khoản được cấp bởi quản trị viên doanh nghiệp.
              </p>
            </form>
          </div>

          <footer className="login-footer">
            <span>&copy; {new Date().getFullYear()} {BRAND.name}</span>
          </footer>
        </div>

        <aside className="login-visual" aria-labelledby="login-visual-title">
          <picture>
            <source
              media="(max-width: 900px)"
              srcSet="/assets/illustrations/login-business-control-mobile-v3.webp"
            />
            <img
              src="/assets/illustrations/login-business-control-v3.webp"
              alt=""
              className="login-visual__image"
              width="1024"
              height="1536"
              decoding="async"
              fetchPriority="high"
            />
          </picture>
          <div className="login-visual__veil" aria-hidden="true" />

          <div className="login-visual__content">
            <p className="login-visual__eyebrow">
              <span className="login-status-dot" />
              Một nguồn dữ liệu
            </p>
            <h2 id="login-visual-title">Mọi hoạt động. Một hệ thống.</h2>
            <p>
              Tập trung chuyến, đội xe, chi phí, chứng từ và công nợ thay cho dữ liệu rời rạc
              trên nhiều công cụ.
            </p>
            <ul className="login-capabilities" aria-label="Năng lực hệ thống">
              <li>Điều hành tập trung</li>
              <li>Tài chính rõ ràng</li>
              <li>Quyết định nhanh hơn</li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
