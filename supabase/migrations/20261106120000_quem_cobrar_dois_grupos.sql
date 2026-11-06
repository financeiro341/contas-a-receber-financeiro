-- 06/11/2026, pedido do Marcus (10h13 e 10h18): a lista "Quem cobrar hoje" mistura dois grupos, com filtro:
--  1) Maiores dívidas: os 40 contatos que mais devem honorários, somando todos os anos (inclusive dívida antiga,
--     de antes de 01/01, que antes ficava de fora);
--  2) Dívidas do ano: quem tem honorário vencido de 01/01 até o dia da cobrança (o dia muda sozinho: hoje até 06/11,
--     amanhã até 07/11).
-- Os atrasados chegam do retrato do Omie com valor/qtd de todos os anos e valor_ano/qtd_ano. Retrato antigo (sem
-- valor_ano) só tinha o ano: valor_ano = valor.
create or replace function public.painel_quem_cobrar(p_atrasados jsonb, p_dia date)
returns jsonb language sql stable set search_path = '' as $$
  with a as (
    select (x->>'cliente')::bigint cliente, (x->>'qtd')::int qtd, (x->>'valor')::numeric valor, (x->>'mais_antigo')::date mais_antigo,
           coalesce((x->>'qtd_ano')::int, (x->>'qtd')::int) qtd_ano, coalesce((x->>'valor_ano')::numeric, (x->>'valor')::numeric) valor_ano
    from jsonb_array_elements(coalesce(p_atrasados, '[]'::jsonb)) x
  ),
  liga as (
    select cc.contato_id, a.cliente, a.qtd, a.valor, a.mais_antigo, a.qtd_ano, a.valor_ano, cc.empresa
    from a join public.contato_clientes cc on cc.codigo_cliente_omie = a.cliente
    join public.contatos c on c.id = cc.contato_id and c.situacao is distinct from 'nao_cliente'
  ),
  -- Um cliente do Omie ligado a dois números aparece nos dois, mas a soma de cada número conta cada cliente uma vez.
  por_contato as (
    select contato_id, sum(qtd)::int qtd, sum(valor) valor, min(mais_antigo) mais_antigo,
      sum(qtd_ano)::int qtd_ano, sum(valor_ano) valor_ano, jsonb_agg(distinct empresa) empresas
    from (select distinct on (contato_id, cliente) * from liga) l group by contato_id
  ),
  marcados as (
    select p.*, row_number() over (order by p.valor desc, p.contato_id) <= 40 maior, p.valor_ano > 0 do_ano
    from por_contato p
  ),
  lista as (select * from marcados where maior or do_ano),
  msgs as (
    select m.contato_id,
      max(m.enviada_em) filter (where m.de_nos) ultima_nossa,
      max(m.enviada_em) filter (where not m.de_nos) ultima_cliente,
      bool_or(m.de_nos and (m.enviada_em at time zone 'America/Sao_Paulo')::date = p_dia) falou_hoje
    from public.mensagens m join lista p on p.contato_id = m.contato_id
    where m.grupo is not true
    group by m.contato_id
  ),
  sem_numero as (
    select count(*) n, coalesce(sum(valor), 0) valor from a
    where not exists (select 1 from liga l where l.cliente = a.cliente)
  )
  select jsonb_build_object(
    'dia', p_dia,
    'maiores_n', 40,
    'contatos', coalesce((select jsonb_agg(jsonb_build_object(
        'contato_id', p.contato_id,
        'nome', coalesce(nullif(c.nome_whatsapp, ''), c.telefone),
        'empresas', p.empresas,
        'qtd', p.qtd, 'valor', p.valor, 'mais_antigo', p.mais_antigo,
        'qtd_ano', p.qtd_ano, 'valor_ano', p.valor_ano,
        'maior', p.maior, 'do_ano', p.do_ano,
        'dias_atraso', p_dia - p.mais_antigo,
        'falou_hoje', coalesce(m.falou_hoje, false),
        'ultima_nossa', m.ultima_nossa, 'ultima_cliente', m.ultima_cliente,
        'retorno', (select jsonb_build_object('dia', l.dia, 'hora', l.hora) from public.lembretes l
                    where l.contato_id = p.contato_id and l.feito_em is null and l.cancelado_em is null order by l.dia, l.hora limit 1),
        'resolvida', exists (select 1 from public.resolucoes r where r.contato_id = p.contato_id
                             and r.em > coalesce(m.ultima_cliente, '-infinity'::timestamptz))
      ) order by p.valor desc) from lista p join public.contatos c on c.id = p.contato_id left join msgs m on m.contato_id = p.contato_id), '[]'::jsonb),
    'sem_numero', (select jsonb_build_object('clientes', n, 'valor', valor) from sem_numero)
  );
$$;
revoke all on function public.painel_quem_cobrar(jsonb, date) from public, anon, authenticated;
grant execute on function public.painel_quem_cobrar(jsonb, date) to service_role;
