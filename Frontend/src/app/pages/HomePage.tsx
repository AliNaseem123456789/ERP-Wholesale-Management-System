// The marketplace homepage: sections arranged in Admin → Site → Homepage (?preview=draft shows the draft to admins).
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { siteApi, HomeSection } from "../../features/site/api";
import { HomeSections } from "../../features/site/HomeSections";
import { GridSkeleton } from "../../features/marketplace/components";
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
      {isPreview && <div className="bg-signal text-signal-ink text-sm font-semibold text-center py-2">Preview of the draft homepage. Visitors still see the published one.</div>}
      {!sections ? (
        <div aria-busy="true" aria-label="Loading">
          <div className="h-[520px] md:h-[580px] bg-night" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-12">
            <div className="h-8 w-64 rounded bg-raised animate-pulse mb-5" />
            <GridSkeleton count={10} cols="grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" />
          </div>
        </div>
      ) : (
        <HomeSections sections={sections} />
      )}
    </div>
  );
};
