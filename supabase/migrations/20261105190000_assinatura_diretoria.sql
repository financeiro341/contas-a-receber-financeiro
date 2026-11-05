-- Decisão do Marcus (05/11/2026, 13h30): a conta da diretoria (Admin CBC no Painel de Demandas) aparece
-- e assina como "Diretoria Castelo" quando responde um cliente pelo sistema. Qualquer pessoa do
-- financeiro continua podendo pôr etiquetas e trocar o dono da conversa (decisão do mesmo horário).
insert into public.atendentes (usuario_id, nome, assinatura, pode_enviar)
values ('adfb037b-735f-4214-87b4-c602f7e0eadd', 'Diretoria Castelo', 'Diretoria Castelo', true)
on conflict (usuario_id) do update set nome = excluded.nome, assinatura = excluded.assinatura, pode_enviar = true;
