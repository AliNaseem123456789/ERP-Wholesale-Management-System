// Search engines and link previews. The site is a single-page app, so crawlers and chat apps (which don't run
// JavaScript) are sent here by the frontend host for public pages: a small HTML page with the real title,
// description, image and structured data, plus the sitemap and robots.txt.
// Only public information is used (no prices: those depend on who is signed in).
const prisma = require("../prisma");
const { appUrl, appName } = require("../config");
const { publicWhere } = require("../services/catalog");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const anon = { user: null }; // what a visitor who isn't signed in may see
const absolute = (u) => (!u ? null : /^https?:\/\//.test(u) ? u : `${appUrl}${u.startsWith("/") ? "" : "/"}${u}`);

const page = ({ title, description, path, image, type = "website", jsonLd, heading, body = "" }) => {
  const url = `${appUrl}${path}`;
  const t = esc(clip(title, 70));
  const d = esc(clip(description, 200));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${t}</title><meta name="description" content="${d}"><link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="${esc(appName)}"><meta property="og:type" content="${type}"><meta property="og:title" content="${t}">
<meta property="og:description" content="${d}"><meta property="og:url" content="${esc(url)}">${image ? `<meta property="og:image" content="${esc(absolute(image))}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}">${image ? `<meta name="twitter:image" content="${esc(absolute(image))}">` : ""}
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
</head><body><h1>${esc(heading || title)}</h1><p>${d}</p>${body}<p><a href="${esc(url)}">${esc(url)}</a></p></body></html>`;
};

const notFound = (res, path) => res.status(404).type("html").send(page({ title: `Not found | ${appName}`, description: "This page isn't available.", path }));
const send = (res, html) => res.set("Cache-Control", "public, max-age=600").type("html").send(html);

const firstImage = async (productId) => (await prisma.product_images.findFirst({ where: { product_id: productId }, orderBy: [{ sort_order: "asc" }, { id: "asc" }], select: { url: true } }))?.url || null;

// GET /api/seo/share/:section/:slug?  (section = products|product|categories|brands|companies|collections)
const share = async (req, res) => {
  const section = req.params.section;
  const slug = String(req.params.slug || "").toLowerCase();
  const path = `/${section}${slug ? `/${slug}` : ""}`;
  if (!slug) {
    const titles = { products: "All products", categories: "Categories", brands: "Brands", companies: "Suppliers", collections: "Collections" };
    return send(res, page({ title: `${titles[section] || appName} | ${appName}`, description: `Browse ${titles[section]?.toLowerCase() || "the marketplace"} from approved wholesale suppliers on ${appName}.`, path }));
  }

  if (section === "products" || section === "product") {
    const p = await prisma.products.findFirst({
      where: { ...publicWhere(anon), ...(/^\d+$/.test(slug) ? { id: BigInt(slug) } : { slug }) },
      select: { id: true, title: true, slug: true, brand: true, sku: true, short_description: true, description: true, url: true, companies: { select: { name: true, slug: true } } },
    });
    if (!p) return notFound(res, path);
    const image = (await firstImage(p.id)) || (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(p.url || "") ? p.url : null);
    const rating = await prisma.reviews.aggregate({ where: { product_id: p.id, status: "published" }, _avg: { rating: true }, _count: true });
    const description = p.short_description || p.description || `${p.title} by ${p.brand}, sold wholesale by ${p.companies?.name}.`;
    return send(res, page({
      title: `${p.title} | ${p.companies?.name || appName}`, description, path: `/product/${p.slug || p.id}`, image, type: "product", heading: p.title,
      body: `<p>Brand: ${esc(p.brand)}${p.sku ? ` · SKU ${esc(p.sku)}` : ""} · Sold by ${esc(p.companies?.name || "")}</p>`,
      jsonLd: {
        "@context": "https://schema.org", "@type": "Product", name: p.title, sku: p.sku || undefined, description: clip(description, 500), image: image ? [absolute(image)] : undefined,
        brand: { "@type": "Brand", name: p.brand }, url: `${appUrl}/product/${p.slug || p.id}`,
        ...(rating._count ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(rating._avg.rating * 10) / 10, reviewCount: rating._count } } : {}),
      },
    }));
  }

  if (section === "categories") {
    const c = await prisma.categories.findFirst({ where: { slug, status: "active" }, select: { name: true, slug: true, description: true, image_url: true } });
    if (!c) return notFound(res, path);
    return send(res, page({ title: `${c.name} wholesale | ${appName}`, description: c.description || `Buy ${c.name} wholesale from approved suppliers on ${appName}.`, path, image: c.image_url }));
  }

  if (section === "brands") {
    const b = await prisma.brands.findFirst({ where: { slug }, select: { name: true, description: true, logo_url: true, website: true } });
    if (!b) return notFound(res, path);
    return send(res, page({
      title: `${b.name} wholesale | ${appName}`, description: b.description || `Buy ${b.name} products wholesale from approved suppliers on ${appName}.`, path, image: b.logo_url,
      jsonLd: { "@context": "https://schema.org", "@type": "Brand", name: b.name, logo: absolute(b.logo_url) || undefined, url: b.website || undefined },
    }));
  }

  if (section === "companies") {
    const parts = String(req.params[0] || "").split("/").filter(Boolean);
    const c = await prisma.companies.findFirst({ where: { slug, status: "active", storefront_published: true }, select: { id: true, name: true, slug: true, tagline: true, description: true, logo_url: true, banner_url: true, city: true, state: true, country: true, website: true } });
    if (!c) return notFound(res, path);
    if (parts[0] === "collections" && parts[1]) {
      const col = await prisma.collections.findFirst({ where: { company_id: c.id, slug: parts[1].toLowerCase(), status: "published", is_enabled: true }, select: { name: true, description: true, cover_image_url: true } });
      if (!col) return notFound(res, `${path}/collections/${parts[1]}`);
      return send(res, page({ title: `${col.name} | ${c.name}`, description: col.description || `${col.name} from ${c.name} on ${appName}.`, path: `${path}/collections/${parts[1]}`, image: col.cover_image_url || c.banner_url }));
    }
    const rating = await prisma.reviews.aggregate({ where: { company_id: c.id, product_id: null, status: "published" }, _avg: { rating: true }, _count: true });
    return send(res, page({
      title: `${c.name}${c.tagline ? ` – ${c.tagline}` : ""} | ${appName}`, description: c.description || c.tagline || `${c.name} is a wholesale supplier on ${appName}.`, path, image: c.banner_url || c.logo_url,
      jsonLd: {
        "@context": "https://schema.org", "@type": "Organization", name: c.name, url: `${appUrl}${path}`, logo: absolute(c.logo_url) || undefined, sameAs: c.website ? [c.website] : undefined,
        address: c.city || c.country ? { "@type": "PostalAddress", addressLocality: c.city || undefined, addressRegion: c.state || undefined, addressCountry: c.country || undefined } : undefined,
        ...(rating._count ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(rating._avg.rating * 10) / 10, reviewCount: rating._count } } : {}),
      },
    }));
  }

  if (section === "collections") {
    const col = await prisma.collections.findFirst({ where: { company_id: null, slug, status: "published", is_enabled: true }, select: { name: true, description: true, cover_image_url: true } });
    if (!col) return notFound(res, path);
    return send(res, page({ title: `${col.name} | ${appName}`, description: col.description || `${col.name} on ${appName}.`, path, image: col.cover_image_url }));
  }
  return notFound(res, path);
};

// GET /api/seo/sitemap.xml
const sitemap = async (req, res) => {
  const [products, categories, brands, companies, collections] = await Promise.all([
    prisma.products.findMany({ where: publicWhere(anon), select: { id: true, slug: true, updated_at: true }, orderBy: { id: "asc" }, take: 45000 }),
    prisma.categories.findMany({ where: { status: "active" }, select: { slug: true } }),
    prisma.brands.findMany({ where: { products: { some: publicWhere(anon) } }, select: { slug: true } }),
    prisma.companies.findMany({ where: { status: "active", storefront_published: true }, select: { slug: true, updated_at: true } }),
    prisma.collections.findMany({ where: { company_id: null, status: "published", is_enabled: true }, select: { slug: true } }),
  ]);
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const urls = [
    ["/", null], ["/products", null], ["/categories", null], ["/brands", null], ["/companies", null], ["/deals", null],
    ...categories.filter((c) => c.slug).map((c) => [`/categories/${c.slug}`, null]),
    ...brands.filter((b) => b.slug).map((b) => [`/brands/${b.slug}`, null]),
    ...companies.filter((c) => c.slug).map((c) => [`/companies/${c.slug}`, day(c.updated_at)]),
    ...collections.map((c) => [`/collections/${c.slug}`, null]),
    ...products.map((p) => [`/product/${p.slug || p.id}`, day(p.updated_at)]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(([u, d]) => `<url><loc>${esc(`${appUrl}${u}`)}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(xml);
};

// GET /api/seo/robots.txt
const robots = (req, res) => {
  res.type("text/plain").set("Cache-Control", "public, max-age=86400").send(
    ["User-agent: *", "Allow: /", "Disallow: /business", "Disallow: /admin", "Disallow: /account", "Disallow: /cart", "Disallow: /checkout", "Disallow: /notifications", "Disallow: /api/", `Sitemap: ${appUrl}/sitemap.xml`, ""].join("\n"),
  );
};

module.exports = { share, sitemap, robots };
