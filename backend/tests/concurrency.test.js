const h = require('./helpers');

beforeAll(h.setupDb);
afterAll(() => h.pool.end());

// BONUS - simultaneous inventory reservations
describe('Bonus: concurrent reservations', () => {
  test('available=100: reserving 80 and 50 at the same time -> exactly one succeeds', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('HP-100', 100, 0);
    const orderA = await h.pendingOrder(sales, [{ code: 'HP-100', qty: 80 }]);
    const orderB = await h.pendingOrder(sales, [{ code: 'HP-100', qty: 50 }]);

    const fire = (id) => h.request(h.app).post(`/sales-orders/${id}/confirm`).set(h.auth(admin));
    const [a, b] = await Promise.all([fire(orderA.id), fire(orderB.id)]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const stock = await h.getStock('HP-100');
    expect([80, 50]).toContain(stock.reserved_qty);
    expect(stock.physical_qty).toBe(100);
  });

  test('many parallel confirms never over-reserve', async () => {
    const admin = await h.adminToken();
    const sales = await h.salesToken();
    await h.setStock('GV-50', 100, 0);
    const orders = [];
    for (let i = 0; i < 8; i += 1) orders.push(await h.pendingOrder(sales, [{ code: 'GV-50', qty: 30 }]));

    const results = await Promise.all(
      orders.map((o) => h.request(h.app).post(`/sales-orders/${o.id}/confirm`).set(h.auth(admin))));

    expect(results.filter((r) => r.status === 200)).toHaveLength(3); // 3 x 30 = 90 <= 100
    expect((await h.getStock('GV-50')).reserved_qty).toBe(90);
  });
});
