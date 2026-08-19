// Публичный клиентский доступ к PostgREST. Секретный ключ сюда не кладём.

export const SUPABASE_URL = "https://bamcbftomojefzxzwdmn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_W52YtYK6LCNsG6xzD021UQ_jEF7zMI6";

export function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
