import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: attach access token ───────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('nxt_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Token refresh state ────────────────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue = []; // queued requests waiting for new token

const processQueue = (error, token = null) => {
  refreshQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token)
  );
  refreshQueue = [];
};

// ── Response interceptor: auto-refresh on 401 ─────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;

    // Do not attempt to refresh tokens or redirect if the 401 is from the login endpoint itself
    if (original.url?.includes('/auth/login')) {
      return Promise.reject(err);
    }

    if (err.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        // Queue this request until the refresh finishes
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        })
          .then((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          })
          .catch(Promise.reject.bind(Promise));
      }

      original._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('nxt_refresh_token');

      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem('nxt_token');
        window.location.href = '/login';
        return Promise.reject(err);
      }

      try {
        // Use axios directly to avoid interceptor loops
        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        const { token: newToken, refreshToken: newRefresh } = data;

        localStorage.setItem('nxt_token', newToken);
        localStorage.setItem('nxt_refresh_token', newRefresh);
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;

        processQueue(null, newToken);
        isRefreshing = false;

        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        isRefreshing = false;

        localStorage.removeItem('nxt_token');
        localStorage.removeItem('nxt_refresh_token');
        delete api.defaults.headers.common.Authorization;
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(err);
  }
);

export default api;
