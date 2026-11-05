import { useEffect, useState } from 'react';
import { lerCaixa, lerEquipe, lerEtiquetas, lerRespostas } from '../lib/api.js';
import { Vazio, useDados } from './comum.jsx';
import CaixaLista from './CaixaLista.jsx';
import CaixaConversa from './CaixaConversa.jsx';

// Caixa de entrada (fase 2): lista de conversas à esquerda, conversa aberta à direita.
// A lista relê a cada 30 segundos; a conversa aberta, a cada 5 (com a aba visível).
export default function Caixa({ eu, contatoPedido }) {
  const caixa = useDados(() => lerCaixa(30), [], 30000);
  const etiquetas = useDados(() => lerEtiquetas(), [], 0);
  const equipe = useDados(() => lerEquipe(), [], 0);
  const respostas = useDados(() => lerRespostas(), [], 0);
  const [aberto, setAberto] = useState(contatoPedido?.id || null);

  useEffect(() => { if (contatoPedido?.id) setAberto(contatoPedido.id); }, [contatoPedido]);

  return (
    <div className={`caixa${aberto ? ' com-conversa' : ''}`}>
      <CaixaLista
        itens={caixa.dados || []}
        carregando={caixa.carregando && !caixa.dados}
        erro={!caixa.dados && caixa.erro}
        recarregar={caixa.recarregar}
        aberto={aberto}
        aoAbrir={setAberto}
        eu={eu}
        etiquetas={etiquetas.dados || []}
      />
      {aberto ? (
        <CaixaConversa
          key={aberto}
          contato={aberto}
          eu={eu}
          etiquetas={etiquetas.dados || []}
          equipe={equipe.dados || []}
          aoVoltar={() => {
            // Fecha a conversa e devolve o foco ao contato na lista (Esc ou botão Voltar).
            const id = aberto;
            setAberto(null);
            requestAnimationFrame(() => document.querySelector(`.caixa-item[data-contato="${Number(id)}"]`)?.focus());
          }}
          pedirSegundaVia={contatoPedido?.segundaVia && contatoPedido.id === aberto ? contatoPedido.em : null}
          aoMudar={caixa.atualizar}
          recarregarEtiquetas={etiquetas.atualizar}
          respostas={respostas.dados || []}
          recarregarRespostas={respostas.atualizar}
        />
      ) : (
        <div className="caixa-painel caixa-vazia">
          <Vazio icone="ti-messages" titulo="Escolha uma conversa" texto="As conversas dos últimos 30 dias aparecem à esquerda, a mais recente primeiro." />
        </div>
      )}
    </div>
  );
}
