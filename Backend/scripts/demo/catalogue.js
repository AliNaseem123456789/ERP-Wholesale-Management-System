// What the demo marketplace is made of: categories, sellers, their products, buyers and staff.
// Every name here is invented (brands, companies, people, addresses).
//
// Product line: [brand, title, size, units per case, price per case, options?]
//   options: { v: [attributeKey, [values...]] } -> one variant per value
//            { feat: true } featured · { moq: n } minimum order · { mult: n } sold in multiples of n
//            { unit: "box" } selling unit (default "case") · { spec: { key: value } } extra specifications
//            { shelf: months } has lots with expiry dates (food, medicine)

const ATTRIBUTES = [
  { key: "net_contents", name: "Net contents", data_type: "text", is_searchable: true },
  { key: "case_pack", name: "Units per case", data_type: "number", unit: "units", is_filterable: true },
  { key: "country_of_origin", name: "Country of origin", data_type: "text", is_filterable: true },
  { key: "shelf_life_months", name: "Shelf life", data_type: "number", unit: "months" },
  { key: "material", name: "Material", data_type: "text", is_filterable: true },
  { key: "warranty", name: "Warranty", data_type: "text" },
  { key: "scent", name: "Scent", data_type: "select", scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
  { key: "colour", name: "Colour", data_type: "select", scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
  { key: "size", name: "Size", data_type: "select", scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
  { key: "shade", name: "Shade", data_type: "select", scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
  { key: "phone_model", name: "Phone model", data_type: "select", scope: "variant", is_variant_option: true, is_filterable: true, validation: { open: true } },
  { key: "nicotine_strength", name: "Nicotine strength", data_type: "number", unit: "mg", is_filterable: true },
  { key: "puff_count", name: "Puffs", data_type: "number", is_filterable: true },
  { key: "size_ml", name: "Bottle size", data_type: "number", unit: "ml", is_filterable: true },
];

// top-level categories (new) with their sub-categories; colour/icon are used for the generated pictures
const CATEGORIES = [
  { slug: "snacks-beverages", name: "Snacks & Beverages", color: "#f97316", icon: "🥤",
    description: "Chips, candy, drinks, coffee and water for convenience stores, cafés and offices.",
    attrs: ["net_contents", "case_pack", "shelf_life_months", "country_of_origin"],
    children: [
      ["chips-snacks", "Chips & Snacks"], ["candy-chocolate", "Candy & Chocolate"], ["gum-mints", "Gum & Mints"],
      ["energy-drinks", "Energy Drinks"], ["soft-drinks-juice", "Soft Drinks & Juice"], ["coffee-tea", "Coffee & Tea"], ["bottled-water", "Bottled Water"],
    ] },
  { slug: "health-beauty", name: "Health & Beauty", color: "#ec4899", icon: "💄",
    description: "Skin care, hair care, cosmetics and personal care for pharmacies, salons and beauty supply stores.",
    attrs: ["net_contents", "case_pack", "country_of_origin"],
    children: [
      ["skin-care", "Skin Care"], ["hair-care", "Hair Care"], ["cosmetics", "Cosmetics"], ["bath-body-care", "Bath & Body Care"],
      ["oral-care", "Oral Care"], ["shaving", "Shaving & Grooming"],
    ] },
  { slug: "household-cleaning", name: "Household & Cleaning", color: "#0ea5e9", icon: "🧽",
    description: "Cleaning chemicals, paper goods, laundry and trash bags by the case.",
    attrs: ["net_contents", "case_pack", "country_of_origin"],
    children: [
      ["cleaning-supplies", "Cleaning Supplies"], ["paper-goods", "Paper Goods"], ["laundry", "Laundry"],
      ["trash-bags", "Trash Bags"], ["air-fresheners", "Air Fresheners & Candles"],
    ] },
  { slug: "phone-electronics", name: "Phone & Electronics", color: "#6366f1", icon: "🔌",
    description: "Chargers, cables, power banks, audio and phone cases with counter displays.",
    attrs: ["case_pack", "warranty", "country_of_origin"],
    children: [
      ["chargers-cables", "Chargers & Cables"], ["power-banks", "Power Banks"], ["earbuds-headphones", "Earbuds & Headphones"],
      ["phone-cases", "Phone Cases & Protection"], ["speakers-gadgets", "Speakers & Gadgets"],
    ] },
  { slug: "health-wellness", name: "Health & Wellness", color: "#10b981", icon: "💊",
    description: "Over-the-counter medicine, vitamins and first aid in retail-ready packs.",
    attrs: ["net_contents", "case_pack", "shelf_life_months"],
    children: [
      ["pain-relief", "Pain Relief"], ["vitamins-supplements", "Vitamins & Supplements"], ["first-aid", "First Aid & PPE"], ["cold-allergy", "Cold, Flu & Allergy"],
    ] },
  { slug: "automotive", name: "Automotive", color: "#64748b", icon: "🚗",
    description: "Air fresheners, car care, oils and fluids, and accessories for gas stations and auto shops.",
    attrs: ["net_contents", "case_pack"],
    children: [
      ["car-air-fresheners", "Car Air Fresheners"], ["car-care", "Car Care"], ["motor-oil-fluids", "Motor Oil & Fluids"], ["car-accessories", "Car Accessories"],
    ] },
  { slug: "apparel-accessories", name: "Apparel & Accessories", color: "#a855f7", icon: "🧢",
    description: "Caps, sunglasses, socks, bags and basics, packed by size run.",
    attrs: ["material", "case_pack", "country_of_origin"],
    children: [
      ["hats-caps", "Hats & Caps"], ["sunglasses", "Sunglasses"], ["socks", "Socks"], ["bags-wallets", "Bags & Wallets"], ["t-shirts-basics", "T-Shirts & Basics"],
    ] },
  { slug: "office-school", name: "Office & School", color: "#eab308", icon: "✏️",
    description: "Pens, paper, notebooks and desk supplies for offices, schools and resellers.",
    attrs: ["case_pack", "country_of_origin"],
    children: [["writing-supplies", "Writing Supplies"], ["paper-notebooks", "Paper & Notebooks"], ["tape-desk", "Tape, Glue & Desk"]] },
  { slug: "pet-supplies", name: "Pet Supplies", color: "#d97706", icon: "🐾",
    description: "Food, treats, litter and accessories for pet stores and groceries.",
    attrs: ["net_contents", "case_pack", "shelf_life_months"],
    children: [["dog-food-treats", "Dog Food & Treats"], ["cat-supplies", "Cat Supplies"], ["pet-accessories", "Pet Accessories"]] },
  { slug: "toys-party", name: "Toys & Party", color: "#ef4444", icon: "🎈",
    description: "Toys, party supplies and seasonal goods for dollar stores and gift shops.",
    attrs: ["case_pack", "material"],
    children: [["toys-games", "Toys & Games"], ["party-supplies", "Party Supplies"], ["seasonal", "Seasonal"]] },
];

// Sellers. "meridian" is the showcase account; every other one is a smaller, specialised seller.
const COMPANIES = {
  meridian: {
    name: "Meridian Trade Co.", legal_name: "Meridian Trade Company LLC", tagline: "Everything your store sells, on one truck.",
    city: "Newark", state: "NJ", postal_code: "07114", address_line1: "1200 Port Logistics Blvd", phone: "(973) 555-0142",
    website: "https://meridian-trade.example.com", color: "#0f766e", commission: 4, lead: 2, min_order: 150, featured: true,
    description: "Meridian is a general-line wholesale distributor serving 1,200+ convenience stores, pharmacies and independent grocers across the East Coast. We stock 170+ fast-moving lines in snacks, drinks, household, health and phone accessories, ship next business day from three warehouses and offer net-30 terms to approved accounts.",
    delivery_info: "Next-business-day delivery in NJ, NY, PA and CT on orders placed by 3 pm. Free delivery over $500; $25 otherwise. Pallet orders ship LTL nationwide.",
    payment_info: "Cash on delivery, or net 15 / net 30 terms for approved accounts. ACH and check accepted.",
  },
  harbor: { name: "Harbor Beauty Supply", tagline: "Salon and beauty essentials, wholesale.", city: "Miami", state: "FL", postal_code: "33127", address_line1: "455 NW 29th St", phone: "(305) 555-0187", color: "#db2777", commission: 5, lead: 3, min_order: 100, featured: true,
    description: "Skin care, hair care and cosmetics for beauty supply stores, salons and pharmacies. Display-ready packs and shade assortments." },
  voltedge: { name: "VoltEdge Electronics", tagline: "Phone accessories that sell themselves.", city: "Dallas", state: "TX", postal_code: "75247", address_line1: "8800 Ambassador Row", phone: "(214) 555-0119", color: "#4f46e5", commission: 6, lead: 2, min_order: 200, featured: true,
    description: "Earbuds, cases, cables and gadgets with counter displays and 12-month warranty. Serving cell phone shops, gas stations and electronics retailers." },
  roadready: { name: "RoadReady Auto Supply", tagline: "Keep every car on the road.", city: "Columbus", state: "OH", postal_code: "43228", address_line1: "3100 Westbelt Dr", phone: "(614) 555-0133", color: "#475569", commission: 4, lead: 3, min_order: 150,
    description: "Car care, oils, fluids and accessories for gas stations, auto shops and convenience stores." },
  urbanthread: { name: "Urban Thread Wholesale", tagline: "Apparel basics by the dozen.", city: "Los Angeles", state: "CA", postal_code: "90021", address_line1: "1601 S Santa Fe Ave", phone: "(213) 555-0164", color: "#7c3aed", commission: 6, lead: 4, min_order: 250,
    description: "Caps, sunglasses, socks, bags and tees sold in prepacked size runs. Serving boutiques, souvenir shops and convenience stores." },
  paperline: { name: "Paperline Office Supply", tagline: "Office and school supplies, stocked deep.", city: "Chicago", state: "IL", postal_code: "60632", address_line1: "4700 S Kildare Ave", phone: "(312) 555-0150", color: "#ca8a04", commission: 3, lead: 3, min_order: 100,
    description: "Writing supplies, paper and desk essentials for offices, schools and resellers. Back-to-school programmes every July." },
  pawpantry: { name: "PawPantry Pet Wholesale", tagline: "Happy pets, happy customers.", city: "Denver", state: "CO", postal_code: "80216", address_line1: "5200 Brighton Blvd", phone: "(720) 555-0171", color: "#b45309", commission: 5, lead: 3, min_order: 150,
    description: "Dog and cat food, treats, litter and accessories for independent pet stores and groceries." },
  funfactory: { name: "FunFactory Toys & Party", tagline: "Toys, party and seasonal for every aisle.", city: "Atlanta", state: "GA", postal_code: "30336", address_line1: "6000 Fulton Industrial Blvd", phone: "(404) 555-0126", color: "#dc2626", commission: 6, lead: 4, min_order: 150,
    description: "Toys, party supplies and seasonal goods for dollar stores, gift shops and grocery aisles." },
  summit: { name: "Summit Candy & Snack", tagline: "Sweet deals for every checkout lane.", city: "Pittsburgh", state: "PA", postal_code: "15201", address_line1: "3400 Smallman St", phone: "(412) 555-0177", color: "#ea580c", commission: 4, lead: 2, min_order: 100,
    description: "Candy, chocolate, gum and mints for checkout lanes, vending and concessions." },
  cloudnine: { name: "Cloud Nine Distribution", tagline: "Vape and smoke shop supply.", city: "Houston", state: "TX", postal_code: "77036", address_line1: "9800 Harwin Dr", phone: "(713) 555-0198", color: "#0891b2", commission: 5, lead: 2, min_order: 300, compliance: true,
    description: "Disposables, e-liquids, coils, papers and lighters for licensed smoke and vape shops. Age-restricted: tobacco licence required." },
  maisonlumen: { name: "Maison Lumen Fragrances", tagline: "Designer-inspired fragrances, wholesale.", city: "Edison", state: "NJ", postal_code: "08837", address_line1: "250 Raritan Center Pkwy", phone: "(732) 555-0145", color: "#9d174d", commission: 5, lead: 3, min_order: 200,
    description: "Eau de parfum and body mists for perfume shops, boutiques and gift stores." },
};

const P = (spec) => spec; // readability

// sub-category slug -> { company, items }
const PRODUCTS = {
  // ---------------- Snacks & Beverages (Meridian + Summit) ----------------
  "chips-snacks": { company: "meridian", items: [
    ["Crunch Valley", "Kettle Cooked Potato Chips", "2 oz", 24, 21.6, { v: ["flavour", ["Sea Salt", "Barbecue", "Salt & Vinegar", "Jalapeño"]], feat: true, shelf: 9 }],
    ["Crunch Valley", "Classic Potato Chips", "1 oz", 64, 28.8, { shelf: 9 }],
    ["Golden Harvest", "Tortilla Chips Nacho Cheese", "3 oz", 28, 30.8, { shelf: 9 }],
    ["Golden Harvest", "Cheddar Cheese Puffs", "1.5 oz", 48, 26.4, { shelf: 9 }],
    ["Golden Harvest", "Butter Microwave Popcorn", "3 oz", 36, 24.5, { shelf: 12 }],
    ["Salty Pete's", "Pretzel Twists", "2 oz", 36, 19.8, { shelf: 12 }],
    ["Salty Pete's", "Hot & Spicy Pork Rinds", "1 oz", 24, 18.0, { shelf: 9 }],
    ["Salty Pete's", "Sweet & Salty Trail Mix", "3 oz", 24, 33.6, { shelf: 9 }],
    ["Crunch Valley", "Rippled Chips Variety Pack", "1 oz", 50, 32.5, { shelf: 9 }],
    ["Golden Harvest", "Sunflower Seeds Ranch", "5.25 oz", 12, 15.6, { shelf: 12 }],
  ] },
  "candy-chocolate": { company: "summit", items: [
    ["Cocoa Lane", "Milk Chocolate Bar", "1.55 oz", 36, 34.2, { feat: true, shelf: 12 }],
    ["Cocoa Lane", "Peanut Butter Cups", "1.5 oz", 36, 36.0, { shelf: 12 }],
    ["Cocoa Lane", "Dark Chocolate Sea Salt Bar", "3 oz", 12, 21.0, { shelf: 12 }],
    ["Fizzy Bear", "Gummy Bears Peg Bag", "5 oz", 12, 14.4, { shelf: 12 }],
    ["Fizzy Bear", "Sour Gummy Worms", "5 oz", 12, 14.4, { shelf: 12 }],
    ["Sweet Ridge", "Caramel Chews", "4.5 oz", 12, 13.2, { shelf: 12 }],
    ["Sweet Ridge", "Assorted Fruit Lollipops Tub", "100 ct", 6, 39.0, { unit: "tub case", shelf: 18 }],
    ["Cocoa Lane", "Chocolate Covered Almonds", "6 oz", 12, 38.4, { shelf: 12 }],
    ["Fizzy Bear", "Sour Belts Rainbow", "2 oz", 24, 21.6, { shelf: 12 }],
    ["Sweet Ridge", "Peppermint Patties", "1.5 oz", 24, 22.8, { shelf: 12 }],
  ] },
  "gum-mints": { company: "summit", items: [
    ["Arctic Fresh", "Sugar-Free Gum", "15 pc", 12, 13.8, { v: ["flavour", ["Spearmint", "Peppermint", "Watermelon", "Bubblemint"]], feat: true }],
    ["Arctic Fresh", "Intense Mints Tin", "1.2 oz", 12, 16.8, { v: ["flavour", ["Peppermint", "Wintergreen", "Cinnamon"]] }],
    ["Zing", "Bubble Gum Chunks Tub", "180 ct", 4, 34.0, { unit: "tub case" }],
    ["Zing", "Xylitol Gum Bottle", "50 pc", 6, 27.0 ],
  ] },
  "energy-drinks": { company: "meridian", items: [
    ["Voltage", "Energy Drink", "16 fl oz can", 24, 34.8, { v: ["flavour", ["Original", "Sugar Free", "Tropical Punch", "Wild Berry"]], feat: true, shelf: 18 }],
    ["Voltage", "Zero Sugar Energy Drink", "12 fl oz can", 24, 28.8, { shelf: 18 }],
    ["Rush Hour", "Energy Shot", "2 fl oz", 12, 21.0, { v: ["flavour", ["Berry", "Grape", "Lemon-Lime"]], shelf: 24 }],
    ["Rush Hour", "Sparkling Energy Water", "12 fl oz can", 12, 15.6, { shelf: 18 }],
    ["Apex Energy", "Performance Energy Drink", "16 fl oz can", 12, 19.2, { v: ["flavour", ["Citrus", "Mango", "Blue Razz"]], shelf: 18 }],
    ["Apex Energy", "Hydration Sports Drink", "20 fl oz", 24, 22.8, { shelf: 12 }],
  ] },
  "soft-drinks-juice": { company: "meridian", items: [
    ["Fizz Co.", "Classic Cola", "12 fl oz can", 24, 13.2, { shelf: 9 }],
    ["Fizz Co.", "Lemon-Lime Soda", "12 fl oz can", 24, 13.2, { shelf: 9 }],
    ["Fizz Co.", "Orange Soda", "20 fl oz bottle", 24, 26.4, { shelf: 9 }],
    ["Sunny Grove", "100% Apple Juice", "10 fl oz", 24, 19.2, { shelf: 12 }],
    ["Sunny Grove", "Old-Fashioned Lemonade", "20 fl oz", 12, 15.6, { shelf: 9 }],
    ["Brookside", "Sweet Iced Tea", "18.5 fl oz", 12, 13.2, { shelf: 9 }],
    ["Brookside", "Peach Iced Tea", "18.5 fl oz", 12, 13.2, { shelf: 9 }],
    ["Sunny Grove", "Orange Juice Single Serve", "12 fl oz", 24, 26.4, { shelf: 6 }],
    ["Fizz Co.", "Ginger Ale", "12 fl oz can", 24, 13.2, { shelf: 9 }],
  ] },
  "coffee-tea": { company: "meridian", items: [
    ["Morning Peak", "Medium Roast Ground Coffee", "12 oz", 6, 36.0, { shelf: 12 }],
    ["Morning Peak", "Dark Roast Coffee Pods", "80 ct", 1, 31.2, { unit: "box", shelf: 12 }],
    ["Morning Peak", "Colombian Whole Bean Coffee", "2 lb", 4, 52.0, { shelf: 12 }],
    ["Leaf & Kettle", "Green Tea Bags", "100 ct", 6, 21.0, { shelf: 24 }],
    ["Leaf & Kettle", "Chai Spice Tea Bags", "40 ct", 6, 18.0, { shelf: 24 }],
    ["Morning Peak", "French Vanilla Creamer Singles", "360 ct", 1, 22.5, { unit: "box", shelf: 9 }],
    ["Morning Peak", "Cold Brew Coffee Bottle", "11 fl oz", 12, 26.4, { shelf: 6 }],
    ["Leaf & Kettle", "Hot Cocoa Mix Packets", "50 ct", 1, 14.5, { unit: "box", shelf: 18 }],
  ] },
  "bottled-water": { company: "meridian", items: [
    ["Clear Spring", "Natural Spring Water", "16.9 fl oz", 24, 6.0, { feat: true, shelf: 24, mult: 1 }],
    ["Clear Spring", "Spring Water Gallon", "1 gal", 6, 8.4, { shelf: 24 }],
    ["Alpine Crest", "Alkaline Water pH 9.5", "1 L", 12, 15.6, { shelf: 24 }],
    ["Alpine Crest", "Sparkling Mineral Water", "500 ml", 24, 21.6, { v: ["flavour", ["Unflavored", "Lime", "Grapefruit"]], shelf: 18 }],
    ["Clear Spring", "Kids Water Bottles", "8 fl oz", 24, 7.2, { shelf: 24 }],
  ] },
  // ---------------- Health & Beauty ----------------
  "skin-care": { company: "harbor", items: [
    ["Lumière Skin", "Daily Moisturizing Lotion", "16 fl oz", 12, 42.0, { feat: true }],
    ["Lumière Skin", "Vitamin C Brightening Serum", "1 fl oz", 6, 45.0 ],
    ["Pure Botanica", "Gentle Foaming Facial Cleanser", "6.8 fl oz", 12, 38.4 ],
    ["Pure Botanica", "Aloe Vera Soothing Gel", "8 fl oz", 12, 27.0 ],
    ["DermaCalm", "Mineral Sunscreen SPF 50", "3 fl oz", 12, 54.0 ],
    ["DermaCalm", "Intensive Hand Cream", "3.4 oz", 12, 30.0 ],
    ["Pure Botanica", "Sheet Face Masks Assorted", "10 pk", 12, 48.0 ],
    ["Lumière Skin", "Lip Balm Counter Display", "24 ct", 1, 21.6, { unit: "display", v: ["flavour", ["Vanilla", "Cherry", "Mint", "Unflavored"]] }],
  ] },
  "hair-care": { company: "harbor", items: [
    ["Silk Strand", "Argan Oil Shampoo", "33.8 fl oz", 6, 39.0, { feat: true }],
    ["Silk Strand", "Argan Oil Conditioner", "33.8 fl oz", 6, 39.0 ],
    ["Mane Theory", "Extra Hold Styling Gel", "16 oz", 12, 30.0 ],
    ["Mane Theory", "Edge Control Pomade", "2.5 oz", 12, 27.6 ],
    ["Silk Strand", "Dry Shampoo Spray", "5 oz", 12, 42.0 ],
    ["Mane Theory", "No-Damage Hair Ties", "100 pk", 12, 24.0 ],
    ["Silk Strand", "Leave-In Coconut Cream", "12 oz", 6, 28.5 ],
  ] },
  "cosmetics": { company: "harbor", items: [
    ["Velvet Hue", "Matte Liquid Lipstick", "0.17 fl oz", 12, 30.0, { v: ["shade", ["Rosewood", "Classic Red", "Nude Beige", "Berry", "Coral"]], feat: true }],
    ["Velvet Hue", "Waterproof Liquid Eyeliner", "0.1 fl oz", 12, 24.0 ],
    ["Glow Lab", "Volumizing Mascara", "0.3 fl oz", 12, 33.0 ],
    ["Velvet Hue", "Gel-Finish Nail Polish", "0.5 fl oz", 12, 18.0, { v: ["shade", ["Ballet Pink", "Cherry", "Midnight", "Lilac", "Clear Top Coat"]] }],
    ["Glow Lab", "Satin Foundation", "1 fl oz", 6, 36.0, { v: ["shade", ["Ivory", "Sand", "Honey", "Caramel", "Espresso"]] }],
    ["Glow Lab", "Blending Sponges", "4 pk", 12, 21.0 ],
    ["Glow Lab", "Makeup Brush Set", "10 pc", 6, 42.0 ],
  ] },
  "bath-body-care": { company: "meridian", items: [
    ["Cedar & Sage", "Moisturizing Body Wash", "18 fl oz", 6, 21.0, { v: ["scent", ["Cedar & Sage", "Ocean Breeze", "Lavender", "Coconut"]] }],
    ["Cedar & Sage", "Deodorant Bar Soap", "12 pk", 4, 26.0 ],
    ["Ocean Mist", "Antiperspirant Stick", "2.6 oz", 12, 30.0, { v: ["scent", ["Fresh", "Powder", "Unscented"]] }],
    ["Ocean Mist", "Body Spray", "4 oz", 12, 33.0 ],
    ["Cedar & Sage", "Fizzing Bath Bombs", "6 pk", 6, 30.0 ],
  ] },
  "oral-care": { company: "meridian", items: [
    ["BrightSmile", "Cavity Protection Toothpaste", "4 oz", 24, 33.6, { feat: true }],
    ["BrightSmile", "Soft Toothbrush", "12 ct", 6, 21.0 ],
    ["DentaPro", "Antiseptic Mouthwash", "1 L", 6, 27.0 ],
    ["DentaPro", "Floss Picks", "90 ct", 12, 24.0 ],
    ["BrightSmile", "Travel Dental Kit", "1 kit", 24, 26.4 ],
  ] },
  "shaving": { company: "meridian", items: [
    ["Edge Men", "Twin-Blade Disposable Razors", "10 pk", 12, 30.0 ],
    ["Edge Men", "Sensitive Shave Gel", "7 oz", 12, 27.0 ],
    ["Smooth Co.", "Aftershave Balm", "3.4 fl oz", 6, 24.0 ],
    ["Smooth Co.", "5-Blade Razor Cartridges", "8 ct", 6, 51.0 ],
  ] },
  // ---------------- Household & Cleaning (Meridian) ----------------
  "cleaning-supplies": { company: "meridian", items: [
    ["SparkPro", "All-Purpose Cleaner Spray", "32 fl oz", 12, 27.0, { feat: true }],
    ["SparkPro", "Streak-Free Glass Cleaner", "32 fl oz", 12, 24.0 ],
    ["SparkPro", "Disinfecting Wipes", "75 ct", 6, 30.0, { v: ["scent", ["Lemon", "Fresh Scent"]] }],
    ["EcoShine", "Concentrated Bleach", "1 gal", 6, 21.0 ],
    ["EcoShine", "Citrus Degreaser", "32 fl oz", 12, 33.0 ],
    ["EcoShine", "Floor Cleaner Concentrate", "1 gal", 4, 28.0 ],
    ["SparkPro", "Scrub Sponges", "6 pk", 12, 25.2 ],
    ["EcoShine", "Microfiber Cleaning Cloths", "24 pk", 4, 30.0 ],
  ] },
  "paper-goods": { company: "meridian", items: [
    ["SoftLeaf", "Paper Towels Mega Roll", "12 rolls", 1, 24.0, { unit: "case", feat: true }],
    ["SoftLeaf", "2-Ply Bath Tissue", "48 rolls", 1, 31.0 ],
    ["NorthPine", "Dinner Napkins", "500 ct", 2, 16.0 ],
    ["NorthPine", "Facial Tissue Cube", "70 ct", 18, 25.2 ],
    ["NorthPine", "Heavy-Duty Paper Plates 9in", "100 ct", 6, 27.0 ],
    ["SoftLeaf", "Foam Cups 16 oz", "500 ct", 1, 22.0 ],
  ] },
  "laundry": { company: "meridian", items: [
    ["FreshFold", "Liquid Laundry Detergent", "100 fl oz", 4, 36.0, { v: ["scent", ["Original", "Free & Clear", "Spring Meadow"]] }],
    ["FreshFold", "Laundry Detergent Pods", "72 ct", 4, 48.0 ],
    ["Brightline", "Fabric Softener", "64 fl oz", 6, 27.0 ],
    ["Brightline", "Dryer Sheets", "120 ct", 6, 24.0 ],
    ["Brightline", "Oxi Stain Remover Spray", "22 fl oz", 12, 36.0 ],
  ] },
  "trash-bags": { company: "meridian", items: [
    ["ToughStack", "Tall Kitchen Bags 13 gal", "90 ct", 4, 34.0, { feat: true }],
    ["ToughStack", "Large Trash Bags 33 gal", "40 ct", 6, 33.0 ],
    ["ToughStack", "Contractor Bags 55 gal", "32 ct", 4, 44.0 ],
    ["ToughStack", "Can Liners 45 gal", "250 ct", 1, 39.0 ],
  ] },
  "air-fresheners": { company: "meridian", items: [
    ["AuraHome", "Room Spray", "8.8 oz", 12, 24.0, { v: ["scent", ["Linen", "Vanilla", "Lavender", "Citrus"]] }],
    ["AuraHome", "Plug-In Oil Refills", "2 ct", 12, 36.0 ],
    ["Breeze", "Reed Diffuser", "3.4 fl oz", 6, 27.0 ],
    ["Breeze", "3-Wick Scented Candle", "14 oz", 6, 45.0 ],
  ] },
  // ---------------- Phone & Electronics (VoltEdge + Meridian) ----------------
  "chargers-cables": { company: "meridian", items: [
    ["Charge+", "USB-C to USB-C Cable 6 ft", "1 ct", 24, 57.6, { v: ["colour", ["Black", "White"]], feat: true }],
    ["Charge+", "USB-C to Lightning Cable 3 ft", "1 ct", 24, 52.8 ],
    ["Charge+", "20W USB-C Wall Charger", "1 ct", 12, 54.0 ],
    ["Charge+", "Dual-Port Car Charger", "1 ct", 12, 42.0 ],
    ["Charge+", "3-in-1 Charging Cable", "1 ct", 24, 48.0 ],
    ["Charge+", "15W Wireless Charging Pad", "1 ct", 6, 51.0 ],
  ] },
  "power-banks": { company: "meridian", items: [
    ["PowerPod", "10,000 mAh Slim Power Bank", "1 ct", 6, 63.0, { v: ["colour", ["Black", "White", "Blue"]] }],
    ["PowerPod", "20,000 mAh PD Power Bank", "1 ct", 4, 72.0 ],
    ["PowerPod", "Magnetic Wireless Power Bank", "1 ct", 4, 68.0 ],
  ] },
  "earbuds-headphones": { company: "voltedge", items: [
    ["SoundWave", "True Wireless Earbuds", "1 ct", 6, 90.0, { v: ["colour", ["Black", "White"]], feat: true, spec: { warranty: "12 months" } }],
    ["SoundWave", "Wired Earphones with Mic", "1 ct", 24, 48.0 ],
    ["Bassline", "Over-Ear Bluetooth Headphones", "1 ct", 4, 96.0, { spec: { warranty: "12 months" } }],
    ["Bassline", "Kids Volume-Limited Headphones", "1 ct", 6, 54.0, { v: ["colour", ["Blue", "Pink", "Green"]] }],
    ["SoundWave", "Sport Neckband Earbuds", "1 ct", 6, 60.0 ],
  ] },
  "phone-cases": { company: "voltedge", items: [
    ["ArmorShell", "Clear Shockproof Case", "1 ct", 10, 40.0, { v: ["phone_model", ["iPhone 16", "iPhone 16 Pro", "iPhone 15", "Galaxy S25", "Galaxy A16"]], feat: true }],
    ["ClearGuard", "Tempered Glass Screen Protector", "3 pk", 10, 35.0, { v: ["phone_model", ["iPhone 16", "iPhone 16 Pro", "iPhone 15", "Galaxy S25"]] }],
    ["ArmorShell", "Rugged Belt-Clip Case", "1 ct", 6, 42.0 ],
    ["ArmorShell", "Leather Wallet Case", "1 ct", 6, 39.0 ],
    ["ClearGuard", "Phone Grip & Stand", "1 ct", 24, 36.0 ],
  ] },
  "speakers-gadgets": { company: "voltedge", items: [
    ["SoundWave", "Mini Bluetooth Speaker", "1 ct", 6, 72.0, { v: ["colour", ["Black", "Red", "Teal"]] }],
    ["Lumiflex", "RGB LED Strip Lights 16 ft", "1 ct", 6, 54.0 ],
    ["Lumiflex", "Wi-Fi Smart Plug", "2 pk", 6, 48.0 ],
    ["ClearGuard", "Selfie Stick Tripod", "1 ct", 6, 45.0 ],
    ["Charge+", "Car Vent Phone Mount", "1 ct", 12, 42.0 ],
  ] },
  // ---------------- Health & Wellness (Meridian) ----------------
  "pain-relief": { company: "meridian", items: [
    ["CareMax", "Ibuprofen 200 mg Tablets", "2-ct pouch", 50, 15.0, { unit: "dispenser box", shelf: 24, feat: true }],
    ["CareMax", "Acetaminophen 500 mg Caplets", "100 ct", 12, 42.0, { shelf: 24 }],
    ["CareMax", "Low-Dose Aspirin 81 mg", "120 ct", 12, 36.0, { shelf: 24 }],
    ["ReliefRx", "Cooling Muscle Rub", "3 oz", 12, 39.0, { shelf: 24 }],
    ["ReliefRx", "Back Heat Wraps", "2 ct", 12, 45.0, { shelf: 36 }],
  ] },
  "vitamins-supplements": { company: "meridian", items: [
    ["VitaCore", "Adult Multivitamin Gummies", "90 ct", 6, 39.0, { shelf: 18 }],
    ["VitaCore", "Vitamin D3 2000 IU", "120 softgels", 6, 30.0, { shelf: 24 }],
    ["VitaCore", "Vitamin C 1000 mg", "100 tablets", 6, 27.0, { shelf: 24 }],
    ["Nature's Path", "Omega-3 Fish Oil", "120 softgels", 6, 42.0, { shelf: 18 }],
    ["Nature's Path", "Melatonin 5 mg", "60 gummies", 6, 24.0, { shelf: 18 }],
    ["Nature's Path", "Electrolyte Drink Mix", "20 sticks", 6, 33.0, { v: ["flavour", ["Lemon-Lime", "Fruit Punch", "Orange"]], shelf: 18 }],
    ["VitaCore", "Protein Bar Chocolate Chip", "12 bars", 6, 54.0, { shelf: 9 }],
  ] },
  "first-aid": { company: "meridian", items: [
    ["SafeHands", "Flexible Fabric Bandages", "100 ct", 12, 36.0, { shelf: 36 }],
    ["SafeHands", "Workplace First Aid Kit", "150 pc", 4, 60.0 ],
    ["SafeHands", "Nitrile Exam Gloves", "100 ct", 10, 65.0, { v: ["size", ["S", "M", "L", "XL"]] }],
    ["SafeHands", "Antiseptic Wipes", "100 ct", 12, 30.0, { shelf: 36 }],
    ["SafeHands", "3-Ply Face Masks", "50 ct", 20, 50.0 ],
  ] },
  "cold-allergy": { company: "meridian", items: [
    ["ReliefRx", "Honey Lemon Cough Drops", "30 ct", 12, 21.6, { shelf: 24 }],
    ["ReliefRx", "24-Hour Allergy Relief", "30 tablets", 12, 54.0, { shelf: 24 }],
    ["ReliefRx", "Saline Nasal Spray", "1.5 fl oz", 12, 30.0, { shelf: 24 }],
    ["CareMax", "Day & Night Cold & Flu", "24 caplets", 12, 51.0, { shelf: 24 }],
    ["SafeHands", "Hand Sanitizer Gel 70%", "8 fl oz", 24, 36.0, { shelf: 24 }],
  ] },
  // ---------------- Automotive (Meridian + RoadReady) ----------------
  "car-air-fresheners": { company: "meridian", items: [
    ["DriveFresh", "Hanging Air Freshener", "24 ct display", 1, 18.0, { unit: "display", v: ["scent", ["New Car", "Black Ice", "Vanilla", "Pine", "Strawberry"]], feat: true }],
    ["DriveFresh", "Vent Clip Freshener", "4 pk", 12, 36.0 ],
    ["DriveFresh", "Gel Can Air Freshener", "2.5 oz", 12, 24.0 ],
  ] },
  "car-care": { company: "roadready", items: [
    ["GlossMax", "Wash & Wax Car Soap", "64 fl oz", 6, 33.0 ],
    ["GlossMax", "Tire Shine Spray", "24 fl oz", 6, 30.0 ],
    ["GlossMax", "Interior Detailing Wipes", "30 ct", 12, 36.0 ],
    ["GlossMax", "Carnauba Paste Wax", "11 oz", 6, 42.0 ],
    ["RoadReady", "Microfiber Detailing Towels", "12 pk", 4, 32.0 ],
  ] },
  "motor-oil-fluids": { company: "roadready", items: [
    ["Torque", "Full Synthetic Motor Oil 5W-30", "1 qt", 12, 66.0, { feat: true }],
    ["Torque", "High Mileage Motor Oil 10W-30", "5 qt", 3, 63.0 ],
    ["RoadReady", "All-Season Windshield Washer Fluid", "1 gal", 6, 15.0 ],
    ["RoadReady", "50/50 Antifreeze Coolant", "1 gal", 6, 51.0 ],
    ["Torque", "Fuel Injector Cleaner", "12 fl oz", 12, 54.0 ],
    ["Torque", "DOT 3 Brake Fluid", "12 fl oz", 12, 42.0 ],
  ] },
  "car-accessories": { company: "roadready", items: [
    ["DriveTech", "1080p Dash Cam", "1 ct", 4, 96.0, { spec: { warranty: "12 months" } }],
    ["DriveTech", "Heavy-Duty Jumper Cables 16 ft", "1 ct", 4, 64.0 ],
    ["DriveTech", "Digital Tire Pressure Gauge", "1 ct", 12, 54.0 ],
    ["DriveTech", "Universal Steering Wheel Cover", "1 ct", 6, 42.0, { v: ["colour", ["Black", "Grey", "Red"]] }],
    ["DriveTech", "Magnetic Dash Phone Mount", "1 ct", 12, 48.0 ],
  ] },
  // ---------------- Apparel (Urban Thread) ----------------
  "hats-caps": { company: "urbanthread", items: [
    ["Northbound", "Mesh Trucker Cap", "1 dozen", 1, 54.0, { unit: "dozen", v: ["colour", ["Black", "Navy", "Khaki", "Camo"]], feat: true }],
    ["Northbound", "Cuffed Knit Beanie", "1 dozen", 1, 42.0, { unit: "dozen", v: ["colour", ["Black", "Grey", "Burgundy", "Olive"]] }],
    ["Urban Thread", "Cotton Bucket Hat", "1 dozen", 1, 60.0, { unit: "dozen" }],
    ["Urban Thread", "Flat-Brim Snapback", "1 dozen", 1, 66.0, { unit: "dozen" }],
  ] },
  "sunglasses": { company: "urbanthread", items: [
    ["ShadeLine", "Classic Aviator Sunglasses", "12 pc", 1, 48.0, { unit: "dozen", feat: true }],
    ["ShadeLine", "Polarized Sport Sunglasses", "12 pc", 1, 72.0, { unit: "dozen" }],
    ["ShadeLine", "Kids Sunglasses Assorted", "12 pc", 1, 36.0, { unit: "dozen" }],
    ["ShadeLine", "Spinner Display with 36 Sunglasses", "36 pc", 1, 135.0, { unit: "display" }],
  ] },
  "socks": { company: "urbanthread", items: [
    ["StepWell", "Cotton Crew Socks", "6 pairs", 12, 72.0, { v: ["size", ["S", "M", "L", "XL"]] }],
    ["StepWell", "No-Show Ankle Socks", "6 pairs", 12, 60.0, { v: ["size", ["S", "M", "L"]] }],
    ["StepWell", "Compression Socks", "1 pair", 12, 54.0 ],
    ["StepWell", "Thermal Boot Socks", "2 pairs", 12, 66.0 ],
  ] },
  "bags-wallets": { company: "urbanthread", items: [
    ["CarryOn", "Everyday Laptop Backpack", "1 ct", 6, 90.0, { v: ["colour", ["Black", "Navy", "Grey"]] }],
    ["CarryOn", "Drawstring Gym Bag", "12 ct", 1, 36.0, { unit: "dozen" }],
    ["Northbound", "Crossbody Belt Bag", "1 ct", 12, 84.0 ],
    ["CarryOn", "RFID Bifold Wallet", "1 ct", 12, 72.0 ],
    ["CarryOn", "Canvas Tote Bag", "12 ct", 1, 42.0, { unit: "dozen" }],
  ] },
  "t-shirts-basics": { company: "urbanthread", items: [
    ["Urban Thread Basics", "Heavyweight Cotton Tee", "1 dozen", 1, 66.0, { unit: "dozen", v: ["size", ["S", "M", "L", "XL", "2XL"]], feat: true }],
    ["Urban Thread Basics", "Pullover Fleece Hoodie", "6 pc", 1, 87.0, { unit: "half dozen", v: ["size", ["M", "L", "XL"]] }],
    ["Urban Thread Basics", "Ribbed Tank Top", "1 dozen", 1, 42.0, { unit: "dozen" }],
  ] },
  // ---------------- Office & School (Paperline) ----------------
  "writing-supplies": { company: "paperline", items: [
    ["Inkwell", "Ballpoint Pens Medium Blue", "12 pk", 12, 30.0, { feat: true }],
    ["Inkwell", "Retractable Gel Pens Assorted", "8 pk", 12, 48.0 ],
    ["ScribePro", "Chisel-Tip Highlighters", "5 pk", 12, 36.0 ],
    ["ScribePro", "#2 Pre-Sharpened Pencils", "24 pk", 12, 33.0 ],
    ["ScribePro", "Permanent Markers Fine", "12 pk", 6, 39.0 ],
    ["Inkwell", "Dry Erase Markers", "8 pk", 6, 42.0 ],
  ] },
  "paper-notebooks": { company: "paperline", items: [
    ["Paperline", "Multipurpose Copy Paper 8.5x11", "10 reams", 1, 44.0, { feat: true }],
    ["Paperline", "1-Subject Spiral Notebook", "70 sheets", 24, 26.4 ],
    ["Paperline", "Composition Book Wide Ruled", "100 sheets", 24, 31.2 ],
    ["Paperline", "Sticky Notes 3x3", "12 pads", 12, 54.0 ],
    ["Paperline", "Legal Pads Yellow", "12 pk", 4, 40.0 ],
    ["Paperline", "Ruled Index Cards", "100 ct", 24, 21.6 ],
  ] },
  "tape-desk": { company: "paperline", items: [
    ["Paperline", "Heavy-Duty Packing Tape", "6 rolls", 6, 45.0 ],
    ["Paperline", "Clear Office Tape with Dispenser", "6 pk", 6, 33.0 ],
    ["ScribePro", "Washable Glue Sticks", "12 pk", 12, 36.0 ],
    ["ScribePro", "Full-Strip Desk Stapler", "1 ct", 12, 54.0 ],
    ["ScribePro", "8-inch Office Scissors", "3 pk", 12, 45.0 ],
    ["Paperline", "Shipping Labels 4x6", "500 ct", 4, 48.0 ],
  ] },
  // ---------------- Pet Supplies (PawPantry) ----------------
  "dog-food-treats": { company: "pawpantry", items: [
    ["PawPantry", "Adult Dry Dog Food Chicken & Rice", "30 lb", 1, 38.0, { unit: "bag", feat: true, shelf: 12 }],
    ["Happy Tails", "Dental Chews Medium", "24 ct", 6, 54.0, { shelf: 12 }],
    ["Happy Tails", "Chicken Jerky Treats", "16 oz", 6, 48.0, { shelf: 12 }],
    ["PawPantry", "Wet Dog Food Beef Stew", "13 oz can", 12, 21.0, { shelf: 24 }],
    ["PawPantry", "Puppy Formula Dry Food", "15 lb", 1, 27.0, { unit: "bag", shelf: 12 }],
  ] },
  "cat-supplies": { company: "pawpantry", items: [
    ["Whisker Co.", "Clumping Clay Cat Litter", "40 lb", 1, 15.0, { unit: "bag", feat: true }],
    ["Whisker Co.", "Indoor Cat Dry Food Salmon", "16 lb", 1, 29.0, { unit: "bag", shelf: 12 }],
    ["Whisker Co.", "Crunchy Cat Treats", "6 oz", 10, 30.0, { v: ["flavour", ["Chicken", "Tuna", "Catnip"]], shelf: 12 }],
    ["Whisker Co.", "Feather Wand Cat Toys", "6 pk", 6, 27.0 ],
  ] },
  "pet-accessories": { company: "pawpantry", items: [
    ["Happy Tails", "Reflective Dog Leash 6 ft", "1 ct", 12, 54.0 ],
    ["Happy Tails", "Adjustable Nylon Collar", "1 ct", 12, 36.0, { v: ["size", ["S", "M", "L"]] }],
    ["Happy Tails", "Dog Waste Bags", "300 ct", 12, 48.0 ],
    ["Happy Tails", "Stainless Steel Pet Bowl", "1 ct", 12, 42.0 ],
    ["Happy Tails", "Rope Chew Toy", "1 ct", 12, 30.0 ],
  ] },
  // ---------------- Toys & Party (FunFactory) ----------------
  "toys-games": { company: "funfactory", items: [
    ["BrightBlocks", "Classic Building Bricks", "500 pc", 4, 64.0, { feat: true }],
    ["FunFactory", "Rechargeable RC Stunt Car", "1 ct", 4, 72.0 ],
    ["FunFactory", "Plush Animals Assorted 8 in", "12 ct", 1, 48.0, { unit: "dozen" }],
    ["FunFactory", "Bubble Wands", "36 ct", 1, 27.0, { unit: "display" }],
    ["BrightBlocks", "DIY Slime Kit", "1 kit", 6, 45.0 ],
    ["FunFactory", "Family Card Game", "1 ct", 12, 54.0 ],
  ] },
  "party-supplies": { company: "funfactory", items: [
    ["PartyPop", "Latex Balloons 12 in Assorted", "100 ct", 6, 36.0, { feat: true }],
    ["PartyPop", "Birthday Candles", "24 ct", 24, 21.6 ],
    ["PartyPop", "Party Plates & Napkins Set", "24 guests", 6, 42.0 ],
    ["PartyPop", "Crepe Paper Streamers", "6 rolls", 12, 30.0 ],
    ["PartyPop", "Glow Sticks", "100 ct", 6, 39.0 ],
  ] },
  "seasonal": { company: "funfactory", items: [
    ["PartyPop", "Halloween Costume Masks Assorted", "12 ct", 1, 36.0, { unit: "dozen" }],
    ["PartyPop", "LED String Lights 100 ct", "1 ct", 12, 54.0 ],
    ["PartyPop", "Kraft Gift Bags Assorted", "24 ct", 6, 30.0 ],
    ["PartyPop", "Holiday Wrapping Paper", "3 rolls", 12, 42.0 ],
  ] },
  // ---------------- existing categories: Smoking & Vape (Cloud Nine) ----------------
  "disposables-pods": { company: "cloudnine", compliance: "vapor_closed", items: [
    ["Nimbus", "Nimbus 6000 Disposable", "5% nic", 10, 75.0, { unit: "box", v: ["flavour", ["Blue Razz Ice", "Watermelon Ice", "Mango Peach", "Strawberry Kiwi", "Mint"]], feat: true, spec: { puff_count: 6000, nicotine_strength: 50 }, ml: 13 }],
    ["Nimbus", "Nimbus Mini 2500 Disposable", "5% nic", 10, 55.0, { unit: "box", v: ["flavour", ["Cool Mint", "Grape Ice", "Peach"]], spec: { puff_count: 2500, nicotine_strength: 50 }, ml: 8 }],
    ["Halo Pod", "Refillable Pod Kit", "1 kit", 5, 70.0, { unit: "box" }],
    ["Halo Pod", "Replacement Pods 1.0Ω", "4 pk", 10, 60.0, { unit: "box" }],
  ] },
  "e-liquids": { company: "cloudnine", compliance: "e_liquid", items: [
    ["Stratus Liquids", "Premium E-Liquid 60 ml", "3 mg", 10, 90.0, { unit: "box", v: ["flavour", ["Vanilla Custard", "Strawberry Milk", "Menthol", "Tobacco Gold"]], spec: { nicotine_strength: 3 }, ml: 60 }],
    ["Stratus Liquids", "Salt Nic E-Liquid 30 ml", "35 mg", 10, 85.0, { unit: "box", v: ["flavour", ["Iced Mango", "Mixed Berry", "Spearmint"]], spec: { nicotine_strength: 35 }, ml: 30 }],
  ] },
  "coils-tanks": { company: "cloudnine", items: [
    ["Halo Pod", "Mesh Coils 0.2Ω", "5 pk", 10, 80.0, { unit: "box" }],
    ["Halo Pod", "Sub-Ohm Glass Tank 5 ml", "1 ct", 5, 75.0, { unit: "box" }],
  ] },
  "papers-wraps": { company: "cloudnine", items: [
    ["Cirrus", "King Size Slim Rolling Papers", "32 leaves", 50, 45.0, { unit: "box", feat: true }],
    ["Cirrus", "Pre-Rolled Cones 1¼", "6 pk", 32, 52.0, { unit: "box" }],
  ] },
  "lighters": { company: "cloudnine", items: [
    ["Flint & Co.", "Disposable Pocket Lighters", "50 ct", 1, 32.5, { unit: "tray" }],
    ["Flint & Co.", "Windproof Torch Lighter", "1 ct", 12, 54.0, { unit: "box" }],
  ] },
  // ---------------- existing categories: Fragrances (Maison Lumen) ----------------
  "women": { company: "maisonlumen", items: [
    ["Maison Lumen", "Rose Éclat Eau de Parfum", "100 ml", 3, 66.0, { unit: "pack", feat: true, frag: ["Eau de Parfum", "Floral", "Women"] }],
    ["Maison Lumen", "Velours Noir Eau de Parfum", "100 ml", 3, 72.0, { unit: "pack", frag: ["Eau de Parfum", "Oriental", "Women"] }],
    ["Lune Douce", "Vanilla Cloud Body Mist", "250 ml", 6, 45.0, { unit: "pack", frag: ["Body Mist", "Gourmand", "Women"] }],
  ] },
  "men": { company: "maisonlumen", items: [
    ["Maison Lumen", "Cèdre Bleu Eau de Toilette", "100 ml", 3, 63.0, { unit: "pack", frag: ["Eau de Toilette", "Woody", "Men"] }],
    ["Atelier Nord", "Sport Fresh Eau de Toilette", "100 ml", 3, 54.0, { unit: "pack", frag: ["Eau de Toilette", "Fresh", "Men"] }],
  ] },
  "unisex": { company: "maisonlumen", items: [
    ["Atelier Nord", "Oud & Amber Eau de Parfum", "50 ml", 3, 60.0, { unit: "pack", frag: ["Eau de Parfum", "Oriental", "Unisex"] }],
    ["Lune Douce", "Citrus Bloom Cologne", "150 ml", 3, 42.0, { unit: "pack", frag: ["Eau de Cologne", "Citrus", "Unisex"] }],
  ] },
};

// Buyers: retail businesses. [business, first, last, city, state, zip, street, kind]
// kind decides what they buy: conv (convenience), pharm, beauty, auto, pet, office, gift, vape, cafe
const BUYERS = [
  ["Corner Market & Deli", "Sam", "Patel", "Jersey City", "NJ", "07302", "214 Newark Ave", "conv"],
  ["Quick Stop Food Mart", "Luis", "Ortega", "Paterson", "NJ", "07501", "88 Market St", "conv"],
  ["Sunrise Pharmacy", "Grace", "Kim", "Queens", "NY", "11354", "136-20 Roosevelt Ave", "pharm"],
  ["Main Street Convenience", "Ahmed", "Hassan", "Philadelphia", "PA", "19107", "1021 Chestnut St", "conv"],
  ["Glow Beauty Supply", "Tasha", "Williams", "Brooklyn", "NY", "11216", "1290 Fulton St", "beauty"],
  ["Pit Stop Auto & Gas", "Mike", "Kowalski", "Toledo", "OH", "43604", "500 Monroe St", "auto"],
  ["Happy Paws Pet Shop", "Emily", "Carter", "Boulder", "CO", "80302", "1650 Pearl St", "pet"],
  ["Campus Corner Store", "Raj", "Mehta", "Boston", "MA", "02115", "290 Huntington Ave", "conv"],
  ["Metro Mart", "Kevin", "Nguyen", "Baltimore", "MD", "21201", "411 N Howard St", "conv"],
  ["Lakeside Grocery", "Maria", "Santos", "Cleveland", "OH", "44113", "1979 W 25th St", "conv"],
  ["Express Mini Mart", "Omar", "Farouk", "Newark", "NJ", "07102", "57 Halsey St", "conv"],
  ["Downtown Smoke & Vape", "Jay", "Thompson", "Austin", "TX", "78701", "608 Congress Ave", "vape"],
  ["Bella Salon & Spa", "Nicole", "Russo", "Hoboken", "NJ", "07030", "112 Washington St", "beauty"],
  ["Valley Gas & Go", "Derek", "Owens", "Allentown", "PA", "18101", "730 Hamilton St", "auto"],
  ["Riverside Deli", "Tony", "Marino", "Yonkers", "NY", "10701", "45 Main St", "cafe"],
  ["Oak Street Pharmacy", "Linda", "Brooks", "Stamford", "CT", "06901", "300 Atlantic St", "pharm"],
  ["Bright Kids Toy Store", "Amy", "Chen", "Edison", "NJ", "08817", "1600 Oak Tree Rd", "gift"],
  ["Office Hub Supplies", "Brian", "Murphy", "Hartford", "CT", "06103", "100 Pearl St", "office"],
  ["The Beauty Bar", "Keisha", "Johnson", "Atlanta", "GA", "30303", "75 Peachtree St", "beauty"],
  ["Northside Wellness", "Paul", "Fischer", "Pittsburgh", "PA", "15212", "820 E Ohio St", "pharm"],
  ["Gulf Coast Vapor", "Carlos", "Mendez", "Houston", "TX", "77002", "1100 Main St", "vape"],
  ["Sunset Souvenirs", "Lisa", "Hart", "Miami Beach", "FL", "33139", "1200 Ocean Dr", "gift"],
  ["Elm City Market", "David", "Cohen", "New Haven", "CT", "06510", "777 Chapel St", "conv"],
  ["Prime Petro Express", "Hassan", "Ali", "Trenton", "NJ", "08608", "25 E State St", "auto"],
  ["Fresh Mart 24", "Jin", "Park", "Fort Lee", "NJ", "07024", "2015 Lemoine Ave", "conv"],
  ["Coastal Café & Market", "Rachel", "Green", "Long Branch", "NJ", "07740", "60 Ocean Ave", "cafe"],
  ["Paws & Claws Supply", "Greg", "Lawson", "Lakewood", "CO", "80226", "7200 W Alameda Ave", "pet"],
  ["Scent Avenue", "Fatima", "Rahman", "Paramus", "NJ", "07652", "1 Garden State Plaza", "gift"],
  ["Uptown Discount Store", "Victor", "Alvarez", "Bronx", "NY", "10458", "2500 Grand Concourse", "conv"],
  ["Harborview Pharmacy", "Susan", "Wright", "Providence", "RI", "02903", "88 Westminster St", "pharm"],
  ["Liberty Food Mart", "Ali", "Rahimi", "Elizabeth", "NJ", "07201", "310 Broad St", "conv"],
  ["Shore Road Gas & Deli", "Vince", "Ferraro", "Toms River", "NJ", "08753", "1450 Hooper Ave", "auto"],
  ["Greenway Pharmacy", "Nadia", "Khan", "Albany", "NY", "12207", "40 State St", "pharm"],
  ["Pawsome Pets", "Laura", "Diaz", "Fort Collins", "CO", "80524", "215 N College Ave", "pet"],
  ["Sparkle Beauty Supply", "Yvonne", "Clarke", "Newark", "NJ", "07103", "590 Springfield Ave", "beauty"],
  ["Market Basket Express", "Pedro", "Gomez", "Camden", "NJ", "08102", "18 Broadway", "conv"],
  ["Ace Office Mart", "Steven", "Park", "Worcester", "MA", "01608", "120 Front St", "office"],
  ["Cloud City Vapes", "Tariq", "Jones", "San Antonio", "TX", "78205", "301 E Houston St", "vape"],
  ["Northgate Convenience", "Irene", "Lopez", "Scranton", "PA", "18503", "401 Lackawanna Ave", "conv"],
  ["Bayside Gift Shop", "Monica", "Reed", "Cape May", "NJ", "08204", "421 Washington St", "gift"],
  ["Sunny Side Café", "Ben", "Wallace", "Montclair", "NJ", "07042", "520 Bloomfield Ave", "cafe"],
  ["QuickFix Auto Parts", "Dmitri", "Volkov", "Akron", "OH", "44308", "77 S Main St", "auto"],
  ["Village Pharmacy", "Helen", "Ortiz", "White Plains", "NY", "10601", "200 Mamaroneck Ave", "pharm"],
  ["24/7 Mini Market", "Karim", "Saleh", "Newark", "DE", "19711", "150 E Main St", "conv"],
  ["Toy Box Outlet", "Ruth", "Sanders", "Lancaster", "PA", "17602", "25 N Queen St", "gift"],
];
// which sellers each kind of buyer buys from (with weights)
const BUYS_FROM = {
  conv: { meridian: 10, summit: 4, voltedge: 2, roadready: 1, funfactory: 1 },
  pharm: { meridian: 10, harbor: 3, summit: 1 },
  beauty: { harbor: 10, meridian: 3, maisonlumen: 2 },
  auto: { roadready: 8, meridian: 6, voltedge: 2, summit: 2 },
  pet: { pawpantry: 10, meridian: 2 },
  office: { paperline: 10, meridian: 3 },
  gift: { funfactory: 6, urbanthread: 5, maisonlumen: 3, summit: 2, voltedge: 2 },
  vape: { cloudnine: 10, voltedge: 2, meridian: 1 },
  cafe: { meridian: 10, summit: 3, paperline: 1 },
};

// Meridian's own staff (employees; some also have log-ins)
const DEPARTMENTS = [
  ["Sales", "SAL"], ["Warehouse & Logistics", "WHS"], ["Delivery", "DEL"], ["Finance", "FIN"], ["Purchasing", "PUR"], ["Administration", "ADM"],
];
// [first, last, title, department code, monthly salary, hire (months ago), login role or null]
const STAFF = [
  ["Daniel", "Reyes", "Managing Director", "ADM", 8200, 60, "OWNER"],
  ["Priya", "Shah", "Operations Manager", "ADM", 6000, 48, "MANAGER"],
  ["Marcus", "Bell", "Finance Manager", "FIN", 5600, 40, "ACCOUNTANT"],
  ["Olivia", "Grant", "HR & Payroll Lead", "ADM", 4600, 30, "HR"],
  ["Ethan", "Cole", "Warehouse Supervisor", "WHS", 4200, 44, "WAREHOUSE"],
  ["Sofia", "Martinez", "Key Account Manager", "SAL", 4600, 36, "SALES"],
  ["Hannah", "Lee", "Sales Representative", "SAL", 3800, 15, null],
  ["Nina", "Kowalczyk", "Buyer", "PUR", 4200, 33, null],
  ["Chloe", "Adams", "Accounts Assistant", "FIN", 3500, 27, null],
  ["Luis", "Ramirez", "Forklift Operator", "WHS", 3100, 38, null],
  ["Aisha", "Bello", "Picker / Packer", "WHS", 2800, 14, null],
  ["Kevin", "Huang", "Delivery Driver", "DEL", 3300, 42, null],
  ["Mei", "Tanaka", "Customer Service", "SAL", 3000, 12, null], // part time
  ["Jordan", "Price", "Warehouse Associate", "WHS", 2900, 30, null], // leaves during the year
  ["Isabel", "Cruz", "Sales Representative", "SAL", 3700, 3, null],  // recent hire
];

// external vendors Meridian buys from (manufacturers / master distributors)
const VENDORS = [
  ["Crunch Valley Foods", "CVF", "Rachel Moore", "orders@crunchvalley.example.com", "Boise", "ID", 30, ["Crunch Valley", "Golden Harvest", "Salty Pete's"]],
  ["Voltage Beverage Group", "VBG", "Steve Park", "sales@voltagebev.example.com", "Charlotte", "NC", 30, ["Voltage", "Rush Hour", "Apex Energy"]],
  ["Fizz Co. Bottling", "FIZ", "Karen Diaz", "trade@fizzco.example.com", "Secaucus", "NJ", 15, ["Fizz Co.", "Sunny Grove", "Brookside", "Clear Spring", "Alpine Crest"]],
  ["Morning Peak Roasters", "MPR", "Joe Russo", "wholesale@morningpeak.example.com", "Providence", "RI", 30, ["Morning Peak", "Leaf & Kettle"]],
  ["SparkPro Chemical", "SPC", "Dana White", "orders@sparkpro.example.com", "Wilmington", "DE", 45, ["SparkPro", "EcoShine", "FreshFold", "Brightline", "AuraHome", "Breeze"]],
  ["NorthPine Paper Mills", "NPM", "Hal Becker", "sales@northpine.example.com", "Green Bay", "WI", 30, ["SoftLeaf", "NorthPine", "ToughStack"]],
  ["CareMax Health Products", "CMH", "Dr. Ana Reyes", "trade@caremax.example.com", "Morristown", "NJ", 30, ["CareMax", "ReliefRx", "VitaCore", "Nature's Path", "SafeHands"]],
  ["BrightSmile Personal Care", "BSP", "Mark Ellis", "orders@brightsmile.example.com", "Cincinnati", "OH", 30, ["BrightSmile", "DentaPro", "Edge Men", "Smooth Co.", "Cedar & Sage", "Ocean Mist"]],
  ["Charge+ Accessories", "CHG", "Lily Zhang", "b2b@chargeplus.example.com", "Shenzhen", "Guangdong", 60, ["Charge+", "PowerPod", "DriveFresh"]],
];

module.exports = { ATTRIBUTES, CATEGORIES, COMPANIES, PRODUCTS, BUYERS, BUYS_FROM, DEPARTMENTS, STAFF, VENDORS, P };
