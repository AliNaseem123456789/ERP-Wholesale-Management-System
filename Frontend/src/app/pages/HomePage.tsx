// The marketplace homepage: sections arranged in Admin → Site → Homepage (?preview=draft shows the draft to admins).
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { siteApi, HomeSection } from "../../features/site/api";
import { HomeSections } from "../../features/site/HomeSections";
import { useLook } from "../../features/site/SiteContext";
import { useSeo } from "../../features/insights/seo";

export const HomePage: React.FC = () => {
  const [params] = useSearchParams();
  const preview = params.get("preview") === "draft";
  const [sections, setSections] = useState<HomeSection[] | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const look = useLook();
  useSeo({ path: "/" });
  useEffect(() => {
    siteApi.homepage(preview).then((r) => { setSections(r.sections); setIsPreview(r.preview); }).catch(() => setSections([]));
  }, [preview]);

  return (
    <div className={`min-h-screen ${look.pageBg}`}>
      {isPreview && <div className="bg-amber-400 text-amber-950 text-sm font-bold text-center py-2">Preview of the draft homepage. Visitors still see the published one.</div>}
      {!sections ? (
        <div>
          <div className="h-[60vh] min-h-[460px] bg-gray-900 animate-pulse" />
          <div className="max-w-7xl mx-auto px-6 mt-10 grid grid-cols-2 md:grid-cols-5 gap-4">{Array.from({ length: 10 }, (_, i) => <div key={i} className="aspect-[3/4] rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse" />)}</div>
        </div>
      ) : (
        <HomeSections sections={sections} />
      )}
    </div>
  );
};
