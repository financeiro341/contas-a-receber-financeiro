-- Os avisos de status da Evolution chegam fora de ordem (ex.: SERVER_ACK depois de DELIVERY_ACK).
-- O status de uma mensagem só avança; ERROR sempre vale.
create or replace function public.status_mensagem_ordem(p text)
returns int language sql immutable set search_path to '' as $$
  select case p when 'PENDING' then 1 when 'SERVER_ACK' then 2 when 'DELIVERY_ACK' then 3 when 'READ' then 4 when 'PLAYED' then 5 else 0 end;
$$;

create or replace function public.mensagens_status_so_avanca()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.status is distinct from old.status and old.status is not null and new.status is distinct from 'ERROR'
     and public.status_mensagem_ordem(new.status) < public.status_mensagem_ordem(old.status) then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger mensagens_status_so_avanca before update of status on public.mensagens
for each row execute function public.mensagens_status_so_avanca();

-- Mensagem enviada pelo sistema em 05/11/2026, 13h21 (a Evolution não manda o aviso de mensagem nova
-- para o que sai pela API; a partir de agora a função painel-cr grava a mensagem ao enviar).
insert into public.mensagens (id, contato_id, remote_jid, grupo, de_nos, tipo, texto, aparelho, enviada_em, status)
select e.mensagem_id, e.contato_id, c.jid, false, true, 'conversation',
       '*Maria Clara - Dep. Financeiro:*' || chr(10) || e.texto, 'sistema', e.criado_em, 'DELIVERY_ACK'
from public.envios e join public.contatos c on c.id = e.contato_id
where e.id = 13 and e.mensagem_id is not null
on conflict (id) do nothing;
