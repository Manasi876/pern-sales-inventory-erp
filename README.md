# PERN ERP Case Study

A small ERP application for a manufacturing and supply company covering one workflow:

**Customer Enquiry → Quotation → Sales Order → Inventory Reservation → Dispatch**

## Tech stack

| Layer     | Technology                                           |
|-----------|------------------------------------------------------|
| Database  | PostgreSQL (plain SQL schema, `pg` driver, no ORM)   |
| Backend   | Node.js, Express 4, JWT (`jsonwebtoken`), `bcryptjs`, `zod` validation |
| Frontend  | React 18 + Vite                                      |
| Tests     | Jest + Supertest (real PostgreSQL test database)     |

## Project structure

```
backend/
  sql/schema.sql          database schema (tables, constraints, sequences)
  src/db/                 pool + transaction helper, migrate.js, seed.js
  src/middleware/         auth (JWT + role checks), error handler
  src/routes/             auth, customers, products, inventory, enquiries, quotations, salesOrders
  src/utils/              calc.js (quotation maths), validate.js, errors.js
  tests/                  automated tests
frontend/                 React app (4 screens: Login, Enquiries, Quotations, Sales Orders)
docs/                     ER diagram, API docs, Postman collection, design notes
```

## Setup

### 1. Prerequisites
Node.js 18+ and PostgreSQL 14+.

### 2. Create the databases
```bash
psql -U postgres -c "CREATE DATABASE erp_db;"
psql -U postgres -c "CREATE DATABASE erp_db_test;"
```

### 3. Backend
```bash
cd backend
cp .env.example .env        # then edit DATABASE_URL / TEST_DATABASE_URL / JWT_SECRET
npm install
npm run db:setup            # runs schema.sql (drops & recreates tables) and seeds data
npm run dev                 # API on http://localhost:5000   (npm start for production)
```

Environment variables (`backend/.env`):

| Variable            | Description                                   | Example |
|---------------------|-----------------------------------------------|---------|
| `PORT`              | API port                                      | `5000` |
| `DATABASE_URL`      | PostgreSQL connection string                  | `postgresql://postgres:pass@localhost:5432/erp_db` |
| `TEST_DATABASE_URL` | Separate database used ONLY by tests (it is wiped) | `postgresql://postgres:pass@localhost:5432/erp_db_test` |
| `JWT_SECRET`        | Secret used to sign tokens                    | long random string |
| `JWT_EXPIRES_IN`    | Token lifetime                                | `8h` |

Migration / seed commands:

| Command                 | What it does |
|-------------------------|--------------|
| `npm run migrate`       | Apply `sql/schema.sql` to an empty database |
| `npm run migrate:reset` | Drop everything and re-apply the schema |
| `npm run seed`          | Insert users, 8 products with inventory, 2 customers (safe to re-run) |
| `npm run db:setup`      | `migrate:reset` + `seed` |

### 4. Frontend
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxies /api -> http://localhost:5000)
```
For a production build set `VITE_API_URL` (see `frontend/.env.example`) and run `npm run build`.

### 5. Tests
```bash
cd backend
npm test
```
Tests run against `TEST_DATABASE_URL` and reset it before each test file. They refuse to run if the database name does not contain `test`.

## Test login credentials

| Role  | Email               | Password   |
|-------|---------------------|------------|
| ADMIN | admin@example.com   | Admin@123  |
| SALES | sales@example.com   | Sales@123  |
| SALES | sales2@example.com  | Sales@123  |

## Roles (enforced in the backend middleware, not only in React)

| Capability                                    | ADMIN | SALES |
|-----------------------------------------------|:-----:|:-----:|
| View all records                              | ✅ | own records only |
| Create customers / enquiries                  | ✅ | ✅ |
| Create quotations, accept/reject, convert     | ✅ | ✅ |
| View inventory availability                   | ✅ | ✅ |
| Manage inventory (adjust physical stock)      | ✅ | ❌ |
| Confirm sales order (reserve stock)           | ✅ | ❌ |
| Dispatch / cancel sales order                 | ✅ | ❌ |

Admin is treated as a super-user, so it can also perform the sales actions.

## Key design decisions

**Workflow & traceability** — `customers → enquiries → quotations → sales_orders → dispatches`, each linked by foreign keys. A sales order shows `ENQ → QTN → SO` in the UI.

**One quotation → one order** — `sales_orders.quotation_id` is `UNIQUE`. The convert endpoint also locks the quotation row (`SELECT … FOR UPDATE`) and checks its status, so double clicks and parallel requests produce exactly one order.

**Backend-calculated totals** — `src/utils/calc.js`: `base = qty × price`, `taxable = base − discount%`, `line = taxable + GST%`, grand total = sum of lines (2-decimal rounding per line). Amounts sent by the client are discarded.

**Stock reservation & concurrency** — Confirming an order runs in one transaction. Each product is reserved with a single atomic statement:
```sql
UPDATE inventory SET reserved_qty = reserved_qty + $qty
WHERE product_id = $id AND physical_qty - reserved_qty >= $qty
```
`UPDATE` takes a row lock; a competing transaction waits, then re-evaluates the `WHERE` against the committed value, so two requests for 80 and 50 units against 100 available can never both succeed (the bonus test proves it). Rows are locked in `product_id` order to avoid deadlocks, and any failure rolls back the whole order. `CHECK` constraints (`reserved_qty <= physical_qty`, no negatives) are a second safety net.

**Dispatch** — Allowed only for `CONFIRMED` orders. `physical_qty` and `reserved_qty` both decrease. Each order line tracks `reserved_qty` and `dispatched_qty` so you can never dispatch more than reserved, never dispatch the same units twice, and never dispatch a cancelled order. Partial dispatches are supported (optional `items` in the request); the order becomes `DISPATCHED` when every line is fully dispatched.

**Cancel** — `POST /sales-orders/:id/cancel` cancels `PENDING` orders and `CONFIRMED` orders (releasing the still-reserved quantity). `DISPATCHED` orders cannot be cancelled.

## Documentation

- ER diagram: [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md) (Mermaid, renders on GitHub)
- API reference: [`docs/API.md`](docs/API.md)
- Postman collection: [`docs/postman_collection.json`](docs/postman_collection.json) (login requests store the tokens automatically)
- Notes for explaining/modifying the code: [`docs/UNDERSTANDING_THE_CODE.md`](docs/UNDERSTANDING_THE_CODE.md)

## Automated tests (20)

| # | Requirement | File |
|---|-------------|------|
| 1 | Quotation total calculated correctly (and client totals ignored) | `quotation.test.js` |
| 2 | DRAFT / REJECTED quotation cannot create an order | `orders.test.js` |
| 3 | Same quotation cannot create duplicate orders (sequential and parallel) | `orders.test.js` |
| 4 | Cannot reserve more than available (+ all-or-nothing, DB constraints) | `orders.test.js` |
| 5 | Unauthenticated → 401, SALES on restricted routes → 403, record scoping | `orders.test.js` |
| Bonus | Simultaneous reservations (80 vs 50 of 100; 8 parallel confirms) | `concurrency.test.js` |
| Extra | Dispatch rules, partial dispatch, cancel releases reservation | `orders.test.js` |
