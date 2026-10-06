import React, { useCallback, useEffect, useState } from 'react';
import { api, money } from '../api.js';

export default function SalesOrders({ token, user }) {
  const [orders, setOrders] = useState([]);
  const [stock, setStock] = useState([]);
  const [msg, setMsg] = useState(null);
  const [dispatching, setDispatching] = useState(null); // order id with open dispatch form
  const [dForm, setDForm] = useState({ vehicle_no: '', driver_name: '' });
  const [editing, setEditing] = useState({}); // product_id -> new physical qty
  const isAdmin = user.role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      setOrders(await api('/sales-orders', { token }));
      setStock(await api('/inventory', { token }));
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function act(id, action, body, okText) {
    setMsg(null);
    try {
      const r = await api(`/sales-orders/${id}/${action}`, { method: 'POST', token, body });
      setMsg({ type: 'ok', text: okText(r) });
      setDispatching(null);
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    load();
  }

  async function saveStock(productId) {
    try {
      await api(`/inventory/${productId}`, { method: 'PATCH', token, body: { physical_qty: Number(editing[productId]) } });
      setEditing((e) => { const n = { ...e }; delete n[productId]; return n; });
      setMsg({ type: 'ok', text: 'Inventory updated' });
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    load();
  }

  return (
    <section>
      <h2>Sales Orders</h2>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <h3>Inventory availability</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Product</th><th>Physical</th><th>Reserved</th><th>Available</th>{isAdmin && <th>Adjust physical</th>}</tr></thead>
          <tbody>
            {stock.map((s) => (
              <tr key={s.product_id}>
                <td>{s.code}</td><td>{s.name}</td><td>{s.physical_qty}</td><td>{s.reserved_qty}</td>
                <td><b>{s.available_qty}</b> {s.unit}</td>
                {isAdmin && (
                  <td className="actions">
                    <input type="number" min="0" value={editing[s.product_id] ?? s.physical_qty}
                      onChange={(e) => setEditing({ ...editing, [s.product_id]: e.target.value })} />
                    {editing[s.product_id] !== undefined && <button onClick={() => saveStock(s.product_id)}>Save</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Orders</h3>
      {orders.length === 0 && <p className="muted">No sales orders yet. Accept a quotation and convert it.</p>}
      {orders.map((o) => (
        <div className="card" key={o.id}>
          <div className="bar">
            <div>
              <b>{o.order_no}</b> · {o.company_name} <span className={`badge s-${o.status}`}>{o.status}</span>
              <div className="muted">{o.enquiry_no} → {o.quotation_no} → {o.order_no} · {o.order_date} · {money(o.total_amount)}</div>
            </div>
            {isAdmin && (
              <div className="actions">
                {o.status === 'PENDING' && <button className="primary" onClick={() => act(o.id, 'confirm', undefined, (r) => `${r.order_no} confirmed, stock reserved`)}>Confirm &amp; reserve</button>}
                {o.status === 'CONFIRMED' && <button className="primary" onClick={() => setDispatching(dispatching === o.id ? null : o.id)}>Dispatch</button>}
                {['PENDING', 'CONFIRMED'].includes(o.status) && <button className="danger" onClick={() => act(o.id, 'cancel', undefined, (r) => `${r.order_no} cancelled`)}>Cancel</button>}
              </div>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Qty</th><th>Reserved</th><th>Dispatched</th><th>Stock available now</th><th>Line total</th></tr></thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product_code} — {i.product_name}</td><td>{i.quantity}</td>
                    <td>{i.reserved_qty}</td><td>{i.dispatched_qty}</td>
                    <td className={o.status === 'PENDING' && i.stock_available < i.quantity ? 'short' : ''}>{i.stock_available}</td>
                    <td>{money(i.line_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {dispatching === o.id && (
            <form className="row" onSubmit={(e) => { e.preventDefault(); act(o.id, 'dispatch', dForm, (r) => `Dispatch recorded for ${r.order_no}`); }}>
              <input placeholder="Vehicle number" required value={dForm.vehicle_no} onChange={(e) => setDForm({ ...dForm, vehicle_no: e.target.value })} />
              <input placeholder="Driver name" required value={dForm.driver_name} onChange={(e) => setDForm({ ...dForm, driver_name: e.target.value })} />
              <button className="primary" type="submit">Dispatch all reserved</button>
            </form>
          )}

          {o.dispatches.length > 0 && (
            <div className="muted">
              {o.dispatches.map((d) => (
                <div key={d.id}>{d.dispatch_no} · {d.dispatch_date} · {d.vehicle_no} / {d.driver_name} · {d.items.map((i) => `${i.product_code}×${i.quantity}`).join(', ')}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
