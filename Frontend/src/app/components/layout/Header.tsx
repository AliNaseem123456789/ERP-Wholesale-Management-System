import React, { useState } from "react";
import { ShoppingCart, Home, Sun, Moon, User, LayoutDashboard, Briefcase, Building2, Menu, Search, X } from "lucide-react";
import { useAuth } from "../../../features/auth/context/AuthContext";
import { useAppSelector } from "../../../app/hooks";
import { Link, useNavigate } from "react-router-dom";
import { NotificationBell } from "../../../features/notifications/notifications";
import { useLook, useSite } from "../../../features/site/SiteContext";
import { MainNav, MobileMenu } from "../../../features/site/MainNav";
import { SearchBox } from "../../../features/site/SearchBox";
import { AnnouncementBar } from "../../../features/site/widgets";

const Logo: React.FC<{ small?: boolean }> = ({ small }) => {
  const look = useLook();
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Home">
      <span className={`${small ? "text-xl" : "text-2xl"} font-extrabold ${look.logoAccent}`}>ERP</span>
      <span className={`text-sm tracking-wide ${look.logoText}`}>WHOLESALE</span>
    </Link>
  );
};

export const Header: React.FC = () => {
  const { user, logout, loading } = useAuth();
  const isAuthenticated = !!user;
  const { mode, toggleMode, appearance } = useSite();
  const look = useLook();
  const cartItems = useAppSelector((state) => state.cart.items);
  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  const navigate = useNavigate();
  const hasBusiness = !!user?.companies?.length;
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);

  const handleProfileClick = () => navigate(user?.role === "ADMIN" ? "/admin" : "/account");
  const ModeIcon = mode === "dark" ? Sun : Moon;

  return (
    <>
      <AnnouncementBar />

      {/* desktop */}
      <header className={`sticky top-0 z-50 hidden md:block ${look.header}`}>
        <div className="relative h-20 flex items-center" style={look.headerBg}>
          {look.headerOverlay && <div className={look.headerOverlay} />}
          <div className="relative max-w-7xl mx-auto w-full px-6 flex items-center justify-between gap-6">
            <Logo />
            <SearchBox className="flex-1 max-w-xl" inputClassName={look.clean ? "border border-gray-300 dark:border-slate-700" : ""} />
            <div className="flex items-center gap-3">
              <button onClick={() => navigate("/")} className={`p-2 rounded-md ${look.iconBtn}`} aria-label="Home" title="Home"><Home /></button>
              <button onClick={() => navigate("/companies")} className={`p-2 rounded-md ${look.iconBtn}`} aria-label="Suppliers" title="Suppliers"><Building2 /></button>
              {loading ? (
                <div className="w-40 h-10 rounded-md bg-gray-500/20 animate-pulse" />
              ) : (
                <>
                  {isAuthenticated && (
                    <button onClick={() => navigate("/business")} className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold ${look.outlineBtn}`}
                      title={hasBusiness ? "Business back office" : "Sell on the marketplace"}>
                      <Briefcase size={18} /> {hasBusiness ? "Business" : "Sell"}
                    </button>
                  )}
                  {isAuthenticated && <NotificationBell className={look.outlineBtn} />}
                  <button onClick={() => navigate("/cart")} className={`relative p-2 rounded-md ${look.outlineBtn}`} aria-label={`Cart, ${cartCount} items`}>
                    <ShoppingCart />
                    {cartCount > 0 && <span className={`absolute -top-2 -right-2 text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold ${look.countBadge}`}>{cartCount}</span>}
                  </button>
                  {!isAuthenticated ? (
                    <>
                      <button onClick={() => navigate("/register")} className={`px-4 py-2 rounded-md ${look.accountBtn}`}>Register</button>
                      <button onClick={() => navigate("/login")} className={`px-4 py-2 rounded-md font-semibold ${look.primaryBtn}`}>Login</button>
                    </>
                  ) : (
                    <>
                      <button onClick={handleProfileClick} className={`p-2 rounded-md ${look.accountBtn}`} title={user?.role === "ADMIN" ? "Admin dashboard" : "My account"} aria-label={user?.role === "ADMIN" ? "Admin dashboard" : "My account"}>
                        {user?.role === "ADMIN" ? <LayoutDashboard size={24} /> : <User size={24} />}
                      </button>
                      <button onClick={async () => { await logout(); navigate("/"); }} className={`px-4 py-2 rounded-md ${look.accountBtn}`}>Logout</button>
                    </>
                  )}
                </>
              )}
              {appearance.allow_toggle && (
                <button onClick={toggleMode} className={`p-2 rounded-md ${look.outlineBtn}`} aria-label={mode === "dark" ? "Light mode" : "Dark mode"} title={mode === "dark" ? "Light mode" : "Dark mode"}>
                  <ModeIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
      <MainNav />

      {/* phone: top bar with menu, logo, search and cart */}
      <header className={`sticky top-0 z-50 md:hidden ${look.mobileTop}`}>
        <div className="flex items-center gap-2 px-3 h-14">
          <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className={`p-2 rounded-md ${look.iconBtn}`}><Menu size={22} /></button>
          <div className="flex-1 flex justify-center"><Logo small /></div>
          <button onClick={() => setMobileSearch(!mobileSearch)} aria-label={mobileSearch ? "Close search" : "Search"} aria-expanded={mobileSearch} className={`p-2 rounded-md ${look.iconBtn}`}>
            {mobileSearch ? <X size={22} /> : <Search size={22} />}
          </button>
          <button onClick={() => navigate("/cart")} aria-label={`Cart, ${cartCount} items`} className={`relative p-2 rounded-md ${look.iconBtn}`}>
            <ShoppingCart size={22} />
            {cartCount > 0 && <span className={`absolute top-0 right-0 text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold ${look.countBadge}`}>{cartCount}</span>}
          </button>
        </div>
        {mobileSearch && <div className="px-3 pb-3"><SearchBox autoFocus onDone={() => setMobileSearch(false)} inputClassName="border border-gray-200" /></div>}
      </header>
      {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)} />}

      {/* phone: bottom bar */}
      <nav className={`fixed bottom-0 left-0 right-0 z-50 md:hidden ${look.mobileBar}`} aria-label="Quick links">
        <div className="flex justify-around items-center py-2">
          <button onClick={() => navigate("/")} className="flex flex-col items-center"><Home size={22} /><span className="text-xs">Home</span></button>
          <button onClick={() => navigate("/categories")} className="flex flex-col items-center"><Menu size={22} /><span className="text-xs">Categories</span></button>
          {!isAuthenticated ? (
            <button onClick={() => navigate("/login")} className="flex flex-col items-center"><User size={22} /><span className="text-xs">Login</span></button>
          ) : (
            <button onClick={handleProfileClick} className="flex flex-col items-center">
              {user?.role === "ADMIN" ? <LayoutDashboard size={22} /> : <User size={22} />}
              <span className="text-xs">{user?.role === "ADMIN" ? "Admin" : "Account"}</span>
            </button>
          )}
          {isAuthenticated && <NotificationBell mobile className="" />}
          {hasBusiness && <button onClick={() => navigate("/business")} className="flex flex-col items-center"><Briefcase size={22} /><span className="text-xs">Business</span></button>}
          {appearance.allow_toggle && (
            <button onClick={toggleMode} className="flex flex-col items-center"><ModeIcon size={22} /><span className="text-xs">Theme</span></button>
          )}
        </div>
      </nav>
    </>
  );
};
