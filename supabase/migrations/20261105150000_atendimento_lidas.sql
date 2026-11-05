-- Atendimento: cada cliente esperando resposta diz se a última mensagem dele já foi aberta (lida).
-- O contador da aba conta só as não lidas: quem leu e não respondeu pode ser uma conversa encerrada
-- (ex.: "obrigado"). A fila mostra as não lidas primeiro. Só muda painel_atendimento.
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
      round(extract(epoch from (now() - u.enviada_em)) / 60.0)::int minutos,
      -- A última mensagem do cliente já foi aberta por nós? (status READ ou PLAYED vem da Evolution;
      -- null = mensagem importada, sem status conhecido)
      (select case when s.status is null then null else s.status in ('READ','PLAYED') end
         from public.mensagens s
        where s.contato_id = u.contato_id and not s.de_nos and not s.grupo and s.enviada_em = u.enviada_em
        order by (s.status is null) limit 1) lida
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
        'desde', to_char(enviada_em at time zone 'America/Sao_Paulo','HH24:MI'), 'minutos', minutos, 'texto', texto, 'lida', lida)
        order by coalesce(lida, false), enviada_em), '[]'::jsonb) from espera),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'cliente', cli, 'nos', nos) order by h), '[]'::jsonb)
      from (select extract(hour from enviada_em at time zone 'America/Sao_Paulo')::int h,
                   count(*) filter (where not de_nos) cli, count(*) filter (where de_nos) nos
            from m group by 1) x)
  );
$$;
