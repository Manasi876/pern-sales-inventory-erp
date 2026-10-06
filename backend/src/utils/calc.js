// Quotation maths. Money is rounded to 2 decimals at each line.
//   base     = quantity x unit_price
//   taxable  = base - (base x discount% / 100)
//   line     = taxable + (taxable x gst% / 100)
//   grand    = sum of line amounts
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function computeLine({ quantity, unit_price, discount_pct = 0, gst_pct = 18 }) {
  const base = quantity * unit_price;
  const taxable = base - (base * discount_pct) / 100;
  const gst = (taxable * gst_pct) / 100;
  return {
    base_amount: round2(base),
    taxable_amount: round2(taxable),
    gst_amount: round2(gst),
    line_amount: round2(taxable + gst),
  };
}

function computeQuotation(items) {
  const lines = items.map((it) => ({ ...it, ...computeLine(it) }));
  const grand_total = round2(lines.reduce((sum, l) => sum + l.line_amount, 0));
  return { lines, grand_total };
}

module.exports = { round2, computeLine, computeQuotation };
