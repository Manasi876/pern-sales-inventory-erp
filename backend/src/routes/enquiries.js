const router = require('express').Router();
const { z } = require('zod');
const { pool, withTransaction } = require('../db/pool');
const { wrap, HttpError } = require('../utils/errors');
const { parse, todayISO } = require('../utils/validate');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const SELECT = `
  SELECT e.id, e.enquiry_no, e.customer_id, c.company_name, c.contact_person, c.mobile,
         c.email AS customer_email, c.city, e.enquiry_date, e.required_date, e.notes,
         e.status, e.created_by, e.created_at,
         COALESCE((SELECT json_agg(json_build_object(
             'id', ei.id, 'product_id', ei.product_id, 'product_code', p.code,
             'product_name', p.name, 'unit', p.unit, 'quantity', ei.quantity) ORDER BY ei.id)
           FROM enquiry_items ei JOIN products p ON p.id = ei.product_id
           WHERE ei.enquiry_id = e.id), '[]'::json) AS items
  FROM enquiries e JOIN customers c ON c.id = e.customer_id`;


async function fetchEnquiries(db, user, id = null) {
  const params = [];
  const where = [];
  if (id !== null) { params.push(id); where.push(`e.id = $${params.length}`); }
  if (user.role === 'SALES') { params.push(user.id); where.push(`e.created_by = $${params.length}`); }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC`;
  return (await db.query(sql, params)).rows;
}

const customerSchema = z.object({
  company_name: z.string().min(1).max(150),
  contact_person: z.string().min(1).max(100),
  mobile: z.string().regex(/^[0-9+\-\s]{7,20}$/, 'Invalid mobile number'),
  email: z.string().email(),
  city: z.string().min(1).max(80),
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const createSchema = z.object({
  customer_id: z.number().int().positive().optional(),
  customer: customerSchema.optional(),
  required_date: dateStr,
  notes: z.string().max(1000).optional(),
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1, 'At least one product is required'),
}).refine((d) => d.customer_id || d.customer, { message: 'Provide customer_id or customer details' });

router.post('/', authorize('SALES', 'ADMIN'), wrap(async (req, res) => {
  const data = parse(createSchema, req.body);
  if (data.required_date < todayISO()) throw new HttpError(400, 'required_date cannot be in the past');

  const id = await withTransaction(async (db) => {
    let customerId = data.customer_id;
    if (!customerId) {
      const c = data.customer;
      const r = await db.query(
        `INSERT INTO customers (company_name, contact_person, mobile, email, city)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`, [c.company_name, c.contact_person, c.mobile, c.email, c.city]);
      customerId = r.rows[0].id;
    }
    const e = await db.query(
      `INSERT INTO enquiries (enquiry_no, customer_id, required_date, notes, created_by)
       VALUES ('ENQ-' || lpad(nextval('enquiry_no_seq')::text, 5, '0'), $1, $2, $3, $4)
       RETURNING id`, [customerId, data.required_date, data.notes || null, req.user.id]);
    for (const it of data.items) {
      await db.query('INSERT INTO enquiry_items (enquiry_id, product_id, quantity) VALUES ($1,$2,$3)',
        [e.rows[0].id, it.product_id, it.quantity]);
    }
    return e.rows[0].id;
  });
  res.status(201).json((await fetchEnquiries(pool, req.user, id))[0]);
}));

router.get('/', wrap(async (req, res) => res.json(await fetchEnquiries(pool, req.user))));

router.get('/:id', wrap(async (req, res) => {
  const row = (await fetchEnquiries(pool, req.user, parseInt(req.params.id, 10)))[0];
  if (!row) throw new HttpError(404, 'Enquiry not found');
  res.json(row);
}));


router.patch('/:id/status', authorize('SALES', 'ADMIN'), wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.literal('LOST') }), req.body);
  const id = parseInt(req.params.id, 10);
  if (!(await fetchEnquiries(pool, req.user, id))[0]) throw new HttpError(404, 'Enquiry not found');
  const upd = await pool.query(
    `UPDATE enquiries SET status = $1 WHERE id = $2 AND status IN ('NEW','QUOTED')`, [status, id]);
  if (upd.rowCount === 0) throw new HttpError(409, 'Only NEW or QUOTED enquiries can be marked LOST');
  res.json((await fetchEnquiries(pool, req.user, id))[0]);
}));

module.exports = router;
