-- ====================================================================
-- ETHO BOT - ESQUEMA COMPLETO PARA SUPABASE (POSTGRESQL)
-- ====================================================================
-- Instrucciones:
-- 1. Ve a tu proyecto en Supabase (https://supabase.com/dashboard)
-- 2. Abre el 'SQL Editor' en el menú lateral izquierdo
-- 3. Pega este contenido completo y haz clic en 'RUN'
-- ====================================================================

-- 1. TABLA DE USUARIOS DE LA PLATAFORMA (TENANTS & CLIENTES)
create table if not exists platform_users (
  id text primary key,
  username text unique not null,
  email text unique,
  password_hash text not null,
  name text not null,
  role text default 'user', -- 'admin' o 'user'
  whatsapp text default '',
  status text default 'active', -- 'active' o 'suspended'
  created_at timestamptz default now()
);

-- 2. TABLA DE BOTS (Instancias de WhatsApp, Dueño, Tiempos y Cobros)
create table if not exists bots (
  id text primary key,
  name text not null,
  phone text,
  prefix text default '#',
  status text default 'offline', -- 'offline', 'connecting', 'qr_ready', 'online', 'error'
  qr_code text,
  pairing_code text,
  is_active boolean default true,
  personality text default 'recreational', -- 'recreational', 'assistant', 'advisor', 'ai_autonomous'
  system_prompt text,
  ai_auto_reply boolean default false,
  owner_id text default 'admin',
  purpose text default '', -- ¿Para qué es el bot? / Negocio del cliente
  expires_at bigint default 0, -- Timestamp ms de vencimiento (0 = ilimitado)
  payment_status text default 'trial', -- 'trial', 'paid', 'expired', 'suspended'
  plan text default 'prueba', -- 'prueba', 'mensual', 'anual', 'ilimitado'
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. TABLA DE REGISTRO DE ACTIVIDAD (LOGS EN TIEMPO REAL)
create table if not exists bot_logs (
  id bigserial primary key,
  bot_id text references bots(id) on delete cascade,
  type text not null, -- 'command', 'message', 'connection', 'error', 'custom_rule'
  chat_jid text,
  sender_jid text,
  sender_name text,
  content text,
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 3. TABLA DE FUNCIONES Y REGLAS PERSONALIZADAS (Dinámicas desde Frontend)
create table if not exists bot_custom_functions (
  id text primary key,
  bot_id text default 'all',
  name text not null,
  description text,
  trigger_type text default 'command', -- 'command', 'exact', 'contains', 'regex'
  trigger_value text not null,
  response_text text not null,
  response_type text default 'text', -- 'text', 'reply', 'image'
  is_enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. TABLA DE USUARIOS (Economía, niveles, perfiles)
create table if not exists bot_users (
  jid text primary key,
  coins bigint default 0,
  bank bigint default 0,
  exp bigint default 0,
  description text,
  genre text,
  partner text,
  updated_at timestamptz default now()
);

-- 5. TABLA DE GRUPOS (Configuración por grupo)
create table if not exists bot_groups (
  jid text primary key,
  welcome boolean default false,
  goodbye boolean default false,
  antilink boolean default false,
  economy boolean default true,
  gacha boolean default true,
  nsfw boolean default false,
  bot_on boolean default true,
  updated_at timestamptz default now()
);

-- 6. TABLA DE PROSPECTOS / LEADS (CRM)
create table if not exists bot_leads (
  id text primary key,
  bot_id text references bots(id) on delete cascade,
  name text,
  phone text,
  email text,
  interest text,
  notes text,
  status text default 'nuevo', -- 'nuevo', 'contactado', 'ganado', 'perdido'
  created_at timestamptz default now()
);

-- 7. TABLA DE CATÁLOGO DE PRODUCTOS / SERVICIOS
create table if not exists bot_products (
  id text primary key,
  bot_id text references bots(id) on delete cascade,
  name text not null,
  description text,
  price numeric default 0,
  currency text default 'USD',
  image_url text,
  category text default 'General',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ÍNDICES PARA BÚSQUEDA RÁPIDA
create index if not exists idx_bot_logs_bot_id on bot_logs(bot_id);
create index if not exists idx_bot_logs_created_at on bot_logs(created_at desc);
create index if not exists idx_bot_leads_bot_id on bot_leads(bot_id);
create index if not exists idx_bot_products_bot_id on bot_products(bot_id);

-- HABILITAR RLS
alter table platform_users enable row level security;
alter table bots enable row level security;
alter table bot_logs enable row level security;
alter table bot_custom_functions enable row level security;
alter table bot_users enable row level security;
alter table bot_groups enable row level security;
alter table bot_leads enable row level security;
alter table bot_products enable row level security;

-- POLÍTICAS PERMISIVAS
drop policy if exists "etho platform_users policy" on platform_users;
create policy "etho platform_users policy" on platform_users for all using (true) with check (true);

drop policy if exists "etho bots policy" on bots;
create policy "etho bots policy" on bots for all using (true) with check (true);

drop policy if exists "etho bot_logs policy" on bot_logs;
create policy "etho bot_logs policy" on bot_logs for all using (true) with check (true);

drop policy if exists "etho custom_functions policy" on bot_custom_functions;
create policy "etho custom_functions policy" on bot_custom_functions for all using (true) with check (true);

drop policy if exists "etho bot_users policy" on bot_users;
create policy "etho bot_users policy" on bot_users for all using (true) with check (true);

drop policy if exists "etho bot_groups policy" on bot_groups;
create policy "etho bot_groups policy" on bot_groups for all using (true) with check (true);

drop policy if exists "etho bot_leads policy" on bot_leads;
create policy "etho bot_leads policy" on bot_leads for all using (true) with check (true);

drop policy if exists "etho bot_products policy" on bot_products;
create policy "etho bot_products policy" on bot_products for all using (true) with check (true);
