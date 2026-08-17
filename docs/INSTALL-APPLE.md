# Instalação no iPhone e iPad

## Requisitos

- iOS ou iPadOS 16.4 ou mais recente (recomendado, para melhor suporte de vídeo).
- Browser **Safari** (obrigatório — só o Safari permite instalar a app no ecrã principal no
  iPhone/iPad; o Chrome ou outros browsers no iOS não têm essa capacidade, é uma limitação da
  Apple, não desta app).
- Ligação à internet para instalar (depois de instalada, a app funciona offline).

## Método de instalação

Esta app **não está na App Store** (isso exigiria uma conta paga de Apple Developer Program e
processo de revisão da Apple). O método real e suportado pelo iOS para instalar sem App Store é
uma **PWA (Progressive Web App)** — instalada diretamente do Safari, sem qualquer conta ou
pagamento.

## Passo 1

No iPhone/iPad, abre o **Safari** (tem de ser o Safari) e vai a:

```
https://nunocochofel.github.io/football-analysis-app/
```

## Passo 2

Toca no botão de **Partilhar** (o ícone de um quadrado com uma seta para cima, na barra inferior
do Safari).

## Passo 3

No menu que aparece, desce e toca em **"Adicionar ao Ecrã Principal"**. Confirma tocando em
**"Adicionar"** no canto superior direito.

Aparece agora um ícone da app no teu ecrã principal, como qualquer outra app.

## Primeiro arranque

Toca no ícone criado. A app abre em ecrã inteiro, sem a barra de endereços do Safari — como uma
app nativa.

## Permissões

Ao carregar um vídeo pela primeira vez, o Safari mostra o seletor de ficheiros normal do iOS —
escolhe o vídeo a partir da app Fotos ou Ficheiros. Não são pedidas outras permissões.

## Importar vídeos

Botão "Carregar vídeo" — abre o seletor de ficheiros do iOS (Fotos, Ficheiros, iCloud Drive, etc.).

## Utilização fullscreen

Botão de ecrã inteiro (⛶) nos controlos de vídeo. O vídeo ocupa o máximo de espaço possível e as
categorias ficam numa **coluna ao lado** (nunca por cima do vídeo), sempre visíveis, mesmo depois
de os controlos normais (play, timeline) desaparecerem ao fim de uns segundos sem interação — toca
no vídeo para os fazeres reaparecer. Tocar numa categoria inicia um corte; toca outra vez na mesma
para terminar — tudo sem sair do ecrã inteiro.

## Exportação de vídeo

Podes selecionar cortes (individualmente ou "Exportar tudo"), ver o progresso e cancelar, tal como
no Windows/Mac. Como não existe FFmpeg num browser, a exportação no iPhone/iPad usa uma tecnologia
nativa do próprio Safari (WebCodecs) — funciona de verdade, mas com limitações reais que preferimos
explicar em vez de esconder:

- **Sem som**: o ficheiro exportado tem só vídeo, sem áudio, nesta versão.
- **Mantém o ecrã aceso durante a exportação** (não é preciso fazeres nada — a app pede isso
  automaticamente), mas se **mudares de app** o iOS pode pausar/abrandar a exportação — é uma
  limitação do próprio sistema operativo com páginas em segundo plano, não desta app. Mantém o
  Safari em primeiro plano até a exportação terminar.
- Quando terminar, aparece um botão **"Transferir"** (e "Partilhar", se o dispositivo suportar) em
  vez de "Abrir" — não há acesso direto ao sistema de ficheiros num browser, por isso a gravação
  usa o mecanismo normal de downloads do iOS.
- **"Juntar num só vídeo"** (combinar vários cortes num único ficheiro) ainda não está disponível
  no iPhone/iPad — os cortes individuais exportam-se na mesma.

## Problemas comuns

- **Não aparece a opção "Adicionar ao Ecrã Principal"**: confirma que estás a usar o Safari (não
  o Chrome nem outro browser) — é uma limitação da Apple, não contornável.
- **Exportação não funciona**: requer iOS/iPadOS 16.4 ou mais recente (suporte a WebCodecs). Em
  versões mais antigas, a app avisa que a exportação não está disponível em vez de falhar em
  silêncio.
- **Quadro Tático ainda não tem interação por toque dedicada** (arrastar jogadores, pinch-zoom,
  Apple Pencil) — está planeado para uma fase seguinte. O resto da app (vídeo, cortes, categorias,
  timeline, ecrã inteiro, exportação) já está totalmente adaptado a toque.
- **Vídeo não reproduz**: formatos comuns (MP4/H.264) funcionam sempre; formatos como HEVC/ProRes
  podem ter suporte variável consoante o modelo/versão do iOS.

## Como atualizar

Como é uma PWA, atualiza-se sozinha: da próxima vez que abrires a app com internet, recebe
automaticamente a versão mais recente publicada — não precisas de remover e voltar a instalar, o
ícone continua exatamente onde está.
