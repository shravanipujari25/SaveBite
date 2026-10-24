-- ==============================================================================
-- SaveBite Phase 3: Receipts, Items & Freshness Scans Database Schema
-- File: docs/phase3-receipts-database-schema.sql
-- ==============================================================================
-- INSTRUCTIONS FOR MANUAL APPLICATION IN SUPABASE DASHBOARD:
-- 1. Log in to your Supabase Project Dashboard.
-- 2. Navigate to "SQL Editor" on the left navigation panel.
-- 3. Click "New Query".
-- 4. Paste the entire contents of this SQL file.
-- 5. Click "Run" (Ctrl+Enter / Cmd+Enter).
--
-- EXECUTION ORDER:
-- 1. Extension check (gen_random_uuid)
-- 2. public.receipts table & indexes
-- 3. public.receipt_items table & indexes
-- 4. public.freshness_scans table & indexes
-- 5. Optional columns on public.inventory_items
-- 6. updated_at timestamp triggers
-- 7. Row Level Security (RLS) policies
-- 8. Supabase Realtime publication setup
-- ==============================================================================

-- 1. Ensure UUID Extension is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. Receipts Table
-- Stores uploaded receipt files, metadata, and high-level parsing status.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    storage_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
        'uploaded', 'parsing', 'parsed', 'failed'
    )),
    parse_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Receipts indexes
CREATE INDEX IF NOT EXISTS idx_receipts_household_created 
    ON public.receipts (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_status 
    ON public.receipts (status);

-- ==============================================================================
-- 3. Receipt Items / Line Items Table
-- Stores individual parsed lines from receipts, AI normalization results,
-- confidence scores, and confirmation/inventory-link status.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    raw_name TEXT NOT NULL,
    normalized_name TEXT,
    category TEXT CHECK (category IS NULL OR category IN (
        'produce', 'dairy', 'bakery', 'meat', 'pantry',
        'beverages', 'frozen', 'leftovers', 'snacks', 'other'
    )),
    quantity NUMERIC(10, 2),
    unit TEXT CHECK (unit IS NULL OR unit IN (
        'g', 'kg', 'ml', 'l', 'piece', 'pack', 'oz', 'lb', 'can', 'bottle', 'item', 'serving'
    )),
    unit_price NUMERIC(10, 2),
    total_price NUMERIC(10, 2),
    parse_confidence NUMERIC(5, 4),
    normalize_confidence NUMERIC(5, 4),
    confidence NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'auto_created', 'confirmed', 'rejected'
    )),
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Receipt items indexes
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id 
    ON public.receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_household_status 
    ON public.receipt_items (household_id, status);
CREATE INDEX IF NOT EXISTS idx_receipt_items_inventory_item 
    ON public.receipt_items (inventory_item_id);

-- ==============================================================================
-- 4. Freshness Scans Table
-- Records camera image uploads and AI freshness estimates for inventory items.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.freshness_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    image_path TEXT,
    freshness_score NUMERIC(5, 2) NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 100),
    status_label TEXT CHECK (status_label IS NULL OR status_label IN (
        'fresh', 'use_soon', 'critical', 'expired'
    )),
    confidence NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    notes TEXT,
    scanned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Freshness scans indexes
CREATE INDEX IF NOT EXISTS idx_freshness_scans_item_created 
    ON public.freshness_scans (inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_freshness_scans_household_created 
    ON public.freshness_scans (household_id, created_at DESC);

-- ==============================================================================
-- 5. Optional Inventory Items Enhancements
-- Adds support for freshness_score, barcode, and receipt origin tracing.
-- ==============================================================================
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS freshness_score NUMERIC(5, 2);
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS receipt_line_id UUID REFERENCES public.receipt_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode 
    ON public.inventory_items (barcode) WHERE barcode IS NOT NULL;

-- ==============================================================================
-- 6. Automatic updated_at Timestamp Triggers
-- ==============================================================================
DROP TRIGGER IF EXISTS tr_receipts_updated_at ON public.receipts;
CREATE TRIGGER tr_receipts_updated_at
    BEFORE UPDATE ON public.receipts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_receipt_items_updated_at ON public.receipt_items;
CREATE TRIGGER tr_receipt_items_updated_at
    BEFORE UPDATE ON public.receipt_items
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 7. Row Level Security (RLS) Configuration
-- Protect tables against unauthorized direct client access. Application endpoints
-- access tables through backend service-role connection with household-level checks.
-- ==============================================================================
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freshness_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipts_service_role_policy ON public.receipts;
CREATE POLICY receipts_service_role_policy
    ON public.receipts FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS receipt_items_service_role_policy ON public.receipt_items;
CREATE POLICY receipt_items_service_role_policy
    ON public.receipt_items FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS freshness_scans_service_role_policy ON public.freshness_scans;
CREATE POLICY freshness_scans_service_role_policy
    ON public.freshness_scans FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 8. Supabase Realtime Publication
-- ==============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'receipts'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.receipts;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'receipt_items'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.receipt_items;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'freshness_scans'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.freshness_scans;
        END IF;
    END IF;
END $$;

-- ==============================================================================
-- 9. SUPABASE STORAGE BUCKET INSTRUCTIONS
-- ==============================================================================
-- In the Supabase Dashboard:
-- 1. Go to "Storage" in the left sidebar.
-- 2. Click "New bucket".
-- 3. Bucket name: "receipts"
-- 4. Public bucket: NO (Keep it PRIVATE to protect sensitive grocery haul data).
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf
-- 6. Max file size: 10MB
-- 7. Click "Save bucket".
-- ==============================================================================
