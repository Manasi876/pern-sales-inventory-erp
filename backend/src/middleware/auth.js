const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('../utils/errors');


function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.id, role: payload.role, name: payload.name };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}


const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : next(new HttpError(403, `Forbidden: requires role ${roles.join(' or ')}`));

module.exports = { authenticate, authorize };
