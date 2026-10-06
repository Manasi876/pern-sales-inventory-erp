import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      onLogin(await api('/auth/login', { method: 'POST', body: { email, password } }));
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Mini ERP</h1>

        {error && <div className="alert error">{error}</div>}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="primary" type="submit">Login</button>
        <div className="demo muted">
         
        </div>
      </form>
    </div>
  );
}
