import { useEffect, useState } from 'react';
import { textoAvisoWhatsapp, vigiarWhatsapp } from '../lib/vigia.js';

// Faixa do topo (09/11/2026): aparece em todas as abas, só quando o vigia diz "falha" ou "vigia_parado".
// Sem botão de fechar: some sozinha quando o WhatsApp volta.
export function FaixaWhatsapp({ resposta }) {
  const texto = textoAvisoWhatsapp(resposta);
  if (!texto) return null;
  const tom = resposta.situacao === 'falha' ? 'falha' : 'parado';
  return (
    <div className={`aviso-whatsapp ${tom}`} role="alert">
      <div className="aviso-whatsapp-dentro">
        <i className="ti ti-alert-triangle" aria-hidden="true" />
        <p>{texto}</p>
      </div>
    </div>
  );
}

export default function AvisoWhatsapp() {
  const [resposta, setResposta] = useState(null);
  useEffect(() => vigiarWhatsapp({ aoMudar: setResposta }), []);
  return <FaixaWhatsapp resposta={resposta} />;
}
