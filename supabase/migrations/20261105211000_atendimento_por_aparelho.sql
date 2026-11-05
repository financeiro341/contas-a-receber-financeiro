-- Atendimento por pessoa (05/11/2026): o que sai direto pelo WhatsApp não diz quem enviou.
-- Em vez de um "Direto pelo WhatsApp" só, separa o WhatsApp Web (aparelho 'web') do celular
-- (os outros aparelhos). O que sai pelo sistema continua com o nome de quem enviou.
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
        order by (quem in ('WhatsApp Web', 'WhatsApp no celular')), respostas desc, enviadas desc, quem), '[]'::jsonb) from pp),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'cliente', cli, 'nos', nos) order by h), '[]'::jsonb)
      from (select extract(hour from enviada_em at time zone 'America/Sao_Paulo')::int h,
                   count(*) filter (where not de_nos) cli, count(*) filter (where de_nos) nos
            from m group by 1) x)
  );
$$;
