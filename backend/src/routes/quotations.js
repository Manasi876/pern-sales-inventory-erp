const router = require('express').Router();
const { z } = require('zod');
const { pool, withTransaction } = require('../db/pool');
const { wrap, HttpError } = require('../utils/errors');
const { parse, todayISO } = require('../utils/validate');
const { computeQuotation } = require('../utils/calc');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const SELECT = `
  SELECT q.id, q.quotation_no, q.enquiry_id, en.enquiry_no, q.customer_id, c.company_name,
         q.valid_until, q.status, q.grand_total, q.created_by, q.created_at,
         so.id AS sales_order_id, so.order_no,
         COALESCE((SELECT json_agg(json_build_object(
             'id', qi.id, 'product_id', qi.product_id, 'product_code', p.code, 'product_name', p.name,
             'quantity', qi.quantity, 'unit_price', qi.unit_price, 'discount_pct', qi.discount_pct,
             'gst_pct', qi.gst_pct, 'line_amount', qi.line_amount) ORDER BY qi.id)
           FROM quotation_items qi JOIN products p ON p.id = qi.product_id
           WHERE qi.quotation_id = q.id), '[]'::json) AS items
  FROM quotations q
  JOIN enquiries en ON en.id = q.enquiry_id
  JOIN customers c ON c.id = q.customer_id
  LEFT JOIN sales_orders so ON so.quotation_id = q.id`;


async function fetchQuotations(db, user, id = null) {
  const params = [];
  const where = [];
  if (id !== null) { params.push(id); where.push(`q.id = $${params.length}`); }
  if (user.role === 'SALES') { params.push(user.id); where.push(`q.created_by = $${params.length}`); }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.id DESC`;
  return (await db.query(sql, params)).rows;
}

const createSchema = z.object({
  enquiry_id: z.number().int().positive(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
 
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().int().positive(),
    unit_price: z.number().min(0).optional(),
    discount_pct: z.number().min(0).max(100).default(0),
    gst_pct: z.number().min(0).max(100).default(18),
  })).min(1).optional(),
});

router.post('/', authorize('SALES', 'ADMIN'), wrap(async (req, res) => {
  const data = parse(createSchema, req.body);
  if (data.valid_until < todayISO()) throw new HttpError(400, 'valid_until cannot be in the past');

  const id = await withTransaction(async (db) => {
    const enq = (await db.query('SELECT * FROM enquiries WHERE id = $1 FOR UPDATE', [data.enquiry_id])).rows[0];
    if (!enq || (req.user.role === 'SALES' && enq.created_by !== req.user.id)) {
      throw new HttpError(404, 'Enquiry not found');
    }
    if (['WON', 'LOST'].includes(enq.status)) {
      throw new HttpError(409, `Cannot quote an enquiry that is ${enq.status}`);
    }

    
    let items = data.items;
    if (!items) {
      const r = await db.query('SELECT product_id, quantity FROM enquiry_items WHERE enquiry_id = $1', [enq.id]);
      items = r.rows.map((x) => ({ ...x, discount_pct: 0, gst_pct: 18 }));
    }

   
    const ids = [...new Set(items.map((i) => i.product_id))];
    const prods = await db.query('SELECT id, base_price FROM products WHERE id = ANY($1)', [ids]);
    const price = Object.fromEntries(prods.rows.map((p) => [p.id, p.base_price]));
    if (prods.rows.length !== ids.length) throw new HttpError(400, 'One or more products do not exist');
    items = items.map((i) => ({ ...i, unit_price: i.unit_price ?? price[i.product_id] }));

    
    const { lines, grand_total } = computeQuotation(items);

    const q = await db.query(
      `INSERT INTO quotations (quotation_no, enquiry_id, customer_id, valid_until, grand_total, created_by)
       VALUES ('QTN-' || lpad(nextval('quotation_no_seq')::text, 5, '0'), $1,$2,$3,$4,$5) RETURNING id`,
      [enq.id, enq.customer_id, data.valid_until, grand_total, req.user.id]);
    for (const l of lines) {
      await db.query(
        `INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price, discount_pct, gst_pct, line_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [q.rows[0].id, l.product_id, l.quantity, l.unit_price, l.discount_pct, l.gst_pct, l.line_amount]);
    }
    await db.query(`UPDATE enquiries SET status = 'QUOTED' WHERE id = $1 AND status = 'NEW'`, [enq.id]);
    return q.rows[0].id;
  });
  res.status(201).json((await fetchQuotations(pool, req.user, id))[0]);
}));

router.get('/', wrap(async (req, res) => res.json(await fetchQuotations(pool, req.user))));

router.get('/:id', wrap(async (req, res) => {
  const row = (await fetchQuotations(pool, req.user, parseInt(req.params.id, 10)))[0];
  if (!row) throw new HttpError(404, 'Quotation not found');
  res.json(row);
}));


const TRANSITIONS = { DRAFT: ['SENT'], SENT: ['ACCEPTED', 'REJECTED'], ACCEPTED: [], REJECTED: [] };

router.patch('/:id/status', authorize('SALES', 'ADMIN'), wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['SENT', 'ACCEPTED', 'REJECTED']) }), req.body);
  const id = parseInt(req.params.id, 10);
  await withTransaction(async (db) => {
    const q = (await db.query('SELECT * FROM quotations WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!q || (req.user.role === 'SALES' && q.created_by !== req.user.id)) throw new HttpError(404, 'Quotation not found');
    if (!TRANSITIONS[q.status].includes(status)) {
      throw new HttpError(409, `Cannot change quotation from ${q.status} to ${status}`);
    }
    await db.query('UPDATE quotations SET status = $1 WHERE id = $2', [status, id]);
  });
  res.json((await fetchQuotations(pool, req.user, id))[0]);
}));


router.post('/:id/convert', authorize('SALES', 'ADMIN'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const orderId = await withTransaction(async (db) => {
   
    const q = (await db.query('SELECT * FROM quotations WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!q || (req.user.role === 'SALES' && q.created_by !== req.user.id)) throw new HttpError(404, 'Quotation not found');
    if (q.status !== 'ACCEPTED') {
      throw new HttpError(409, `Only ACCEPTED quotations can be converted (current status: ${q.status})`);
    }
    const existing = await db.query('SELECT order_no FROM sales_orders WHERE quotation_id = $1', [id]);
    if (existing.rows[0]) {
      throw new HttpError(409, `Quotation already converted to ${existing.rows[0].order_no}`);
    }
    
    const so = await db.query(
      `INSERT INTO sales_orders (order_no, customer_id, quotation_id, total_amount, created_by)
       VALUES ('SO-' || lpad(nextval('order_no_seq')::text, 5, '0'), $1,$2,$3,$4) RETURNING id`,
      [q.customer_id, q.id, q.grand_total, req.user.id]);
    await db.query(
      `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, line_amount)
       SELECT $1, product_id, quantity, unit_price, line_amount FROM quotation_items WHERE quotation_id = $2`,
      [so.rows[0].id, q.id]);
    await db.query(`UPDATE enquiries SET status = 'WON' WHERE id = $1`, [q.enquiry_id]);
    return so.rows[0].id;
  });
  const { fetchOrders } = require('./salesOrders');
  res.status(201).json((await fetchOrders(pool, req.user, orderId))[0]);
}));

module.exports = router;
