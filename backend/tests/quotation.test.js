const h = require('./helpers');
const { computeLine, computeQuotation } = require('../src/utils/calc');

beforeAll(h.setupDb);
afterAll(() => h.pool.end());

// TEST 1 - quotation total is calculated correctly
describe('Test 1: quotation total calculation', () => {
  test('calculation helper applies discount first, then GST', () => {
    // 10 x 1000 = 10000; -10% = 9000; +18% GST = 10620
    expect(computeLine({ quantity: 10, unit_price: 1000, discount_pct: 10, gst_pct: 18 }).line_amount).toBe(10620);
  });

  test('grand total is the sum of rounded line amounts', () => {
    const { grand_total } = computeQuotation([
      { quantity: 10, unit_price: 1000, discount_pct: 10, gst_pct: 18 }, // 10620
      { quantity: 3, unit_price: 250.5, discount_pct: 0, gst_pct: 12 },  // 841.68
    ]);
    expect(grand_total).toBe(11461.68);
  });

  test('API ignores totals sent by the client and calculates on the backend', async () => {
    const token = await h.salesToken();
    const pid = await h.productId('GV-50');
    const enq = await h.request(h.app).post('/enquiries').set(h.auth(token))
      .send({ customer: h.customer, required_date: h.future(5), items: [{ product_id: pid, quantity: 10 }] });
    const res = await h.request(h.app).post('/quotations').set(h.auth(token)).send({
      enquiry_id: enq.body.id,
      valid_until: h.future(10),
      grand_total: 1,                                    // malicious / wrong value
      items: [{ product_id: pid, quantity: 10, unit_price: 1000, discount_pct: 10, gst_pct: 18, line_amount: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.grand_total).toBe(10620);
    expect(res.body.items[0].line_amount).toBe(10620);
    expect(res.body.status).toBe('DRAFT');
  });
});
