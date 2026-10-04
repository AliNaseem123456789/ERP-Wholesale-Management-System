import React, { useState } from "react";
import { Save, X, MapPin, Phone, User, Home, Briefcase } from "lucide-react";
import { addressService } from "../api/address.api";
import { CreateAddressData } from "../types/address.types";

interface AddAddressFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const AddAddressForm: React.FC<AddAddressFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const [loading, setLoading] = useState(false);
  const initialState: CreateAddressData = {
    full_name: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "USA",
    phone: "",
    address_type: "Shipping",
    is_default: false,
  };

  const [formData, setFormData] = useState(initialState);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await addressService.create(formData);
      setFormData(initialState);
      onSuccess();
    } catch (err: any) {
      console.error("Error adding address:", err.response?.data || err.message);
      alert(
        err.response?.data?.message ||
          "Failed to save address. Please check all fields.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border-2 border-blue-100 rounded-3xl p-6 mb-8 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
          <MapPin className="text-blue-600" size={20} /> New Address
        </h3>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600"
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase ml-1">
              Recipient Name
            </label>
            <div className="relative">
              <User
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                size={16}
              />
              <input
                required
                type="text"
                placeholder="John Doe"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                value={formData.full_name}
                onChange={(e) =>
                  setFormData({ ...formData, full_name: e.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase ml-1">
              Phone Number
            </label>
            <div className="relative">
              <Phone
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                size={16}
              />
              <input
                type="tel"
                placeholder="(555) 000-0000"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase ml-1">
              Street Address
            </label>
            <input
              required
              type="text"
              placeholder="123 Business Way"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              value={formData.address_line1}
              onChange={(e) =>
                setFormData({ ...formData, address_line1: e.target.value })
              }
            />
          </div>
          <input
            type="text"
            placeholder="Apt, Suite, Unit (Optional)"
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            value={formData.address_line2}
            onChange={(e) =>
              setFormData({ ...formData, address_line2: e.target.value })
            }
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <input
            required
            placeholder="City"
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
          />
          <input
            required
            placeholder="State"
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            value={formData.state}
            onChange={(e) =>
              setFormData({ ...formData, state: e.target.value })
            }
          />
          <input
            required
            placeholder="Zip Code"
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            value={formData.postal_code}
            onChange={(e) =>
              setFormData({ ...formData, postal_code: e.target.value })
            }
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() =>
                setFormData({ ...formData, address_type: "Shipping" })
              }
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${formData.address_type === "Shipping" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"}`}
            >
              <Home size={14} /> Shipping
            </button>
            <button
              type="button"
              onClick={() =>
                setFormData({ ...formData, address_type: "Billing" })
              }
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${formData.address_type === "Billing" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"}`}
            >
              <Briefcase size={14} /> Billing
            </button>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded text-blue-600"
              checked={formData.is_default}
              onChange={(e) =>
                setFormData({ ...formData, is_default: e.target.checked })
              }
            />
            <span className="text-sm font-bold text-gray-600">
              Set as default
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all disabled:bg-blue-300"
        >
          {loading ? (
            "Saving..."
          ) : (
            <>
              <Save size={18} /> Save Address
            </>
          )}
        </button>
      </form>
    </div>
  );
};