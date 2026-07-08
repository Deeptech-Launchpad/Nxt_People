import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('nxt_token');
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      api.get('/auth/me')
        .then(res => setUser(res.data.data))
        .catch((err) => {
          if (err?.response?.status === 401) {
            localStorage.removeItem('nxt_token');
            localStorage.removeItem('nxt_refresh_token');
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const checkEmail = async (email) => {
    const res = await api.post('/auth/check-email', { email });
    return res.data;
  };

  const register = async (data) => {
    const res = await api.post('/auth/register', data);
    return res.data;
  };

  const acceptTerms = async (email, setupToken) => {
    const res = await api.post('/auth/accept-terms', { email, token: setupToken });
    const { token, refreshToken, data } = res.data;
    localStorage.setItem('nxt_token', token);
    if (refreshToken) localStorage.setItem('nxt_refresh_token', refreshToken);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(data);
    return data;
  };

  /** Persist a freshly-issued session and update React state. Shared between
   *  the password-only path and the MFA-second-step path. */
  const finaliseSession = ({ token, refreshToken, data }) => {
    localStorage.setItem('nxt_token', token);
    if (refreshToken) localStorage.setItem('nxt_refresh_token', refreshToken);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(data);
    return data;
  };

  /**
   * Step 1 of login. Returns one of two shapes:
   *   - { mfaRequired: false, user }  → fully signed in
   *   - { mfaRequired: true, mfaTicket } → call loginMfa() to finish
   */
  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res.data.requiresMfa) {
      return { mfaRequired: true, mfaTicket: res.data.mfaTicket };
    }
    return { mfaRequired: false, user: finaliseSession(res.data) };
  };

  /** Step 2 of login (MFA). Pass either `code` (6-digit TOTP) or `backupCode`. */
  const loginMfa = async ({ mfaTicket, code, backupCode }) => {
    const res = await api.post('/auth/login-mfa', { mfaTicket, code, backupCode });
    return finaliseSession(res.data);
  };

  /**
   * Google Sign-In. Exchanges a Google Identity Services `credential` (ID
   * token) for a session. Mirrors `login`'s return shape:
   *   - { mfaRequired: true, mfaTicket }  → finish via loginMfa()
   *   - { mfaRequired: false, user }       → fully signed in
   * The backend verifies the token, enforces the company domain, matches the
   * employee, and (on success) issues the same session as a password login.
   */
  const loginGoogle = async (credential) => {
    const res = await api.post('/auth/google', { credential });
    if (res.data.requiresMfa) {
      return { mfaRequired: true, mfaTicket: res.data.mfaTicket };
    }
    if (res.data.requiresMfaSetup) {
      const err = new Error(res.data.message || 'Your role requires MFA. Sign in with email and password to set it up.');
      err.code = 'MFA_SETUP_REQUIRED';
      throw err;
    }
    return { mfaRequired: false, user: finaliseSession(res.data) };
  };

  const logout = async () => {
    try {
      const refreshToken = localStorage.getItem('nxt_refresh_token');
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } catch (_) { /* silent */ }
    localStorage.removeItem('nxt_token');
    localStorage.removeItem('nxt_refresh_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, checkEmail, register, acceptTerms, login, loginMfa, loginGoogle, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
