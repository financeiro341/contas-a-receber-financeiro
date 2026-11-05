-- Revisão de segurança de 05/11/2026: retorno não se apaga nem pelo banco (fica feito ou cancelado),
-- e a tabela de conversas resolvidas não se esvazia de uma vez. O padrão do Supabase dá tudo ao service_role.
revoke delete, truncate on public.lembretes from service_role;
revoke truncate on public.resolucoes from service_role;
