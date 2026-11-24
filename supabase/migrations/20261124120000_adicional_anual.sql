-- 24/11/2026, pedido do Marcus: aba Adicional Anual no sistema do contas a receber.
-- 1) adicional_retratos: a leitura do Omie dos títulos do adicional (só consulta), guardada e reaproveitada por 10 minutos,
--    como os retratos dos honorários (omie_retratos).
-- 2) adicional_anotacoes: a anotação manual opcional de cada cliente do Omie ("contestou", "empresa baixada"...), por cima
--    do que vem sozinho do Omie e do WhatsApp. Guarda quem escreveu e quando; apagar é escrever vazio.
-- 3) painel_adicional_whatsapp: para os clientes do Omie pedidos, os números de WhatsApp ligados a eles, a última
--    situação de cobrança no WhatsApp desde o começo da campanha, o retorno marcado e o boleto do adicional mandado
--    pelo PayBot (o texto "Referente a: Adicional Anual").
-- Nada é apagado nem alterado nos dados que já existem.

create table if not exists public.adicional_retratos (
  id bigint generated always as identity primary key,
  calculado_em timestamptz not null default now(),
  calculado_por text,
  status text not null check (status in ('calculando', 'completo', 'incompleto', 'erro')),
  dados jsonb not null default '{}'::jsonb
);
create index if not exists adicional_retratos_em on public.adicional_retratos (calculado_em desc);
alter table public.adicional_retratos enable row level security;
revoke all on public.adicional_retratos from anon, authenticated;

create table if not exists public.adicional_anotacoes (
  cliente_omie bigint primary key,
  texto text not null check (length(texto) between 1 and 500),
  usuario_id uuid,
  usuario_nome text,
  em timestamptz not null default now()
);
alter table public.adicional_anotacoes enable row level security;
revoke all on public.adicional_anotacoes from anon, authenticated;

create or replace function public.painel_adicional_whatsapp(p_clientes bigint[], p_desde date)
returns jsonb language plpgsql stable set search_path to '' as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_out jsonb;
begin
  with cc as (
    select distinct cc.codigo_cliente_omie cliente, cc.contato_id, cc.empresa
    from public.contato_clientes cc
    join public.contatos c on c.id = cc.contato_id and c.situacao is distinct from 'nao_cliente'
    where cc.codigo_cliente_omie = any(p_clientes)
  ), contatos_alvo as (
    select distinct contato_id from cc
  ), dias as (
    select d::date dia from generate_series(p_desde, v_hoje, interval '1 day') d
    where extract(isodow from d) < 6
  ), lidos as (
    -- Dias com a leitura do relatório (Claude ou manual): vale a situação gravada; os outros dias, as regras do banco.
    select distinct s.dia from public.situacao_do_dia s
    where s.dia between p_desde and v_hoje and s.classificado_por in ('claude', 'manual')
  ), sit as (
    select s.dia, s.contato_id, s.situacao, s.motivo
    from public.situacao_do_dia s join lidos l on l.dia = s.dia
    where s.teve_cobranca and s.contato_id in (select contato_id from contatos_alvo)
    union all
    select d.dia, r.contato_id, r.situacao, r.motivo
    from dias d cross join lateral public.situacao_por_regras(d.dia, time '23:59:59') r
    where d.dia not in (select dia from lidos) and r.contato_id in (select contato_id from contatos_alvo)
  ), ultima as (
    select distinct on (contato_id) contato_id, dia, situacao, motivo
    from sit where situacao is not null order by contato_id, dia desc
  ), boleto as (
    -- Boleto do adicional pelo PayBot: a mensagem nossa com "Referente a: Adicional Anual" (o status só avança).
    select distinct on (m.contato_id) m.contato_id, m.enviada_em, m.status,
      count(*) over (partition by m.contato_id) qtd
    from public.mensagens m
    where m.de_nos and not m.grupo and m.contato_id in (select contato_id from contatos_alvo)
      and m.enviada_em >= (p_desde::timestamp at time zone 'America/Sao_Paulo')
      and coalesce(m.texto, '') ~* 'referente a.{0,6}adicional anual'
    order by m.contato_id, m.enviada_em desc
  ), msgs as (
    select m.contato_id,
      max(m.enviada_em) filter (where m.de_nos) ultima_nossa,
      max(m.enviada_em) filter (where not m.de_nos) ultima_cliente
    from public.mensagens m
    where not m.grupo and m.contato_id in (select contato_id from contatos_alvo)
      and m.enviada_em >= (p_desde::timestamp at time zone 'America/Sao_Paulo')
    group by m.contato_id
  ), por_contato as (
    select ca.contato_id,
      jsonb_build_object(
        'contato_id', ca.contato_id,
        'nome', coalesce(nullif(c.nome_whatsapp, ''), c.telefone),
        'situacao', u.situacao, 'motivo', u.motivo, 'situacao_dia', u.dia,
        'ultima_nossa', ms.ultima_nossa, 'ultima_cliente', ms.ultima_cliente,
        'boleto_em', b.enviada_em, 'boleto_status', b.status, 'boletos', coalesce(b.qtd, 0),
        'retorno', (select jsonb_build_object('dia', l.dia, 'hora', to_char(l.hora, 'HH24:MI')) from public.lembretes l
                    where l.contato_id = ca.contato_id and l.feito_em is null and l.cancelado_em is null order by l.dia, l.hora limit 1)
      ) info
    from contatos_alvo ca
    join public.contatos c on c.id = ca.contato_id
    left join ultima u on u.contato_id = ca.contato_id
    left join boleto b on b.contato_id = ca.contato_id
    left join msgs ms on ms.contato_id = ca.contato_id
  )
  select jsonb_build_object(
    'desde', p_desde,
    'clientes', coalesce((
      select jsonb_object_agg(x.cliente::text, x.contatos) from (
        select cc.cliente, jsonb_agg(pc.info order by pc.contato_id) contatos
        from cc join por_contato pc on pc.contato_id = cc.contato_id
        group by cc.cliente
      ) x), '{}'::jsonb),
    'anotacoes', coalesce((
      select jsonb_object_agg(a.cliente_omie::text, jsonb_build_object('texto', a.texto, 'por', a.usuario_nome, 'em', a.em))
      from public.adicional_anotacoes a where a.cliente_omie = any(p_clientes)), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $function$;
revoke all on function public.painel_adicional_whatsapp(bigint[], date) from public, anon, authenticated;
grant execute on function public.painel_adicional_whatsapp(bigint[], date) to service_role;
