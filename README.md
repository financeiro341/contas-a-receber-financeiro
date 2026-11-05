# Contas a Receber · Castelo Branco Contabilidade

Painel do contas a receber com as métricas do WhatsApp do financeiro e os totais do Omie (fase 1) e a caixa de
entrada para responder os clientes pelo número do financeiro (fase 2, desde 05/11/2026).
Referência de produto: Umbler Talk (fila "Esperando resposta", tempo da primeira resposta, volume por período),
somada ao que é próprio da cobrança: situação de cada cliente cobrado e o atraso no Omie.

## Como funciona
- **Login:** o mesmo usuário e senha do Painel de Demandas (Supabase do Painel, produção). Entra quem é admin
  ou do setor financeiro ou diretoria. Não há cadastro aqui.
- **Dados:** Supabase `whatsapp-financeiro` (projeto `mhihrbchidudhgvpouia`). O site chama só a função
  `painel-cr` (`supabase/functions/painel-cr`), que confere o login no Painel e lê as funções `painel_*`
  (`supabase/migrations`). As tabelas não ficam abertas para o navegador.
- **Durante o dia** a situação vem das regras do banco (`situacao_por_regras`); **depois das 17h30** vale a
  leitura do Claude gravada pela tarefa "Relatório de cobrança paralelo CBC", que também grava o atraso no Omie
  por cliente (`situacao_do_dia`) e o relatório do dia com os totais (`relatorios_dia`).
- **Mensagens completas desde 01/11/2026.**

## Telas
1. Cobrança do dia: resumo, situação dos cobrados (filtra a lista), lista com busca e exportação, conversa do dia.
2. Atendimento: esperando resposta, primeira resposta (mediana e média), faixas de tempo, mensagens por hora.
3. Histórico: 7 dias, 30 dias ou o mês; taxa de resposta, pagamentos e promessas; quem mais fica sem retorno.
4. Omie: carteira do ano, mês vigente, faturado, entrou no mês e os maiores atrasos dos cobrados.
5. Conversas (fase 2): caixa de entrada dos últimos 30 dias (filtros Esperando, Sem ler, Minhas, Todas; clientes,
   a identificar ou todos; etiqueta), conversa de vários dias, resposta em texto e arquivo (até 8 MB), notas
   internas, etiquetas próprias do sistema e dono da conversa.

## Envio pela Evolution (fase 2)
- Só envia quem é admin no Painel ou está na tabela `atendentes` com `pode_enviar` (Maria Clara, Marcus,
  Mariana). A mensagem sai com a assinatura de `atendentes.assinatura` (`*Maria Clara - Dep. Financeiro:*`).
- A função manda pela Evolution (`/message/sendText` e `/message/sendMedia`, instância Financeiro CB) com a
  chave guardada no segredo **`EVOLUTION_APIKEY`** da função (Supabase, Edge Functions, Secrets). Sem o
  segredo, o sistema mostra que o envio não foi ligado. A chave nunca vai ao navegador nem ao código.
- Cada envio fica em `envios` (quem, o quê, resultado); a mensagem volta pelo aviso de sempre
  (`receber-evolution`) e é ligada ao envio pelo id. Limite de 20 envios por minuto por pessoa.
- Notas, etiquetas, dono e o histórico (`eventos_caixa`) ficam só no Supabase do WhatsApp; não mexem nas
  etiquetas do WhatsApp.

## Comandos
```
npm install
npm run dev      # http://localhost:5174 (a função aceita localhost)
npm run build
```
Hospedagem: Vercel, deploy pelo Git (branch `main`).
Regras para pessoas: projeto do Claude, `claude/projeto-whatsapp-api.md`.
