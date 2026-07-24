import React, { useState } from 'react';
import { User, Lock, Eye, EyeOff } from 'lucide-react';
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
      <div className="login-card">
        <form className="login-form" onSubmit={submit}>
          <div className="login-brand">
            <div className="brand-logo">
              <img src={BRAND.logoPath} alt={`Biểu trưng ${BRAND.name}`} />
            </div>
            <h1>{BRAND.name}</h1>
            <p>{BRAND.tagline}</p>
          </div>

          <div className="login-divider" />

          <h2>Đăng nhập</h2>
          <p className="sub">Nhập thông tin tài khoản của bạn</p>

          {sessionExpired && (
            <div className="login-session-notice" role="status">
              Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.
            </div>
          )}

          <div className="field">
            <label htmlFor="username-input">Tên đăng nhập / Số điện thoại</label>
            <div className="input-icon">
              <User size={16} />
              <input
                id="username-input"
                name="username"
                className="input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Tên đăng nhập hoặc SĐT"
                autoComplete="username"
                autoCapitalize="none"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password-input">Mật khẩu</label>
            <div className="input-icon" style={{ position: 'relative' }}>
              <Lock size={16} />
              <input
                id="password-input"
                name="password"
                className="input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mật khẩu"
                autoComplete="current-password"
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="btn btn--primary btn--lg login-submit"
            type="submit"
            disabled={!username || !password || submitting}
          >
            {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>


        </form>
      </div>

      <img src="/assets/illustrations/bg-transport-world.svg" alt="" className="login-bg-svg" />

      <p className="login-footer">
        &copy; {new Date().getFullYear()} {BRAND.name} &middot; Hải Phòng
      </p>
    </main>
  );
}
