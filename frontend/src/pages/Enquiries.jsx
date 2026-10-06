import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const blankCustomer = { company_name: '', contact_person: '', mobile: '', email: '', city: '' };
const blankItem = { product_id: '', quantity: 1 };

export default function Enquiries({ token, products }) {
  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [customer, setCustomer] = useState(blankCustomer);
  const [requiredDate, setRequiredDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ ...blankItem }]);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      setList(await api('/enquiries', { token }));
      setCustomers(await api('/customers', { token }));
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const setItem = (i, patch) => setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    const body = {
      required_date: requiredDate,
      notes: notes || undefined,
      items: items.map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity) })),
      ...(customerId ? { customer_id: Number(customerId) } : { customer }),
    };
    try {
      const created = await api('/enquiries', { method: 'POST', token, body });
      setMsg({ type: 'ok', text: `Enquiry ${created.enquiry_no} created` });
      setOpen(false); setItems([{ ...blankItem }]); setCustomer(blankCustomer); setCustomerId(''); setNotes('');
      load();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
  }

  async function markLost(id) {
    try { await api(`/enquiries/${id}/status`, { method: 'PATCH', token, body: { status: 'LOST' } }); load(); }
    catch (err) { setMsg({ type: 'error', text: err.message }); }
  }

  return (
    <section>
      <div className="bar">
        <h2>Enquiries</h2>
        <button className="primary" onClick={() => setOpen(!open)}>{open ? 'Close' : '+ New enquiry'}</button>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {open && (
        <form className="card" onSubmit={submit}>
          <h3>Customer</h3>
          <label>Existing customer
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— New customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.company_name} ({c.city})</option>)}
            </select>
          </label>
          {!customerId && (
            <div className="grid">
              {[['company_name', 'Company name'], ['contact_person', 'Contact person'], ['mobile', 'Mobile'], ['email', 'Email'], ['city', 'City']].map(([k, label]) => (
                <label key={k}>{label}
                  <input value={customer[k]} required onChange={(e) => setCustomer({ ...customer, [k]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          <h3>Enquiry details</h3>
          <div className="grid">
            <label>Required date<input type="date" value={requiredDate} required onChange={(e) => setRequiredDate(e.target.value)} /></label>
            <label>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <h3>Products</h3>
          {items.map((it, i) => (
            <div className="row" key={i}>
              <select value={it.product_id} required onChange={(e) => setItem(i, { product_id: e.target.value })}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
              <input type="number" min="1" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} />
              {items.length > 1 && <button type="button" className="link" onClick={() => setItems(items.filter((_, x) => x !== i))}>Remove</button>}
            </div>
          ))}
          <button type="button" onClick={() => setItems([...items, { ...blankItem }])}>+ Add product</button>{' '}
          <button className="primary" type="submit">Create enquiry</button>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th>Required</th><th>Products</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{e.enquiry_no}</td>
                <td>{e.company_name}<div className="muted">{e.contact_person} · {e.city}</div></td>
                <td>{e.enquiry_date}</td><td>{e.required_date}</td>
                <td>{e.items.map((i) => <div key={i.id}>{i.product_code} × {i.quantity}</div>)}</td>
                <td><span className={`badge s-${e.status}`}>{e.status}</span></td>
                <td>{['NEW', 'QUOTED'].includes(e.status) && <button className="link" onClick={() => markLost(e.id)}>Mark lost</button>}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="muted">No enquiries yet</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
