# Ligações do Financeiro (extensão do Chrome)

Lê as ligações de hoje no WhatsApp Web do financeiro e grava no sistema do contas a receber
(https://contas-a-receber-financeiro.vercel.app), a cada 5 minutos. Pedido do Marcus de 06/11/2026.

## O que ela faz e o que não faz
- **Faz:** lê o histórico de ligações que o próprio WhatsApp Web guarda neste Chrome (com quem, hora, quem ligou,
  se atendeu e a duração) e manda só isso para o sistema.
- **Não faz:** não clica, não digita, não liga, não envia nem responde mensagem, não marca conversa como lida, não
  mexe em etiqueta e não abre outra aba do WhatsApp. Não manda texto de conversa, foto nem arquivo.
- Só roda no endereço `web.whatsapp.com` e só fala com a função `registrar-ligacoes` do Supabase do WhatsApp.

## Como instalar (uma vez, no computador da Maria Clara, 174)
1. Copie a pasta `extensao-ligacoes` para o computador (por exemplo, em `Documentos`). Não apague a pasta depois:
   o Chrome usa ela.
2. No Chrome, abra `chrome://extensions`, ligue **Modo do desenvolvedor** (canto de cima, à direita) e clique em
   **Carregar sem compactação**. Escolha a pasta `extensao-ligacoes`.
3. **No próprio computador 174**, entre no sistema do contas a receber com um usuário administrador, aba
   **Atendimento**, quadro **Ligações automáticas**, escreva o nome do computador e clique em **Gerar código de
   ligação**. O código aparece uma vez só. **Nunca mande o código por WhatsApp, e-mail ou mensagem**: ele fica
   guardado na conversa. Gerar outro código com o mesmo nome desliga o anterior.
4. No Chrome, clique no ícone da extensão (quebra-cabeça, depois "Ligações do Financeiro"), cole o código e clique
   em **Salvar**. Feche o aviso do código no sistema.
5. Recarregue a aba do WhatsApp Web. Em até 1 minuto a extensão faz a primeira leitura; o quadro do sistema passa a
   mostrar "funcionando".

## Atualizar
Troque os arquivos da pasta pelos novos e clique no botão de recarregar da extensão em `chrome://extensions`.

## Se parar
O quadro **Ligações automáticas** fica vermelho quando a extensão passa mais de 1 hora sem mandar nada. Causas
comuns: Chrome fechado, WhatsApp Web desconectado, código desligado no sistema ou o WhatsApp mudou a forma de
guardar as ligações (aí é preciso ajustar o `leitor.js`). Enquanto isso, a ligação pode ser registrada no botão
do telefone da conversa, no sistema.

## Segurança
- A instalação sem compactação exige o Modo do desenvolvedor, então quem usa este Chrome consegue ver o código.
  Por isso ele só serve para gravar ligações de hoje deste computador: não lê nada, não muda ligação já gravada (só
  completa o resultado e a duração) e tem limite por dia. No futuro, dá para instalar por política do Chrome e
  desligar o Modo do desenvolvedor.
- O código de ligação fica só neste Chrome e só serve para **gravar** ligações: com ele ninguém lê nada do sistema
  nem manda mensagem. Um administrador desliga o código no quadro do sistema a qualquer momento.
- No banco fica só o resumo (sha256) do código.
