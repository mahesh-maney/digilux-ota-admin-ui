import { useState } from 'react';
import { useAuth } from './AuthContext';
import { logger } from '../utils/logger';
import { LOGO_URL, BRAND_NAME, APP_SUBTITLE } from '../config';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    logger.debug('LoginPage', 'Form submitted', { username });
    try {
      await login(username, password);
      logger.info('LoginPage', 'Login flow complete, redirecting');
    } catch (err) {
      logger.warn('LoginPage', 'Login rejected', { username, error: err.message });
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          {LOGO_URL && (
            <img
              src={LOGO_URL}
              alt={BRAND_NAME}
              style={{ height: 52, objectFit: 'contain', background: '#1a202c', borderRadius: 8, padding: '6px 14px', marginBottom: 12 }}
            />
          )}
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
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
