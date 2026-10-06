const { HttpError } = require('../utils/errors');


function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });

  
  switch (err.code) {
    case '23505': return res.status(409).json({ error: 'Duplicate record', details: [err.detail] });
    case '23503': return res.status(400).json({ error: 'Referenced record does not exist', details: [err.detail] });
    case '23514': return res.status(400).json({ error: `Data rule violated (${err.constraint})` });
    case '22P02': return res.status(400).json({ error: 'Invalid value format' });
    default: break;
  }
  if (process.env.NODE_ENV !== 'test') console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
