const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");

const fetchUserAddresses = async (req, res) => {
  const data = await prisma.addresses.findMany({
    where: { user_id: BigInt(req.user.id) },
    orderBy: [{ is_default: "desc" }, { created_at: "desc" }],
  });
  res.json({ message: "Addresses fetched", data });
};

const clean = (v) => (typeof v === "string" ? v.trim() : v);

const addUserAddress = async (req, res) => {
  const userId = BigInt(req.user.id);
  const b = req.body;
  for (const field of ["address_line1", "city", "state", "postal_code"]) {
    if (!clean(b[field])) throw new HttpError(400, `${field.replace("_", " ")} is required`);
  }

  const isFirst = (await prisma.addresses.count({ where: { user_id: userId } })) === 0;
  const isDefault = !!b.is_default || isFirst;

  const data = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.addresses.updateMany({ where: { user_id: userId }, data: { is_default: false } });
    }
    return tx.addresses.create({
      data: {
        user_id: userId,
        full_name: clean(b.full_name) || null,
        company_name: clean(b.company_name) || null,
        address_line1: clean(b.address_line1),
        address_line2: clean(b.address_line2) || null,
        city: clean(b.city),
        state: clean(b.state),
        postal_code: clean(b.postal_code),
        country: clean(b.country) || "USA",
        phone: clean(b.phone) || null,
        address_type: b.address_type ? String(b.address_type).toLowerCase() : "shipping",
        is_default: isDefault,
      },
    });
  });

  res.status(201).json({ message: "Address added successfully", data });
};

const deleteAddress = async (req, res) => {
  const userId = BigInt(req.user.id);
  const id = toId(req.params.id);

  const address = await prisma.addresses.findFirst({ where: { id, user_id: userId } });
  if (!address) throw new HttpError(404, "Address not found");

  const usedByOrder = await prisma.orders.count({
    where: { OR: [{ shipping_address_id: id }, { billing_address_id: id }] },
  });
  if (usedByOrder) {
    throw new HttpError(409, "This address is used by a past order and can't be deleted");
  }

  await prisma.addresses.delete({ where: { id } });
  res.json({ message: "Address deleted successfully" });
};

const setDefaultAddress = async (req, res) => {
  const userId = BigInt(req.user.id);
  const id = toId(req.params.id);

  const address = await prisma.addresses.findFirst({ where: { id, user_id: userId } });
  if (!address) throw new HttpError(404, "Address not found");

  const [, data] = await prisma.$transaction([
    prisma.addresses.updateMany({ where: { user_id: userId }, data: { is_default: false } }),
    prisma.addresses.update({ where: { id }, data: { is_default: true } }),
  ]);
  res.json({ message: "Default address updated", data });
};

module.exports = { fetchUserAddresses, addUserAddress, deleteAddress, setDefaultAddress };
