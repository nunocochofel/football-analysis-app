// Formato do "pacote" de dados da LINHA (versão web) usado na mudança de endereço — partilhado
// pela página de envio (endereço antigo) e pelo recetor (dentro da app, endereço novo).
// Sem dependências; funciona no browser (window.LinhaPacote) e em Node (testes).
(function(root){
  'use strict';
  const PREFIXO = 'linha:';
  const FORMATO = 'linha-copia-dados';
  const VERSAO = 1;
  const INDICE = 'linha:projects';
  const PROJETO = 'linha:project:';

  // Tudo o que a app guarda no localStorage com o prefixo "linha:" (projetos, índice, modelos de
  // categorias, preferências). As referências a ficheiros de vídeo (IndexedDB) não são
  // transferíveis entre endereços — o vídeo volta a ser escolhido, como noutro browser.
  function recolherPacote(storage, origem){
    const dados = {};
    for(let i=0; i<storage.length; i++){
      const k = storage.key(i);
      if(k && k.startsWith(PREFIXO)) dados[k] = storage.getItem(k);
    }
    return { formato: FORMATO, versao: VERSAO, origem: origem || '', criadoEm: new Date().toISOString(), dados };
  }

  function lerIndice(valor){
    try{ const v = JSON.parse(valor || '[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; }
  }
  function contarProjetos(pacote){
    return lerIndice(pacote && pacote.dados && pacote.dados[INDICE]).length;
  }

  function validarPacote(p){
    if(!p || typeof p !== 'object') return 'O ficheiro não é uma cópia de dados da LINHA.';
    if(p.formato !== FORMATO) return 'O ficheiro não é uma cópia de dados da LINHA.';
    if(typeof p.versao !== 'number' || p.versao > VERSAO) return 'Esta cópia foi feita por uma versão mais recente da LINHA — atualiza a app e tenta outra vez.';
    if(!p.dados || typeof p.dados !== 'object') return 'A cópia está vazia ou danificada.';
    for(const k of Object.keys(p.dados)){
      if(!k.startsWith(PREFIXO) || typeof p.dados[k] !== 'string') return 'A cópia está danificada.';
    }
    return null;
  }

  function jaExisteComConteudo(storage, indice, conteudo){
    return indice.some(e => e && e.id && storage.getItem(PROJETO + e.id) === conteudo);
  }

  function novoIdProjeto(){
    return 'proj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Junta o pacote aos dados que já existem — NUNCA apaga nem substitui nada:
  //  - projeto que não existe aqui → entra tal como está;
  //  - projeto com o mesmo id e conteúdo igual → ignorado (ex.: mudança feita duas vezes);
  //  - projeto com o mesmo id mas conteúdo diferente → entra como CÓPIA (id novo, nome com
  //    "(endereço antigo)"), ficando os dois;
  //  - preferências/modelos → só entram se ainda não existirem aqui, exceto se este endereço ainda
  //    não tiver projetos nenhuns (ver destinoPorEstrear).
  function aplicarPacote(pacote, storage){
    const erro = validarPacote(pacote);
    if(erro) throw new Error(erro);
    const dados = pacote.dados;
    const indiceAqui = lerIndice(storage.getItem(INDICE));
    const indiceVindo = lerIndice(dados[INDICE]);
    // Endereço novo ainda sem projetos = só tem as predefinições que a app grava ao abrir pela
    // primeira vez (ex.: modelos de categorias) — aí as preferências vindas substituem-nas, senão
    // as categorias personalizadas da pessoa perdiam-se para as de fábrica.
    const destinoPorEstrear = indiceAqui.length === 0;
    const r = { novos: 0, copias: 0, iguais: 0, preferencias: 0 };

    for(const entrada of indiceVindo){
      if(!entrada || !entrada.id) continue;
      const chaveVinda = PROJETO + entrada.id;
      const conteudo = dados[chaveVinda];
      if(conteudo == null) continue; // entrada sem dados — nada a copiar
      const existente = storage.getItem(chaveVinda);
      if(existente == null && !indiceAqui.some(e => e.id === entrada.id)){
        storage.setItem(chaveVinda, conteudo);
        indiceAqui.push(entrada);
        r.novos++;
      } else if(existente === conteudo || jaExisteComConteudo(storage, indiceAqui, conteudo)){
        // Igual, ou já trazido como cópia numa mudança anterior — não duplicar.
        r.iguais++;
      } else {
        const id = novoIdProjeto();
        storage.setItem(PROJETO + id, conteudo);
        indiceAqui.push(Object.assign({}, entrada, { id, name: (entrada.name || 'Projeto') + ' (endereço antigo)' }));
        r.copias++;
      }
    }
    // Projetos sem entrada no índice (não deviam existir, mas não se perdem): entram como novos.
    for(const k of Object.keys(dados)){
      if(!k.startsWith(PROJETO)) continue;
      const id = k.slice(PROJETO.length);
      if(indiceVindo.some(e => e && e.id === id)) continue;
      if(storage.getItem(k) == null){
        storage.setItem(k, dados[k]);
        indiceAqui.push({ id, name: 'Projeto recuperado', createdAt: Date.now(), updatedAt: Date.now() });
        r.novos++;
      }
    }
    storage.setItem(INDICE, JSON.stringify(indiceAqui));

    for(const k of Object.keys(dados)){
      if(k === INDICE || k.startsWith(PROJETO)) continue;
      if(storage.getItem(k) == null || (destinoPorEstrear && storage.getItem(k) !== dados[k])){
        storage.setItem(k, dados[k]); r.preferencias++;
      }
    }
    return r;
  }

  const api = { PREFIXO, FORMATO, VERSAO, recolherPacote, aplicarPacote, validarPacote, contarProjetos };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LinhaPacote = api;
})(typeof window !== 'undefined' ? window : globalThis);
