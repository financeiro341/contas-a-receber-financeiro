-- 06/11/2026, aba Omie no visual novo (aprovado pelo Marcus): "Inadimplência do mês, dia a dia" e "Entrou no caixa hoje".
-- Decisão do Marcus (14h27): a aba usa os cálculos feitos pelo próprio sistema na API do Omie (omie_retratos, o último
-- completo de cada dia), sem depender da tarefa das 17h30. Para os dias sem cálculo guardado (antes de 05/11) usa o
-- relatório do dia (relatorios_dia). 'evolucao' devolve os 25 dias mais novos, do mais antigo para o mais novo.
-- O resto da função não muda. Só leitura.
create or replace function public.painel_omie()
returns jsonb language sql stable set search_path to '' as $$
  with ult as (select dia, dados, gravado_em from public.relatorios_dia order by dia desc limit 1)
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
    'atrasos', (select coalesce(jsonb_agg(x order by (x->>'atraso_valor')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('contato_id', s.contato_id, 'nome', coalesce(nullif(c.nome_whatsapp,''), c.telefone),
          'empresas', (select coalesce(jsonb_agg(distinct cc.empresa), '[]'::jsonb) from public.contato_clientes cc where cc.contato_id = s.contato_id),
          'atraso_qtd', s.atraso_qtd, 'atraso_valor', s.atraso_valor, 'situacao', s.situacao) x
        from public.situacao_do_dia s join public.contatos c on c.id = s.contato_id
        where s.dia = (select dia from ult) and s.atraso_valor > 0
        order by s.atraso_valor desc limit 40) y)
  );
$$;
