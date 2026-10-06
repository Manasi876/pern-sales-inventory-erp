const h = require('./helpers');

beforeAll(h.setupDb);
afterAll(() => h.pool.end());

const convert = (token, id) => h.request(h.app).post(`/quotations/${id}/convert`).set(h.auth(token));
const confirm = (token, id) => h.request(h.app).post(`/sales-orders/${id}/confirm`).set(h.auth(token));
const dispatch = (token, id, body = {}) =>
  h.request(h.app).post(`/sales-orders/${id}/dispatch`).set(h.auth(token))
    .send({ vehicle_no: 'MH12AB1234', driver_name: 'Ramesh', ...body });
const cancel = (token, id) => h.request(h.app).post(`/sales-orders/${id}/cancel`).set(h.auth(token));

//Test 2
describe('Test 2: only ACCEPTED quotations convert', () => {
  test('DRAFT quotation cannot create a sales order', async () => {
    const t = await h.salesToken();
    const { quotation } = await h.draftQuotation(t, [{ code: 'GV-50', qty: 5 }]);
    const res = await convert(t, quotation.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ACCEPTED/);
  });

  test('REJECTED quotation cannot create a sales order', async () => {
    const t = await h.salesToken();
    const { quotation } = await h.draftQuotation(t, [{ code: 'GV-50', qty: 5 }]);
    await h.setQuotationStatus(t, quotation.id, 'SENT');
    await h.setQuotationStatus(t, quotation.id, 'REJECTED');
    const res = await convert(t, quotation.id);
    expect(res.status).toBe(409);
  });

  test('invalid status jump (DRAFT -> ACCEPTED) is refused', async () => {
    const t = await h.salesToken();
    const { quotation } = await h.draftQuotation(t, [{ code: 'GV-50', qty: 5 }]);
    const res = await h.setQuotationStatus(t, quotation.id, 'ACCEPTED');
    expect(res.status).toBe(409);
  });
});

// TEST 3 - no duplicate sales orders from the same quotation
describe('Test 3: no duplicate sales orders', () => {
  test('second conversion is rejected and only one order exists', async () => {
    const t = await h.salesToken();
    const { quotation } = await h.draftQuotation(t, [{ code: 'GV-50', qty: 5 }]);
    await h.setQuotationStatus(t, quotation.id, 'SENT');
    await h.setQuotationStatus(t, quotation.id, 'ACCEPTED');
    const first = await convert(t, quotation.id);
    const second = await convert(t, quotation.id);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    const { rows } = await h.pool.query('SELECT count(*)::int AS n FROM sales_orders WHERE quotation_id = $1', [quotation.id]);
    expect(rows[0].n).toBe(1);
  });

  test('simultaneous conversions create exactly one order', async () => {
    const t = await h.salesToken();
    const { quotation } = await h.draftQuotation(t, [{ code: 'GV-50', qty: 5 }]);
    await h.setQuotationStatus(t, quotation.id, 'SENT');
    await h.setQuotationStatus(t, quotation.id, 'ACCEPTED');
    const results = await Promise.all([convert(t, quotation.id), convert(t, quotation.id), convert(t, quotation.id)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const { rows } = await h.pool.query('SELECT count(*)::int AS n FROM sales_orders WHERE quotation_id = $1', [quotation.id]);
    expect(rows[0].n).toBe(1);
  });
});

// TEST 4 - cannot reserve more than available
describe('Test 4: reservation limits', () => {
  test('cannot confirm an order for more than available stock', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('HP-100', 100, 30); 
    const so = await h.pendingOrder(sales, [{ code: 'HP-100', qty: 80 }]);
    const res = await confirm(admin, so.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Insufficient stock/);
    expect(await h.getStock('HP-100')).toEqual({ physical_qty: 100, reserved_qty: 30 }); // unchanged
    const order = await h.pool.query('SELECT status FROM sales_orders WHERE id = $1', [so.id]);
    expect(order.rows[0].status).toBe('PENDING');
  });

  test('confirming within availability reserves stock but keeps physical unchanged', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('HP-100', 100, 30);
    const so = await h.pendingOrder(sales, [{ code: 'HP-100', qty: 60 }]);
    const res = await confirm(admin, so.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONFIRMED');
    expect(await h.getStock('HP-100')).toEqual({ physical_qty: 100, reserved_qty: 90 }); // available 10
  });

  test('a multi-line order is all-or-nothing', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('GB-15', 10, 0);
    await h.setStock('PG-160', 5, 0);
    const so = await h.pendingOrder(sales, [{ code: 'GB-15', qty: 5 }, { code: 'PG-160', qty: 50 }]);
    const res = await confirm(admin, so.id);
    expect(res.status).toBe(409);
    expect(await h.getStock('GB-15')).toEqual({ physical_qty: 10, reserved_qty: 0 }); // rolled back
  });

  test('database constraint blocks negative / over-reserved stock', async () => {
    await expect(h.pool.query(`UPDATE inventory SET reserved_qty = physical_qty + 1 WHERE product_id = 1`)).rejects.toThrow();
    await expect(h.pool.query(`UPDATE inventory SET physical_qty = -1 WHERE product_id = 1`)).rejects.toThrow();
  });
});

// TEST 5 - unauthorized user cannot perform restricted operations
describe('Test 5: authentication and RBAC', () => {
  test('no token -> 401', async () => {
    const res = await h.request(h.app).get('/sales-orders');
    expect(res.status).toBe(401);
  });

  test('SALES user cannot confirm, dispatch, cancel or edit inventory -> 403', async () => {
    const sales = await h.salesToken();
    const so = await h.pendingOrder(sales, [{ code: 'GV-50', qty: 1 }]);
    expect((await confirm(sales, so.id)).status).toBe(403);
    expect((await dispatch(sales, so.id)).status).toBe(403);
    expect((await cancel(sales, so.id)).status).toBe(403);
    const inv = await h.request(h.app).patch('/inventory/1').set(h.auth(sales)).send({ physical_qty: 999 });
    expect(inv.status).toBe(403);
  });

  test('wrong password -> 401, and SALES users only see their own records', async () => {
    const bad = await h.request(h.app).post('/auth/login').send({ email: 'sales@example.com', password: 'nope' });
    expect(bad.status).toBe(401);
    const s1 = await h.salesToken();
    const s2 = await h.sales2Token();
    await h.pendingOrder(s1, [{ code: 'GV-50', qty: 1 }]);
    const list2 = await h.request(h.app).get('/sales-orders').set(h.auth(s2));
    expect(list2.body).toHaveLength(0);
    const admin = await h.adminToken();
    const all = await h.request(h.app).get('/sales-orders').set(h.auth(admin));
    expect(all.body.length).toBeGreaterThan(0);
  });
});

// Dispatch & cancel business rules
describe('Dispatch and cancellation', () => {
  test('dispatch reduces physical AND reserved; cannot dispatch the same quantity twice', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('SB-6205', 100, 0);
    const so = await h.pendingOrder(sales, [{ code: 'SB-6205', qty: 60 }]);
    expect((await dispatch(admin, so.id)).status).toBe(409); // not confirmed yet
    await confirm(admin, so.id);
    expect(await h.getStock('SB-6205')).toEqual({ physical_qty: 100, reserved_qty: 60 });

    const d1 = await dispatch(admin, so.id);
    expect(d1.status).toBe(201);
    expect(d1.body.status).toBe('DISPATCHED');
    expect(await h.getStock('SB-6205')).toEqual({ physical_qty: 40, reserved_qty: 0 });

    const d2 = await dispatch(admin, so.id);
    expect(d2.status).toBe(409);
    expect(await h.getStock('SB-6205')).toEqual({ physical_qty: 40, reserved_qty: 0 });
  });

  test('partial dispatch cannot exceed the reserved quantity', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('EM-5HP', 50, 0);
    const so = await h.pendingOrder(sales, [{ code: 'EM-5HP', qty: 20 }]);
    await confirm(admin, so.id);
    const pid = await h.productId('EM-5HP');
    const tooMuch = await dispatch(admin, so.id, { items: [{ product_id: pid, quantity: 25 }] });
    expect(tooMuch.status).toBe(409);
    const part = await dispatch(admin, so.id, { items: [{ product_id: pid, quantity: 12 }] });
    expect(part.status).toBe(201);
    expect(part.body.status).toBe('CONFIRMED');
    const rest = await dispatch(admin, so.id, { items: [{ product_id: pid, quantity: 9 }] });
    expect(rest.status).toBe(409); // only 8 left
    expect((await dispatch(admin, so.id)).body.status).toBe('DISPATCHED');
    expect(await h.getStock('EM-5HP')).toEqual({ physical_qty: 30, reserved_qty: 0 });
  });

  test('cancelling a confirmed order releases its reservation; cancelled order cannot be dispatched', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('CB-10M', 25, 0);
    const so = await h.pendingOrder(sales, [{ code: 'CB-10M', qty: 10 }]);
    await confirm(admin, so.id);
    expect(await h.getStock('CB-10M')).toEqual({ physical_qty: 25, reserved_qty: 10 });
    const c = await cancel(admin, so.id);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('CANCELLED');
    expect(await h.getStock('CB-10M')).toEqual({ physical_qty: 25, reserved_qty: 0 });
    expect((await dispatch(admin, so.id)).status).toBe(409);
    expect((await confirm(admin, so.id)).status).toBe(409);
  });
});
