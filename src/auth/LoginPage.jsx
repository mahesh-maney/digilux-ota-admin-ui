import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { logger } from '../utils/logger';
import { LOGO_SRC, BRAND_NAME, APP_SUBTITLE, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS } from '../config';

export default function LoginPage() {
  const { login } = useAuth();
  const [username,    setUsername]    = useState('');
  const [password,    setPassword]    = useState('');
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [failCount,   setFailCount]   = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [secsLeft,    setSecsLeft]    = useState(0);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left <= 0) {
        setSecsLeft(0);
        setLockedUntil(0);
        setFailCount(0);
        setError('');
      } else {
        setSecsLeft(left);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const isLocked = secsLeft > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setError('');
    setLoading(true);
    logger.debug('LoginPage', 'Form submitted', { username });
    try {
      await login(username, password);
      logger.info('LoginPage', 'Login flow complete, redirecting');
      setFailCount(0);
    } catch (err) {
      logger.warn('LoginPage', 'Login rejected', { username, error: err.message });
      const next = failCount + 1;
      setFailCount(next);
      if (next >= LOGIN_MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOGIN_LOCKOUT_MS);
        setError(`Too many failed attempts. Try again in 30 seconds.`);
      } else {
        setError(`${err.message} (attempt ${next} of ${LOGIN_MAX_ATTEMPTS})`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img
            src={LOGO_SRC}
            alt={BRAND_NAME}
            style={{ height: 52, objectFit: 'contain', background: '#1a202c', borderRadius: 8, padding: '6px 14px', marginBottom: 12 }}
          />
          <span className="logo-text">{BRAND_NAME}</span>
          <span className="logo-sub">{APP_SUBTITLE}</span>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin@digilux.com"
              required
              autoFocus
              disabled={isLocked}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={isLocked}
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {isLocked && (
            <div className="alert alert-warn" style={{textAlign:'center'}}>
              Account locked — try again in {secsLeft}s
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-full" disabled={loading || isLocked}>
            {loading ? 'Signing in…' : isLocked ? `Locked (${secsLeft}s)` : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
