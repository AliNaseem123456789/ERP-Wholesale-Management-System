import React, { useEffect, useState } from "react";
import {
  ShoppingCart,
  Home,
  Sun,
  Moon,
  User,
  LayoutDashboard,
  Briefcase,
  Building2,
} from "lucide-react"; // Added LayoutDashboard for flavor
import { useAuth } from "../../../features/auth/context/AuthContext";
import { useAppSelector } from "../../../app/hooks";
import { useNavigate } from "react-router-dom";
import SecondaryNavbar from "./SecondaryNavbar";
import TopWarningMarquee from "./TopWarningMarquee";
import { NotificationBell } from "../../../features/notifications/notifications";

export const Header: React.FC = () => {
  const { user, logout, loading } = useAuth();
  const isAuthenticated = !!user;

  const cartItems = useAppSelector((state) => state.cart.items);
  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const hasBusiness = !!user?.companies?.length;

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("theme") as "light" | "dark") || "dark";
  });

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // Logic to handle conditional routing based on role
  const handleProfileClick = () => {
    if (user?.role === "ADMIN") {
      navigate("/admin"); // Or your specific admin dashboard path
    } else {
      navigate("/account");
    }
  };

  if (loading) {
    return (
      <header className="sticky top-0 z-50 w-full">
        <div className="h-20 bg-black/80 flex items-center px-6">
          <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-24 h-8 bg-gray-700/50 rounded animate-pulse" />
            </div>
            <div className="hidden md:block w-96 h-10 bg-gray-700/50 rounded-lg animate-pulse" />
            <div className="flex gap-4">
              <div className="w-10 h-10 bg-gray-700/50 rounded-md animate-pulse" />
              <div className="w-10 h-10 bg-gray-700/50 rounded-md animate-pulse" />
            </div>
          </div>
        </div>
        <div className="h-12 bg-gray-900 border-b border-gray-800 animate-pulse" />
      </header>
    );
  }

  return (
    <>
      <TopWarningMarquee />
      <header className="sticky top-0 z-50 hidden md:block">
        <div
          className="relative h-20 flex items-center"
          style={{
            backgroundImage: "url('/logos/galaxy.jpeg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <div className="relative max-w-7xl mx-auto w-full px-6 flex items-center justify-between">
            {/* Logo */}
            <div
              onClick={() => navigate("/")}
              className="flex items-center gap-2 cursor-pointer"
            >
              <span className="text-2xl font-extrabold text-cyan-400">
                Soota
              </span>
              <span className="text-sm text-white tracking-wide">
                Smoke Shop
              </span>
            </div>

            {/* Search */}
            <div className="hidden md:flex flex-1 max-w-md">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim().length >= 2) {
                    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                  }
                }}
                aria-label="Search products"
                placeholder="Search products, brands or SKU..."
                className="w-full px-4 py-2 rounded-lg bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/")}
                className="p-2 text-cyan-400 hover:bg-cyan-400/20 rounded-md transition-colors"
              >
                <Home />
              </button>

              <button
                onClick={() => navigate("/companies")}
                className="p-2 text-cyan-400 hover:bg-cyan-400/20 rounded-md transition-colors"
                title="Suppliers"
              >
                <Building2 />
              </button>

              {isAuthenticated && (
                <button
                  onClick={() => navigate("/business")}
                  className="flex items-center gap-1.5 px-3 py-2 border border-cyan-400 text-cyan-400 rounded-md hover:bg-cyan-400/10 transition-colors text-sm font-semibold"
                  title={hasBusiness ? "Business back office" : "Sell on the marketplace"}
                >
                  <Briefcase size={18} /> {hasBusiness ? "Business" : "Sell"}
                </button>
              )}

              {isAuthenticated && <NotificationBell className="border-cyan-400 text-cyan-400 hover:bg-cyan-400/10" />}

              <button
                onClick={() => navigate("/cart")}
                className="relative p-2 border border-cyan-400 text-cyan-400 rounded-md hover:bg-cyan-400/10 transition-colors"
              >
                <ShoppingCart />
                {cartCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-cyan-400 text-black text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">
                    {cartCount}
                  </span>
                )}
              </button>

              {!isAuthenticated ? (
                <>
                  <button
                    onClick={() => navigate("/register")}
                    className="px-4 py-2 border border-pink-500 text-pink-400 rounded-md hover:bg-pink-500/10 transition-colors"
                  >
                    Register
                  </button>
                  <button
                    onClick={() => navigate("/login")}
                    className="px-4 py-2 border border-pink-500 text-pink-400 rounded-md hover:bg-pink-500/10 transition-colors"
                  >
                    Login
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  {/* ROLE-BASED PROFILE ICON */}
                  <button
                    onClick={handleProfileClick}
                    className="p-2 border border-pink-500 text-pink-400 rounded-md hover:bg-pink-500/10 transition-colors"
                    title={
                      user?.role === "ADMIN" ? "Admin Dashboard" : "My Account"
                    }
                  >
                    {user?.role === "ADMIN" ? (
                      <LayoutDashboard size={24} />
                    ) : (
                      <User size={24} />
                    )}
                  </button>
                  <button
                    onClick={async () => {
                      await logout();
                      navigate("/");
                    }}
                    className="px-4 py-2 border border-pink-500 text-pink-400 rounded-md hover:bg-pink-500/10 transition-colors"
                  >
                    Logout
                  </button>
                </div>
              )}

              <button
                onClick={toggleTheme}
                className="p-2 border border-cyan-400 text-cyan-400 rounded-md hover:bg-cyan-400/10 transition-colors"
              >
                {theme === "dark" ? <Sun /> : <Moon />}
              </button>
            </div>
          </div>
        </div>
      </header>

      <SecondaryNavbar />

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-black/90 backdrop-blur-lg border-t border-cyan-400">
        <div className="flex justify-around items-center py-2">
          <button
            onClick={() => navigate("/")}
            className="flex flex-col items-center text-cyan-400"
          >
            <Home size={22} />
            <span className="text-xs">Home</span>
          </button>

          <button
            onClick={() => navigate("/cart")}
            className="relative flex flex-col items-center text-cyan-400"
          >
            <ShoppingCart size={22} />
            <span className="text-xs">Cart</span>
            {cartCount > 0 && (
              <span className="absolute top-0 right-2 bg-cyan-400 text-black text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold">
                {cartCount}
              </span>
            )}
          </button>

          {/* DYNAMIC AUTH LINK FOR MOBILE */}
          {!isAuthenticated ? (
            <button
              onClick={() => navigate("/login")}
              className="flex flex-col items-center text-pink-400"
            >
              <User size={22} />
              <span className="text-xs">Login</span>
            </button>
          ) : (
            <button
              onClick={handleProfileClick}
              className="flex flex-col items-center text-pink-400"
            >
              {user?.role === "ADMIN" ? (
                <LayoutDashboard size={22} />
              ) : (
                <User size={22} />
              )}
              <span className="text-xs">
                {user?.role === "ADMIN" ? "Admin" : "Account"}
              </span>
            </button>
          )}

          {isAuthenticated && <NotificationBell mobile className="text-cyan-400" />}

          {hasBusiness && (
            <button
              onClick={() => navigate("/business")}
              className="flex flex-col items-center text-cyan-400"
            >
              <Briefcase size={22} />
              <span className="text-xs">Business</span>
            </button>
          )}

          <button
            onClick={toggleTheme}
            className="flex flex-col items-center text-cyan-400"
          >
            {theme === "dark" ? <Sun size={22} /> : <Moon size={22} />}
            <span className="text-xs">Theme</span>
          </button>
        </div>
      </nav>
      <div className="h-16 md:hidden" />
    </>
  );
};
