// Supabase Edge Function entry point.
// Deploy:  supabase functions deploy analyze --no-verify-jwt
import { handle } from "./handler.ts";

Deno.serve((req) => handle(req, Deno.env));
