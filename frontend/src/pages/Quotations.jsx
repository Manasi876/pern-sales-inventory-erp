import React, { useCallback, useEffect, useState } from 'react';
import { api, money, previewLine } from '../api.js';

export default function Quotations({ token, products }) {
  const [list, setList] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [open, setOpen] = useState(false);
  const [enquiryId, setEnquiryId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      setList(await api('/quotations', { token }));
      setEnquiries(await api('/enquiries', { token }));
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  function pickEnquiry(id) {
    setEnquiryId(id);
    const enq = enquiries.find((e) => String(e.id) === id);
    setItems(enq ? enq.items.map((i) => {
      const p = products.find((x) => x.id === i.product_id);
      return { product_id: i.product_id, label: `${i.product_code} — ${i.product_name}`, quantity: i.quantity, unit_price: p ? p.base_price : 0, discount_pct: 0, gst_pct: 18 };
    }) : []);
  }
  const setItem = (i, patch) => setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const preview = items.reduce((s, i) => s + previewLine(i), 0);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const body = {
        enquiry_id: Number(enquiryId),
        valid_until: validUntil,
        items: items.map((i) => ({
          product_id: i.product_id, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
          discount_pct: Number(i.discount_pct), gst_pct: Number(i.gst_pct),
        })),
      };
      const q = await api('/quotations', { method: 'POST', token, body });
      setMsg({ type: 'ok', text: `Quotation ${q.quotation_no} created (total ${money(q.grand_total)})` });
      setOpen(false); setEnquiryId(''); setItems([]); load();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
  }

  async function act(id, path, method, body, okText) {
    setMsg(null);
    try {
      const r = await api(`/quotations/${id}${path}`, { method, token, body });
      setMsg({ type: 'ok', text: okText(r) });
      load();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
  }
  const setStatus = (id, status) => act(id, '/status', 'PATCH', { status }, (r) => `${r.quotation_no} is now ${r.status}`);
  const convert = (id) => act(id, '/convert', 'POST', undefined, (r) => `Sales order ${r.order_no} created`);

  const quotable = enquiries.filter((e) => ['NEW', 'QUOTED'].includes(e.status));

  return (
    <section>
      <div className="bar">
        <h2>Quotations</h2>
        <button className="primary" onClick={() => setOpen(!open)}>{open ? 'Close' : '+ New quotation'}</button>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {open && (
        <form className="card" onSubmit={submit}>
          <div className="grid">
            <label>Enquiry
              <select value={enquiryId} required onChange={(e) => pickEnquiry(e.target.value)}>
                <option value="">Select enquiry</option>
                {quotable.map((e) => <option key={e.id} value={e.id}>{e.enquiry_no} — {e.company_name}</option>)}
              </select>
            </label>
            <label>Valid until<input type="date" value={validUntil} required onChange={(e) => setValidUntil(e.target.value)} /></label>
          </div>
          {items.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Disc %</th><th>GST %</th><th>Line (preview)</th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.label}</td>
                      <td><input type="number" min="1" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })} /></td>
                      <td><input type="number" min="0" max="100" step="0.01" value={it.discount_pct} onChange={(e) => setItem(i, { discount_pct: e.target.value })} /></td>
                      <td><input type="number" min="0" max="100" step="0.01" value={it.gst_pct} onChange={(e) => setItem(i, { gst_pct: e.target.value })} /></td>
                      <td>{money(previewLine(it))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">Preview total: {money(preview)} — the server recalculates the final amounts.</p>
          <button className="primary" type="submit" disabled={!items.length}>Create quotation</button>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>No.</th><th>Enquiry</th><th>Customer</th><th>Items</th><th>Total</th><th>Valid until</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((q) => (
              <tr key={q.id}>
                <td>{q.quotation_no}</td><td>{q.enquiry_no}</td><td>{q.company_name}</td>
                <td>{q.items.map((i) => <div key={i.id}>{i.product_code} × {i.quantity} @ {i.unit_price} (−{i.discount_pct}%, GST {i.gst_pct}%)</div>)}</td>
                <td>{money(q.grand_total)}</td><td>{q.valid_until}</td>
                <td><span className={`badge s-${q.status}`}>{q.status}</span></td>
                <td className="actions">
                  {q.status === 'DRAFT' && <button onClick={() => setStatus(q.id, 'SENT')}>Mark sent</button>}
                  {q.status === 'SENT' && <>
                    <button className="ok" onClick={() => setStatus(q.id, 'ACCEPTED')}>Accept</button>
                    <button className="danger" onClick={() => setStatus(q.id, 'REJECTED')}>Reject</button>
                  </>}
                  {q.status === 'ACCEPTED' && !q.sales_order_id && <button className="primary" onClick={() => convert(q.id)}>Convert to order</button>}
                  {q.order_no && <span className="muted">→ {q.order_no}</span>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="8" className="muted">No quotations yet</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
