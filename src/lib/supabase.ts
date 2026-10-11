import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key && !key.includes("replace_"));
export const supabase = createClient(
  url || "http://127.0.0.1:54321",
  key || "unconfigured-publishable-key",
);
