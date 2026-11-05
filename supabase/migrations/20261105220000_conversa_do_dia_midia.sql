-- Conversa do dia (painel lateral da Cobrança e do Atendimento), 05/11/2026: cada mensagem leva o id,
-- para abrir imagem, comprovante e áudio pela função painel-cr (pedido do Marcus, 14h17); as ligações
-- desfeitas não aparecem e as registradas no sistema dizem quem registrou.
create or replace function public.painel_conversa(p_contato bigint, p_dia date)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'contato_id', p_contato,
    'nome', (select coalesce(nullif(nome_whatsapp,''), telefone) from public.contatos where id = p_contato),
    'empresas', (select coalesce(jsonb_agg(distinct empresa), '[]'::jsonb) from public.contato_clientes where contato_id = p_contato),
    'mensagens', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'hora', to_char(m.enviada_em at time zone 'America/Sao_Paulo','HH24:MI'), 'nos', m.de_nos, 'tipo', m.tipo,
        'texto', left(coalesce(m.texto,''), 1200), 'arquivo', m.nome_arquivo) order by m.enviada_em), '[]'::jsonb)
      from public.mensagens m
      where m.contato_id = p_contato and not m.grupo and m.tipo is distinct from 'protocolMessage'
        and m.enviada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
        and m.enviada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')),
    'ligacoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'hora', to_char(l.iniciada_em at time zone 'America/Sao_Paulo','HH24:MI'), 'direcao', l.direcao,
        'resultado', l.resultado, 'duracao_seg', l.duracao_seg, 'fonte', l.fonte, 'por', l.usuario_nome) order by l.iniciada_em), '[]'::jsonb)
      from public.ligacoes l where l.contato_id = p_contato and l.anulada_em is null
        and l.iniciada_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
        and l.iniciada_em <  ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')),
    'situacao', (select to_jsonb(s) - 'contato_id' from public.situacao_do_dia s where s.contato_id = p_contato and s.dia = p_dia)
  );
$$;
revoke all on function public.painel_conversa(bigint, date) from public, anon, authenticated;
grant execute on function public.painel_conversa(bigint, date) to service_role;
