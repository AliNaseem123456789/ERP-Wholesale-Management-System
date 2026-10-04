import { useState } from "react";
import { SECONDARY_NAV_DATA } from "../../data/secondaryNavbarData";
import { useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";

const SecondaryNavbar: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const activeCategory =
    activeIndex !== null ? SECONDARY_NAV_DATA[activeIndex] : null;

  const isSingleColumn =
    activeCategory?.title === "Devices / Pods / Coils / Tanks";

  const isSmokeShop = activeCategory?.title === "Smoke Shop";

  const handleItemClick = (value: string) => {
    if (isSmokeShop) {
      navigate(`/category/${encodeURIComponent(value)}`);
    } else {
      navigate(`/brand/${encodeURIComponent(value)}`);
    }
    setActiveIndex(null);
    setMobileOpen(false);
  };

  return (
    <>
      {/* ================= DESKTOP NAV ================= */}
      <div
        className="relative hidden md:block"
        style={{ backgroundColor: "rgba(0,0,0,1)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-1 flex justify-center">
          <ul className="flex gap-6 text-md font-semibold uppercase tracking-wide text-gray-100">
            {SECONDARY_NAV_DATA.map((category, index) => (
              <li
                key={category.title}
                className="relative py-3 cursor-pointer hover:text-gray-300"
                onMouseEnter={() => setActiveIndex(index)}
              >
                {category.title}

                {/* SINGLE COLUMN DROPDOWN */}
                {activeCategory &&
                  activeIndex === index &&
                  isSingleColumn && (
                    <div
                      className="absolute left-0 top-full mt-2 w-64 bg-black border border-gray-700 z-50"
                      onMouseLeave={() => setActiveIndex(null)}
                    >
                      <ul className="p-2 space-y-1">
                        {activeCategory.brands.map((item) => (
                          <li
                            key={item}
                            className="px-3 py-2 text-sm text-gray-200 border border-gray-700 rounded hover:bg-gray-800 cursor-pointer"
                            onClick={() => handleItemClick(item)}
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </li>
            ))}

            <li
              className="py-3 cursor-pointer hover:text-gray-300"
              onClick={() =>
                navigate(
                  `/category/${encodeURIComponent("ALT Nicotine")}`
                )
              }
            >
              Nicotine Pouches
            </li>
          </ul>
        </div>

        {/* WIDE DROPDOWN */}
        {activeCategory && !isSingleColumn && (
          <div
            className="absolute left-0 top-full w-full bg-black border-t border-gray-700 z-40"
            onMouseLeave={() => setActiveIndex(null)}
          >
            <div className="max-w-7xl mx-auto px-4 py-4">
              <ul className="grid grid-cols-4 gap-4">
                {activeCategory.brands.map((item) => (
                  <li
                    key={item}
                    className="px-3 py-2 text-sm text-gray-200 border border-gray-700 rounded hover:bg-gray-800 cursor-pointer"
                    onClick={() => handleItemClick(item)}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* ================= MOBILE HAMBURGER ================= */}
      <div className="md:hidden bg-black border-t border-gray-700 px-4 py-2">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-2 text-cyan-400"
        >
          <Menu size={24} />
          <span className="font-semibold">Categories</span>
        </button>
      </div>

      {/* ================= MOBILE SIDEBAR ================= */}
      {mobileOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setMobileOpen(false)}
          />

          {/* Sidebar */}
          <div className="fixed top-0 left-0 h-full w-72 bg-black z-50 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-cyan-400">Categories</h2>
              <button onClick={() => setMobileOpen(false)}>
                <X className="text-gray-300" />
              </button>
            </div>

            <ul className="space-y-3">
              {SECONDARY_NAV_DATA.map((category, index) => (
                <li key={category.title}>
                  <button
                    onClick={() =>
                      setActiveIndex(
                        activeIndex === index ? null : index
                      )
                    }
                    className="w-full text-left text-gray-200 font-semibold uppercase"
                  >
                    {category.title}
                  </button>

                  {activeIndex === index && (
                    <ul className="mt-2 space-y-1 pl-3">
                      {category.brands.map((item) => (
                        <li
                          key={item}
                          onClick={() => handleItemClick(item)}
                          className="text-sm text-gray-300 hover:text-cyan-400 cursor-pointer"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}

              <li
                onClick={() =>
                  navigate(
                    `/category/${encodeURIComponent("ALT Nicotine")}`
                  )
                }
                className="text-gray-200 font-semibold uppercase cursor-pointer"
              >
                Nicotine Pouches
              </li>
            </ul>
          </div>
        </>
      )}
    </>
  );
};

export default SecondaryNavbar;
