-- 05/11/2026, pedidos do Marcus (16h15): relatório do Omie para baixar com os números do dia, "Quem cobrar hoje"
-- e busca dentro da conversa.

-- 1. Retrato do Omie calculado na hora pela função painel-cr (só consulta no Omie). Guarda os totais (mesma conta do
--    programa financeiro.py v8 da tarefa das 16h11) e os atrasados de Honorários por cliente do Omie, para o PDF, a aba
--    Omie e o "Quem cobrar hoje" usarem o mesmo cálculo por alguns minutos sem consultar o Omie de novo.
create table if not exists public.omie_retratos (
  id bigint generated always as identity primary key,
  dia date not null,
  calculado_em timestamptz not null default now(),
  calculado_por text,
  status text not null check (status in ('completo', 'incompleto')),
  totais jsonb not null,
  atrasados jsonb not null default '[]'::jsonb -- [{cliente, qtd, valor, mais_antigo}]
);
create index if not exists omie_retratos_dia on public.omie_retratos (dia, calculado_em desc);
alter table public.omie_retratos enable row level security;
revoke all on public.omie_retratos from anon, authenticated;
-- Histórico: ninguém apaga nem altera pelo app (a função só lê e acrescenta).
grant select, insert on public.omie_retratos to service_role;
revoke update, delete, truncate on public.omie_retratos from service_role;

-- Texto sem acento e em minúsculas, para buscar "acao" e achar "ação".
create or replace function public.sem_acento(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
$$;

-- 2. Quem cobrar hoje: recebe os atrasados do retrato (por código do cliente no Omie) e devolve, por contato do WhatsApp,
--    quanto está em atraso, se já houve mensagem nossa hoje, a última mensagem nossa e do cliente, retorno marcado e se a
--    conversa está resolvida. Clientes do Omie sem número ligado no cadastro voltam só como contagem e soma.
create or replace function public.painel_quem_cobrar(p_atrasados jsonb, p_dia date)
returns jsonb language sql stable set search_path = '' as $$
  with a as (
    select (x->>'cliente')::bigint cliente, (x->>'qtd')::int qtd, (x->>'valor')::numeric valor, (x->>'mais_antigo')::date mais_antigo
    from jsonb_array_elements(coalesce(p_atrasados, '[]'::jsonb)) x
  ),
  liga as (
    select cc.contato_id, a.cliente, a.qtd, a.valor, a.mais_antigo, cc.empresa
    from a join public.contato_clientes cc on cc.codigo_cliente_omie = a.cliente
    join public.contatos c on c.id = cc.contato_id and c.situacao is distinct from 'nao_cliente'
  ),
  -- Um cliente do Omie ligado a dois números aparece nos dois, mas a soma de cada número conta cada cliente uma vez.
  por_contato as (
    select contato_id, sum(qtd)::int qtd, sum(valor) valor, min(mais_antigo) mais_antigo,
      jsonb_agg(distinct empresa) empresas
    from (select distinct on (contato_id, cliente) * from liga) l group by contato_id
  ),
  msgs as (
    select m.contato_id,
      max(m.enviada_em) filter (where m.de_nos) ultima_nossa,
      max(m.enviada_em) filter (where not m.de_nos) ultima_cliente,
      bool_or(m.de_nos and (m.enviada_em at time zone 'America/Sao_Paulo')::date = p_dia) falou_hoje
    from public.mensagens m join por_contato p on p.contato_id = m.contato_id
    where m.grupo is not true
    group by m.contato_id
  ),
  sem_numero as (
    select count(*) n, coalesce(sum(valor), 0) valor from a
    where not exists (select 1 from liga l where l.cliente = a.cliente)
  )
  select jsonb_build_object(
    'dia', p_dia,
    'contatos', coalesce((select jsonb_agg(jsonb_build_object(
        'contato_id', p.contato_id,
        'nome', coalesce(nullif(c.nome_whatsapp, ''), c.telefone),
        'empresas', p.empresas,
        'qtd', p.qtd, 'valor', p.valor, 'mais_antigo', p.mais_antigo,
        'dias_atraso', p_dia - p.mais_antigo,
        'falou_hoje', coalesce(m.falou_hoje, false),
        'ultima_nossa', m.ultima_nossa, 'ultima_cliente', m.ultima_cliente,
        'retorno', (select jsonb_build_object('dia', l.dia, 'hora', l.hora) from public.lembretes l
                    where l.contato_id = p.contato_id and l.feito_em is null and l.cancelado_em is null order by l.dia, l.hora limit 1),
        'resolvida', exists (select 1 from public.resolucoes r where r.contato_id = p.contato_id
                             and r.em > coalesce(m.ultima_cliente, '-infinity'::timestamptz))
      ) order by p.valor desc) from por_contato p join public.contatos c on c.id = p.contato_id left join msgs m on m.contato_id = p.contato_id), '[]'::jsonb),
    'sem_numero', (select jsonb_build_object('clientes', n, 'valor', valor) from sem_numero)
  );
$$;
revoke all on function public.painel_quem_cobrar(jsonb, date) from public, anon, authenticated;
grant execute on function public.painel_quem_cobrar(jsonb, date) to service_role;

-- 3. Busca dentro da conversa: texto e nome de arquivo das mensagens guardadas do contato, sem diferença de acento e de
--    maiúsculas. Devolve as mais recentes primeiro, com o texto inteiro (a tela recorta em volta do termo).
create or replace function public.painel_buscar_conversa(p_contato bigint, p_q text, p_limite int default 50)
returns jsonb language sql stable set search_path = '' as $$
  with termo as (
    select '%' || replace(replace(replace(public.sem_acento(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' padrao
  ), achadas as (
    select m.id, m.enviada_em, m.de_nos, m.texto, m.nome_arquivo, m.tipo
    from public.mensagens m, termo t
    where m.contato_id = p_contato and m.grupo is not true and length(btrim(coalesce(p_q, ''))) >= 2
      and (public.sem_acento(m.texto) like t.padrao or public.sem_acento(m.nome_arquivo) like t.padrao)
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
grant execute on function public.sem_acento(text) to service_role;
