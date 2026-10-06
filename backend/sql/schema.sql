
CREATE SEQUENCE enquiry_no_seq;
CREATE SEQUENCE quotation_no_seq;
CREATE SEQUENCE order_no_seq;
CREATE SEQUENCE dispatch_no_seq;

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role          VARCHAR(10)  NOT NULL CHECK (role IN ('ADMIN', 'SALES')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id             SERIAL PRIMARY KEY,
  company_name   VARCHAR(150) NOT NULL,
  contact_person VARCHAR(100) NOT NULL,
  mobile         VARCHAR(20)  NOT NULL,
  email          VARCHAR(150) NOT NULL,
  city           VARCHAR(80)  NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id         SERIAL PRIMARY KEY,
  code       VARCHAR(30)  NOT NULL UNIQUE,
  name       VARCHAR(150) NOT NULL,
  category   VARCHAR(80)  NOT NULL,
  unit       VARCHAR(20)  NOT NULL,
  base_price NUMERIC(12,2) NOT NULL CHECK (base_price >= 0)
);


CREATE TABLE inventory (
  product_id   INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  physical_qty INTEGER NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reserved_not_above_physical CHECK (reserved_qty <= physical_qty)
);

CREATE TABLE enquiries (
  id            SERIAL PRIMARY KEY,
  enquiry_no    VARCHAR(20) NOT NULL UNIQUE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  enquiry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  required_date DATE NOT NULL,
  notes         TEXT,
  status        VARCHAR(10) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','QUOTED','WON','LOST')),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (required_date >= enquiry_date)
);

CREATE TABLE enquiry_items (
  id         SERIAL PRIMARY KEY,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE quotations (
  id           SERIAL PRIMARY KEY,
  quotation_no VARCHAR(20) NOT NULL UNIQUE,
  enquiry_id   INTEGER NOT NULL REFERENCES enquiries(id),
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  valid_until  DATE NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','ACCEPTED','REJECTED')),
  grand_total  NUMERIC(14,2) NOT NULL CHECK (grand_total >= 0),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quotation_items (
  id           SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  discount_pct NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  gst_pct      NUMERIC(5,2)  NOT NULL DEFAULT 18 CHECK (gst_pct BETWEEN 0 AND 100),
  line_amount  NUMERIC(14,2) NOT NULL CHECK (line_amount >= 0)
);


CREATE TABLE sales_orders (
  id           SERIAL PRIMARY KEY,
  order_no     VARCHAR(20) NOT NULL UNIQUE,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  quotation_id INTEGER NOT NULL UNIQUE REFERENCES quotations(id),
  order_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  status       VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','DISPATCHED','CANCELLED')),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE sales_order_items (
  id             SERIAL PRIMARY KEY,3
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  unit_price     NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_amount    NUMERIC(14,2) NOT NULL CHECK (line_amount >= 0),
  reserved_qty   INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  dispatched_qty INTEGER NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
  CHECK (reserved_qty <= quantity),
  CHECK (dispatched_qty <= reserved_qty)
);

CREATE TABLE dispatches (
  id             SERIAL PRIMARY KEY,
  dispatch_no    VARCHAR(20) NOT NULL UNIQUE,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id),
  dispatch_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  vehicle_no     VARCHAR(30) NOT NULL,
  driver_name    VARCHAR(100) NOT NULL,
  dispatched_by  INTEGER NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispatch_items (
  id          SERIAL PRIMARY KEY,
  dispatch_id INTEGER NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX idx_enquiries_customer ON enquiries(customer_id);
CREATE INDEX idx_quotations_enquiry ON quotations(enquiry_id);
CREATE INDEX idx_soi_order          ON sales_order_items(sales_order_id);
CREATE INDEX idx_dispatches_order   ON dispatches(sales_order_id);
