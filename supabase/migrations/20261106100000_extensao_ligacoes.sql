-- 06/11/2026, pedido do Marcus (09h43, "vamos começar a construir a extensão"): extensão do Chrome no computador
-- da Maria Clara (174) que lê as ligações do WhatsApp Web e grava aqui, sem o Claude e sem clique.
-- A Evolution não registra as ligações que nós fazemos (só avisa parte das recebidas), e a marca "Ligação de voz"
-- da conversa não é mensagem: cada aparelho desenha a sua a partir do histórico de ligações.

-- 1) Fonte nova das ligações.
alter table public.ligacoes drop constraint if exists ligacoes_fonte_check;
alter table public.ligacoes add constraint ligacoes_fonte_check
  check (fonte in ('evolution', 'chrome', 'manual', 'extensao'));
alter table public.ligacoes add column if not exists aparelho_id bigint;

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

-- 3) Ligações que contam num dia: as registradas no sistema sempre; das automáticas vale uma fonte só, a melhor que
-- houver no dia (extensão, senão a leitura do Chrome às 17h30, senão o aviso da Evolution), e só quando não há
-- registro manual do mesmo contato até 30 minutos antes ou depois (para não contar a mesma ligação duas vezes).
create or replace function public.ligacoes_validas(p_dia date)
returns table(id bigint, contato_id bigint, direcao text, resultado text, fonte text, iniciada_em timestamptz, usuario_nome text)
language sql stable set search_path to '' as $$
  with d as (
    select l.* from public.ligacoes l
    where l.anulada_em is null
      and l.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
      and l.iniciada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), auto as (
    select case when exists (select 1 from d where d.fonte = 'extensao') then 'extensao'
                when exists (select 1 from d where d.fonte = 'chrome') then 'chrome'
                else 'evolution' end f
  )
  select d.id, d.contato_id, d.direcao, d.resultado, d.fonte, d.iniciada_em, d.usuario_nome from d where d.fonte = 'manual'
  union all
  select a.id, a.contato_id, a.direcao, a.resultado, a.fonte, a.iniciada_em, a.usuario_nome
  from d a cross join auto
  where a.fonte = auto.f
    and not exists (select 1 from d m where m.fonte = 'manual' and m.contato_id = a.contato_id
                    and abs(extract(epoch from (m.iniciada_em - a.iniciada_em))) <= 1800);
$$;
revoke all on function public.ligacoes_validas(date) from public, anon, authenticated;
grant execute on function public.ligacoes_validas(date) to service_role;
