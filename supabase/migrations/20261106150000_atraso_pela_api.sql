-- 06/11/2026, pedido do Marcus (14h46): "essas partes em atraso no nosso painel, não dá para puxar via API também? tem
-- que depender dar 17:30?". A coluna "Em atraso" e o número "Em atraso no Omie" da Cobrança do dia, e a lista "Maiores
-- atrasos entre os cobrados" da aba Omie, passam a sair do cálculo que o próprio sistema faz na API do Omie (só consulta).
-- O cálculo (função painel-cr, consulta E) guarda em omie_retratos.atraso_clientes, por cliente do Omie, os títulos
-- ATRASADOS de todas as categorias e de todos os anos (a mesma base que o relatório das 17h30 usa por cliente).
-- Sem cálculo do dia com essa lista (dias antes de 06/11, ou leitura incompleta), vale o que o relatório gravou, como antes.
-- Só leitura; nada é apagado nem alterado nos dados.

alter table public.omie_retratos add column if not exists atraso_clientes jsonb; -- [{cliente, qtd, valor}] ou null
comment on column public.omie_retratos.atraso_clientes is
  'Em atraso por cliente do Omie (títulos ATRASADOS de todas as categorias e anos), da consulta E do painel-cr. null = não lido por inteiro.';

-- Em atraso por contato do WhatsApp, pelo último cálculo do dia que trouxe a lista inteira. Contato sem cliente do Omie
-- ligado no cadastro fica de fora (a tela mostra "sem dado"); contato ligado e sem atraso volta com zero.
create or replace function public.atraso_pela_api(p_dia date)
returns table(contato_id bigint, qtd int, valor numeric, calculado_em timestamptz)
language sql stable set search_path to '' as $$
  with r as (
    select o.atraso_clientes, o.calculado_em from public.omie_retratos o
    where o.dia = p_dia and jsonb_typeof(o.atraso_clientes) = 'array'
    order by o.calculado_em desc limit 1
  ), a as (
    select (x->>'cliente')::bigint cliente, (x->>'qtd')::int qtd, (x->>'valor')::numeric valor
    from r, jsonb_array_elements(r.atraso_clientes) x
  ), liga as (
    -- Um cliente do Omie ligado duas vezes ao mesmo número conta uma vez.
    select distinct on (cc.contato_id, cc.codigo_cliente_omie) cc.contato_id, cc.codigo_cliente_omie cliente
    from public.contato_clientes cc where cc.codigo_cliente_omie is not null
  )
  select l.contato_id, coalesce(sum(a.qtd), 0)::int, coalesce(sum(a.valor), 0), (select r.calculado_em from r)
  from liga l left join a on a.cliente = l.cliente
  where exists (select 1 from r)
  group by l.contato_id;
$$;
revoke all on function public.atraso_pela_api(date) from public, anon, authenticated;
grant execute on function public.atraso_pela_api(date) to service_role;

-- Cobrança do dia: igual à de 05/11 (resolver_retorno_ligacoes), com o atraso pela API quando houver cálculo do dia.
create or replace function public.painel_dia(p_dia date)
returns jsonb language plpgsql stable set search_path to '' as $function$
declare
  v_claude boolean;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_api timestamptz;
  v_out jsonb;
begin
  select exists(select 1 from public.situacao_do_dia s where s.dia = p_dia and s.classificado_por in ('claude','manual'))
    into v_claude;
  select o.calculado_em into v_api from public.omie_retratos o
    where o.dia = p_dia and jsonb_typeof(o.atraso_clientes) = 'array' order by o.calculado_em desc limit 1;

  with base as (
    select s.contato_id, s.situacao, s.motivo, s.atraso_qtd, s.atraso_valor, s.valor_pago
    from public.situacao_do_dia s
    where v_claude and s.dia = p_dia and s.teve_cobranca
    union all
    select r.contato_id, r.situacao, r.motivo, null::int, null::numeric, null::numeric
    from public.situacao_por_regras(p_dia, time '23:59:59') r
    where not v_claude
  ), api as (
    select * from public.atraso_pela_api(p_dia) where v_api is not null
  ), m as (
    select * from public.painel_msgs(p_dia)
  ), mc as (
    select m.contato_id,
      count(*)::int mensagens,
      count(*) filter (where not m.de_nos)::int do_cliente,
      count(*) filter (where m.de_nos and m.tipo = 'documentMessage' and m.conteudo ~* '(boleto|contas a receber)')::int boletos,
      min(m.enviada_em) primeira, max(m.enviada_em) ultima
    from m group by 1
  ), lv as (
    select l.* from public.ligacoes_validas(p_dia) l
    join public.contatos c on c.id = l.contato_id and c.situacao = 'cliente'
  ), lg as (
    select lv.contato_id,
      count(*)::int ligacoes,
      count(*) filter (where lv.resultado = 'atendida')::int atendidas,
      count(*) filter (where lv.direcao = 'feita')::int feitas
    from lv group by 1
  ), cl as (
    select b.contato_id, b.situacao, b.motivo,
      case when v_api is not null then api.qtd else b.atraso_qtd end atraso_qtd,
      case when v_api is not null then api.valor else b.atraso_valor end atraso_valor,
      b.valor_pago,
      coalesce(nullif(c.nome_whatsapp,''), c.telefone) nome,
      (select coalesce(jsonb_agg(distinct cc.empresa), '[]'::jsonb) from public.contato_clientes cc where cc.contato_id = b.contato_id) empresas,
      coalesce(mc.mensagens,0) mensagens, coalesce(mc.do_cliente,0) do_cliente, coalesce(mc.boletos,0) boletos,
      mc.primeira, mc.ultima,
      coalesce(lg.ligacoes,0) ligacoes, coalesce(lg.atendidas,0) lig_atendidas
    from base b
    join public.contatos c on c.id = b.contato_id
    left join mc on mc.contato_id = b.contato_id
    left join lg on lg.contato_id = b.contato_id
    left join api on api.contato_id = b.contato_id
    where b.situacao is not null
  ), rt as (
    select l.id, l.contato_id, l.dia, l.hora, l.texto, l.usuario_nome, l.feito_em, l.feito_por_nome,
      coalesce(nullif(c.nome_whatsapp,''), c.telefone, 'Sem nome') nome,
      (select coalesce(jsonb_agg(distinct cc.empresa), '[]'::jsonb) from public.contato_clientes cc where cc.contato_id = l.contato_id) empresas
    from public.lembretes l join public.contatos c on c.id = l.contato_id
    where l.cancelado_em is null
      and (l.dia = p_dia or (p_dia = v_hoje and l.dia < p_dia and l.feito_em is null))
  )
  select jsonb_build_object(
    'dia', p_dia,
    'fonte', case when v_claude then 'claude' else 'regras' end,
    'resumo', jsonb_build_object(
      'cobrados', (select count(*) from cl),
      'responderam', (select count(*) from cl where do_cliente > 0 or lig_atendidas > 0),
      'sem_resposta', (select count(*) from cl where do_cliente = 0 and lig_atendidas = 0),
      'por_situacao', (select coalesce(jsonb_object_agg(situacao, n), '{}'::jsonb) from (select situacao, count(*) n from cl group by 1) x),
      'boletos_enviados', (select coalesce(sum(boletos),0) from cl),
      'ligacoes', (select jsonb_build_object(
          'total', coalesce(sum(ligacoes),0), 'atendidas', coalesce(sum(atendidas),0),
          'nao_atendidas', coalesce(sum(ligacoes - atendidas),0), 'feitas', coalesce(sum(feitas),0),
          'registradas', (select count(*) from lv where lv.fonte = 'manual'),
          'automaticas', (select count(*) from lv where lv.fonte <> 'manual'),
          'fonte', case when exists(select 1 from lv where lv.fonte = 'manual') then 'sistema'
                        when exists(select 1 from lv where lv.fonte = 'chrome') then 'chrome' else 'evolution' end)
        from lg),
      'atraso_total', (select sum(atraso_valor) from cl),
      'atraso_fonte', case when v_api is not null then 'api' when v_claude then 'relatorio' end,
      'atraso_em', v_api,
      'pago_informado', (select sum(valor_pago) from cl)
    ),
    'clientes', (select coalesce(jsonb_agg(jsonb_build_object(
        'contato_id', contato_id, 'nome', nome, 'empresas', empresas, 'situacao', situacao, 'motivo', motivo,
        'mensagens', mensagens, 'do_cliente', do_cliente, 'boletos', boletos, 'ligacoes', ligacoes, 'lig_atendidas', lig_atendidas,
        'primeira', to_char(primeira at time zone 'America/Sao_Paulo','HH24:MI'), 'ultima', to_char(ultima at time zone 'America/Sao_Paulo','HH24:MI'),
        'atraso_qtd', atraso_qtd, 'atraso_valor', atraso_valor, 'valor_pago', valor_pago)
        order by case situacao when 'sem_retorno' then 1 when 'respondeu_sem_pagar' then 2 when 'prometeu' then 3
          when 'disse_que_pagou' then 4 when 'pagou_parcial' then 5 when 'pagou' then 6 else 7 end, atraso_valor desc nulls last, nome), '[]'::jsonb) from cl),
    'retornos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'contato_id', contato_id, 'nome', nome, 'empresas', empresas, 'dia', dia,
        'hora', to_char(hora, 'HH24:MI'), 'texto', texto, 'por', usuario_nome,
        'feito', feito_em is not null, 'feito_por', feito_por_nome, 'atrasado', dia < p_dia)
        order by (feito_em is not null), dia, hora nulls last, nome), '[]'::jsonb) from rt)
  ) into v_out;
  return v_out;
end $function$;
revoke all on function public.painel_dia(date) from public, anon, authenticated;
grant execute on function public.painel_dia(date) to service_role;

-- Aba Omie: "Maiores atrasos entre os cobrados" pela API quando hoje tem cálculo com a lista e cobrança; senão, como antes
-- (do último relatório gravado). Resto igual à de 06/11 (omie_evolucao).
create or replace function public.painel_omie()
returns jsonb language sql stable set search_path to '' as $$
  with ult as (select dia, dados, gravado_em from public.relatorios_dia order by dia desc limit 1),
  hj as (select (now() at time zone 'America/Sao_Paulo')::date dia),
  api_em as (select o.calculado_em from public.omie_retratos o, hj
             where o.dia = hj.dia and jsonb_typeof(o.atraso_clientes) = 'array' order by o.calculado_em desc limit 1),
  hoje_cl as (
    select x from hj, jsonb_array_elements(case when exists (select 1 from api_em)
                                             then public.painel_dia(hj.dia)->'clientes' else '[]'::jsonb end) x
    where (x->>'atraso_valor')::numeric > 0
  ),
  usa_api as (select exists (select 1 from hoje_cl) sim)
  select jsonb_build_object(
    'dia', (select dia from ult),
    'gravado_em', (select gravado_em from ult),
    'financeiro', (select dados->'financeiro' from ult),
    'evolucao', (select coalesce(jsonb_agg(e.x order by e.dia), '[]'::jsonb) from (
        select t.dia, jsonb_build_object('dia', t.dia, 'fonte', t.fonte,
          'inadimplencia_total', (t.f->>'inadimplencia_total')::numeric,
          'inadimplencia_mes', (t.f->>'inadimplencia_mes')::numeric, 'titulos_inadimplentes_mes', (t.f->>'titulos_inadimplentes_mes')::int,
          'recebido_no_mes', (t.f->>'recebido_no_mes')::numeric, 'titulos_recebidos_no_mes', (t.f->>'titulos_recebidos_no_mes')::int,
          'inicio_mes', t.f->>'inicio_mes') x
        from (
          select * from (select distinct on (o.dia) o.dia, o.totais f, 'api'::text fonte
                         from public.omie_retratos o where o.status = 'completo' and jsonb_typeof(o.totais) = 'object'
                         order by o.dia, o.calculado_em desc) ret
          union all
          select r.dia, r.dados->'financeiro', 'relatorio' from public.relatorios_dia r
          where jsonb_typeof(r.dados->'financeiro') = 'object'
            and not exists (select 1 from public.omie_retratos o where o.dia = r.dia and o.status = 'completo')
        ) t
        order by t.dia desc limit 25) e),
    'atrasos_fonte', case when (select sim from usa_api) then 'api' else 'relatorio' end,
    'atrasos_dia', case when (select sim from usa_api) then (select dia from hj) else (select dia from ult) end,
    'atrasos_em', case when (select sim from usa_api) then (select calculado_em from api_em) else (select gravado_em from ult) end,
    'atrasos', case when (select sim from usa_api) then
        (select coalesce(jsonb_agg(jsonb_build_object('contato_id', x->'contato_id', 'nome', x->'nome', 'empresas', x->'empresas',
            'atraso_qtd', x->'atraso_qtd', 'atraso_valor', x->'atraso_valor', 'situacao', x->'situacao')
            order by (x->>'atraso_valor')::numeric desc), '[]'::jsonb)
         from (select x from hoje_cl order by (x->>'atraso_valor')::numeric desc limit 40) y)
      else (select coalesce(jsonb_agg(x order by (x->>'atraso_valor')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('contato_id', s.contato_id, 'nome', coalesce(nullif(c.nome_whatsapp,''), c.telefone),
          'empresas', (select coalesce(jsonb_agg(distinct cc.empresa), '[]'::jsonb) from public.contato_clientes cc where cc.contato_id = s.contato_id),
          'atraso_qtd', s.atraso_qtd, 'atraso_valor', s.atraso_valor, 'situacao', s.situacao) x
        from public.situacao_do_dia s join public.contatos c on c.id = s.contato_id
        where s.dia = (select dia from ult) and s.atraso_valor > 0
        order by s.atraso_valor desc limit 40) y) end
  );
$$;
revoke all on function public.painel_omie() from public, anon, authenticated;
grant execute on function public.painel_omie() to service_role;
