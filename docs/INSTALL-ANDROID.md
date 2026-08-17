# Instalação no Android

## Requisitos

- Android 8.0 ou mais recente (recomendado).
- Browser **Google Chrome** (recomendado — outros browsers baseados em Chromium, como o Edge ou
  Brave, também costumam funcionar; o Firefox para Android tem suporte limitado a instalação de
  PWAs).
- Ligação à internet para instalar (depois de instalada, a app funciona offline).

## Método de instalação

Esta app **não está na Google Play Store** (não temos conta de programador Play Console). O
método usado é uma **PWA (Progressive Web App)** — instalada diretamente do Chrome, sem qualquer
conta ou pagamento, tal como uma app normal.

## Passo 1

No telemóvel/tablet Android, abre o **Chrome** e vai a:

```
https://nunocochofel.github.io/football-analysis-app/
```

## Passo 2

Toca no menu do Chrome (os três pontos, canto superior direito) e escolhe **"Instalar
aplicação"** (ou "Adicionar ao ecrã principal", consoante a versão do Chrome). Em alguns
telemóveis o Chrome mostra automaticamente um banner "Instalar app" no fundo do ecrã — também
podes tocar aí.

## Passo 3

Confirma tocando em **"Instalar"**.

Aparece agora um ícone da app na gaveta de aplicações e/ou ecrã principal, como qualquer outra
app.

## Primeiro arranque

Toca no ícone criado. A app abre numa janela própria, sem a barra de endereços do Chrome — como
uma app nativa.

## Permissões

Ao carregar um vídeo pela primeira vez, o Chrome pode pedir acesso aos teus ficheiros — aceita
para poderes escolher os teus vídeos.

## Importar vídeos

Botão "Carregar vídeo" — abre o seletor de ficheiros do Android.

## Utilização fullscreen

Botão de ecrã inteiro nos controlos de vídeo. O vídeo ocupa o máximo de espaço possível e as
categorias ficam numa **coluna ao lado** (nunca por cima do vídeo), sempre visíveis, mesmo depois
de os controlos normais (play, timeline) desaparecerem ao fim de uns segundos sem interação — toca
no vídeo para os fazeres reaparecer. Tocar numa categoria inicia um corte; toca outra vez na mesma
para terminar — tudo sem sair do ecrã inteiro.

## Exportação de vídeo

Podes selecionar cortes (individualmente ou "Exportar tudo"), ver o progresso e cancelar, tal como
no Windows/Mac. Como não existe FFmpeg num browser, a exportação no Android usa uma tecnologia
nativa do próprio Chrome (WebCodecs) — funciona de verdade, com limitações reais:

- **Sem som**: o ficheiro exportado tem só vídeo, sem áudio, nesta versão.
- **Mantém o ecrã aceso durante a exportação** (a app pede isso automaticamente), mas se
  **mudares de app** o Android pode pausar/abrandar a exportação — é uma limitação do próprio
  sistema operativo com páginas em segundo plano, não desta app. Mantém o Chrome/a app em primeiro
  plano até a exportação terminar.
- Quando terminar, aparece um botão **"Transferir"** (e "Partilhar", se o dispositivo suportar) —
  a gravação usa o mecanismo normal de downloads do Android.
- **"Juntar num só vídeo"** ainda não está disponível no Android — os cortes individuais
  exportam-se na mesma.

## Problemas comuns

- **Não aparece a opção "Instalar aplicação"**: confirma que estás a usar o Chrome (ou outro
  browser Chromium) atualizado; alguns browsers ou versões antigas não suportam instalação de
  PWAs.
- **Exportação não funciona**: requer um Chrome/Chromium razoavelmente recente (suporte a
  WebCodecs, Chrome 94+). Em versões mais antigas, a app avisa que a exportação não está
  disponível em vez de falhar em silêncio.
- **Ecrãs e proporções muito diferentes** (telemóveis vs. tablets Android têm muita variedade):
  se algo parecer cortado ou mal dimensionado num aparelho específico, é útil reportares o
  modelo/tamanho de ecrã.

## Quadro Tático

Totalmente utilizável por toque: arrasta jogadores/objetos para os mover, arrasta a pega para os
rodar, belisca com dois dedos para aproximar/afastar o campo, arrasta com dois dedos para navegar.
As ferramentas de desenho (linha, seta, zona, texto) desenham-se com o dedo tal como no rato do
computador.

## Como atualizar

Como é uma PWA, atualiza-se sozinha: da próxima vez que abrires a app com internet, recebe
automaticamente a versão mais recente publicada — não precisas de remover e voltar a instalar, o
ícone continua exatamente onde está.
