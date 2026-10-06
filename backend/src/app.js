const express = require('express');
const cors = require('cors');
const { authenticate } = require('./middleware/auth');
const { errorHandler } = require('./middleware/error');
const { HttpError } = require('./utils/errors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', require('./routes/auth'));
app.use('/customers', require('./routes/customers'));
app.use('/products', require('./routes/products'));
app.use('/inventory', require('./routes/inventory'));
app.use('/enquiries', require('./routes/enquiries'));
app.use('/quotations', require('./routes/quotations'));
app.use('/sales-orders', require('./routes/salesOrders'));

app.use((req, res, next) => next(new HttpError(404, 'Route not found')));
app.use(errorHandler);

module.exports = app;
