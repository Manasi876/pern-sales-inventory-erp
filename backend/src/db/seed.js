const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

const USERS = [
  ['Admin User', 'admin@example.com', 'Admin@123', 'ADMIN'],
  ['Sales User', 'sales@example.com', 'Sales@123', 'SALES'],
  ['Sales User Two', 'sales2@example.com', 'Sales@123', 'SALES'],
];

// code, name, category, unit, base price, physical qty
const PRODUCTS = [
  ['HP-100', 'Hydraulic Pump HP-100', 'Hydraulics', 'pcs', 18500, 120],
  ['SB-6205', 'Steel Ball Bearing 6205', 'Bearings', 'pcs', 350, 2000],
  ['GV-50', 'Gate Valve 50mm', 'Valves', 'pcs', 2750, 300],
  ['CB-10M', 'Rubber Conveyor Belt 10m', 'Conveyors', 'roll', 42000, 25],
  ['PG-160', 'Pressure Gauge 0-160 bar', 'Instruments', 'pcs', 1200, 400],
  ['GB-15', 'Helical Gearbox 15kW', 'Power Transmission', 'pcs', 67500, 40],
  ['EM-5HP', 'Electric Motor 5HP 3-Phase', 'Motors', 'pcs', 21500, 80],
  ['HS-25', 'Hydraulic Hose 25mm (per metre)', 'Hydraulics', 'm', 480, 1500],
];

const CUSTOMERS = [
  ['ABC Engineering Pvt. Ltd.', 'Rakesh Mehta', '9876543210', 'rakesh@abceng.example', 'Pune'],
  ['Sunrise Steel Works', 'Anita Rao', '9123456780', 'anita@sunrisesteel.example', 'Bhubaneswar'],
];

async function seed({ withCustomers = true } = {}) {
  for (const [name, email, pw, role] of USERS) {
    const hash = await bcrypt.hash(pw, 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO NOTHING`, [name, email, hash, role]);
  }
  for (const [code, name, cat, unit, price, qty] of PRODUCTS) {
    const { rows } = await pool.query(
      `INSERT INTO products (code, name, category, unit, base_price) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [code, name, cat, unit, price]);
    await pool.query(
      `INSERT INTO inventory (product_id, physical_qty, reserved_qty) VALUES ($1,$2,0)
       ON CONFLICT (product_id) DO NOTHING`, [rows[0].id, qty]);
  }
  if (withCustomers) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM customers');
    if (rows[0].n === 0) {
      for (const c of CUSTOMERS) {
        await pool.query(
          `INSERT INTO customers (company_name, contact_person, mobile, email, city)
           VALUES ($1,$2,$3,$4,$5)`, c);
      }
    }
  }
}

module.exports = seed;

if (require.main === module) {
  seed()
    .then(() => { console.log('Seed complete'); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
