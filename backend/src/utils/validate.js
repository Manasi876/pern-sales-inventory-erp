const { HttpError } = require('./errors');


function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
    throw new HttpError(400, 'Validation failed', details);
  }
  return result.data;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

module.exports = { parse, todayISO };
