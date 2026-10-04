// Money helpers: always round to cents at the edges of a calculation.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));
module.exports = { round2, num };
