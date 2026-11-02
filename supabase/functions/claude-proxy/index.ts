// Grant Copilot — Claude proxy (Supabase Edge Function)
// Keeps the Anthropic API key on the server. Only signed-in users can call it.
// Deploy:  supabase functions deploy claude-proxy
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optional: supabase secrets set ALLOWED_EMAILS=you@org.org,teammate@org.org
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: { message: "POST only" } }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: { message: "Sign in required" } }, 401);
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email ?? "").toLowerCase())) return json({ error: { message: "Not allowed" } }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: { message: "ANTHROPIC_API_KEY secret is not set" } }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: { message: "Bad JSON" } }, 400); }
  if (!MODELS.has(String(body.model))) body.model = "claude-sonnet-5-5";
  body.max_tokens = Math.min(Number(body.max_tokens) || 2000, 8000);
  delete body.stream;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  return new Response(await r.text(), { status: r.status, headers: { ...cors, "content-type": "application/json" } });
});
