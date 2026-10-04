import React, { useState, useEffect, useCallback } from "react";
import {
  MapPin,
  ShoppingBag,
  CreditCard,
  Loader2,
  CheckCircle,
  Package,
  Tag,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { toast } from "sonner";
import { apiClient } from "../../../api/apiClient";
import { clearCart } from "../../cart/redux/cartSlice";
import { AppDispatch } from "../../../app/store";
import { useAuth } from "../../auth/context/AuthContext";

export const CheckoutPage = () => {
  const [addresses, setAddresses] = useState<any[]>([]);
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [totals, setTotals] = useState({ subtotal: 0, discount: 0, shipping: 0, tax: 0, excise: 0, total: 0 });
  const addressRef = React.useRef<string | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promoCodes, setPromoCodes] = useState<string[]>([]);
  const [promoErrors, setPromoErrors] = useState<{ code: string; message: string }[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const cannotOrder =
    user?.role === "SUBACCOUNT" && !user?.permissions?.can_place_order;

  // The server is the source of truth for prices, promos, shipping, tax and totals.
  const loadSummary = useCallback(async (codes: string[], methods: Record<string, string>) => {
    const q = new URLSearchParams();
    if (codes.length) q.set("promo", codes.join(","));
    for (const [companyId, m] of Object.entries(methods)) q.set(`pm_${companyId}`, m);
    if (addressRef.current) q.set("address_id", addressRef.current); // state rules (tobacco tax, bans) follow the delivery address
    const res = await apiClient.get(`/orders/checkout-summary?${q}`);
    setCartItems(res.data.items || []);
    setGroups(res.data.groups || []);
    setPromoErrors(res.data.promoErrors || []);
    setTotals({
      subtotal: Number(res.data.subtotal || 0),
      discount: Number(res.data.discount || 0),
      shipping: Number(res.data.shipping || 0),
      tax: Number(res.data.tax || 0),
      excise: Number(res.data.excise || 0),
      total: Number(res.data.total || 0),
    });
    return res.data;
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [addrRes] = await Promise.all([apiClient.get("/address"), loadSummary([], {})]);
        const addressList = addrRes.data.data || [];
        setAddresses(addressList);
        const defaultAddr =
          addressList.find((a: any) => a.is_default) || addressList[0];
        if (defaultAddr) setSelectedAddressId(String(defaultAddr.id));
      } catch (err) {
        console.error("Error loading checkout data", err);
        toast.error("Could not load checkout. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [loadSummary]);

  const refresh = async (codes: string[], methods: Record<string, string>) => {
    setRefreshing(true);
    try {
      const data = await loadSummary(codes, methods);
      return data;
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Could not update totals");
    } finally {
      setRefreshing(false);
    }
  };

  const applyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = promoInput.trim().toUpperCase();
    if (!code || promoCodes.includes(code)) return;
    const codes = [...promoCodes, code];
    const data = await refresh(codes, paymentMethods);
    const err = data?.promoErrors?.find((p: any) => p.code === code);
    if (err) {
      toast.error(`${code}: ${err.message}`);
      setPromoCodes(promoCodes);
      await refresh(promoCodes, paymentMethods);
    } else {
      setPromoCodes(codes);
      setPromoInput("");
      toast.success(`Promo code ${code} applied`);
    }
  };
  const removePromo = (code: string) => {
    const codes = promoCodes.filter((c) => c !== code);
    setPromoCodes(codes);
    refresh(codes, paymentMethods);
  };
  // re-price when the delivery address changes (state excise and rules)
  useEffect(() => {
    if (!selectedAddressId || selectedAddressId === addressRef.current) return;
    const first = addressRef.current === null;
    addressRef.current = selectedAddressId;
    if (!first || groups.some((g: any) => g.compliance?.lines?.length || g.compliance?.problems?.length || g.compliance?.flags?.length)) refresh(promoCodes, paymentMethods);
  }, [selectedAddressId]);

  const choosePayment = (companyId: string, method: string) => {
    const methods = { ...paymentMethods, [companyId]: method };
    setPaymentMethods(methods);
    refresh(promoCodes, methods);
  };

  const { subtotal, discount, shipping, tax, excise, total } = totals;
  const blockedGroup = groups.find((g: any) => g.blocked || !g.payment_method || g.compliance?.problems?.length);

  const handlePlaceOrder = async () => {
    if (!selectedAddressId) {
      toast.error("Please select a shipping address");
      return;
    }

    setIsPlacingOrder(true);
    try {
      await apiClient.post("/orders/checkout", {
        shipping_address_id: selectedAddressId,
        billing_address_id: selectedAddressId,
        business_name: user?.businessName || "",
        promo_codes: promoCodes,
        payment_methods: Object.fromEntries(groups.filter((g: any) => g.company).map((g: any) => [String(g.company.id), g.payment_method])),
      });
      dispatch(clearCart());
      toast.success(
        groups.length > 1 ? `${groups.length} orders placed, one per seller` : "Order placed successfully!",
      );
      navigate("/account?tab=orders", { state: { orderSuccess: true } });
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to place order.");
    } finally {
      setIsPlacingOrder(false);
    }
  };

  if (loading)
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-blue-600 w-10 h-10 mb-4" />
        <p className="text-gray-500 font-medium">Preparing your checkout...</p>
      </div>
    );

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex items-center gap-3 mb-10">
        <div className="p-3 bg-blue-600 rounded-2xl text-white">
          <ShoppingBag size={24} />
        </div>
        <h1 className="text-4xl font-black text-gray-900 dark:text-white">Secure Checkout</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-8 space-y-8">
          {/* 1. SHIPPING ADDRESS */}
          <section className="bg-white border border-gray-200 rounded-[32px] p-8 shadow-sm">
            <h3 className="text-xl font-black mb-6 flex items-center gap-3">
              <MapPin className="text-blue-600" /> 1. Shipping Address
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {addresses.map((addr: any) => (
                <div
                  key={addr.id}
                  onClick={() => setSelectedAddressId(String(addr.id))}
                  className={`relative p-5 border-2 rounded-2xl cursor-pointer transition-all duration-200 ${
                    selectedAddressId === String(addr.id)
                      ? "border-blue-600 bg-blue-50/50"
                      : "border-gray-100 hover:border-gray-300 bg-gray-50/30"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-bold text-gray-900">{addr.full_name}</p>
                    {selectedAddressId === String(addr.id) && (
                      <CheckCircle size={20} className="text-blue-600" />
                    )}
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {addr.address_line1}
                    <br />
                    {addr.city}, {addr.state} {addr.postal_code}
                  </p>
                </div>
              ))}
              {addresses.length === 0 && (
                <button
                  onClick={() => navigate("/account?tab=addresses")}
                  className="border-2 border-dashed border-gray-200 rounded-2xl p-5 text-gray-500 hover:text-blue-600 text-sm font-bold"
                >
                  + Add New Address
                </button>
              )}
            </div>
          </section>

          {/* 2. PAYMENT METHOD */}
          <section className="bg-white border border-gray-200 rounded-[32px] p-8 shadow-sm">
            <h3 className="text-xl font-black mb-6 flex items-center gap-3">
              <CreditCard className="text-blue-600" /> 2. Payment Method
            </h3>
            <div className="space-y-4">
              {groups.map((g: any) => {
                const key = String(g.company?.id ?? "other");
                const opts = g.payment_options || {};
                return (
                  <div key={key} className="border border-gray-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
                      Pay {g.company?.name || "seller"} · {"$"}{Number(g.total).toFixed(2)}
                    </p>
                    {g.blocked ? (
                      <p className="text-sm font-medium text-red-700 bg-red-50 rounded-xl p-3">Your account with this seller is on hold. Please contact them.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {opts.cash_on_delivery && (
                          <button
                            type="button"
                            onClick={() => choosePayment(key, "cash_on_delivery")}
                            className={`text-left p-4 border-2 rounded-xl transition-all ${g.payment_method === "cash_on_delivery" ? "border-blue-600 bg-blue-50/50" : "border-gray-100 hover:border-gray-300"}`}
                          >
                            <p className="font-bold text-gray-900">Cash on delivery</p>
                            <p className="text-xs text-gray-500">Pay when the order arrives</p>
                          </button>
                        )}
                        {opts.on_account && (
                          <button
                            type="button"
                            onClick={() => choosePayment(key, "on_account")}
                            className={`text-left p-4 border-2 rounded-xl transition-all ${g.payment_method === "on_account" ? "border-blue-600 bg-blue-50/50" : "border-gray-100 hover:border-gray-300"}`}
                          >
                            <p className="font-bold text-gray-900">On account · Net {opts.on_account.terms_days}</p>
                            <p className={`text-xs ${opts.on_account.credit_available < g.total ? "text-red-600 font-bold" : "text-gray-500"}`}>
                              {"$"}{Number(opts.on_account.credit_available).toFixed(2)} of {"$"}{Number(opts.on_account.credit_limit).toFixed(2)} credit available
                            </p>
                          </button>
                        )}
                        {!opts.cash_on_delivery && !opts.on_account && (
                          <p className="text-sm text-amber-800 bg-amber-50 rounded-xl p-3 md:col-span-2">This seller only sells on account to approved customers. Contact them to set up payment terms.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* SUMMARY SECTION */}
        <div className="lg:col-span-4">
          <div className="bg-gray-50 border border-gray-200 rounded-[32px] p-8 sticky top-8">
            <h3 className="text-xl font-black mb-8 flex items-center gap-2">
              <Package size={20} /> Summary
            </h3>

            <div className="space-y-4 mb-8 max-h-[300px] overflow-y-auto pr-2">
              {groups.map((g: any) => (
                <div key={g.company?.id ?? "other"} className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {g.company?.name || "Seller"}
                  </p>
                  {g.items.map((item: any) => {
                    const itemPrice = Number(item.unit_price ?? item.products?.price ?? 0);
                    const listPrice = Number(item.list_price ?? itemPrice);
                    return (
                      <div key={`${item.product_id}|${item.flavor || ""}`} className="flex justify-between items-center gap-4">
                        <div className="flex-1">
                          <p className="font-bold text-gray-900 text-sm">{item.products?.title || "Item"}{item.flavor ? <span className="font-medium text-blue-700"> · {item.flavor}</span> : null}</p>
                          <p className="text-xs text-gray-500">
                            {item.quantity} × ${itemPrice.toFixed(2)}
                            {listPrice > itemPrice && <span className="line-through ml-1 text-gray-400">${listPrice.toFixed(2)}</span>}
                          </p>
                        </div>
                        <p className="font-bold text-gray-900">${(itemPrice * item.quantity).toFixed(2)}</p>
                      </div>
                    );
                  })}
                  <div className="text-xs text-gray-500 text-right space-y-0.5">
                    {g.discount > 0 && <p className="text-green-700">Promo {g.promo?.code}: -${Number(g.discount).toFixed(2)}</p>}
                    <p>
                      Shipping {g.shipping > 0 ? `$${Number(g.shipping).toFixed(2)}` : "free"}
                      {g.tax > 0 && ` · Tax $${Number(g.tax).toFixed(2)}`}
                      {g.excise > 0 && ` · Excise tax${g.compliance?.state ? ` (${g.compliance.state})` : ""} $${Number(g.excise).toFixed(2)}`} · Order total{" "}
                      <b className="text-gray-900">${Number(g.total).toFixed(2)}</b>
                    </p>
                    {g.shipping > 0 && g.free_shipping_over != null && <p>Free shipping from ${Number(g.free_shipping_over).toFixed(2)}</p>}
                    {g.compliance?.problems?.map((pr: any) => <p key={pr.message} className="text-left text-red-700 font-semibold bg-red-50 rounded-lg px-2 py-1 mt-1">{pr.message}</p>)}
                    {g.compliance?.flags?.map((f: string) => <p key={f} className="text-left text-amber-700">{f}</p>)}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={applyPromo} className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  placeholder="Promo code"
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-xl text-sm bg-white text-gray-900 uppercase"
                />
              </div>
              <button disabled={!promoInput.trim() || refreshing} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold disabled:opacity-40">Apply</button>
            </form>
            {promoCodes.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {promoCodes.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded-lg">
                    {c}
                    <button onClick={() => removePromo(c)} aria-label={`Remove ${c}`}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            {promoErrors.length > 0 && promoErrors.map((p) => (
              <p key={p.code} className="text-xs text-red-600 mb-2">{p.code}: {p.message}</p>
            ))}

            <div className="border-t border-gray-200 pt-6 space-y-3">
              <div className="flex justify-between text-gray-600">
                <span className="font-medium">Subtotal</span>
                <span className="font-bold">${subtotal.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-green-700">
                  <span className="font-medium">Discount</span>
                  <span className="font-bold">-${discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span className="font-medium">Shipping</span>
                <span className="font-bold">${shipping.toFixed(2)}</span>
              </div>
              {tax > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span className="font-medium">Tax</span>
                  <span className="font-bold">${tax.toFixed(2)}</span>
                </div>
              )}
              {excise > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span className="font-medium">Tobacco excise tax</span>
                  <span className="font-bold">${excise.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-2xl font-black pt-4 text-gray-900 border-t border-gray-200 mt-4">
                <span>Total</span>
                <span className="text-blue-600">${total.toFixed(2)}</span>
              </div>
            </div>

            {cannotOrder && (
              <p className="mt-6 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Your account owner hasn't enabled ordering for you yet.
              </p>
            )}
            <button
              onClick={handlePlaceOrder}
              disabled={
                isPlacingOrder ||
                refreshing ||
                !selectedAddressId ||
                cartItems.length === 0 ||
                cannotOrder ||
                !!blockedGroup ||
                promoErrors.length > 0
              }
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-5 rounded-2xl font-black text-lg mt-10 transition-all flex items-center justify-center gap-2 shadow-xl"
            >
              {isPlacingOrder ? (
                <>
                  <Loader2 className="animate-spin" /> Processing...
                </>
              ) : (
                "Complete Purchase"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
