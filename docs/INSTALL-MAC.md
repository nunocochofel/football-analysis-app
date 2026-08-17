# Instalação no macOS

## Requisitos

- macOS 11 (Big Sur) ou mais recente.
- Apple Silicon (M1/M2/M3/M4) e Intel são ambos suportados pelo mesmo ficheiro (build universal).

## Método de instalação

Imagem de disco `.dmg`, descarregada diretamente do GitHub Releases.

## Passo 1

Vai a [github.com/nunocochofel/football-analysis-app/releases/latest](https://github.com/nunocochofel/football-analysis-app/releases/latest)
e descarrega o ficheiro `football-analysis-app-X.X.X.dmg`.

## Passo 2

Abre o `.dmg` descarregado e arrasta o ícone da app para a pasta "Applications".

## Passo 3

Abre a app a partir do Launchpad ou da pasta Applications.

## Primeiro arranque

Como a app não está assinada com um certificado Apple Developer pago, o macOS Gatekeeper vai
bloquear a primeira abertura ("não é possível abrir porque o programador não pode ser
verificado"). Para autorizar: **Definições do Sistema → Privacidade e Segurança**, desce até à
secção de segurança e clica em **"Abrir mesmo assim"** junto ao aviso sobre esta app. Só é
necessário fazer isto uma vez.

## Permissões

Na primeira vez que carregares um vídeo, o macOS pode pedir permissão de acesso a
ficheiros/pastas — aceita para poderes escolher os teus vídeos.

## Importar vídeos

Botão "Carregar vídeo" na barra de ferramentas — abre o seletor de ficheiros nativo do macOS.

## Utilização fullscreen

Botão de ecrã inteiro (⛶) junto aos controlos de vídeo. ESC sai do ecrã inteiro.

## Problemas comuns

- **"App danificada, não pode ser aberta"**: normalmente resolve-se com o passo do Gatekeeper
  acima; se persistir, volta a descarregar o `.dmg` (pode ter ficado corrompido no download).
- **Vídeo não reproduz**: formatos comuns (MP4/H.264) funcionam sempre; formatos raros (ex.
  ProRes/HEVC de alguns iPhones) podem precisar de conversão — a app avisa e sugere.

## Como atualizar

A app verifica atualizações automaticamente e avisa quando há uma nova versão disponível.
