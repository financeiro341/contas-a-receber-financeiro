-- Correções da revisão de segurança da fase 2 (05/11/2026):
-- (1) atendentes.pode_enviar nasce false: linha nova não dá permissão de envio sem querer;
-- (2) limite de envio contado e gravado na mesma transação, com trava por pessoa (sem corrida entre
--     pedidos em paralelo): 20 por minuto por pessoa, 5 por minuto por contato, 300 por dia por pessoa;
-- (3) envio pode ficar 'incerto' (a Evolution demorou a responder: pode ter saído);
-- (4) o detalhe do erro da Evolution não volta para a tela (fica só na tabela e no log da função);
-- (5) sequências novas fechadas para anon e authenticated.
alter table public.atendentes alter column pode_enviar set default false;

alter table public.envios drop constraint envios_status_check;
alter table public.envios add constraint envios_status_check check (status in ('enviando', 'enviado', 'erro', 'incerto'));

revoke all on sequence public.envios_id_seq, public.notas_id_seq, public.etiquetas_id_seq, public.eventos_caixa_id_seq from anon, authenticated;

create or replace function public.registrar_envio(
  p_contato bigint, p_usuario uuid, p_usuario_nome text, p_tipo text, p_texto text,
  p_nome_arquivo text, p_mimetype text, p_tamanho int, p_destino text)
returns bigint language plpgsql volatile set search_path to '' as $$
declare
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('envio:' || p_usuario::text));
  if (select count(*) from public.envios where usuario_id = p_usuario and criado_em > now() - interval '1 minute') >= 20 then
    raise exception 'limite_pessoa_minuto' using errcode = 'P0001';
  end if;
  if (select count(*) from public.envios where contato_id = p_contato and criado_em > now() - interval '1 minute') >= 5 then
    raise exception 'limite_contato_minuto' using errcode = 'P0001';
  end if;
  if (select count(*) from public.envios where usuario_id = p_usuario and criado_em > now() - interval '1 day') >= 300 then
    raise exception 'limite_pessoa_dia' using errcode = 'P0001';
  end if;
  insert into public.envios (contato_id, usuario_id, usuario_nome, tipo, texto, nome_arquivo, mimetype, tamanho, destino)
  values (p_contato, p_usuario, p_usuario_nome, p_tipo, p_texto, p_nome_arquivo, p_mimetype, p_tamanho, p_destino)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.registrar_envio(bigint, uuid, text, text, text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.registrar_envio(bigint, uuid, text, text, text, text, text, int, text) to service_role;

-- A conversa deixa de devolver o texto do erro da Evolution.
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
                 'status', e.status, 'por', e.usuario_nome, 'em', e.criado_em) order by e.id), '[]'::jsonb)
               from public.envios e where e.contato_id = p_contato and e.status <> 'enviado' and e.criado_em > now() - interval '2 days'),
    'eventos', (select coalesce(jsonb_agg(x order by (x->>'em') desc), '[]'::jsonb) from (
                  select jsonb_build_object('tipo', ev.tipo, 'por', ev.usuario_nome, 'detalhe', ev.detalhe - 'erro', 'em', ev.em) x
                  from public.eventos_caixa ev where ev.contato_id = p_contato order by ev.em desc limit 20) y)
  );
$$;
