# LINHA — Análise de Vídeo de Futebol

Ferramenta de análise de vídeo de futebol: cortes por categoria, timeline, gestão de
equipas/jogadores e Quadro Tático.

## Download

| Plataforma | Como instalar |
|---|---|
| 🪟 **Windows** | [Descarregar o instalador mais recente](https://github.com/nunocochofel/football-analysis-app/releases/latest) (ficheiro `.exe`) — ver [guia de instalação](docs/INSTALL-WINDOWS.md) |
| 🍎 **macOS** | [Descarregar o instalador mais recente](https://github.com/nunocochofel/football-analysis-app/releases/latest) (ficheiro `.dmg`) — ver [guia de instalação](docs/INSTALL-MAC.md) |
| 📱 **iPhone / iPad** | [Abrir a app na web](https://nunocochofel.github.io/football-analysis-app/) e instalar via Safari → "Adicionar ao Ecrã Principal" — ver [guia de instalação](docs/INSTALL-APPLE.md) |
| 🤖 **Android** | [Abrir a app na web](https://nunocochofel.github.io/football-analysis-app/) e instalar via Chrome → "Instalar aplicação" — ver [guia de instalação](docs/INSTALL-ANDROID.md) |

A versão Windows/macOS é uma aplicação de ambiente de trabalho completa (Electron). A versão
iPhone/iPad/Android é uma PWA (Progressive Web App) instalável diretamente pelo browser — sem
necessidade de App Store, Play Store ou conta de programador.

## Arquitetura

Existe um único núcleo de lógica de negócio (projetos, vídeo, cortes, categorias, equipas,
jogadores, Quadro Tático, exportação) partilhado entre as duas experiências:

- **Desktop** (Windows/macOS, Electron) — interface por teclado/rato, exportação com FFmpeg.
- **Touch** (iPhone/iPad/Android, PWA) — interface pensada para toque.

A deteção da plataforma nunca deixa a versão desktop entrar acidentalmente no caminho mobile: a
app desktop corre sempre dentro do Electron, e isso por si só é o sinal que desliga
incondicionalmente qualquer comportamento mobile, independentemente de o hardware ter ecrã tátil
ou não.
