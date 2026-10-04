# Soota Smoke Shop - Quick Reference

## Project Structure

```
/src/app/
├── App.tsx                          # Main app with routing
├── components/
│   ├── Header.tsx                   # Sticky header with navigation
│   ├── Footer.tsx                   # Global footer
│   ├── ProductCard.tsx              # Reusable product card
│   └── ProductCarousel.tsx          # Product carousel slider
├── context/
│   ├── AuthContext.tsx              # Authentication management
│   └── CartContext.tsx              # Cart/quote management
├── data/
│   └── mockData.ts                  # Products, brands, categories
└── pages/
    ├── HomePage.tsx                 # Landing page
    ├── BrandProductsPage.tsx        # Brand product listing
    ├── ProductDetailPage.tsx        # Product details
    ├── LoginPage.tsx                # Login form
    ├── RegistrationPage.tsx         # Registration form
    ├── CartPage.tsx                 # Quote cart
    ├── ContactPage.tsx              # Contact form
    └── BrandsPage.tsx               # All brands
```

## Key Features Implemented

### Header (All Pages)
- Sticky navigation
- Logo (clickable to home)
- Navigation: Home, Categories (dropdown), Brands, Contact
- Auth buttons: Login / Register (or user info + Logout)
- Cart icon with item count
- Categories dropdown with 5 categories × 5 brands each
- Mobile responsive menu

### Home Page
- Hero section with CTA buttons
- Featured Products (3 rows of carousels)
- New Arrivals (2 rows)
- Best Sellers (2 rows)
- Famous Brands section (clickable brand logos)
- Bottom CTA section

### Product Features
- Prices hidden until login (shows "Login to view price")
- Product cards show: image, brand, name, price/lock icon
- "NEW" and "BEST SELLER" badges
- Hover effects (shadow, scale)

### Product Detail Page
- Image gallery (3 images, thumbnail selection)
- Brand name + product title
- Nicotine warning (with TriangleAlert icon)
- Product description
- Flavor selection (if available)
- Wholesale quantity controls (+/-10, manual input)
- Price display (hidden until login)
- "Request Quote" button (not "Add to Cart")
- Suggested products section
- Redirects to login if not authenticated

### Brand Products Page
- Brand name header
- Filter by category
- Product count display
- Grid layout of products

### Login & Registration
- Login with demo credentials: demo@wholesale.com / demo123
- Registration form with all fields:
  - Business Name, Owner Name, Email, Phone
  - Address, City, State, ZIP
  - Business Type, Tax ID
  - Password + Confirm Password
- Form validation
- Auto-login after registration
- LocalStorage persistence

### Cart/Quote System
- Shows "Request Quote Cart" (not "Shopping Cart")
- Product image, brand, name, flavor
- Quantity controls (wholesale units)
- Price per unit + total (if logged in)
- "Submit Quote Request" button (not checkout)
- Business info displayed for logged-in users
- Clear cart option

### Footer (All Pages)
- Logo + description
- Quick links (Home, Brands, Contact, Registration)
- Legal links (Terms, Privacy, etc.)
- Contact info (Email, Phone, Address)
- Business hours
- Age restriction notice (21+)
- Wholesale disclaimer

### Design Principles
- Clean, modern UI
- Minimal animations (suitable for older users)
- Smooth hover effects
- Simple transitions (200ms)
- Desktop-first (wholesale business)
- Mobile responsive
- Clear fonts and buttons

## Navigation Flow

```
Home
├── Click Product → Product Detail
├── Click Brand → Brand Products
├── Click Category Brand → Brand Products
├── Request Quote (unauthenticated) → Login
├── Login → Home (with prices visible)
└── Register → Home (auto-logged-in)

Product Detail
├── Request Quote (unauthenticated) → Login
├── Request Quote (authenticated) → Add to cart + toast
└── Suggested Product → Product Detail

Cart
├── Submit Quote (unauthenticated) → Login
└── Submit Quote (authenticated) → Success toast → Home
```

## Demo Usage

1. **Browse as Guest:**
   - See products, but prices are hidden
   - Try to request quote → redirected to login

2. **Login:**
   - Use: demo@wholesale.com / demo123
   - Now prices are visible

3. **Add to Quote:**
   - Select flavor (if applicable)
   - Choose quantity
   - Click "Request Quote"
   - See toast confirmation

4. **Submit Quote:**
   - Go to cart icon
   - Review items
   - Click "Submit Quote Request"
   - Success message

## Color Scheme

- Primary Blue: #3b82f6 (blue-600)
- Hover Blue: #1d4ed8 (blue-700)
- Background: #f9fafb (gray-50)
- Text: #111827 (gray-900)
- Warning: #fef3c7 (yellow-50) / #92400e (yellow-800)

## Responsive Breakpoints

- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

Carousels adapt:
- Desktop: 4 items
- Tablet: 3 items
- Mobile-landscape: 2 items
- Mobile-portrait: 1 item
