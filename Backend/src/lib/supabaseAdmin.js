// Supabase is now used ONLY for Storage (image uploads). All database access goes through Prisma.
const { createClient } = require("@supabase/supabase-js");
const { supabaseUrl, supabaseServiceRoleKey } = require("../config");

let supabaseAdmin = null;
if (supabaseUrl && supabaseServiceRoleKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
} else {
  console.warn(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: image uploads are disabled.",
  );
}

module.exports = { supabaseAdmin };
