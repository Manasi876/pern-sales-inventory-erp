import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Enquiries from './pages/Enquiries.jsx';
import Quotations from './pages/Quotations.jsx';
import SalesOrders from './pages/SalesOrders.jsx';

const TABS = ['Enquiries', 'Quotations', 'Sales Orders'];

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('session') || 'null'));
  const [tab, setTab] = useState('Enquiries');
  const [products, setProducts] = useState([]);

  const logout = useCallback(() => { localStorage.removeItem('session'); setSession(null); }, []);

  useEffect(() => {
    if (!session) return;
    api('/products', { token: session.token }).then(setProducts).catch((e) => e.status === 401 && logout());
  }, [session, logout]);

  if (!session) {
    return <Login onLogin={(s) => { localStorage.setItem('session', JSON.stringify(s)); setSession(s); }} />;
  }
  const props = { token: session.token, user: session.user, products };

  return (
    <div className="app">
      <header>
        <h1>Mini ERP</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        <div className="who">
          {session.user.name} <span className={`badge role-${session.user.role}`}>{session.user.role}</span>
          <button className="link" onClick={logout}>Logout</button>
        </div>
      </header>
      <main>
        {tab === 'Enquiries' && <Enquiries {...props} />}
        {tab === 'Quotations' && <Quotations {...props} />}
        {tab === 'Sales Orders' && <SalesOrders {...props} />}
      </main>
    </div>
  );
}
