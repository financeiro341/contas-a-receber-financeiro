-- 06/11/2026, decisões do Marcus (15h12):
-- 1) Atendimento, tabela "Por pessoa": as ligações feitas pela extensão do Chrome contam para a pessoa do computador
--    da extensão (o nome do aparelho, sem o que vem entre parênteses: "Maria Clara (174)" vira "Maria Clara").
--    Antes só contavam as registradas pelo botão do sistema.
-- 2) "Cliente só ligado: sim, deve entrar": cliente para quem ligamos no dia entra em "Clientes cobrados", mesmo sem
--    mensagem. Vale nas regras (situacao_por_regras, usada na prévia e pela tarefa paralela) e, depois da leitura do
--    Claude, para quem só recebeu ligação e ficou fora dela.
-- Só leitura; nada é apagado nem alterado nos dados.

create or replace function public.situacao_por_regras(p_dia date, p_ate time without time zone default '17:00:00'::time without time zone)
returns table(contato_id bigint, nome text, telefone text, mensagens integer, nossas integer, do_cliente integer, boletos integer, cliente_mandou_arquivo boolean, situacao text, motivo text, precisa_leitura boolean, primeira timestamp with time zone, ultima timestamp with time zone)
language sql stable set search_path to '' as $function$
-- Regras de 05/11/2026 (decisões do Marcus): lembrete da Maria Clara sem boleto anexo conta como cobrança;
-- boleto enviado junto com outro assunto conta; pagamento de uma parte vira 'pagou_parcial'.
-- 06/11/2026 (decisão do Marcus, 15h12): cliente para quem ligamos entra como cobrado, mesmo sem mensagem no dia.
-- Ligação atendida sem mensagem do cliente vira 'respondeu_sem_pagar' (a conversa foi por telefone); não atendida, 'sem_retorno'.
with m as (
  select m.*, coalesce(m.texto, '') || ' ' || coalesce(m.nome_arquivo, '') as conteudo
  from public.mensagens m
  join public.contatos c on c.id = m.contato_id and c.situacao = 'cliente'
  where not m.grupo
    and m.enviada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
    and m.enviada_em < ((p_dia + p_ate)::timestamp at time zone 'America/Sao_Paulo')
    and coalesce(m.texto, '') !~* 'MENSALIDADE ADICIONAL ANUAL'
), x as (
  select m.contato_id,
    count(*)::int as mensagens,
    count(*) filter (where de_nos)::int as nossas,
    count(*) filter (where not de_nos and tipo is distinct from 'reactionMessage')::int as do_cliente,
    count(*) filter (where de_nos and tipo = 'documentMessage' and conteudo ~* '(boleto|contas a receber)')::int as boletos,
    bool_or(de_nos and tipo is distinct from 'documentMessage' and conteudo ~* '(honor[aá]rio.{0,20}n[aã]o foi regularizado|realizar o pagamento|previs[aã]o de pagamento|nos dar um retorno|valores em aberto|consegue regularizar|enviar o comprovante|seu boleto|boleto.{0,20}vencid|em aberto|pagamento)') as cobranca_texto,
    bool_or(de_nos
      and (conteudo ~* 'maria clara' or conteudo ~* 'entrando em contato para saber se (voc[eê] )?recebeu o boleto')
      and conteudo !~* 'segue os dados para o pagamento do seu boleto'
      and conteudo ~* '(boleto|vencimento|parcela|honor[aá]rio|pagamento|em aberto|regulariz|segunda via|2.? via)') as lembrete_maria,
    bool_or(not de_nos and conteudo ~* '(comprovante|pix|paguei|pago|pagamento|boleto|segunda via|2.? via|honor[aá]rio|vou pagar|consigo pagar|transferi|depositei)') as cliente_fala_pagamento,
    bool_or(not de_nos and tipo in ('imageMessage', 'documentMessage', 'documentWithCaptionMessage')) as cliente_mandou_arquivo,
    bool_or(not de_nos and conteudo ~* '(segue (o )?comprovante|comprovante|paguei|j[aá] (foi )?pago|pagamento (feito|realizado|efetuado)|pix (feito|enviado|realizado)|transferi|depositei)') as disse_que_pagou,
    bool_or(not de_nos and conteudo ~* '(uma parte|parte do|parcial|metade|restante|o resto|resto do|saldo|o que falta|completo (o|a) |complemento)') as fala_parte,
    bool_or(not de_nos and conteudo ~* '(vou pagar|vou fazer|vou realizar|vou efetuar|amanh[aã]|at[eé] (o )?(dia|final|fim)|semana que vem|pr[oó]xima semana|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|depois do dia|assim que|consigo pagar|posso pagar|dia \d{1,2})') as prometeu,
    min(enviada_em) as primeira, max(enviada_em) as ultima
  from m group by m.contato_id
), lg as (
  select l.contato_id, bool_or(l.resultado = 'atendida') as atendeu, min(l.iniciada_em) as primeira, max(l.iniciada_em) as ultima
  from public.ligacoes_validas(p_dia) l
  join public.contatos c on c.id = l.contato_id and c.situacao = 'cliente'
  where l.direcao = 'feita'
    and l.iniciada_em < ((p_dia + p_ate)::timestamp at time zone 'America/Sao_Paulo')
  group by l.contato_id
)
select x.contato_id, c.nome_whatsapp, c.telefone,
  x.mensagens, x.nossas, x.do_cliente, x.boletos, x.cliente_mandou_arquivo,
  case
    when x.do_cliente = 0 and lg.atendeu then 'respondeu_sem_pagar'
    when x.do_cliente = 0 and lg.contato_id is null and x.boletos > 0 and not x.cobranca_texto and not x.lembrete_maria then 'so_boleto'
    when x.do_cliente = 0 then 'sem_retorno'
    when (x.disse_que_pagou or (x.cliente_mandou_arquivo and x.cliente_fala_pagamento)) and x.fala_parte then 'pagou_parcial'
    when x.disse_que_pagou or (x.cliente_mandou_arquivo and x.cliente_fala_pagamento) then 'disse_que_pagou'
    when x.prometeu then 'prometeu'
    else 'respondeu_sem_pagar'
  end as situacao,
  case
    when x.do_cliente = 0 and lg.atendeu then 'atendeu a ligação e não escreveu (ver o que foi combinado)'
    when x.do_cliente = 0 and lg.contato_id is null and x.boletos > 0 and not x.cobranca_texto and not x.lembrete_maria then 'só recebeu o boleto automático'
    when x.do_cliente = 0 and lg.contato_id is not null then 'cobrado, ligamos e não atendeu, sem resposta'
    when x.do_cliente = 0 and x.lembrete_maria and not x.cobranca_texto and x.boletos = 0 then 'lembrete da Maria Clara sem boleto anexo e sem resposta'
    when x.do_cliente = 0 then 'cobrado e sem resposta'
    when (x.disse_que_pagou or (x.cliente_mandou_arquivo and x.cliente_fala_pagamento)) and x.fala_parte then 'cliente fala de pagamento de uma parte (conferir valor e saldo no Omie)'
    when x.disse_que_pagou or (x.cliente_mandou_arquivo and x.cliente_fala_pagamento) then 'cliente fala de pagamento feito ou mandou comprovante (conferir no Omie)'
    when x.prometeu then 'cliente fala de data ou intenção de pagar'
    else 'cliente respondeu sem falar de pagamento feito ou data'
  end as motivo,
  (x.do_cliente > 0) as precisa_leitura,
  x.primeira, x.ultima
from x join public.contatos c on c.id = x.contato_id
left join lg on lg.contato_id = x.contato_id
where x.boletos > 0 or x.cobranca_texto or x.lembrete_maria or x.cliente_fala_pagamento or lg.contato_id is not null
union all
-- Só ligação no dia, nenhuma mensagem.
select lg.contato_id, c.nome_whatsapp, c.telefone, 0, 0, 0, 0, false,
  case when lg.atendeu then 'respondeu_sem_pagar' else 'sem_retorno' end,
  case when lg.atendeu then 'só ligação: atendeu (ver o que foi combinado)' else 'só ligação: não atendeu' end,
  false, lg.primeira, lg.ultima
from lg join public.contatos c on c.id = lg.contato_id
where not exists (select 1 from x where x.contato_id = lg.contato_id);
$function$;
revoke all on function public.situacao_por_regras(date, time without time zone) from public, anon, authenticated;
grant execute on function public.situacao_por_regras(date, time without time zone) to service_role;

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
    union all
    -- Depois da leitura do Claude: o cliente que só recebeu ligação e ficou fora dela entra pelas regras (decisão do Marcus, 06/11).
    select r.contato_id, r.situacao, r.motivo, null::int, null::numeric, null::numeric
    from public.situacao_por_regras(p_dia, time '23:59:59') r
    where v_claude and r.mensagens = 0
      and not exists (select 1 from public.situacao_do_dia s where s.dia = p_dia and s.contato_id = r.contato_id)
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

create or replace function public.painel_atendimento(p_dia date)
returns jsonb language sql stable set search_path to '' as $$
  with m as (
    select *, lag(de_nos) over (partition by contato_id order by enviada_em) ant_nos
    from public.painel_msgs(p_dia)
  ), nossas as (
    select x.id, x.contato_id, x.enviada_em,
      coalesce((select e.usuario_nome from public.envios e where e.mensagem_id = x.id order by e.id desc limit 1),
               case when x.aparelho = 'web' then 'WhatsApp Web' else 'WhatsApp no celular' end) quem
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
    -- Registradas pelo botão: quem registrou. Feitas pela extensão do Chrome: a pessoa do computador da extensão
    -- (o nome do aparelho sem o que vem entre parênteses, por exemplo "Maria Clara (174)" vira "Maria Clara").
    select coalesce(lv.usuario_nome, nullif(trim(regexp_replace(ap.nome, '\s*\([^)]*\)\s*$', '')), '')) quem,
      count(*)::int n, count(*) filter (where lv.resultado = 'atendida')::int atendidas
    from public.ligacoes_validas(p_dia) lv
    join public.contatos c on c.id = lv.contato_id and c.situacao = 'cliente'
    left join public.ligacoes l on l.id = lv.id
    left join public.extensao_aparelhos ap on ap.id = l.aparelho_id
    where (lv.fonte = 'manual' and lv.usuario_nome is not null)
       or (lv.fonte = 'extensao' and lv.direcao = 'feita' and ap.nome is not null)
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
        order by (quem in ('WhatsApp Web', 'WhatsApp no celular')), respostas desc, enviadas desc, quem), '[]'::jsonb) from pp),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'cliente', cli, 'nos', nos) order by h), '[]'::jsonb)
      from (select extract(hour from enviada_em at time zone 'America/Sao_Paulo')::int h,
                   count(*) filter (where not de_nos) cli, count(*) filter (where de_nos) nos
            from m group by 1) x)
  );
$$;
revoke all on function public.painel_atendimento(date) from public, anon, authenticated;
grant execute on function public.painel_atendimento(date) to service_role;
