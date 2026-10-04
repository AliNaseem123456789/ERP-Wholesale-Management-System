import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { adminService } from "../../../features/admin/api/admin.service";

const FourFeatureSection: React.FC = () => {
  const navigate = useNavigate();
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBanners = async () => {
      try {
        const data = await adminService.getSettings();
        const featureItems = data
          .filter((item: any) => item.key.startsWith("feature_"))
          .sort((a: any, b: any) => a.key.localeCompare(b.key));
        setFeatures(featureItems);
      } catch (error) {
        console.error("Failed to load banners", error);
      } finally {
        setLoading(false);
      }
    };
    fetchBanners();
  }, []);
  if (loading)
    return (
      <div className="h-96 flex items-center justify-center">
        Loading Banners...
      </div>
    );
  return (
    <section className="py-10 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.length === 0 && <p>No features found in database.</p>}
          {features.map((item) => {
            console.log("Current Item:", item);
            const imageUrl = item.value?.image || item.image;
            const linkUrl = item.value?.link || item.link;
            return (
              <div
                key={item.key}
                onClick={() => navigate(linkUrl)}
                className="group relative aspect-[2/1] w-full overflow-hidden border border-gray-200 cursor-pointer transition-all hover:border-cyan-500 hover:shadow-xl"
              >
                <img
                  src={imageUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-fill transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    console.error("Image failed to load:", imageUrl);
                    (e.target as HTMLImageElement).src =
                      "https://placehold.co/600x300?text=Image+Not+Found";
                  }}
                />
                <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
export default FourFeatureSection;
