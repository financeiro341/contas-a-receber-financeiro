-- Caixa de entrada, melhorias de 05/11/2026 (pedido do Marcus, "melhorar a caixa de entrada"):
-- respostas prontas compartilhadas pela equipe ({nome} e {empresa} são trocados ao usar).
create table public.respostas_prontas (
  id bigserial primary key,
  titulo text not null check (length(btrim(titulo)) between 1 and 60),
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  criada_por uuid,
  criada_por_nome text,
  criado_em timestamptz not null default now(),
  apagada_em timestamptz
);
alter table public.respostas_prontas enable row level security;
revoke all on public.respostas_prontas from anon, authenticated;
grant select, insert, update on public.respostas_prontas to service_role;
grant usage, select on sequence public.respostas_prontas_id_seq to service_role;
revoke all on sequence public.respostas_prontas_id_seq from anon, authenticated;

insert into public.respostas_prontas (titulo, texto, criada_por_nome) values
  ('Segunda via', 'Olá, {nome}! Tudo bem? Segue a segunda via do boleto atualizado.', 'Sistema'),
  ('Pagamento recebido', 'Obrigada, {nome}! Recebemos o seu pagamento.', 'Sistema'),
  ('Pedir comprovante', 'Olá, {nome}! Tudo bem? Pode nos enviar o comprovante do pagamento, por favor?', 'Sistema'),
  ('Saber se recebeu o boleto', 'Olá, {nome}! Tudo bem? Estamos entrando em contato para saber se você recebeu o boleto.', 'Sistema');
