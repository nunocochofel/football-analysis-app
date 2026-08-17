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

Botão de ecrã inteiro nos controlos de vídeo. **Nota honesta sobre o estado atual**: a app já
está instalável e funcional no iPhone/iPad com um layout adaptado ao ecrã; as interações
específicas para toque (categorias sempre visíveis em ecrã inteiro, gestos, timeline tátil) estão
a ser implementadas numa fase seguinte de desenvolvimento — ainda não estão todas disponíveis
nesta versão.

## Problemas comuns

- **Não aparece a opção "Adicionar ao Ecrã Principal"**: confirma que estás a usar o Safari (não
  o Chrome nem outro browser) — é uma limitação da Apple, não contornável.
- **Exportação de vídeo indisponível**: nesta versão, exportar cortes para ficheiro ainda só
  funciona no Windows/Mac (usa o motor FFmpeg da aplicação de ambiente de trabalho). Uma
  exportação real para iPhone/iPad/Android está planeada para uma fase seguinte — não existe
  ainda, e preferimos não simular uma funcionalidade que não está pronta.
- **Vídeo não reproduz**: formatos comuns (MP4/H.264) funcionam sempre; formatos como HEVC/ProRes
  podem ter suporte variável consoante o modelo/versão do iOS.

## Como atualizar

Como é uma PWA, atualiza-se sozinha: da próxima vez que abrires a app com internet, recebe
automaticamente a versão mais recente publicada — não há nada para fazeres manualmente.
