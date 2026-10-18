// Mudança de endereço da versão web — ÚNICO sítio a editar quando a LINHA muda de endereço.
//
// Usado pelos dois lados:
//  - enviar.html (página que fica no endereço ANTIGO): manda as pessoas e os seus dados para `destino`;
//  - receber.js (dentro da app, no endereço NOVO): só aceita dados vindos de `origensPermitidas`.
//
// Para mudar outra vez de endereço no futuro (ex.: de linha.pages.dev para um domínio próprio):
//  1. `destino` = endereço novo;
//  2. acrescentar o endereço que fica para trás a `origensPermitidas` (sem apagar os anteriores);
//  3. publicar a app no endereço novo e a página de mudança no antigo
//     (node scripts/pagina-mudanca.mjs <pasta> — ver README do script).
// Nada mais precisa de ser reescrito.
window.LINHA_MIGRACAO = {
  destino: 'https://linha.pages.dev/',
  origensPermitidas: [
    'https://nunocochofel.github.io',
  ],
};
