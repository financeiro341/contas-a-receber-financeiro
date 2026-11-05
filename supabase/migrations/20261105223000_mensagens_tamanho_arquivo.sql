-- Revisão de segurança de 05/11/2026: antes de pedir uma mídia à Evolution, a função painel-cr confere o
-- tamanho do arquivo (o WhatsApp aceita documentos de até 2 GB, e baixar um desses derrubaria a Evolution
-- que também serve ao PayBot). O tamanho vem do próprio aviso da mensagem (fileLength) e é gravado aqui.
alter table public.mensagens add column if not exists tamanho_arquivo bigint;

-- fileLength chega como número, texto ou { low, high } (inteiro de 64 bits partido em dois).
create or replace function public.tamanho_do_aviso(v jsonb)
returns bigint language sql immutable set search_path to '' as $$
  select case jsonb_typeof(v)
    when 'number' then (v #>> '{}')::numeric::bigint
    when 'string' then case when (v #>> '{}') ~ '^\d{1,15}$' then (v #>> '{}')::bigint end
    when 'object' then case when (v->>'low') ~ '^-?\d+$' then
      ((v->>'low')::bigint & 4294967295) + coalesce(nullif(v->>'high', '')::bigint, 0) * 4294967296 end
  end;
$$;
revoke all on function public.tamanho_do_aviso(jsonb) from public, anon, authenticated;
grant execute on function public.tamanho_do_aviso(jsonb) to service_role;

-- Preenche com os avisos ainda guardados (últimos 7 dias).
update public.mensagens m set tamanho_arquivo = x.tam
from (
  select distinct on (a.payload->'data'->'key'->>'id') a.payload->'data'->'key'->>'id' id,
    public.tamanho_do_aviso(coalesce(
      a.payload->'data'->'message'->'imageMessage'->'fileLength',
      a.payload->'data'->'message'->'documentMessage'->'fileLength',
      a.payload->'data'->'message'->'audioMessage'->'fileLength',
      a.payload->'data'->'message'->'videoMessage'->'fileLength',
      a.payload->'data'->'message'->'stickerMessage'->'fileLength',
      a.payload->'data'->'message'->'documentWithCaptionMessage'->'message'->'documentMessage'->'fileLength')) tam
  from public.avisos_recebidos a
  where a.evento = 'messages.upsert'
  order by a.payload->'data'->'key'->>'id', a.id desc
) x
where x.id = m.id and x.tam is not null and m.tamanho_arquivo is null;
