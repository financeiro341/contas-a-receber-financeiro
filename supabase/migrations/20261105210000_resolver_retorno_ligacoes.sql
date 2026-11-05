-- Caixa de entrada, 05/11/2026 (pedidos do Marcus, 13h48):
--  2) marcar a conversa como resolvida: sai de "Esperando" e da fila do Atendimento; volta sozinha
--     quando o cliente escreve de novo;
--  4) lembrete de retorno: data (e hora opcional) para voltar a falar com o cliente;
--  5) tempo de resposta por pessoa no Atendimento;
--  e ligações: o botão "Registrar ligação" vira a contagem oficial (decisão do Marcus: botão no
--  sistema, com a leitura do Chrome às 17h30 como conferência para o que ficar sem registro).
-- Tudo fechado para o navegador: só a chave de serviço da função painel-cr lê e grava.

-- 1) Conversa resolvida: vale enquanto não chega mensagem do cliente depois de "em".
create table public.resolucoes (
  contato_id bigint primary key references public.contatos(id),
  usuario_id uuid not null,
  usuario_nome text not null,
  em timestamptz not null default now()
);

-- 2) Lembretes de retorno. Não se apagam: ficam feitos ou cancelados.
create table public.lembretes (
  id bigserial primary key,
  contato_id bigint not null references public.contatos(id),
  dia date not null,
  hora time,
  texto text check (texto is null or length(texto) <= 500),
  usuario_id uuid not null,
  usuario_nome text not null,
  criado_em timestamptz not null default now(),
  feito_em timestamptz,
  feito_por uuid,
  feito_por_nome text,
  cancelado_em timestamptz,
  cancelado_por uuid
);
create index lembretes_abertos_idx on public.lembretes (dia) where feito_em is null and cancelado_em is null;
create index lembretes_contato_idx on public.lembretes (contato_id, dia);

-- 3) Ligações registradas pela equipe (fonte 'manual'): quem registrou, observação e anulação
-- (registro feito por engano não some: fica anulado).
alter table public.ligacoes
  add column if not exists usuario_id uuid,
  add column if not exists usuario_nome text,
  add column if not exists observacao text check (observacao is null or length(observacao) <= 500),
  add column if not exists anulada_em timestamptz,
  add column if not exists anulada_por uuid;

alter table public.resolucoes enable row level security;
alter table public.lembretes enable row level security;
revoke all on public.resolucoes, public.lembretes from anon, authenticated;
grant select, insert, update, delete on public.resolucoes to service_role;
grant select, insert, update on public.lembretes to service_role;
grant usage, select on sequence public.lembretes_id_seq to service_role;
revoke all on sequence public.lembretes_id_seq from anon, authenticated;

-- 4) Ligações que contam num dia: as registradas no sistema sempre; as automáticas (Chrome, ou a
-- Evolution quando não houve leitura do Chrome) só quando não há registro manual do mesmo contato
-- até 30 minutos antes ou depois, para não contar a mesma ligação duas vezes.
create or replace function public.ligacoes_validas(p_dia date)
returns table(id bigint, contato_id bigint, direcao text, resultado text, fonte text, iniciada_em timestamptz, usuario_nome text)
language sql stable set search_path to '' as $$
  with d as (
    select l.* from public.ligacoes l
    where l.anulada_em is null
      and l.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
      and l.iniciada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), auto as (
    select case when exists (select 1 from d where d.fonte = 'chrome') then 'chrome' else 'evolution' end f
  )
  select d.id, d.contato_id, d.direcao, d.resultado, d.fonte, d.iniciada_em, d.usuario_nome from d where d.fonte = 'manual'
  union all
  select a.id, a.contato_id, a.direcao, a.resultado, a.fonte, a.iniciada_em, a.usuario_nome
  from d a cross join auto
  where a.fonte = auto.f
    and not exists (select 1 from d m where m.fonte = 'manual' and m.contato_id = a.contato_id
                    and abs(extract(epoch from (m.iniciada_em - a.iniciada_em))) <= 1800);
$$;

-- 5) Cobrança do dia: igual à anterior, com as ligações de ligacoes_validas e os retornos do dia.
create or replace function public.painel_dia(p_dia date)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  v_claude boolean;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
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
end $$;

-- 6) Atendimento: igual ao anterior, mais
--   - conversa resolvida depois da última mensagem do cliente sai da fila "aguardando";
--   - bloco resolvido sem resposta conta como encerrado, não como "sem resposta";
--   - por_pessoa: quem deu a primeira resposta de cada bloco (envio pelo sistema = nome de quem
--     enviou; o que saiu direto pelo WhatsApp, celular ou WhatsApp Web, fica "Direto pelo WhatsApp"),
--     mensagens enviadas e ligações registradas por pessoa.
create or replace function public.painel_atendimento(p_dia date)
returns jsonb language sql stable set search_path to '' as $$
  with m as (
    select *, lag(de_nos) over (partition by contato_id order by enviada_em) ant_nos
    from public.painel_msgs(p_dia)
  ), nossas as (
    select x.id, x.contato_id, x.enviada_em,
      coalesce((select e.usuario_nome from public.envios e where e.mensagem_id = x.id order by e.id desc limit 1),
               'Direto pelo WhatsApp') quem
    from public.mensagens x
    join public.contatos c on c.id = x.contato_id and c.situacao = 'cliente'
    where x.de_nos and not x.grupo
      and x.tipo is distinct from 'reactionMessage' and x.tipo is distinct from 'protocolMessage'
      and x.enviada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
      and x.enviada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), blocos as (
    -- cada mensagem do cliente que abre um bloco (antes dela, nada hoje ou mensagem nossa)
    select b.contato_id, b.enviada_em ini, r.enviada_em resp, r.quem,
      exists (select 1 from public.resolucoes z where z.contato_id = b.contato_id and z.em >= b.enviada_em) resolvido
    from m b
    left join lateral (select n.enviada_em, n.quem from nossas n
                       where n.contato_id = b.contato_id and n.enviada_em > b.enviada_em
                       order by n.enviada_em limit 1) r on true
    where not b.de_nos and (b.ant_nos is null or b.ant_nos)
  ), t as (
    select contato_id, ini, resp, quem, resolvido, extract(epoch from (resp - ini)) / 60.0 minutos from blocos
  ), ultima as (
    select distinct on (contato_id) contato_id, de_nos, enviada_em, conteudo from m order by contato_id, enviada_em desc
  ), espera as (
    select u.contato_id, coalesce(nullif(c.nome_whatsapp,''), c.telefone) nome, u.enviada_em,
      left(regexp_replace(u.conteudo, '\s+', ' ', 'g'), 140) texto,
      round(extract(epoch from (now() - u.enviada_em)) / 60.0)::int minutos,
      (select case when s.status is null then null else s.status in ('READ','PLAYED') end
         from public.mensagens s
        where s.contato_id = u.contato_id and not s.de_nos and not s.grupo and s.enviada_em = u.enviada_em
        order by (s.status is null) limit 1) lida
    from ultima u join public.contatos c on c.id = u.contato_id
    where not u.de_nos
      and not exists (select 1 from public.resolucoes z where z.contato_id = u.contato_id and z.em >= u.enviada_em)
  ), conv as (
    select contato_id, min(enviada_em) p, max(enviada_em) u, count(*) n from m group by 1
  ), lig as (
    select lv.usuario_nome quem, count(*)::int n, count(*) filter (where lv.resultado = 'atendida')::int atendidas
    from public.ligacoes_validas(p_dia) lv
    join public.contatos c on c.id = lv.contato_id and c.situacao = 'cliente'
    where lv.fonte = 'manual' and lv.usuario_nome is not null
    group by 1
  ), pessoas as (
    select quem from t where resp is not null
    union select quem from nossas
    union select quem from lig
  ), pp as (
    select p.quem,
      (select count(*) from t where t.quem = p.quem and t.resp is not null)::int respostas,
      (select round((percentile_cont(0.5) within group (order by t.minutos))::numeric)::int from t where t.quem = p.quem and t.resp is not null) mediana,
      (select round(avg(t.minutos))::int from t where t.quem = p.quem and t.resp is not null) media,
      (select count(*) from t where t.quem = p.quem and t.resp is not null and t.minutos <= 15)::int ate_15,
      (select count(*) from nossas n where n.quem = p.quem)::int enviadas,
      coalesce((select l.n from lig l where l.quem = p.quem), 0) ligacoes,
      coalesce((select l.atendidas from lig l where l.quem = p.quem), 0) lig_atendidas
    from pessoas p
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
      'sem_resposta', (select count(*) from t where resp is null and not resolvido),
      'encerradas', (select count(*) from t where resp is null and resolvido)),
    'tempo_conversa_medio_min', (select round(avg(extract(epoch from (u - p)) / 60.0))::int from conv where n > 1),
    'aguardando', (select coalesce(jsonb_agg(jsonb_build_object('contato_id', contato_id, 'nome', nome,
        'desde', to_char(enviada_em at time zone 'America/Sao_Paulo','HH24:MI'), 'minutos', minutos, 'texto', texto, 'lida', lida)
        order by coalesce(lida, false), enviada_em), '[]'::jsonb) from espera),
    'por_pessoa', (select coalesce(jsonb_agg(jsonb_build_object('nome', quem, 'respostas', respostas, 'mediana_min', mediana,
        'media_min', media, 'ate_15', ate_15, 'enviadas', enviadas, 'ligacoes', ligacoes, 'lig_atendidas', lig_atendidas)
        order by (quem = 'Direto pelo WhatsApp'), respostas desc, enviadas desc, quem), '[]'::jsonb) from pp),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'cliente', cli, 'nos', nos) order by h), '[]'::jsonb)
      from (select extract(hour from enviada_em at time zone 'America/Sao_Paulo')::int h,
                   count(*) filter (where not de_nos) cli, count(*) filter (where de_nos) nos
            from m group by 1) x)
  );
$$;

-- 7) Lista da caixa: igual à anterior, mais resolvida e o próximo retorno. Entram também as
-- conversas com retorno marcado mesmo sem mensagem nos últimos p_dias.
create or replace function public.painel_caixa(p_dias int default 30)
returns jsonb language sql stable set search_path to '' as $$
  with base as (
    select m.contato_id, m.de_nos, m.enviada_em, m.status, m.tipo,
           coalesce(nullif(m.texto, ''), m.nome_arquivo, '') conteudo
    from public.mensagens m
    where not m.grupo and m.contato_id is not null
      and m.tipo is distinct from 'reactionMessage' and m.tipo is distinct from 'protocolMessage'
      and m.enviada_em >= now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 90))
  ), abertos as (
    select distinct on (l.contato_id) l.contato_id, l.id, l.dia, l.hora, l.texto, l.usuario_nome
    from public.lembretes l where l.feito_em is null and l.cancelado_em is null
    order by l.contato_id, l.dia, l.hora nulls last, l.id
  ), ult as (
    select distinct on (contato_id) contato_id, de_nos, enviada_em, tipo, conteudo
    from base order by contato_id, enviada_em desc
  ), ult_extra as (
    select distinct on (m.contato_id) m.contato_id, m.de_nos, m.enviada_em, m.tipo,
           coalesce(nullif(m.texto, ''), m.nome_arquivo, '') conteudo
    from public.mensagens m
    where m.contato_id in (select a.contato_id from abertos a where a.contato_id not in (select contato_id from ult))
      and not m.grupo and m.tipo is distinct from 'reactionMessage' and m.tipo is distinct from 'protocolMessage'
    order by m.contato_id, m.enviada_em desc
  ), todos as (
    select * from ult union all select * from ult_extra
  ), ult_cliente as (
    select contato_id, max(enviada_em) em from base where not de_nos group by 1
  ), ult_nossa as (
    select contato_id, max(enviada_em) em from base where de_nos group by 1
  ), sl as (
    select b.contato_id, count(*)::int n
    from base b left join ult_nossa n on n.contato_id = b.contato_id
    where not b.de_nos and (n.em is null or b.enviada_em > n.em)
      and b.status is not null and b.status not in ('READ', 'PLAYED')
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'contato_id', u.contato_id,
      'nome', coalesce(nullif(c.nome_whatsapp, ''), c.telefone, 'Sem nome'),
      'telefone', c.telefone,
      'situacao', c.situacao,
      'empresas', (select jsonb_agg(cc.empresa order by cc.empresa) from public.contato_clientes cc where cc.contato_id = u.contato_id),
      'ultima_em', u.enviada_em,
      'ultima_de_nos', u.de_nos,
      'ultima_tipo', u.tipo,
      'ultima_texto', left(regexp_replace(u.conteudo, '\s+', ' ', 'g'), 120),
      'sem_ler', coalesce(sl.n, 0),
      'resolvida', (r.contato_id is not null and (uc.em is null or r.em >= uc.em)),
      'resolvida_por', case when r.contato_id is not null and (uc.em is null or r.em >= uc.em) then r.usuario_nome end,
      'retorno', case when a.id is not null then jsonb_build_object('id', a.id, 'dia', a.dia, 'hora', to_char(a.hora, 'HH24:MI'),
                   'texto', a.texto, 'por', a.usuario_nome) end,
      'dono', (select jsonb_build_object('id', at.usuario_id, 'nome', at.usuario_nome) from public.atribuicoes at where at.contato_id = u.contato_id),
      'etiquetas', (select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor) order by e.nome)
                    from public.contato_etiquetas ce join public.etiquetas e on e.id = ce.etiqueta_id and e.apagada_em is null
                    where ce.contato_id = u.contato_id)
    ) order by u.enviada_em desc), '[]'::jsonb)
  from todos u join public.contatos c on c.id = u.contato_id
  left join sl on sl.contato_id = u.contato_id
  left join ult_cliente uc on uc.contato_id = u.contato_id
  left join public.resolucoes r on r.contato_id = u.contato_id
  left join abertos a on a.contato_id = u.contato_id;
$$;

-- 8) O que a conversa aberta mostra além das mensagens: resolvida, retornos e ligações recentes.
create or replace function public.painel_conversa_extras(p_contato bigint)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'resolucao', (select jsonb_build_object('por', r.usuario_nome, 'em', r.em,
                    'vale', not exists (select 1 from public.mensagens m where m.contato_id = r.contato_id and not m.de_nos
                                          and not m.grupo and m.enviada_em > r.em
                                          and m.tipo is distinct from 'reactionMessage' and m.tipo is distinct from 'protocolMessage'))
                  from public.resolucoes r where r.contato_id = p_contato),
    'lembretes', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'dia', l.dia, 'hora', to_char(l.hora, 'HH24:MI'),
                    'texto', l.texto, 'por', l.usuario_nome, 'por_id', l.usuario_id, 'em', l.criado_em,
                    'feito', l.feito_em is not null, 'feito_por', l.feito_por_nome, 'feito_em', l.feito_em)
                    order by (l.feito_em is not null), l.dia, l.hora nulls last), '[]'::jsonb)
                  from (select * from public.lembretes x where x.contato_id = p_contato and x.cancelado_em is null
                        order by (x.feito_em is not null), x.dia desc limit 10) l),
    'ligacoes', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'direcao', l.direcao, 'resultado', l.resultado,
                   'fonte', l.fonte, 'em', l.iniciada_em, 'por', l.usuario_nome, 'por_id', l.usuario_id, 'observacao', l.observacao)
                   order by l.iniciada_em desc), '[]'::jsonb)
                 from (select * from public.ligacoes x where x.contato_id = p_contato and x.anulada_em is null
                       order by x.iniciada_em desc limit 10) l)
  );
$$;

revoke all on function public.ligacoes_validas(date), public.painel_dia(date), public.painel_atendimento(date),
  public.painel_caixa(int), public.painel_conversa_extras(bigint) from public, anon, authenticated;
grant execute on function public.ligacoes_validas(date), public.painel_dia(date), public.painel_atendimento(date),
  public.painel_caixa(int), public.painel_conversa_extras(bigint) to service_role;
