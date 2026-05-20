-- Add Clerk user ID to orders for customer order tracking.
-- Nullable for backward compatibility with existing rows.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS clerk_user_id text;
