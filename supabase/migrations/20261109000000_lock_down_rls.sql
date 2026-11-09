-- Cierra el acceso público a las tablas de Etho en un proyecto ya existente.
-- Antes: políticas "using (true)" => cualquiera con la clave publishable podía leer/editar
-- bots (incluido el QR de vinculación), logs de mensajes, leads, etc.
-- Después: RLS activo sin políticas; solo el backend (SUPABASE_SERVICE_ROLE_KEY) accede.
-- Requisito previo: definir SUPABASE_SERVICE_ROLE_KEY en el servidor, o la sincronización dejará de funcionar.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'platform_users','bots','bot_logs','bot_custom_functions','bot_users','bot_groups','bot_leads','bot_products',
    'etho_clubs','etho_groups','etho_interactions','etho_inventory','etho_logs','etho_users'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy %I on public.%I', p.policyname, t);
      end loop;
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Borra los QR de vinculación ya replicados (el backend ya no los envía).
update public.bots set qr_code = null where qr_code is not null;

-- El backend ya no replica hashes de contraseña.
do $$ begin
  if to_regclass('public.platform_users') is not null then
    alter table public.platform_users alter column password_hash drop not null;
    update public.platform_users set password_hash = null;
  end if;
end $$;
