import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { slides } from "../../data/heroslides";
import { useAuth } from "../../../features/auth/context/AuthContext";

export const HeroSection: React.FC = () => {
  const navigate = useNavigate();
  const [active, setActive] = useState(0);

  // 2. Access auth state
  const { user, loading } = useAuth();

  useEffect(() => {
    const interval = setInterval(() => {
      setActive((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative h-[70vh] min-h-[600px] overflow-hidden bg-black">
      <img
        src={slides[active].image}
        alt="Hero"
        className="absolute -top-[15px] left-0 w-full h-[calc(100%+15px)] object-cover transition-opacity duration-1000"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
      <div className="relative max-w-7xl mx-auto px-8 pb-16 h-full flex items-end">
        <div className="w-full">
          <div className="max-w-3xl mb-10">
            <h1 className="text-4xl md:text-6xl font-extrabold mb-4 text-white leading-tight">
              <span className="block">
                {slides[active].title.split("//")[0]}
              </span>
              <span className="text-white">
                {slides[active].title.split("//")[1]}
                <span className="text-cyan-400 ml-3">//</span>
              </span>
            </h1>
            <p className="text-lg md:text-xl text-gray-200 mb-8 max-w-2xl">
              {slides[active].subtitle}
            </p>

            {/* 3. Conditional Rendering for Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              {loading ? (
                // Optional: Show nothing or a small loader while checking auth
                <div className="h-12 w-32 bg-white/10 animate-pulse rounded-lg" />
              ) : !user ? (
                // GUEST BUTTONS
                <>
                  <button
                    onClick={() => navigate("/register")}
                    className="px-8 py-3 rounded-lg font-bold bg-cyan-500 text-black hover:bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all"
                  >
                    Get Started
                  </button>
                  <button
                    onClick={() => navigate("/login")}
                    className="px-8 py-3 rounded-lg font-bold border-2 border-pink-500 text-pink-500 hover:bg-pink-500 hover:text-white transition-all"
                  >
                    Login
                  </button>
                </>
              ) : (
                // LOGGED IN BUTTONS
                <>
                  <button
                    onClick={() => navigate("/cart")}
                    className="px-8 py-3 rounded-lg font-bold bg-white text-black hover:bg-gray-200 transition-all"
                  >
                    View My Quote Cart
                  </button>
                  <button
                    onClick={() => navigate("/")}
                    className="px-8 py-3 rounded-lg font-bold border-2 border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-black transition-all"
                  >
                    Browse Categories
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Thumbnails stay the same */}
          <div className="flex gap-4 items-center">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => setActive(index)}
                className={`relative h-20 w-32 rounded-lg transition-all duration-500 overflow-hidden border-2 ${
                  active === index
                    ? "border-cyan-400 scale-110 z-10 shadow-[0_0_25px_rgba(34,211,238,0.5)]"
                    : "border-transparent opacity-50 hover:opacity-100 hover:scale-105"
                }`}
              >
                <img
                  src={slides[index].image}
                  alt="thumb"
                  className="h-full w-full object-cover"
                />
                {active !== index && (
                  <div className="absolute inset-0 bg-black/40" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
