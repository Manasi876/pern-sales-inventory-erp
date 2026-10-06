const API = import.meta.env.VITE_API_URL || '/api';

export async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(data.details) ? ` (${data.details.join('; ')})` : '';
    const err = new Error((data.error || 'Request failed') + details);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const money = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n ?? 0);

// Preview only - the backend always recalculates and stores the real amounts.
export function previewLine({ quantity, unit_price, discount_pct, gst_pct }) {
  const base = (Number(quantity) || 0) * (Number(unit_price) || 0);
  const taxable = base - (base * (Number(discount_pct) || 0)) / 100;
  return Math.round((taxable + (taxable * (Number(gst_pct) || 0)) / 100 + Number.EPSILON) * 100) / 100;
}
