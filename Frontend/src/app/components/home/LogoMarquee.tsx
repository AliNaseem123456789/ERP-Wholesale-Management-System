import React from "react";
const logos = Array.from({ length: 12 }, (_, i) => ({
  src: `/logos/logo${i + 1}.jpg`,
  link: "#", 
}));

const LogoMarquee: React.FC = () => {
  return (
    <div className="w-full overflow-hidden bg-gray-100 py-6">
      <div className="relative flex w-[200%] animate-logo-marquee items-center">
        {[...logos, ...logos].map((logo, index) => (
          <a
            key={index}
            href={logo.link}
            className="flex items-center justify-center px-4 py-2 cursor-pointer"
          >
            <img
              src={logo.src}
              alt={`Logo ${index + 1}`}
              className="h-full w-full "
              draggable={false}
              loading="lazy"
            />
          </a>
        ))}
      </div>

      {/* Local animation – no tailwind config needed */}
      <style>
        {`
          @keyframes logo-marquee {
            0% {
              transform: translateX(0);
            }
            100% {
              transform: translateX(-50%);
            }
          }

          .animate-logo-marquee {
            animation: logo-marquee 25s linear infinite;
          }
        `}
      </style>
    </div>
  );
};

export default LogoMarquee;
