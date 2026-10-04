class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Parses a route/body id into a BigInt, or throws a 400.
const toId = (value, name = "id") => {
  if (value === undefined || value === null || value === "") {
    throw new HttpError(400, `${name} is required`);
  }
  if (!/^\d+$/.test(String(value))) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return BigInt(value);
};

const toPositiveInt = (value, name = "quantity", fallback) => {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000) {
    throw new HttpError(400, `${name} must be a positive whole number`);
  }
  return n;
};

module.exports = { HttpError, toId, toPositiveInt };
