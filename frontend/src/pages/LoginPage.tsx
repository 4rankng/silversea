import React, { useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api/errors';
import { BRAND } from '../brand';
import { Btn } from '../components/UI';
import { TextField } from '../design-system/forms/TextField';
import './LoginPage.css';

export default function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [credentialError, setCredentialError] = useState(false);
  // SIL-563: validate on submit names the offending field — the submit button
  // stays enabled, the first invalid field takes focus, and the field's
  // aria-invalid points at the inline message.
  const [fieldError, setFieldError] = useState<'username' | 'password' | null>(null);
  // QA2-006: Caps Lock silently uppercases the password, so the typed value
  // stops matching what the operator thinks they entered and the login is
  // refused for no visible reason. Track the modifier while the field has
  // focus and say so, the standard pattern for password fields.
  const [capsLockOn, setCapsLockOn] = useState(false);
  const trackCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(e.getModifierState('CapsLock'));
  };
  const busy = useRef(false);
  const clearError = () => { setError(''); setCredentialError(false); setFieldError(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    // Card QA1-003: trust the DOM, not only our own state. Browser autofill
    // (and some IMEs) write into the inputs WITHOUT firing onChange, so
    // `username`/`password` can still be '' while the operator sees a filled
    // form — the old code then returned silently: no request, no error, and a
    // button that looked simply dead. Prefer the live input value whenever it
    // has something the state does not.
    const liveUsername = (document.getElementById('username-input') as HTMLInputElement | null)?.value ?? '';
    const livePassword = (document.getElementById('password-input') as HTMLInputElement | null)?.value ?? '';
    const finalUsername = (username || liveUsername).trim();
    const finalPassword = password || livePassword;
    // Calm per-field messages (house §8): name the field, focus it, let its
    // aria-invalid carry the state. No lecturing, no combined scold.
    if (!finalUsername) {
      setCredentialError(false);
      setFieldError('username');
      setError('Vui lòng nhập tên đăng nhập hoặc số điện thoại.');
      document.getElementById('username-input')?.focus();
      return;
    }
    if (!finalPassword) {
      setCredentialError(false);
      setFieldError('password');
      setError('Vui lòng nhập mật khẩu.');
      document.getElementById('password-input')?.focus();
      return;
    }
    busy.current = true;
    setSubmitting(true);
    clearError();
    try {
      await login(finalUsername, finalPassword);
    } catch (cause) {
      const credentialsRejected = cause instanceof ApiError && cause.status === 401;
      setCredentialError(credentialsRejected);
      setError(credentialsRejected ? 'Sai thông tin đăng nhập. Vui lòng thử lại.' : cause instanceof ApiError ? cause.message : 'Không thể kết nối để đăng nhập. Vui lòng thử lại.');
    } finally {
      busy.current = false;
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
            <form className="login-form" onSubmit={submit} noValidate aria-busy={submitting}>
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

              <div className="field ds-field">
                <label htmlFor="username-input" className="ds-field__label">Tên đăng nhập hoặc số điện thoại</label>
                  <TextField
                    id="username-input"
                    name="username"
                    prefix={<User size={18} aria-hidden="true" />}
                    value={username}
                    onChange={e => { setUsername(e.target.value); clearError(); }}
                    placeholder="VD: nv001 hoặc 0901 234 567"
                    autoComplete="username"
                    autoCapitalize="none"
                    aria-invalid={fieldError === 'username' || credentialError}
                    aria-describedby={error && (fieldError === 'username' || credentialError) ? 'login-error' : undefined}
                    required
                    autoFocus
                  />
              </div>

              <div className="field ds-field">
                <label htmlFor="password-input" className="ds-field__label">Mật khẩu</label>
                  <TextField
                    id="password-input"
                    name="password"
                    prefix={<Lock size={18} aria-hidden="true" />}
                    suffix={
                      <Btn
                        variant="ghost"
                        size="sm"
                        icon={showPw ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        onClick={() => setShowPw(!showPw)}
                        aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        aria-pressed={showPw}
                      />
                    }
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); clearError(); }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    aria-invalid={fieldError === 'password' || credentialError}
                    aria-describedby={[capsLockOn ? 'login-caps-hint' : null, error && (fieldError === 'password' || credentialError) ? 'login-error' : null].filter(Boolean).join(' ') || undefined}
                    onKeyDown={trackCapsLock}
                    onKeyUp={trackCapsLock}
                    onBlur={() => setCapsLockOn(false)}
                    required
                  />
                  {capsLockOn && (
                    <p id="login-caps-hint" className="login-caps-hint" role="status">Caps Lock đang bật.</p>
                  )}
              </div>

              {error && (
                <div id="login-error" className="login-error" role="alert">
                  {error}
                </div>
              )}

              <Btn
                variant="primary"
                className="login-submit"
                icon={!submitting ? <ArrowRight size={18} aria-hidden="true" /> : undefined}
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </Btn>

              <p className="login-help">
                Tài khoản được cấp bởi quản trị viên doanh nghiệp.
                {' '}Quên mật khẩu? Liên hệ quản trị viên của đơn vị để được đặt lại.
              </p>
            </form>
          </div>

          {/* Installed launch (user report 20/10): web-only chrome — the
              © footer and this marketing copy are hidden by the shared
              `hide-in-pwa` rule (styles/utilities.css), driven by the hybrid
              standalone detector on <html>. Browser visitors keep both. */}
          <footer className="login-footer hide-in-pwa">
            <span>&copy; {new Date().getFullYear()} {BRAND.legalEntity}</span>
          </footer>
        </div>

        {/* aria-label instead of aria-labelledby: when the marketing copy
            below is hidden in an installed PWA the referenced heading leaves
            the accessibility tree, which would dangle the reference. */}
        <aside className="login-visual" aria-label="Mọi hoạt động. Một hệ thống.">
          <picture>
            <source
              media="(max-width: 900px)"
              srcSet="/assets/illustrations/logistics-hero-van-mobile.webp"
            />
            <img
              src="/assets/illustrations/logistics-hero-van.webp"
              alt="Minh họa xe vận tải chở hàng trên tuyến giao hàng"
              className="login-visual__image"
              width="1024"
              height="1536"
              decoding="async"
              fetchPriority="high"
            />
          </picture>
          <div className="login-visual__veil" aria-hidden="true" />

          <div className="login-visual__content hide-in-pwa">
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
