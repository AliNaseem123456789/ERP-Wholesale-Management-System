import React from "react";
import { Headphones, Gift, Star, Truck } from "lucide-react";

const WhyChooseUs: React.FC = () => {
  return (
    <section
      className="relative py-10 px-6 text-white"
      style={{
        backgroundImage: "url('/logos/galaxy.jpeg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Galaxy overlay + blur (same as footer) */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

      {/* Content */}
      <div className="relative max-w-6xl mx-auto">
        <h2 className="text-center text-3xl md:text-4xl font-semibold tracking-wide mb-16 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
          WHY OUR CUSTOMERS CHOOSE US AGAIN
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 items-center">
          {/* Left features */}
          <div className="space-y-12">
            <Feature
              icon={<Headphones size={22} />}
              title="Best Customer Service"
              description="Our support team is always ready to help you with quick and friendly service."
            />
            <Feature
              icon={<Gift size={22} />}
              title="Great Offers & Rewards"
              description="Enjoy exclusive deals, discounts, and rewards designed for loyal customers."
            />
          </div>

          {/* Center Image */}
          <div className="flex justify-center">
            <img
              src="logos/Hookah.png"
              alt="Product"
              loading="lazy"
              className="w-full h-full drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)]"
            />
          </div>

          {/* Right features */}
          <div className="space-y-12">
            <Feature
              icon={<Star size={22} />}
              title="Premium Quality Products"
              description="We deliver only high-quality products crafted with care and precision."
            />
            <Feature
              icon={<Truck size={22} />}
              title="Fast & Reliable Delivery"
              description="Your order reaches you safely and on time, every single time."
            />
          </div>
        </div>
      </div>
    </section>
  );
};

interface FeatureProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}
 
const Feature: React.FC<FeatureProps> = ({ icon, title, description }) => {
  return (
    <div className="flex items-start gap-4">
      <div className="text-yellow-400 min-w-[32px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
        {icon}
      </div>
      <div>
        <h4 className="text-lg font-semibold tracking-tight text-white mb-1 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
          {title}
        </h4>
        <p className="text-sm text-zinc-200 leading-relaxed tracking-tight">
          {description}
        </p>
      </div>
    </div>
  );
};

export default WhyChooseUs;
