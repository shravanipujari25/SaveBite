-- ==============================================================================
-- SaveBite Phase 4: Scheduler & Intelligence Routes Database Schema
-- File: docs/phase4-database-schema.sql
-- ==============================================================================
-- INSTRUCTIONS FOR MANUAL APPLICATION IN SUPABASE DASHBOARD:
-- 1. Log in to your Supabase Project Dashboard.
-- 2. Navigate to "SQL Editor" on the left navigation panel.
-- 3. Click "New Query".
-- 4. Paste the entire contents of this SQL file.
-- 5. Click "Run" (Ctrl+Enter / Cmd+Enter).
--
-- EXECUTION ORDER:
-- 1. UUID & Extension verification
-- 2. Inventory Items Intelligence columns enhancement
-- 3. Shopping List Items table & indexes
-- 4. Avoided Waste Log table & indexes
-- 5. Device Pairing Tokens table & indexes
-- 6. Household settings & User profile preferences enhancement
-- 7. updated_at timestamp triggers
-- 8. Row Level Security (RLS) policies for service_role
-- 9. Supabase Realtime publication setup
-- ==============================================================================

-- 1. Ensure UUID Extension is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. Inventory Items Intelligence Columns Enhancement
-- Adds AI-computed shelf-life days remaining, Use-First priority score,
-- and freshness bucket. Note: Original `expiry_date` is strictly preserved!
-- ==============================================================================
ALTER TABLE public.inventory_items 
    ADD COLUMN IF NOT EXISTS adj_days_left NUMERIC(5, 2);

ALTER TABLE public.inventory_items 
    ADD COLUMN IF NOT EXISTS use_first_score INT DEFAULT 0 CHECK (use_first_score >= 0 AND use_first_score <= 100);

ALTER TABLE public.inventory_items 
    ADD COLUMN IF NOT EXISTS freshness_bucket TEXT DEFAULT 'fresh' CHECK (freshness_bucket IN ('fresh', 'use_soon', 'critical', 'expired'));

ALTER TABLE public.inventory_items 
    ADD COLUMN IF NOT EXISTS last_intelligence_at TIMESTAMPTZ;

-- Performance indexes for scheduler item queries and Use-First sorting
CREATE INDEX IF NOT EXISTS idx_inventory_items_household_use_first 
    ON public.inventory_items (household_id, use_first_score DESC) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_inventory_items_freshness_bucket 
    ON public.inventory_items (household_id, freshness_bucket) WHERE status = 'active';

-- ==============================================================================
-- 3. Shopping List Items Table
-- Stores household grocery shopping lists with duplicate/overbuy warnings.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.shopping_list_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit TEXT NOT NULL DEFAULT 'piece',
    category TEXT DEFAULT 'other',
    notes TEXT,
    is_purchased BOOLEAN NOT NULL DEFAULT false,
    purchased_at TIMESTAMPTZ,
    added_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Shopping list indexes
CREATE INDEX IF NOT EXISTS idx_shopping_list_household_purchased 
    ON public.shopping_list_items (household_id, is_purchased);

CREATE INDEX IF NOT EXISTS idx_shopping_list_household_created 
    ON public.shopping_list_items (household_id, created_at DESC);

-- ==============================================================================
-- 4. Avoided Waste Log Table
-- Tracks savings when at-risk or high-priority ingredients are consumed in recipes.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.avoided_waste_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    estimated_savings NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (estimated_savings >= 0),
    source TEXT NOT NULL DEFAULT 'recipe_rescue',
    recipe_name TEXT,
    recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Avoided waste indexes
CREATE INDEX IF NOT EXISTS idx_avoided_waste_household_consumed 
    ON public.avoided_waste_log (household_id, consumed_at DESC);

-- ==============================================================================
-- 5. Device Pairing Tokens Table
-- Ephemeral 15-minute cryptographically secure pairing codes for physical ESP32 nodes.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.device_pairing_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    device_type TEXT NOT NULL DEFAULT 'esp32',
    zone TEXT NOT NULL DEFAULT 'refrigerator',
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT false,
    used_at TIMESTAMPTZ,
    paired_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Pairing tokens indexes
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_token 
    ON public.device_pairing_tokens (token);

CREATE INDEX IF NOT EXISTS idx_pairing_tokens_household_expires 
    ON public.device_pairing_tokens (household_id, expires_at);

-- ==============================================================================
-- 6. Household Settings & User Preferences Enhancement
-- ==============================================================================
ALTER TABLE public.households 
    ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"alert_on_critical": true, "alert_on_use_soon": true}'::jsonb;

ALTER TABLE public.users 
    ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';

ALTER TABLE public.users 
    ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{"theme": "system", "email_notifications": true}'::jsonb;

-- ==============================================================================
-- 7. Automatic updated_at Triggers
-- ==============================================================================
DROP TRIGGER IF EXISTS tr_shopping_list_updated_at ON public.shopping_list_items;
CREATE TRIGGER tr_shopping_list_updated_at
    BEFORE UPDATE ON public.shopping_list_items
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 8. Row Level Security (RLS) Configuration
-- ==============================================================================
ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avoided_waste_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairing_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopping_list_service_role_policy ON public.shopping_list_items;
CREATE POLICY shopping_list_service_role_policy
    ON public.shopping_list_items FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS avoided_waste_service_role_policy ON public.avoided_waste_log;
CREATE POLICY avoided_waste_service_role_policy
    ON public.avoided_waste_log FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS pairing_tokens_service_role_policy ON public.device_pairing_tokens;
CREATE POLICY pairing_tokens_service_role_policy
    ON public.device_pairing_tokens FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 9. Supabase Realtime Publication Setup
-- ==============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'shopping_list_items'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_list_items;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'avoided_waste_log'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.avoided_waste_log;
        END IF;
    END IF;
END $$;
