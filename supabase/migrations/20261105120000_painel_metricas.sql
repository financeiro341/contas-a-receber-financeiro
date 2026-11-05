-- Sistema do contas a receber (05/11/2026): dados que o painel mostra.
-- Leitura só pela função painel-cr (chave de serviço); nada aberto para anon/authenticated.

-- 1) Omie por cliente cobrado, gravado pelo relatório paralelo junto com a situação.
alter table public.situacao_do_dia
  add column if not exists atraso_qtd integer,
  add column if not exists atraso_valor numeric(14,2),
  add column if not exists valor_pago numeric(14,2);

-- 2) O relatório do dia inteiro (o mesmo dia.json do link), com os totais do Omie.
create table if not exists public.relatorios_dia (
  dia date primary key,
  origem text not null default 'paralelo',
  dados jsonb not null,
  gravado_em timestamptz not null default now()
);
alter table public.relatorios_dia enable row level security;
revoke all on public.relatorios_dia from anon, authenticated;
grant select, insert, update on public.relatorios_dia to service_role;

-- 3) Mensagens de clientes de um dia (base das métricas).
create or replace function public.painel_msgs(p_dia date)
returns table(contato_id bigint, de_nos boolean, tipo text, enviada_em timestamptz, conteudo text)
language sql stable set search_path to '' as $$
  select m.contato_id, m.de_nos, m.tipo, m.enviada_em,
         coalesce(m.texto,'') || ' ' || coalesce(m.nome_arquivo,'')
  from public.mensagens m
  join public.contatos c on c.id = m.contato_id and c.situacao = 'cliente'
  where not m.grupo
    and m.tipo is distinct from 'reactionMessage'
    and m.tipo is distinct from 'protocolMessage'
    and m.enviada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
    and m.enviada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo');
$$;

-- 4) Cobrança do dia: situação de cada cliente cobrado.
-- Vale a leitura do Claude (situacao_do_dia, gravada pelo paralelo às 17h31); antes disso, as regras ao vivo.
create or replace function public.painel_dia(p_dia date)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  v_claude boolean;
  v_out jsonb;
begin
  select exists(select 1 from public.situacao_do_dia s where s.dia = p_dia and s.classificado_por in ('claude','manual'))
    into v_claude;

  with base as (
    select s.contato_id, s.situacao, s.motivo, s.atraso_qtd, s.atraso_valor, s.valor_pago
    from public.situacao_do_dia s
    where v_claude and s.dia = p_dia and s.teve_cobranca
    union all
    select r.contato_id, r.situacao, r.motivo, null::int, null::numeric, null::numeric
    from public.situacao_por_regras(p_dia, time '23:59:59') r
    where not v_claude
  ), m as (
    select * from public.painel_msgs(p_dia)
  ), mc as (
    select m.contato_id,
      count(*)::int mensagens,
      count(*) filter (where not m.de_nos)::int do_cliente,
      count(*) filter (where m.de_nos and m.tipo = 'documentMessage' and m.conteudo ~* '(boleto|contas a receber)')::int boletos,
      min(m.enviada_em) primeira, max(m.enviada_em) ultima
    from m group by 1
  ), lg as (
    select l.contato_id,
      count(*)::int ligacoes,
      count(*) filter (where l.resultado = 'atendida')::int atendidas,
      count(*) filter (where l.direcao = 'feita')::int feitas
    from public.ligacoes l
    join public.contatos c on c.id = l.contato_id and c.situacao = 'cliente'
    where l.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
      and l.iniciada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')
      and (l.fonte = 'chrome' or not exists (select 1 from public.ligacoes x where x.fonte = 'chrome'
            and x.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
            and x.iniciada_em < ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')))
    group by 1
  ), cl as (
    select b.contato_id, b.situacao, b.motivo, b.atraso_qtd, b.atraso_valor, b.valor_pago,
      coalesce(nullif(c.nome_whatsapp,''), c.telefone) nome,
      (select coalesce(jsonb_agg(distinct cc.empresa), '[]'::jsonb) from public.contato_clientes cc where cc.contato_id = b.contato_id) empresas,
      coalesce(mc.mensagens,0) mensagens, coalesce(mc.do_cliente,0) do_cliente, coalesce(mc.boletos,0) boletos,
      mc.primeira, mc.ultima,
      coalesce(lg.ligacoes,0) ligacoes, coalesce(lg.atendidas,0) lig_atendidas
    from base b
    join public.contatos c on c.id = b.contato_id
    left join mc on mc.contato_id = b.contato_id
    left join lg on lg.contato_id = b.contato_id
    where b.situacao is not null
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
          'fonte', case when exists(select 1 from public.ligacoes x where x.fonte='chrome'
                 and x.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
                 and x.iniciada_em < ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')) then 'chrome' else 'evolution' end)
        from lg),
      'atraso_total', (select sum(atraso_valor) from cl),
      'pago_informado', (select sum(valor_pago) from cl)
    ),
    'clientes', (select coalesce(jsonb_agg(jsonb_build_object(
        'contato_id', contato_id, 'nome', nome, 'empresas', empresas, 'situacao', situacao, 'motivo', motivo,
        'mensagens', mensagens, 'do_cliente', do_cliente, 'boletos', boletos, 'ligacoes', ligacoes, 'lig_atendidas', lig_atendidas,
        'primeira', to_char(primeira at time zone 'America/Sao_Paulo','HH24:MI'), 'ultima', to_char(ultima at time zone 'America/Sao_Paulo','HH24:MI'),
        'atraso_qtd', atraso_qtd, 'atraso_valor', atraso_valor, 'valor_pago', valor_pago)
        order by case situacao when 'sem_retorno' then 1 when 'respondeu_sem_pagar' then 2 when 'prometeu' then 3
          when 'disse_que_pagou' then 4 when 'pagou_parcial' then 5 when 'pagou' then 6 else 7 end, atraso_valor desc nulls last, nome), '[]'::jsonb) from cl)
  ) into v_out;
  return v_out;
end $$;

-- 5) Atendimento: primeira resposta, quem espera resposta, volume por hora (só clientes).
create or replace function public.painel_atendimento(p_dia date)
returns jsonb language sql stable set search_path to '' as $$
  with m as (
    select *, lag(de_nos) over (partition by contato_id order by enviada_em) ant_nos
    from public.painel_msgs(p_dia)
  ), blocos as (
    -- cada mensagem do cliente que abre um bloco (antes dela, nada hoje ou mensagem nossa)
    select b.contato_id, b.enviada_em ini,
      (select min(r.enviada_em) from m r where r.contato_id = b.contato_id and r.de_nos and r.enviada_em > b.enviada_em) resp
    from m b where not b.de_nos and (b.ant_nos is null or b.ant_nos)
  ), t as (
    select contato_id, ini, resp, extract(epoch from (resp - ini)) / 60.0 minutos from blocos
  ), ultima as (
    select distinct on (contato_id) contato_id, de_nos, enviada_em, conteudo from m order by contato_id, enviada_em desc
  ), espera as (
    select u.contato_id, coalesce(nullif(c.nome_whatsapp,''), c.telefone) nome, u.enviada_em,
      left(regexp_replace(u.conteudo, '\s+', ' ', 'g'), 140) texto,
      round(extract(epoch from (now() - u.enviada_em)) / 60.0)::int minutos
    from ultima u join public.contatos c on c.id = u.contato_id
    where not u.de_nos
  ), conv as (
    select contato_id, min(enviada_em) p, max(enviada_em) u, count(*) n from m group by 1
  )
  select jsonb_build_object(
    'dia', p_dia,
    'conversas', (select count(*) from conv),
    'mensagens_cliente', (select count(*) from m where not de_nos),
    'mensagens_nossas', (select count(*) from m where de_nos),
    'blocos', (select count(*) from t),
    'respondidos', (select count(*) from t where resp is not null),
    'primeira_resposta_media_min', (select round(avg(minutos))::int from t where resp is not null),
    'primeira_resposta_mediana_min', (select round((percentile_cont(0.5) within group (order by minutos))::numeric)::int from t where resp is not null),
    'faixas', jsonb_build_object(
      'ate_15', (select count(*) from t where minutos <= 15),
      'ate_60', (select count(*) from t where minutos > 15 and minutos <= 60),
      'ate_240', (select count(*) from t where minutos > 60 and minutos <= 240),
      'mais_240', (select count(*) from t where minutos > 240),
      'sem_resposta', (select count(*) from t where resp is null)),
    'tempo_conversa_medio_min', (select round(avg(extract(epoch from (u - p)) / 60.0))::int from conv where n > 1),
    'aguardando', (select coalesce(jsonb_agg(jsonb_build_object('contato_id', contato_id, 'nome', nome,
        'desde', to_char(enviada_em at time zone 'America/Sao_Paulo','HH24:MI'), 'minutos', minutos, 'texto', texto)
        order by enviada_em), '[]'::jsonb) from espera),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'cliente', cli, 'nos', nos) order by h), '[]'::jsonb)
      from (select extract(hour from enviada_em at time zone 'America/Sao_Paulo')::int h,
                   count(*) filter (where not de_nos) cli, count(*) filter (where de_nos) nos
            from m group by 1) x)
  );
$$;

-- 6) Histórico por dia (dias úteis com movimento).
create or replace function public.painel_historico(p_de date, p_ate date)
returns jsonb language plpgsql stable set search_path to '' as $$
declare d date; v jsonb := '[]'::jsonb; dj jsonb; aj jsonb;
begin
  if p_ate - p_de > 62 then p_de := p_ate - 62; end if;
  d := p_de;
  while d <= p_ate loop
    if extract(isodow from d) < 6 then
      dj := public.painel_dia(d);
      if (dj->'resumo'->>'cobrados')::int > 0 then
        aj := public.painel_atendimento(d);
        v := v || jsonb_build_array(jsonb_build_object(
          'dia', d, 'fonte', dj->>'fonte',
          'cobrados', dj->'resumo'->'cobrados', 'responderam', dj->'resumo'->'responderam',
          'sem_resposta', dj->'resumo'->'sem_resposta', 'por_situacao', dj->'resumo'->'por_situacao',
          'boletos', dj->'resumo'->'boletos_enviados', 'ligacoes', dj->'resumo'->'ligacoes'->'total',
          'conversas', aj->'conversas', 'primeira_resposta_mediana_min', aj->'primeira_resposta_mediana_min',
          'sem_resposta_nossa', aj->'faixas'->'sem_resposta'));
      end if;
    end if;
    d := d + 1;
  end loop;
  return jsonb_build_object('de', p_de, 'ate', p_ate, 'dias', v,
    'recorrentes', (select coalesce(jsonb_agg(x order by x->>'dias' desc), '[]'::jsonb) from (
       select jsonb_build_object('contato_id', s.contato_id, 'nome', coalesce(nullif(c.nome_whatsapp,''), c.telefone),
              'dias', count(*), 'ultimo', max(s.dia)) x
       from public.situacao_do_dia s join public.contatos c on c.id = s.contato_id
       where s.dia between p_de and p_ate and s.situacao = 'sem_retorno'
       group by s.contato_id, c.nome_whatsapp, c.telefone having count(*) >= 2
       order by count(*) desc limit 20) y));
end $$;

-- 7) Conversa de um cliente num dia.
create or replace function public.painel_conversa(p_contato bigint, p_dia date)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'contato_id', p_contato,
    'nome', (select coalesce(nullif(nome_whatsapp,''), telefone) from public.contatos where id = p_contato),
    'empresas', (select coalesce(jsonb_agg(distinct empresa), '[]'::jsonb) from public.contato_clientes where contato_id = p_contato),
    'mensagens', (select coalesce(jsonb_agg(jsonb_build_object(
        'hora', to_char(m.enviada_em at time zone 'America/Sao_Paulo','HH24:MI'), 'nos', m.de_nos, 'tipo', m.tipo,
        'texto', left(coalesce(m.texto,''), 1200), 'arquivo', m.nome_arquivo) order by m.enviada_em), '[]'::jsonb)
      from public.mensagens m
      where m.contato_id = p_contato and not m.grupo and m.tipo is distinct from 'protocolMessage'
        and m.enviada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
        and m.enviada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')),
    'ligacoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'hora', to_char(l.iniciada_em at time zone 'America/Sao_Paulo','HH24:MI'), 'direcao', l.direcao,
        'resultado', l.resultado, 'duracao_seg', l.duracao_seg, 'fonte', l.fonte) order by l.iniciada_em), '[]'::jsonb)
      from public.ligacoes l where l.contato_id = p_contato
        and l.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
        and l.iniciada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')),
    'situacao', (select to_jsonb(s) - 'contato_id' from public.situacao_do_dia s where s.contato_id = p_contato and s.dia = p_dia)
  );
$$;

-- 8) Omie: o último relatório gravado (totais) e os maiores atrasos dos cobrados.
create or replace function public.painel_omie()
returns jsonb language sql stable set search_path to '' as $$
  with ult as (select dia, dados, gravado_em from public.relatorios_dia order by dia desc limit 1)
  select jsonb_build_object(
    'dia', (select dia from ult),
    'gravado_em', (select gravado_em from ult),
    'financeiro', (select dados->'financeiro' from ult),
    'atrasos', (select coalesce(jsonb_agg(x order by (x->>'atraso_valor')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('contato_id', s.contato_id, 'nome', coalesce(nullif(c.nome_whatsapp,''), c.telefone),
          'empresas', (select coalesce(jsonb_agg(distinct cc.empresa), '[]'::jsonb) from public.contato_clientes cc where cc.contato_id = s.contato_id),
          'atraso_qtd', s.atraso_qtd, 'atraso_valor', s.atraso_valor, 'situacao', s.situacao) x
        from public.situacao_do_dia s join public.contatos c on c.id = s.contato_id
        where s.dia = (select dia from ult) and s.atraso_valor > 0
        order by s.atraso_valor desc limit 40) y)
  );
$$;

revoke all on function public.painel_msgs(date), public.painel_dia(date), public.painel_atendimento(date),
  public.painel_historico(date,date), public.painel_conversa(bigint,date), public.painel_omie() from public, anon, authenticated;
grant execute on function public.painel_msgs(date), public.painel_dia(date), public.painel_atendimento(date),
  public.painel_historico(date,date), public.painel_conversa(bigint,date), public.painel_omie() to service_role;
