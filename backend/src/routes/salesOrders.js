const router = require('express').Router();
const { z } = require('zod');
const { pool, withTransaction } = require('../db/pool');
const { wrap, HttpError } = require('../utils/errors');
const { parse } = require('../utils/validate');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const SELECT = `
  SELECT so.id, so.order_no, so.customer_id, c.company_name, so.quotation_id, q.quotation_no,
         q.enquiry_id, en.enquiry_no, so.order_date, so.total_amount, so.status,
         so.created_by, so.confirmed_at, so.created_at,
         COALESCE((SELECT json_agg(json_build_object(
             'id', i.id, 'product_id', i.product_id, 'product_code', p.code, 'product_name', p.name,
             'unit', p.unit, 'quantity', i.quantity, 'unit_price', i.unit_price, 'line_amount', i.line_amount,
             'reserved_qty', i.reserved_qty, 'dispatched_qty', i.dispatched_qty,
             'stock_physical', inv.physical_qty, 'stock_reserved', inv.reserved_qty,
             'stock_available', inv.physical_qty - inv.reserved_qty) ORDER BY i.id)
           FROM sales_order_items i
           JOIN products p ON p.id = i.product_id
           JOIN inventory inv ON inv.product_id = i.product_id
           WHERE i.sales_order_id = so.id), '[]'::json) AS items,
         COALESCE((SELECT json_agg(json_build_object(
             'id', d.id, 'dispatch_no', d.dispatch_no, 'dispatch_date', d.dispatch_date,
             'vehicle_no', d.vehicle_no, 'driver_name', d.driver_name,
             'items', (SELECT COALESCE(json_agg(json_build_object(
                          'product_id', di.product_id, 'product_code', p2.code, 'quantity', di.quantity)), '[]'::json)
                       FROM dispatch_items di JOIN products p2 ON p2.id = di.product_id
                       WHERE di.dispatch_id = d.id)) ORDER BY d.id)
           FROM dispatches d WHERE d.sales_order_id = so.id), '[]'::json) AS dispatches
  FROM sales_orders so
  JOIN customers c ON c.id = so.customer_id
  JOIN quotations q ON q.id = so.quotation_id
  JOIN enquiries en ON en.id = q.enquiry_id`;


async function fetchOrders(db, user, id = null) {
  const params = [];
  const where = [];
  if (id !== null) { params.push(id); where.push(`so.id = $${params.length}`); }
  if (user.role === 'SALES') { params.push(user.id); where.push(`so.created_by = $${params.length}`); }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY so.id DESC`;
  return (await db.query(sql, params)).rows;
}

async function lockOrder(db, id) {
  const so = (await db.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!so) throw new HttpError(404, 'Sales order not found');
  return so;
}

router.get('/', wrap(async (req, res) => res.json(await fetchOrders(pool, req.user))));

router.get('/:id', wrap(async (req, res) => {
  const row = (await fetchOrders(pool, req.user, parseInt(req.params.id, 10)))[0];
  if (!row) throw new HttpError(404, 'Sales order not found');
  res.json(row);
}));


router.post('/:id/confirm', authorize('ADMIN'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await withTransaction(async (db) => {
    const order = await lockOrder(db, id);
    if (order.status !== 'PENDING') {
      throw new HttpError(409, `Only PENDING orders can be confirmed (current status: ${order.status})`);
    }
    const items = (await db.query(
      'SELECT id, product_id, quantity FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id, id', [id])).rows;

    for (const it of items) {
      const r = await db.query(
        `UPDATE inventory SET reserved_qty = reserved_qty + $1, updated_at = now()
         WHERE product_id = $2 AND physical_qty - reserved_qty >= $1`, [it.quantity, it.product_id]);
      if (r.rowCount === 0) {
        const s = (await db.query(
          `SELECT p.code, i.physical_qty - i.reserved_qty AS available
           FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.product_id = $1`, [it.product_id])).rows[0];
        throw new HttpError(409, `Insufficient stock for ${s ? s.code : 'product ' + it.product_id}: required ${it.quantity}, available ${s ? s.available : 0}`);
      }
      await db.query('UPDATE sales_order_items SET reserved_qty = quantity WHERE id = $1', [it.id]);
    }
    await db.query(
      `UPDATE sales_orders SET status = 'CONFIRMED', confirmed_by = $1, confirmed_at = now() WHERE id = $2`,
      [req.user.id, id]);
  });
  res.json((await fetchOrders(pool, req.user, id))[0]);
}));

const dispatchSchema = z.object({
  vehicle_no: z.string().min(1).max(30),
  driver_name: z.string().min(1).max(100),
  dispatch_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1).optional(),
});



router.post('/:id/dispatch', authorize('ADMIN'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const data = parse(dispatchSchema, req.body);

  await withTransaction(async (db) => {
    const order = await lockOrder(db, id);
    if (order.status === 'CANCELLED') throw new HttpError(409, 'Cannot dispatch a cancelled order');
    if (order.status === 'DISPATCHED') throw new HttpError(409, 'Order is already fully dispatched');
    if (order.status !== 'CONFIRMED') throw new HttpError(409, 'Only CONFIRMED orders can be dispatched');

    const lines = (await db.query(
      'SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id, id FOR UPDATE', [id])).rows;

   
    let plan;
    if (data.items) {
      const seen = new Set();
      plan = data.items.map((x) => {
        if (seen.has(x.product_id)) throw new HttpError(400, `Duplicate product ${x.product_id} in dispatch items`);
        seen.add(x.product_id);
        const line = lines.find((l) => l.product_id === x.product_id);
        if (!line) throw new HttpError(400, `Product ${x.product_id} is not part of this order`);
        return { line, qty: x.quantity };
      });
    } else {
      plan = lines.map((l) => ({ line: l, qty: l.reserved_qty - l.dispatched_qty })).filter((p) => p.qty > 0);
    }
    if (plan.length === 0) throw new HttpError(409, 'Nothing left to dispatch');

    for (const { line, qty } of plan) {
      const remaining = line.reserved_qty - line.dispatched_qty;
      if (qty > remaining) {
        throw new HttpError(409, `Cannot dispatch ${qty} of product ${line.product_id}: only ${remaining} reserved and undispatched`);
      }
    }

    const d = await db.query(
      `INSERT INTO dispatches (dispatch_no, sales_order_id, dispatch_date, vehicle_no, driver_name, dispatched_by)
       VALUES ('DSP-' || lpad(nextval('dispatch_no_seq')::text, 5, '0'), $1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5)
       RETURNING id`, [id, data.dispatch_date || null, data.vehicle_no, data.driver_name, req.user.id]);

    for (const { line, qty } of plan) {
      const inv = await db.query(
        `UPDATE inventory SET physical_qty = physical_qty - $1, reserved_qty = reserved_qty - $1, updated_at = now()
         WHERE product_id = $2 AND reserved_qty >= $1 AND physical_qty >= $1`, [qty, line.product_id]);
      if (inv.rowCount === 0) throw new HttpError(409, `Inventory mismatch for product ${line.product_id}`);
      await db.query('UPDATE sales_order_items SET dispatched_qty = dispatched_qty + $1 WHERE id = $2', [qty, line.id]);
      await db.query('INSERT INTO dispatch_items (dispatch_id, product_id, quantity) VALUES ($1,$2,$3)',
        [d.rows[0].id, line.product_id, qty]);
    }

    const left = await db.query(
      'SELECT 1 FROM sales_order_items WHERE sales_order_id = $1 AND dispatched_qty < quantity LIMIT 1', [id]);
    if (left.rowCount === 0) await db.query(`UPDATE sales_orders SET status = 'DISPATCHED' WHERE id = $1`, [id]);
  });
  res.status(201).json((await fetchOrders(pool, req.user, id))[0]);
}));

router.post('/:id/cancel', authorize('ADMIN'), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await withTransaction(async (db) => {
    const order = await lockOrder(db, id);
    if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
      throw new HttpError(409, `Cannot cancel an order that is ${order.status}`);
    }
    if (order.status === 'CONFIRMED') {
      const lines = (await db.query(
        'SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id, id FOR UPDATE', [id])).rows;
      for (const l of lines) {
        const release = l.reserved_qty - l.dispatched_qty;
        if (release > 0) {
          await db.query(
            'UPDATE inventory SET reserved_qty = reserved_qty - $1, updated_at = now() WHERE product_id = $2',
            [release, l.product_id]);
          await db.query('UPDATE sales_order_items SET reserved_qty = dispatched_qty WHERE id = $1', [l.id]);
        }
      }
    }
    await db.query(`UPDATE sales_orders SET status = 'CANCELLED' WHERE id = $1`, [id]);
  });
  res.json((await fetchOrders(pool, req.user, id))[0]);
}));

module.exports = router;
module.exports.fetchOrders = fetchOrders;
