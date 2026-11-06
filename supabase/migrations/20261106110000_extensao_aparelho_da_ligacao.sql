-- 06/11/2026, teste da extensão de ligações no computador da Maria Clara (174), às 10h30:
-- 1) a versão 0.1.0 leu as 25 ligações do dia, mas gravou todas como "recebida" (o WhatsApp Web guarda o id da
--    ligação como texto "true_<chat>_<id>", e a extensão procurava o campo fromMe). A versão 0.2.0 corrige e usa
--    chaves novas ("ext-w-<id>"); as 25 linhas da 0.1.0 ficam ANULADAS (anulada_em), sem apagar, e a 0.2.0 grava de novo.
-- 2) o WhatsApp Web diz de qual aparelho saiu cada ligação feita (callCreator). Decisão do Marcus (06/11, 09h42):
--    a Maria Clara liga só pelo computador; então ligação feita de outro aparelho do mesmo número (celular, computador
--    do Marcus ou da Mariana) fica gravada, mas não conta na cobrança do dia.

alter table public.ligacoes add column if not exists deste_computador boolean;
comment on column public.ligacoes.deste_computador is
  'Só fonte extensao, ligação feita: true = saiu do computador onde está a extensão; false = de outro aparelho do mesmo número; null = recebida ou sem como saber.';

update public.ligacoes
   set anulada_em = now(), observacao = 'versão 0.1.0 da extensão gravou a direção errada; regravada pela 0.2.0'
 where fonte = 'extensao' and id_chamada not like 'ext-w-%' and anulada_em is null;

create or replace function public.extensao_gravar_ligacoes(p_aparelho bigint, p_linhas jsonb)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_novas int := 0;
  v_completadas int := 0;
begin
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 500 then
    raise exception 'lista inválida';
  end if;
  with ins as (
    insert into public.ligacoes (id_chamada, contato_id, remote_jid, direcao, resultado, video, iniciada_em, duracao_seg, fonte, aparelho_id, deste_computador)
    select x->>'id_chamada', nullif(x->>'contato_id', '')::bigint, x->>'remote_jid', x->>'direcao', x->>'resultado',
           coalesce((x->>'video')::boolean, false), (x->>'iniciada_em')::timestamptz, nullif(x->>'duracao_seg', '')::int,
           'extensao', p_aparelho, (x->>'deste_computador')::boolean
    from jsonb_array_elements(p_linhas) x
    where x->>'id_chamada' like 'ext-%'
    on conflict (id_chamada) do nothing
    returning 1
  ) select count(*) into v_novas from ins;
  with up as (
    update public.ligacoes l set
      resultado = case when l.resultado = 'desconhecido' then x.resultado else l.resultado end,
      duracao_seg = coalesce(l.duracao_seg, x.duracao_seg),
      atualizada_em = now()
    from (select y->>'id_chamada' id_chamada, y->>'resultado' resultado, nullif(y->>'duracao_seg', '')::int duracao_seg
          from jsonb_array_elements(p_linhas) y) x
    where l.id_chamada = x.id_chamada and l.fonte = 'extensao' and l.aparelho_id = p_aparelho
      and ((l.resultado = 'desconhecido' and x.resultado <> 'desconhecido') or (l.duracao_seg is null and x.duracao_seg is not null))
    returning 1
  ) select count(*) into v_completadas from up;
  return jsonb_build_object('novas', v_novas, 'completadas', v_completadas);
end;
$$;
revoke all on function public.extensao_gravar_ligacoes(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.extensao_gravar_ligacoes(bigint, jsonb) to service_role;

-- Ligações que contam: igual à de 06/11 10h, menos as feitas de outro aparelho lidas pela extensão.
create or replace function public.ligacoes_validas(p_dia date)
returns table(id bigint, contato_id bigint, direcao text, resultado text, fonte text, iniciada_em timestamptz, usuario_nome text)
language sql stable set search_path to '' as $$
  with d as (
    select l.* from public.ligacoes l
    where l.anulada_em is null
      and not (l.fonte = 'extensao' and l.direcao = 'feita' and l.deste_computador is false)
      and l.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
      and l.iniciada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), tem_chrome as (select exists (select 1 from d where d.fonte = 'chrome') sim),
  auto as (
    select a.* from d a where a.fonte = 'extensao'
    union all
    select a.* from d a where a.fonte = 'chrome'
      and not exists (select 1 from d e where e.fonte = 'extensao' and e.contato_id = a.contato_id and e.direcao = a.direcao
                      and abs(extract(epoch from (e.iniciada_em - a.iniciada_em))) <= 600)
    union all
    select a.* from d a cross join tem_chrome where a.fonte = 'evolution' and not tem_chrome.sim
      and not exists (select 1 from d e where e.fonte = 'extensao' and e.contato_id = a.contato_id and e.direcao = a.direcao
                      and abs(extract(epoch from (e.iniciada_em - a.iniciada_em))) <= 600)
  )
  select d.id, d.contato_id, d.direcao, d.resultado, d.fonte, d.iniciada_em, d.usuario_nome from d where d.fonte = 'manual'
  union all
  select a.id, a.contato_id, a.direcao, a.resultado, a.fonte, a.iniciada_em, a.usuario_nome
  from auto a
  where not exists (select 1 from d m where m.fonte = 'manual' and m.contato_id = a.contato_id
                    and abs(extract(epoch from (m.iniciada_em - a.iniciada_em))) <= 1800);
$$;
revoke all on function public.ligacoes_validas(date) from public, anon, authenticated;
grant execute on function public.ligacoes_validas(date) to service_role;
