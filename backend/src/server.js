const config = require('./config');
const app = require('./app');

if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Copy .env.example to .env and set it.');
}
app.listen(config.port, () => console.log(`ERP API listening on http://localhost:${config.port}`));
