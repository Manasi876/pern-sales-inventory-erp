const router = require('express').Router();
const { z } = require('zod');
const { pool, withTransaction } = require('../db/pool');
const { wrap, HttpError } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM products ORDER BY code');
  res.json(rows);
}));

const productSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  category: z.string().min(1).max(80),
  unit: z.string().min(1).max(20),
  base_price: z.number().min(0),
  physical_qty: z.number().int().min(0).default(0),
});


router.post('/', authorize('ADMIN'), wrap(async (req, res) => {
  const { physical_qty, ...p } = parse(productSchema, req.body);
  const product = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO products (code, name, category, unit, base_price)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`, [p.code, p.name, p.category, p.unit, p.base_price]);
    await db.query('INSERT INTO inventory (product_id, physical_qty) VALUES ($1,$2)', [rows[0].id, physical_qty]);
    return rows[0];
  });
  res.status(201).json(product);
}));

module.exports = router;
