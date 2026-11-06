-- 06/11/2026, pedido do Marcus (09h43, "vamos começar a construir a extensão"): extensão do Chrome no computador
-- da Maria Clara (174) que lê as ligações do WhatsApp Web e grava aqui, sem o Claude e sem clique.
-- A Evolution não registra as ligações que nós fazemos (só avisa parte das recebidas), e a marca "Ligação de voz"
-- da conversa não é mensagem: cada aparelho desenha a sua a partir do histórico de ligações.

-- 1) Fonte nova das ligações.
alter table public.ligacoes drop constraint if exists ligacoes_fonte_check;
alter table public.ligacoes add constraint ligacoes_fonte_check
  check (fonte in ('evolution', 'chrome', 'manual', 'extensao'));
alter table public.ligacoes add column if not exists aparelho_id bigint;
alter table public.ligacoes add column if not exists atualizada_em timestamptz;

-- 2) Aparelhos com a extensão. O código de ligação é gerado no sistema por um administrador e mostrado uma vez;
-- aqui fica só o resumo sha256. Revogar = preencher revogado_em (nada é apagado).
create table if not exists public.extensao_aparelhos (
  id bigserial primary key,
  nome text not null check (length(nome) between 1 and 60),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  criado_por uuid not null,
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  revogado_em timestamptz,
  revogado_por uuid,
  ultimo_contato timestamptz,
  ultima_versao text check (ultima_versao is null or length(ultima_versao) <= 40),
  ultimo_resumo jsonb
);
alter table public.ligacoes
  drop constraint if exists ligacoes_aparelho_id_fkey,
  add constraint ligacoes_aparelho_id_fkey foreign key (aparelho_id) references public.extensao_aparelhos(id);

alter table public.extensao_aparelhos enable row level security;
revoke all on public.extensao_aparelhos from anon, authenticated;
grant select, insert, update on public.extensao_aparelhos to service_role;
grant usage, select on sequence public.extensao_aparelhos_id_seq to service_role;
revoke all on sequence public.extensao_aparelhos_id_seq from anon, authenticated;

-- 3) Ligações que contam num dia (revisão de segurança de 06/11: nenhuma fonte apaga a outra no dia inteiro).
-- As registradas no sistema contam sempre. A extensão conta sempre que não houver registro manual do mesmo contato
-- até 30 minutos antes ou depois. A leitura do Chrome (17h30) só conta o que a extensão não viu (mesmo contato e
-- direção até 10 minutos antes ou depois). O aviso da Evolution só entra quando o dia não teve leitura do Chrome e a
-- extensão não viu a mesma ligação. Assim, se o Chrome ficar fechado à tarde, o que a Evolution avisou continua.
create or replace function public.ligacoes_validas(p_dia date)
returns table(id bigint, contato_id bigint, direcao text, resultado text, fonte text, iniciada_em timestamptz, usuario_nome text)
language sql stable set search_path to '' as $$
  with d as (
    select l.* from public.ligacoes l
    where l.anulada_em is null
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

-- 4) Gravação pela extensão (revisão de segurança de 06/11): ligação nova entra; a que já existe só se COMPLETA
-- (resultado que estava "desconhecido" e duração que estava vazia), só na linha do mesmo computador, e nunca muda
-- contato, horário, direção ou número. Cada complemento deixa o carimbo atualizada_em.
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
    insert into public.ligacoes (id_chamada, contato_id, remote_jid, direcao, resultado, video, iniciada_em, duracao_seg, fonte, aparelho_id)
    select x->>'id_chamada', nullif(x->>'contato_id', '')::bigint, x->>'remote_jid', x->>'direcao', x->>'resultado',
           coalesce((x->>'video')::boolean, false), (x->>'iniciada_em')::timestamptz, nullif(x->>'duracao_seg', '')::int,
           'extensao', p_aparelho
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
