import React from "react";
import { Link } from "react-router-dom";

export const Footer: React.FC = () => {
  return (
    <footer className="w-full">
      <div
        className="relative text-white px-4 sm:px-6 py-8 sm:py-10"
        style={{
          backgroundImage: "url('/logos/galaxy.jpeg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

        <div className="relative max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="text-center md:text-left">
            <p className="text-sm opacity-90 mb-2">
              Unbeatable Deals, Endless Choices – Shop Now!
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight">
              Shop Smarter, Save Bigger!
            </h2>
          </div>
          <div className="flex flex-wrap justify-center md:justify-end gap-3 sm:gap-4">
            {["footer1.jpg", "footer2.jpg", "footer3.jpg", "footer4.jpg"].map(
              (img, i) => (
                <img
                  key={i}
                  src={`/logos/${img}`}
                  alt={`Footer ${i + 1}`}
                  className="
                    aspect-square
                    w-20 sm:w-24 md:w-28 lg:w-32
                    object-cover
                    rounded-lg
                    shadow-lg
                  "
                />
              )
            )}
          </div>
        </div>
      </div>
      <div className="bg-[#f8f8f8] px-6 py-8 text-[#333]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-x-8 gap-y-6">
          <div className="space-y-2">
            <div>
              <h3 className="text-xl font-black tracking-tighter uppercase">
                SOOTA SMOKE
              </h3>
              <p className="text-xs font-bold uppercase">
                Exceeding The Expectations
              </p>
            </div>
            <p className="text-sm leading-snug text-gray-700 max-w-xs">
              We are an authorized wholesale vape distributor of thousands of
              e-liquids and vaping devices based in New York.
            </p>
            <div className="pt-1">
              <div className="border border-yellow-400 rounded-md p-1 px-2 inline-flex items-center gap-2 bg-white scale-90 origin-left">
                <span className="text-blue-900 font-bold text-[9px] uppercase italic leading-none">
                  Secured by <br />
                  <span className="text-sm normal-case">positiveSSL</span>
                </span>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2 uppercase">
              Navigation
            </h4>
            <ul className="text-sm space-y-1">
              <li><Link to="/" className="hover:text-gray-500">Homepage</Link></li>
              <li><Link to="/trending" className="hover:text-gray-500">Trending Products</Link></li>
              <li><Link to="/account" className="hover:text-gray-500">My Account</Link></li>
              <li><Link to="/brand" className="hover:text-gray-500">Shop by Brands</Link></li>
              <li><Link to="/FAQ" className="hover:text-gray-500">FAQ</Link></li>
              <li><Link to="/contact" className="hover:text-gray-500">Contact Us</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2 uppercase">
              Stay Connected
            </h4>
            <p className="text-sm mb-3">
              Exclusive discounts, sales & news!
            </p>
            <div className="space-y-2">
              <input
                type="email"
                placeholder="Email Address"
                className="w-full border border-gray-300 p-2 text-sm bg-white focus:outline-none"
              />
              <button className="w-full bg-[#360542] text-white py-2 text-sm font-bold hover:bg-black transition-colors">
                Subscribe
              </button>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2 uppercase">
              Contact Us
            </h4>
            <div className="space-y-2 text-sm">
              <p className="text-blue-600 truncate">
                support@sootasmoke.com
              </p>
              <p>(516) 485-4343</p>
              <p className="leading-tight">
                34 Nassau Blvd, Garden City, NY 11530
              </p>
            </div>
          </div>

        </div>
      </div>

      <div className="bg-white px-6 py-4 border-t border-gray-100">
        <div className="max-w-7xl mx-auto text-[11px] leading-tight text-gray-600 italic">
          <p>
            <span className="font-bold uppercase not-italic">Warning:</span>{" "}
            This product contains nicotine which is a highly addictive substance.
            NOT FOR SALE TO MINORS.
          </p>
        </div>
      </div>
      <div className="bg-[#f8f8f8] border-t border-gray-200 py-3 px-6 text-center text-xs text-gray-500">
        © 2026 Soota Smoke Shop. All rights reserved.
      </div>
    </footer>
  );
};

export default Footer;
