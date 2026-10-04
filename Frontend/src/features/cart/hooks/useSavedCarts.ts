import { useState, useEffect } from "react";
import { getSavedCarts } from "../api/cartApi";
import { toast } from "sonner";

export function useSavedCarts() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const data = await getSavedCarts();
      setTemplates(data);
    } catch (err: any) {
      toast.error(err.message || "Could not load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  return { templates, loading, refetch: fetchTemplates };
}
