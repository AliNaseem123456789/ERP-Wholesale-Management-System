import { useState, useEffect, useCallback } from "react";
import { Address } from "../types/address.types";
import { addressService } from "../api/address.api";

export const useAddresses = () => {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAddresses = useCallback(async () => {
    try {
      setLoading(true);
      const data = await addressService.getAll();
      setAddresses(data);
    } catch (err) {
      console.error("Failed to load addresses", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure?")) return;
    try {
      await addressService.delete(id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      alert("Delete failed");
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await addressService.setDefault(id);
      await fetchAddresses(); // Re-fetch to update all 'is_default' flags
    } catch (err) {
      alert("Failed to update default");
    }
  };

  return {
    addresses,
    loading,
    handleDelete,
    handleSetDefault,
    refresh: fetchAddresses,
  };
};
