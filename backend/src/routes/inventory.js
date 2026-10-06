const router = require('express').Router();
const { z } = require('zod');
const { pool } = require('../db/pool');
const { wrap, HttpError } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const SELECT = `
  SELECT p.id AS product_id, p.code, p.name, p.category, p.unit,
         i.physical_qty, i.reserved_qty, (i.physical_qty - i.reserved_qty) AS available_qty
  FROM inventory i JOIN products p ON p.id = i.product_id`;


router.get('/', wrap(async (req, res) => {
  const { rows } = await pool.query(`${SELECT} ORDER BY p.code`);
  res.json(rows);
}));


router.patch('/:productId', authorize('ADMIN'), wrap(async (req, res) => {
  const { physical_qty } = parse(z.object({ physical_qty: z.number().int().min(0) }), req.body);
  const productId = parseInt(req.params.productId, 10);
  
  const upd = await pool.query(
    `UPDATE inventory SET physical_qty = $1, updated_at = now()
     WHERE product_id = $2 AND reserved_qty <= $1`, [physical_qty, productId]);
  if (upd.rowCount === 0) {
    const exists = await pool.query('SELECT reserved_qty FROM inventory WHERE product_id = $1', [productId]);
    if (!exists.rows[0]) throw new HttpError(404, 'Inventory record not found');
    throw new HttpError(409, `Physical quantity cannot be below reserved quantity (${exists.rows[0].reserved_qty})`);
  }
  const { rows } = await pool.query(`${SELECT} WHERE p.id = $1`, [productId]);
  res.json(rows[0]);
}));

module.exports = router;

