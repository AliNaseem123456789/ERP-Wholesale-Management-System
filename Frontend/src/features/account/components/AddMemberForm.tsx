import React, { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { teamService } from "../api/team.api";
import { toast } from "sonner";

interface Props {
  onBack: () => void;
  onSuccess: () => void;
}

export const AddMemberForm: React.FC<Props> = ({ onBack, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [canPlaceOrder, setCanPlaceOrder] = useState(true);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    canPlaceOrder,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await teamService.addMember({ ...formData, canPlaceOrder });
      onSuccess();
    } catch (err: any) {
      toast.error(
        err.response?.data?.message ||
          "Error adding member. Email might already be in use.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm max-w-2xl animate-in slide-in-from-right-4 duration-300">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-500 hover:text-blue-600 font-bold mb-8 transition-colors"
      >
        <ArrowLeft size={20} /> Back to Team
      </button>

      <div className="mb-8">
        <h3 className="text-2xl font-black text-gray-900">Add Staff Member</h3>
        <p className="text-gray-500">
          Create a sub-account to delegate ordering tasks.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-gray-400 ml-1">
              First Name
            </label>
            <input
              required
              className="w-full bg-gray-50 border border-gray-100 px-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={formData.firstName}
              onChange={(e) =>
                setFormData({ ...formData, firstName: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-gray-400 ml-1">
              Last Name
            </label>
            <input
              required
              className="w-full bg-gray-50 border border-gray-100 px-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={formData.lastName}
              onChange={(e) =>
                setFormData({ ...formData, lastName: e.target.value })
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-gray-400 ml-1">
            Work Email
          </label>
          <input
            type="email"
            required
            className="w-full bg-gray-50 border border-gray-100 px-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-gray-400 ml-1">
            Temporary Password
          </label>
          <input
            type="password"
            required
            className="w-full bg-gray-50 border border-gray-100 px-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            value={formData.password}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
          />
        </div>
        <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100 mb-6">
          <input
            type="checkbox"
            id="canPlaceOrder"
            checked={canPlaceOrder}
            onChange={(e) => setCanPlaceOrder(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label
            htmlFor="canPlaceOrder"
            className="text-sm font-bold text-gray-700 cursor-pointer"
          >
            Allow this member to place orders immediately
          </label>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black mt-4 hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            "Confirm & Add Member"
          )}
        </button>
      </form>
    </div>
  );
};
