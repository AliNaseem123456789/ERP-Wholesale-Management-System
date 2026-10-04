// Per-company document numbers: PO-00001, GRN-00001, TR-00001 ...
// Uses an upsert-increment, so concurrent requests never get the same number.
const nextNumber = async (tx, companyId, key, prefix = key, pad = 5) => {
  const rows = await tx.$queryRaw`
    INSERT INTO company_sequences (company_id, key, value) VALUES (${BigInt(companyId)}, ${key}, 1)
    ON CONFLICT (company_id, key) DO UPDATE SET value = company_sequences.value + 1
    RETURNING value`;
  return `${prefix}-${String(rows[0].value).padStart(pad, "0")}`;
};

module.exports = { nextNumber };
