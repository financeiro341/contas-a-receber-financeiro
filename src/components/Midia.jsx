import { useState } from 'react';
import { aoSair, lerMidia } from '../lib/api.js';

export const TIPOS_MIDIA = new Set(['imageMessage', 'documentMessage', 'audioMessage', 'videoMessage', 'stickerMessage']);

// Já abertos nesta aba (não baixa de novo do WhatsApp ao reler a conversa): no máximo 30; tudo some ao sair.
const abertos = new Map();
const MAX_ABERTOS = 30;
function guardar(id, obj) {
  abertos.set(id, obj);
  while (abertos.size > MAX_ABERTOS) {
    const [primeiro, velho] = abertos.entries().next().value;
    URL.revokeObjectURL(velho.url);
    abertos.delete(primeiro);
  }
}
aoSair(() => { abertos.forEach((o) => URL.revokeObjectURL(o.url)); abertos.clear(); });

function paraBlob(base64, tipo) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

const ROTULO = { imageMessage: ['ti-photo', 'Ver imagem'], stickerMessage: ['ti-mood-smile', 'Ver figurinha'], audioMessage: ['ti-player-play', 'Ouvir áudio'], videoMessage: ['ti-video', 'Ver vídeo'], documentMessage: ['ti-file-text', 'Abrir arquivo'] };

// Imagem, comprovante, áudio ou vídeo de uma mensagem: só baixa quando a pessoa pede.
export default function Midia({ id, tipo, arquivo }) {
  const [aberto, setAberto] = useState(() => abertos.get(id) || null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState('');
  if (!id || !TIPOS_MIDIA.has(tipo)) return null;

  async function abrir() {
    setLendo(true);
    setErro('');
    try {
      const r = await lerMidia(id);
      const url = URL.createObjectURL(paraBlob(r.base64, r.mimetype));
      const obj = { url, mimetype: r.mimetype, nome: r.nome };
      guardar(id, obj);
      setAberto(obj);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLendo(false);
    }
  }

  if (!aberto) {
    const [icone, rotulo] = ROTULO[tipo];
    return (
      <span className="midia">
        <button type="button" className="botao midia-botao" onClick={abrir} disabled={lendo}>
          <i className={`ti ${lendo ? 'ti-loader-2 girando' : icone}`} aria-hidden="true" />{lendo ? 'Baixando…' : rotulo}
        </button>
        {erro && <span className="midia-erro" role="alert">{erro}</span>}
      </span>
    );
  }
  const { url, mimetype, nome } = aberto;
  if (mimetype.startsWith('image/')) {
    return (
      <a className="midia" href={url} target="_blank" rel="noopener noreferrer" title="Abrir a imagem em outra aba">
        <img className={tipo === 'stickerMessage' ? 'midia-figurinha' : 'midia-img'} src={url} alt={arquivo || (tipo === 'stickerMessage' ? 'Figurinha' : 'Imagem da conversa')} />
      </a>
    );
  }
  if (mimetype.startsWith('audio/')) return <audio className="midia midia-audio" controls autoPlay src={url} aria-label="Áudio da conversa" />;
  if (mimetype.startsWith('video/')) return <video className="midia midia-img" controls src={url} aria-label="Vídeo da conversa" />;
  return (
    <span className="midia midia-links">
      {mimetype === 'application/pdf' && <a className="botao midia-botao" href={url} target="_blank" rel="noopener noreferrer"><i className="ti ti-external-link" aria-hidden="true" />Abrir PDF</a>}
      <a className="botao midia-botao" href={url} download={nome}><i className="ti ti-download" aria-hidden="true" />Baixar</a>
    </span>
  );
}
