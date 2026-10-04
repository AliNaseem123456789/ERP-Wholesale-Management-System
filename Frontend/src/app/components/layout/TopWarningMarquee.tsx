import React from "react";

const TopWarningMarquee: React.FC = () => {
  const warnings = [
    "⚠️ WARNING: SOME PRODUCTS CONTAIN NICOTINE.",
    "NICOTINE IS AN ADDICTIVE CHEMICAL.",
    "SALE RESTRICTED TO ADULTS 21 YEARS OF AGE OR OLDER.",
    "NEW YORK LAW PROHIBITS SALE TO MINORS.",
    "WARNING: ALL ORDERS ARE MONITORED FOR AUTHENTICITY.",
    "ANY SUSPICIOUS OR FRAUDULENT ACTIVITY MAY RESULT IN LEGAL ACTION."
  ];

  const MarqueeGroup = () => (
    <div className="flex shrink-0 items-center gap-16 px-16">
      {warnings.map((text, index) => (
        <span key={index} className="uppercase tracking-widest">
          {text}
        </span>
      ))}
    </div>
  );

  return (
    <div className="w-full overflow-hidden bg-black py-2 text-[12px] font-bold text-white border-b border-white/10">
      <div className="flex animate-warning-marquee whitespace-nowrap">
        <MarqueeGroup />
        <MarqueeGroup />
      </div>
    </div>
  );
};

export default TopWarningMarquee;