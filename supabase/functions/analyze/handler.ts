// handler.ts — the logic of the "analyze" edge function.
// Kept separate from index.ts so it can be tested locally with a fake fetch.
//
// GET  -> { providers: ["gemini", "anthropic", "openrouter"] }  (only those with a key set)
// POST -> { provider, stats, transcript, meta }  ->  { report, provider, model }
//
// Nothing is stored: the chat lives only in this request's memory.

import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.ts";

export type Env = { get(key: string): string | undefined };
type Fetch = typeof fetch;

const MAX_BODY_CHARS = 1_200_000; // ~1.2 MB — the client sends ~150k chars by default
const PROVIDERS = ["gemini", "anthropic", "openrouter"] as const;
type Provider = (typeof PROVIDERS)[number];

const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: "gemini-3.8-flash",
  anthropic: "claude-sonnet-5-5",
  openrouter: "google/gemini-3.8-flash",
};
const KEY_NAMES: Record<Provider, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};
const MODEL_NAMES: Record<Provider, string> = {
  gemini: "GEMINI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
  openrouter: "OPENROUTER_MODEL",
};

// Very small in-memory rate limit (per function instance). Good enough to stop
// casual abuse of your API credits; see README for a stronger option.
const hits = new Map<string, number[]>();
function rateLimited(ip: string, perHour: number): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > perHour;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowOrigin = allowed.length === 0 ? "*" : (origin && allowed.includes(origin) ? origin : allowed[0]);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function configured(env: Env): Provider[] {
  return PROVIDERS.filter((p) => !!env.get(KEY_NAMES[p]));
}

/** Pull a JSON object out of a model reply (handles ```json fences and stray text). */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callProvider(
  provider: Provider, model: string, key: string, system: string, user: string, fetchImpl: Fetch,
): Promise<string> {
  let res: Response;
  if (provider === "gemini") {
    res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 16384, responseMimeType: "application/json" },
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Gemini HTTP ${res.status}`);
    return (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  }

  if (provider === "anthropic") {
    res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Anthropic HTTP ${res.status}`);
    return (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  }

  // openrouter (OpenAI-compatible)
  res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "X-Title": "ChatLens" },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      temperature: 0.8,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `OpenRouter HTTP ${res.status}`);
  return data.choices?.[0]?.message?.content ?? "";
}

export async function handle(req: Request, env: Env, fetchImpl: Fetch = fetch): Promise<Response> {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, env);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return json({ providers: configured(env) }, 200, cors);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  // Only your own site may call this (set ALLOWED_ORIGINS in production).
  const allowed = (env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && (!origin || !allowed.includes(origin))) return json({ error: "Origin not allowed" }, 403, cors);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const perHour = Number(env.get("REPORTS_PER_HOUR_PER_IP") ?? "10");
  if (rateLimited(ip, perHour)) return json({ error: "Too many reports — try again in an hour." }, 429, cors);

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: "Chat sample too large." }, 413, cors);

  let body: { provider?: string; stats?: unknown; transcript?: string; meta?: Record<string, unknown> };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400, cors);
  }

  const available = configured(env);
  const provider = (body.provider ?? available[0]) as Provider;
  if (!PROVIDERS.includes(provider)) return json({ error: "Unknown provider" }, 400, cors);
  if (!available.includes(provider)) return json({ error: `No API key set for ${provider}` }, 400, cors);
  if (typeof body.transcript !== "string" || !body.transcript.trim()) return json({ error: "Empty chat" }, 400, cors);

  const model = env.get(MODEL_NAMES[provider]) || DEFAULT_MODELS[provider];
  const key = env.get(KEY_NAMES[provider])!;
  const user = buildUserPrompt(body.stats, body.transcript, body.meta ?? {});

  try {
    const text = await callProvider(provider, model, key, SYSTEM_PROMPT, user, fetchImpl);
    const report = extractJson(text) ?? { title: "Your chat, read closely", opening: text };
    return json({ report, provider, model }, 200, cors);
  } catch (err) {
    console.error("AI call failed:", provider, model, (err as Error).message);
    return json({ error: `The AI (${provider}) returned an error: ${(err as Error).message}` }, 502, cors);
  }
}
