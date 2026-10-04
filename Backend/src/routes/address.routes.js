const express = require("express");
const router = express.Router();
const {
  fetchUserAddresses,
  addUserAddress,
  deleteAddress,
  setDefaultAddress,
} = require("../controllers/address.controller");
const { verifyTokenFromCookie } = require("../jwt");
router.get("/", verifyTokenFromCookie, fetchUserAddresses);
router.post("/", verifyTokenFromCookie, addUserAddress);
router.delete("/:id", verifyTokenFromCookie, deleteAddress);
router.patch("/:id/default", verifyTokenFromCookie, setDefaultAddress);

module.exports = router;
