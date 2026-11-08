/*
 * config.js — the only file you need to edit to connect your backend.
 * Both values are safe to put in front-end code (they're public by design).
 * Find them in Supabase: Project Settings -> API Keys / Data API.
 */
window.CHATLENS_CONFIG = {
  // e.g. 'https://abcdefghijklmnop.supabase.co'  (leave empty to run stats-only)
  SUPABASE_URL: 'https://gvydwgsjykbioaojtrbv.supabase.co',

  // Your publishable key, e.g. 'sb_publishable_...'
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_yYkk63FDoXcEV0FwLsXNwA_niXIAZ27',

  // Name of the edge function you deployed
  FUNCTION_NAME: 'analyze',

  // How much chat text to send to the AI (characters). ~150k chars is roughly
  // 40–60k tokens: enough for a good read, cheap enough for a student budget.
  TRANSCRIPT_CHAR_BUDGET: 150000,

  // Replace real names with "Person A/B" and strip phone numbers, emails and
  // links before anything leaves the browser.
  ANONYMISE_BY_DEFAULT: true,
};
