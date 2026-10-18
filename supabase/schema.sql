-- Hot Pizza Ace: Production Supabase Schema
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Products Table
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES public.categories(id) ON UPDATE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    vegetarian BOOLEAN NOT NULL DEFAULT TRUE,
    price INT NOT NULL, -- Integer paise (e.g., ₹199 = 19900)
    available BOOLEAN NOT NULL DEFAULT TRUE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    bestseller BOOLEAN NOT NULL DEFAULT FALSE,
    badge TEXT,
    sizes JSONB NOT NULL DEFAULT '[]'::JSONB,
    crusts JSONB NOT NULL DEFAULT '[]'::JSONB,
    toppings JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Restaurant Settings
CREATE TABLE IF NOT EXISTS public.restaurant_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    name TEXT NOT NULL DEFAULT 'Hot Pizza Ace',
    address TEXT NOT NULL DEFAULT 'ME 346, near Ram Janki Mandir, Hemat Vihar, Barra 2, Barra World Bank, Barra, Kanpur, Uttar Pradesh 208027',
    phone TEXT NOT NULL DEFAULT '+91 70815 55055',
    opening_hours TEXT NOT NULL DEFAULT 'Every day · 11:00 AM – 12:00 midnight',
    delivery_fee INT NOT NULL DEFAULT 4900, -- ₹49 in paise
    free_delivery_threshold INT NOT NULL DEFAULT 25000, -- ₹250 in paise
    service_postal_codes JSONB NOT NULL DEFAULT '["208027"]'::JSONB,
    cod_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    online_payments_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    customer JSONB NOT NULL,
    fulfillment TEXT NOT NULL CHECK (fulfillment IN ('delivery', 'pickup')),
    items JSONB NOT NULL,
    subtotal INT NOT NULL,
    delivery_fee INT NOT NULL DEFAULT 0,
    discount INT NOT NULL DEFAULT 0,
    total INT NOT NULL,
    coupon TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL CHECK (payment_method IN ('upi', 'card', 'cash')),
    payment_status TEXT NOT NULL CHECK (payment_status IN ('initiated', 'pending', 'paid', 'simulated_paid', 'failed')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'cancelled', 'rejected')),
    branch_id TEXT NOT NULL DEFAULT 'barra',
    branch_name TEXT NOT NULL DEFAULT 'Barra · Kanpur',
    branch_address TEXT,
    branch_phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Payments Table (Razorpay & Online Transactions)
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'razorpay',
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    amount INT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    method TEXT DEFAULT 'upi',
    status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'captured', 'failed', 'refunded')),
    error_code TEXT,
    error_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_available ON public.products(available) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders((customer->>'phone'));
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order_id ON public.payments(razorpay_order_id);

-- 8. Row Level Security (RLS) Configuration
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Allow public read access to active categories & products
DROP POLICY IF EXISTS "Public can view non-archived categories" ON public.categories;
CREATE POLICY "Public can view non-archived categories"
    ON public.categories FOR SELECT
    USING (archived = false);

DROP POLICY IF EXISTS "Public can view active products" ON public.products;
CREATE POLICY "Public can view active products"
    ON public.products FOR SELECT
    USING (archived = false);

DROP POLICY IF EXISTS "Public can view restaurant settings" ON public.restaurant_settings;
CREATE POLICY "Public can view restaurant settings"
    ON public.restaurant_settings FOR SELECT
    USING (true);

-- Allow inserting orders & tracking own orders by ID or Phone
DROP POLICY IF EXISTS "Anyone can insert orders" ON public.orders;
CREATE POLICY "Anyone can insert orders"
    ON public.orders FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read own orders by ID" ON public.orders;
CREATE POLICY "Anyone can read own orders by ID"
    ON public.orders FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Anyone can insert payments" ON public.payments;
CREATE POLICY "Anyone can insert payments"
    ON public.payments FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read payments by order" ON public.payments;
CREATE POLICY "Anyone can read payments by order"
    ON public.payments FOR SELECT
    USING (true);

-- 9. Seed Initial Restaurant Settings
INSERT INTO public.restaurant_settings (id, name, address, phone, opening_hours, delivery_fee, free_delivery_threshold, service_postal_codes)
VALUES (
    'default',
    'Hot Pizza Ace',
    'ME 346, near Ram Janki Mandir, Hemat Vihar, Barra 2, Barra World Bank, Barra, Kanpur, Uttar Pradesh 208027',
    '+91 70815 55055',
    'Every day · 11:00 AM – 12:00 midnight',
    4900,
    25000,
    '["208027"]'::JSONB
)
ON CONFLICT (id) DO NOTHING;

-- 10. Seed Initial Menu Categories
INSERT INTO public.categories (id, name, slug, sort_order) VALUES
('veg-pizza', 'Veg Pizzas', 'veg-pizza', 0),
('value-pizzas', 'Value Pizzas', 'value-pizzas', 1),
('combos', 'Combos', 'combos', 2),
('burgers', 'Burgers', 'burgers', 3),
('pasta', 'Pasta', 'pasta', 4),
('garlic-bread', 'Garlic Breads', 'garlic-bread', 5),
('sides', 'Fries & Pizza Puffs', 'sides', 6),
('pockets', 'Pockets', 'pockets', 7),
('wraps', 'Wraps', 'wraps', 8),
('rice', 'Rice', 'rice', 9),
('pav-bhaji', 'Pav Bhaji', 'pav-bhaji', 10),
('desserts', 'Desserts', 'desserts', 11),
('dips', 'Dips', 'dips', 12),
('beverages', 'Beverages', 'beverages', 13)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;
