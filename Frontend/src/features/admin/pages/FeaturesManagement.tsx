import React, { useState, useEffect } from "react";
import { adminService } from "../api/admin.service";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Link as LinkIcon,
  Save,
  RefreshCcw,
} from "lucide-react";

export const FeatureSettings = () => {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const data = await adminService.getSettings();
      setSettings(data.filter((s: any) => s.key.startsWith("feature_")));
    } catch (err) {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleUpdate = async (slotKey: string, link: string, file?: File) => {
    setUpdating(slotKey);
    try {
      await adminService.updateFeature(slotKey, link, file);
      toast.success(`${slotKey.replace("_", " ")} updated!`);
      fetchSettings();
    } catch (err) {
      toast.error("Update failed");
    } finally {
      setUpdating(null);
    }
  };

  if (loading)
    return (
      <div className="p-20 text-center text-gray-500">
        Loading configurations...
      </div>
    );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {settings.map((slot) => (
          <div
            key={slot.key}
            className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-800 uppercase text-sm tracking-wider">
                {slot.key.replace("_", " ")}
              </h3>
              {updating === slot.key && (
                <RefreshCcw className="animate-spin text-blue-500" size={16} />
              )}
            </div>

            <div className="aspect-video mb-4 rounded-xl overflow-hidden border bg-gray-50">
              <img
                src={slot.value.image}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-3">
              <div className="relative">
                <LinkIcon
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  defaultValue={slot.value.link}
                  onBlur={(e) => handleUpdate(slot.key, e.target.value)}
                  placeholder="Redirect Link (e.g. /category/sale)"
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <label className="flex items-center justify-center gap-2 w-full py-2 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg cursor-pointer hover:bg-blue-100 transition">
                <ImageIcon size={14} /> Change Image
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpdate(slot.key, slot.value.link, file);
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
