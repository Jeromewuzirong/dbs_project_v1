import { createClient } from '@supabase/supabase-js';

// Server-only. SUPABASE_SERVICE_ROLE_KEY must never be NEXT_PUBLIC_ —
// it bypasses RLS and must not appear in the client bundle.
export const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
