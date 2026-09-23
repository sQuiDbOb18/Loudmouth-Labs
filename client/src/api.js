// Empty means same-origin requests, which is used by the combined Vercel deployment
// and by the local Vite proxy. Set VITE_API_BASE_URL only for a separate API origin.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}
