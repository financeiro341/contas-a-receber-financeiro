-- 05/11/2026, ressalvas da revisão de segurança da consulta do Omie na hora:
-- 1. omie_retratos passa a guardar também a trava ("calculando": alguém está consultando o Omie; um cálculo por vez para
--    todo o sistema) e a falha ("erro": 2 minutos sem tentar de novo), para o Omie não receber consultas repetidas.
alter table public.omie_retratos drop constraint if exists omie_retratos_status_check;
alter table public.omie_retratos add constraint omie_retratos_status_check
  check (status in ('calculando', 'completo', 'incompleto', 'erro'));

-- 2. sem_acento só para a função (como as outras).
revoke all on function public.sem_acento(text) from public, anon, authenticated;
grant execute on function public.sem_acento(text) to service_role;

-- 3. Busca: o escape do LIKE fica explícito.
create or replace function public.painel_buscar_conversa(p_contato bigint, p_q text, p_limite int default 50)
returns jsonb language sql stable set search_path = '' as $$
  with termo as (
    select '%' || replace(replace(replace(public.sem_acento(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' padrao
  ), achadas as (
    select m.id, m.enviada_em, m.de_nos, m.texto, m.nome_arquivo, m.tipo
    from public.mensagens m, termo t
    where m.contato_id = p_contato and m.grupo is not true and length(btrim(coalesce(p_q, ''))) >= 2
      and (public.sem_acento(m.texto) like t.padrao escape '\' or public.sem_acento(m.nome_arquivo) like t.padrao escape '\')
    order by m.enviada_em desc
    limit least(greatest(coalesce(p_limite, 50), 1), 100) + 1
  )
  select jsonb_build_object(
    'resultados', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'em', enviada_em, 'nos', de_nos,
        'texto', left(texto, 2000), 'arquivo', nome_arquivo, 'tipo', tipo) order by enviada_em desc)
      from (select * from achadas order by enviada_em desc limit least(greatest(coalesce(p_limite, 50), 1), 100)) x), '[]'::jsonb),
    'mais', (select count(*) from achadas) > least(greatest(coalesce(p_limite, 50), 1), 100)
  );
$$;
revoke all on function public.painel_buscar_conversa(bigint, text, int) from public, anon, authenticated;
grant execute on function public.painel_buscar_conversa(bigint, text, int) to service_role;
