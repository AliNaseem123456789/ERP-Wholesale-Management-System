import { useState, useEffect } from "react";
import { getPaymentHistory } from "../api/paymentApi";

export function usePayments() {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPaymentHistory()
      .then(setPayments)
      .finally(() => setLoading(false));
  }, []);

  return { payments, loading };
}
