import { createContext, useContext, useState } from 'react';
import { COGNITO_URL, COGNITO_CLIENT } from '../config';
import { logger } from '../utils/logger';
import { audit }  from '../utils/audit';

const AuthContext = createContext(null);

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function getIsAdmin(token) {
  if (!token) return false;
  const claims = decodeJwt(token);
  const groups = claims['cognito:groups'] || [];
  return groups.includes('ota-admin');
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    return localStorage.getItem('ota_token') || '';
  });
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('ota_user') || '';
    if (saved) {
      audit.setActor(saved);
      logger.info('AuthContext', 'Session restored', { user: saved });
    }
    return saved;
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    return getIsAdmin(localStorage.getItem('ota_token') || '');
  });

  const login = async (username, password) => {
    logger.info('AuthContext', 'Login attempt', { username });
    audit.log('LOGIN', { username }, 'INITIATED');

    const resp = await fetch(COGNITO_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow:       'USER_PASSWORD_AUTH',
        ClientId:       COGNITO_CLIENT,
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      const reason = err.message || 'Login failed';
      logger.error('AuthContext', 'Login failed', { username, reason });
      audit.log('LOGIN', { username }, 'FAILURE', { reason });
      throw new Error(reason);
    }

    const data    = await resp.json();
    const idToken = data.AuthenticationResult.IdToken;
    const admin   = getIsAdmin(idToken);
    localStorage.setItem('ota_token', idToken);
    localStorage.setItem('ota_user',  username);
    audit.setActor(username);
    setToken(idToken);
    setUser(username);
    setIsAdmin(admin);
    logger.info('AuthContext', 'Login successful', { username, isAdmin: admin });
    audit.log('LOGIN', { username }, 'SUCCESS', { isAdmin: admin });
  };

  const logout = () => {
    logger.info('AuthContext', 'User logout', { user });
    audit.log('LOGOUT', { username: user }, 'SUCCESS');
    localStorage.removeItem('ota_token');
    localStorage.removeItem('ota_user');
    audit.setActor(null);
    setToken('');
    setUser('');
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ token, user, isAdmin, login, logout, isLoggedIn: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
