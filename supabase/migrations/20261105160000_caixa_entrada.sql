-- Fase 2 do sistema do contas a receber: caixa de entrada para responder pelo sistema
-- (decisões do Marcus, 05/11/2026, 11h55): conversas com resposta em texto e arquivo, notas internas,
-- etiquetas e dono da conversa. Só Maria Clara e os administradores enviam; a mensagem sai com o nome
-- de quem enviou ("*Maria Clara - Dep. Financeiro:*"). O envio é feito pela função painel-cr, pela
-- Evolution; a mensagem enviada volta pelo aviso de sempre (receber-evolution) e é ligada ao envio
-- pelo id. Tudo fechado para o navegador: só a chave de serviço da função lê e grava.

-- 1) Quem responde pelo sistema e com que assinatura (usuário do Painel de Demandas).
create table public.atendentes (
  usuario_id uuid primary key,
  nome text not null,
  assinatura text not null,
  pode_enviar boolean not null default true,
  criado_em timestamptz not null default now()
);
insert into public.atendentes (usuario_id, nome, assinatura) values
  ('3db559ae-9f99-42d9-89af-0ca2316493c4', 'Maria Clara', 'Maria Clara - Dep. Financeiro'),
  ('a4abec60-0468-4bd6-8807-39257be801a3', 'Marcus Campos', 'Marcus Campos - Dep. Financeiro'),
  ('7f79ca18-61fb-4029-bb8c-dc911fb94ded', 'Mariana Cunha', 'Mariana Cunha - Dep. Financeiro');

-- 2) Cada envio feito pelo sistema (texto ou arquivo), com quem enviou e o resultado na Evolution.
create table public.envios (
  id bigserial primary key,
  contato_id bigint not null references public.contatos(id),
  usuario_id uuid not null,
  usuario_nome text not null,
  tipo text not null check (tipo in ('texto', 'arquivo')),
  texto text,
  nome_arquivo text,
  mimetype text,
  tamanho integer,
  destino text not null,
  status text not null default 'enviando' check (status in ('enviando', 'enviado', 'erro')),
  mensagem_id text,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index envios_contato_idx on public.envios (contato_id, criado_em desc);
create index envios_mensagem_idx on public.envios (mensagem_id);
create index envios_usuario_idx on public.envios (usuario_id, criado_em desc);

-- 3) Notas internas (o cliente não vê). Exclusão lógica.
create table public.notas (
  id bigserial primary key,
  contato_id bigint not null references public.contatos(id),
  usuario_id uuid not null,
  usuario_nome text not null,
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  criado_em timestamptz not null default now(),
  apagada_em timestamptz,
  apagada_por uuid
);
create index notas_contato_idx on public.notas (contato_id, criado_em desc);

-- 4) Etiquetas da caixa (próprias do sistema; não mexem nas etiquetas do WhatsApp).
create table public.etiquetas (
  id bigserial primary key,
  nome text not null check (length(btrim(nome)) between 1 and 40),
  cor text not null default 'neutro' check (cor in ('neutro', 'azul', 'verde', 'amarelo', 'vermelho', 'roxo')),
  criada_por uuid,
  criado_em timestamptz not null default now(),
  apagada_em timestamptz
);
create unique index etiquetas_nome_idx on public.etiquetas (lower(nome)) where apagada_em is null;
insert into public.etiquetas (nome, cor) values
  ('Negociação', 'amarelo'), ('Promessa de pagamento', 'azul'), ('Segunda via', 'neutro'),
  ('Comprovante recebido', 'verde'), ('Aguardando cliente', 'roxo');

create table public.contato_etiquetas (
  contato_id bigint not null references public.contatos(id),
  etiqueta_id bigint not null references public.etiquetas(id),
  usuario_id uuid,
  criado_em timestamptz not null default now(),
  primary key (contato_id, etiqueta_id)
);

-- 5) Dono da conversa (uma pessoa por conversa; sem linha = sem dono).
create table public.atribuicoes (
  contato_id bigint primary key references public.contatos(id),
  usuario_id uuid not null,
  usuario_nome text not null,
  atribuido_por uuid not null,
  atribuido_por_nome text not null,
  em timestamptz not null default now()
);

-- 6) Histórico do que a equipe fez na caixa (envio, nota, etiqueta, dono).
create table public.eventos_caixa (
  id bigserial primary key,
  contato_id bigint references public.contatos(id),
  usuario_id uuid not null,
  usuario_nome text not null,
  tipo text not null,
  detalhe jsonb not null default '{}'::jsonb,
  em timestamptz not null default now()
);
create index eventos_caixa_contato_idx on public.eventos_caixa (contato_id, em desc);

-- Segurança: RLS ligada e nada para anon e authenticated; só a chave de serviço.
alter table public.atendentes enable row level security;
alter table public.envios enable row level security;
alter table public.notas enable row level security;
alter table public.etiquetas enable row level security;
alter table public.contato_etiquetas enable row level security;
alter table public.atribuicoes enable row level security;
alter table public.eventos_caixa enable row level security;
revoke all on public.atendentes, public.envios, public.notas, public.etiquetas, public.contato_etiquetas,
  public.atribuicoes, public.eventos_caixa from anon, authenticated;
grant select, insert, update on public.atendentes, public.envios, public.notas, public.etiquetas,
  public.atribuicoes, public.eventos_caixa to service_role;
grant select, insert, delete on public.contato_etiquetas to service_role;
grant delete on public.atribuicoes to service_role;
grant usage, select on sequence public.envios_id_seq, public.notas_id_seq, public.etiquetas_id_seq,
  public.eventos_caixa_id_seq to service_role;

-- 7) Lista da caixa de entrada: conversas individuais com mensagem nos últimos p_dias (até 90).
-- sem_ler = mensagens do cliente depois da nossa última que ainda não foram abertas (status da Evolution).
create or replace function public.painel_caixa(p_dias int default 30)
returns jsonb language sql stable set search_path to '' as $$
  with base as (
    select m.contato_id, m.de_nos, m.enviada_em, m.status, m.tipo,
           coalesce(nullif(m.texto, ''), m.nome_arquivo, '') conteudo
    from public.mensagens m
    where not m.grupo and m.contato_id is not null
      and m.tipo is distinct from 'reactionMessage' and m.tipo is distinct from 'protocolMessage'
      and m.enviada_em >= now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 90))
  ), ult as (
    select distinct on (contato_id) contato_id, de_nos, enviada_em, tipo, conteudo
    from base order by contato_id, enviada_em desc
  ), ult_nossa as (
    select contato_id, max(enviada_em) em from base where de_nos group by 1
  ), sl as (
    select b.contato_id, count(*)::int n
    from base b left join ult_nossa n on n.contato_id = b.contato_id
    where not b.de_nos and (n.em is null or b.enviada_em > n.em)
      and b.status is not null and b.status not in ('READ', 'PLAYED')
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'contato_id', u.contato_id,
      'nome', coalesce(nullif(c.nome_whatsapp, ''), c.telefone, 'Sem nome'),
      'telefone', c.telefone,
      'situacao', c.situacao,
      'empresas', (select jsonb_agg(cc.empresa order by cc.empresa) from public.contato_clientes cc where cc.contato_id = u.contato_id),
      'ultima_em', u.enviada_em,
      'ultima_de_nos', u.de_nos,
      'ultima_tipo', u.tipo,
      'ultima_texto', left(regexp_replace(u.conteudo, '\s+', ' ', 'g'), 120),
      'sem_ler', coalesce(sl.n, 0),
      'dono', (select jsonb_build_object('id', a.usuario_id, 'nome', a.usuario_nome) from public.atribuicoes a where a.contato_id = u.contato_id),
      'etiquetas', (select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor) order by e.nome)
                    from public.contato_etiquetas ce join public.etiquetas e on e.id = ce.etiqueta_id and e.apagada_em is null
                    where ce.contato_id = u.contato_id)
    ) order by u.enviada_em desc), '[]'::jsonb)
  from ult u join public.contatos c on c.id = u.contato_id
  left join sl on sl.contato_id = u.contato_id;
$$;

-- 8) Conversa completa (vários dias, das mais novas para trás, em páginas) com notas, etiquetas,
-- dono, empresas, a última situação de cobrança e os envios que falharam ou estão saindo.
create or replace function public.painel_conversa_completa(p_contato bigint, p_antes timestamptz default null, p_limite int default 120)
returns jsonb language sql stable set search_path to '' as $$
  with msgs as (
    select m.id, m.de_nos, m.tipo, m.texto, m.nome_arquivo, m.enviada_em, m.status
    from public.mensagens m
    where m.contato_id = p_contato and not m.grupo
      and m.tipo is distinct from 'protocolMessage' and m.tipo is distinct from 'reactionMessage'
      and (p_antes is null or m.enviada_em < p_antes)
    order by m.enviada_em desc
    limit least(greatest(coalesce(p_limite, 120), 1), 300)
  )
  select jsonb_build_object(
    'contato', (select jsonb_build_object('id', c.id, 'nome', coalesce(nullif(c.nome_whatsapp, ''), c.telefone, 'Sem nome'),
                  'telefone', c.telefone, 'situacao', c.situacao, 'tem_destino', (c.jid is not null or c.lid is not null))
                from public.contatos c where c.id = p_contato),
    'empresas', (select coalesce(jsonb_agg(jsonb_build_object('codigo', cc.codigo_cliente_omie, 'empresa', cc.empresa, 'cnpj', cc.cnpj) order by cc.empresa), '[]'::jsonb)
                 from public.contato_clientes cc where cc.contato_id = p_contato),
    'mensagens', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nos', x.de_nos, 'tipo', x.tipo, 'texto', x.texto,
                    'arquivo', x.nome_arquivo, 'em', x.enviada_em, 'status', x.status,
                    'por', (select e.usuario_nome from public.envios e where e.mensagem_id = x.id order by e.id desc limit 1))
                  order by x.enviada_em), '[]'::jsonb) from msgs x),
    'mais_antigas', exists (select 1 from public.mensagens m2 where m2.contato_id = p_contato and not m2.grupo
                     and m2.enviada_em < (select min(enviada_em) from msgs)),
    'situacao', (select jsonb_build_object('dia', s.dia, 'situacao', s.situacao, 'motivo', s.motivo,
                   'classificado_por', s.classificado_por, 'atraso_qtd', s.atraso_qtd, 'atraso_valor', s.atraso_valor)
                 from public.situacao_do_dia s where s.contato_id = p_contato order by s.dia desc limit 1),
    'notas', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'texto', n.texto, 'autor', n.usuario_nome,
                'autor_id', n.usuario_id, 'em', n.criado_em) order by n.criado_em desc), '[]'::jsonb)
              from public.notas n where n.contato_id = p_contato and n.apagada_em is null),
    'etiquetas', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor) order by e.nome), '[]'::jsonb)
                  from public.contato_etiquetas ce join public.etiquetas e on e.id = ce.etiqueta_id and e.apagada_em is null
                  where ce.contato_id = p_contato),
    'dono', (select jsonb_build_object('id', a.usuario_id, 'nome', a.usuario_nome, 'por', a.atribuido_por_nome, 'em', a.em)
             from public.atribuicoes a where a.contato_id = p_contato),
    'envios', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.tipo, 'texto', e.texto, 'arquivo', e.nome_arquivo,
                 'status', e.status, 'erro', e.erro, 'por', e.usuario_nome, 'em', e.criado_em) order by e.id), '[]'::jsonb)
               from public.envios e where e.contato_id = p_contato and e.status <> 'enviado' and e.criado_em > now() - interval '2 days'),
    'eventos', (select coalesce(jsonb_agg(x order by (x->>'em') desc), '[]'::jsonb) from (
                  select jsonb_build_object('tipo', ev.tipo, 'por', ev.usuario_nome, 'detalhe', ev.detalhe, 'em', ev.em) x
                  from public.eventos_caixa ev where ev.contato_id = p_contato order by ev.em desc limit 20) y)
  );
$$;

revoke all on function public.painel_caixa(int), public.painel_conversa_completa(bigint, timestamptz, int) from public, anon, authenticated;
grant execute on function public.painel_caixa(int), public.painel_conversa_completa(bigint, timestamptz, int) to service_role;
