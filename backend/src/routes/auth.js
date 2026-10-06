const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const config = require('../config');
const { pool } = require('../db/pool');
const { HttpError, wrap } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { authenticate } = require('../middleware/auth');

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', wrap(async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;
