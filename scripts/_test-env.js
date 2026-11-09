// Aísla las pruebas de servicios reales: se importa ANTES que cualquier módulo de src/.
// dotenv no sobrescribe variables ya definidas (aunque estén vacías), así que el .env local
// no puede activar Supabase, la IA ni las alertas durante `npm test`.
process.env.NODE_ENV = 'test';
for (const k of [
  'SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'GEMINI_API_KEY', 'HF_TOKEN', 'ALERT_WEBHOOK_URL',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PUBLIC_URL', 'TRANSFER_INSTRUCTIONS',
  'ADMIN_PASSWORD', 'AUTH_SECRET', 'PLANS_JSON',
]) process.env[k] = '';
