const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/db/pool');
const migrate = require('../src/db/migrate');
const seed = require('../src/db/seed');

const future = (days = 30) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function setupDb() {
  if (!/test/.test(process.env.TEST_DATABASE_URL || 'erp_db_test')) {
    throw new Error('Refusing to reset a database whose name does not contain "test"');
  }
  await migrate({ reset: true });
  await seed({ withCustomers: false });
}

async function login(email, password) {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.token;
}
const adminToken = () => login('admin@example.com', 'Admin@123');
const salesToken = () => login('sales@example.com', 'Sales@123');
const sales2Token = () => login('sales2@example.com', 'Sales@123');

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function productId(code) {
  return (await pool.query('SELECT id FROM products WHERE code = $1', [code])).rows[0].id;
}
async function setStock(code, physical, reserved = 0) {
  await pool.query(
    `UPDATE inventory SET physical_qty = $1, reserved_qty = $2
     WHERE product_id = (SELECT id FROM products WHERE code = $3)`, [physical, reserved, code]);
}
async function getStock(code) {
  return (await pool.query(
    `SELECT i.physical_qty, i.reserved_qty FROM inventory i JOIN products p ON p.id = i.product_id
     WHERE p.code = $1`, [code])).rows[0];
}

const customer = {
  company_name: 'Test Co', contact_person: 'Tester', mobile: '9999999999', email: 't@test.example', city: 'Pune',
};


async function draftQuotation(token, lines) {
  const items = [];
  for (const l of lines) items.push({ product_id: await productId(l.code), quantity: l.qty });
  const enq = await request(app).post('/enquiries').set(auth(token))
    .send({ customer, required_date: future(10), items });
  const q = await request(app).post('/quotations').set(auth(token))
    .send({ enquiry_id: enq.body.id, valid_until: future(15) });
  return { enquiry: enq.body, quotation: q.body };
}

async function setQuotationStatus(token, id, status) {
  return request(app).patch(`/quotations/${id}/status`).set(auth(token)).send({ status });
}


async function pendingOrder(token, lines) {
  const { quotation } = await draftQuotation(token, lines);
  await setQuotationStatus(token, quotation.id, 'SENT');
  await setQuotationStatus(token, quotation.id, 'ACCEPTED');
  const so = await request(app).post(`/quotations/${quotation.id}/convert`).set(auth(token));
  return so.body;
}

module.exports = {
  app, request, pool, setupDb, login, adminToken, salesToken, sales2Token, auth,
  productId, setStock, getStock, draftQuotation, setQuotationStatus, pendingOrder, future, customer,
};
