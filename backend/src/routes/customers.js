const router = require('express').Router();
const { z } = require('zod');
const { pool } = require('../db/pool');
const { wrap } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM customers ORDER BY company_name');
  res.json(rows);
}));

const customerSchema = z.object({
  company_name: z.string().min(1).max(150),
  contact_person: z.string().min(1).max(100),
  mobile: z.string().regex(/^[0-9+\-\s]{7,20}$/, 'Invalid mobile number'),
  email: z.string().email(),
  city: z.string().min(1).max(80),
});

router.post('/', authorize('SALES', 'ADMIN'), wrap(async (req, res) => {
  const c = parse(customerSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO customers (company_name, contact_person, mobile, email, city)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [c.company_name, c.contact_person, c.mobile, c.email, c.city]);
  res.status(201).json(rows[0]);
}));

module.exports = router;
