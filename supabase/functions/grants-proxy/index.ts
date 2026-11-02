// Grant Copilot — Grants.gov proxy (Supabase Edge Function)
// Forwards /search2 and /fetchOpportunity to the public Grants.gov API so the
// browser is not blocked by cross-origin rules. Signed-in users only.
// Deploy:  supabase functions deploy grants-proxy
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ msg: "Sign in required" }), { status: 401, headers: cors });

  const kind = new URL(req.url).pathname.split("/").pop();
  if (kind !== "search2" && kind !== "fetchOpportunity")
    return new Response(JSON.stringify({ msg: "Unknown endpoint" }), { status: 404, headers: cors });

  const r = await fetch("https://api.grants.gov/v1/api/" + kind, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await req.text(),
  });
  return new Response(await r.text(), { status: r.status, headers: { ...cors, "content-type": "application/json" } });
});
