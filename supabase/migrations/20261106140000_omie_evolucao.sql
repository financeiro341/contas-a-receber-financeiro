-- 06/11/2026, aba Omie no visual novo (aprovado pelo Marcus): "Inadimplência do mês, dia a dia" e "Entrou no caixa hoje"
-- usam os totais de cada relatório das 17h30 (relatorios_dia). 'evolucao' devolve os 25 relatórios mais novos (um mês de
-- dias úteis), do mais antigo para o mais novo. O resto da função não muda. Só leitura.
create or replace function public.painel_omie()
returns jsonb language sql stable set search_path to '' as $$
  with ult as (select dia, dados, gravado_em from public.relatorios_dia order by dia desc limit 1)
  select jsonb_build_object(
    'dia', (select dia from ult),
    'gravado_em', (select gravado_em from ult),
    'financeiro', (select dados->'financeiro' from ult),
    'evolucao', (select coalesce(jsonb_agg(e.x order by e.dia), '[]'::jsonb) from (
        select r.dia, jsonb_build_object('dia', r.dia,
          'inadimplencia_total', (f->>'inadimplencia_total')::numeric,
          'inadimplencia_mes', (f->>'inadimplencia_mes')::numeric, 'titulos_inadimplentes_mes', (f->>'titulos_inadimplentes_mes')::int,
          'recebido_no_mes', (f->>'recebido_no_mes')::numeric, 'titulos_recebidos_no_mes', (f->>'titulos_recebidos_no_mes')::int,
          'inicio_mes', f->>'inicio_mes') x
        from public.relatorios_dia r cross join lateral (select r.dados->'financeiro' f) ff
        where f is not null and jsonb_typeof(f) = 'object'
        order by r.dia desc limit 25) e),
    'atrasos', (select coalesce(jsonb_agg(x order by (x->>'atraso_valor')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('contato_id', s.contato_id, 'nome', coalesce(nullif(c.nome_whatsapp,''), c.telefone),
          'empresas', (select coalesce(jsonb_agg(distinct cc.empresa), '[]'::jsonb) from public.contato_clientes cc where cc.contato_id = s.contato_id),
          'atraso_qtd', s.atraso_qtd, 'atraso_valor', s.atraso_valor, 'situacao', s.situacao) x
        from public.situacao_do_dia s join public.contatos c on c.id = s.contato_id
        where s.dia = (select dia from ult) and s.atraso_valor > 0
        order by s.atraso_valor desc limit 40) y)
  );
$$;
