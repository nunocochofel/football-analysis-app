# Publicar/testar a build macOS

Build produzida sempre num runner `macos-latest` real do GitHub Actions
(`.github/workflows/build-mac.yml`) — nunca empacotada localmente a partir do
Windows. Alvo: **arm64 (Apple Silicon)**, sem Rosetta e sem binário universal.

## Disparar manualmente (sem criar release)

GitHub → Actions → "Build macOS" → "Run workflow" → escolhe o branch → Run.

Ao terminar, descarrega o artifact `macos-build-<hash>` na própria página da
execução (secção Artifacts, no fundo da página do run). Útil para testar um
commit qualquer sem publicar nada.

## Publicar como release real

```
git tag vX.X.X
git push origin vX.X.X
```

Dispara o mesmo workflow e desta vez também publica o `.dmg`/`.zip` no Release
do GitHub dessa tag.

### Candidatos de teste (RC) — tags com hífen

Uma tag como `v0.8.47-rc1` é publicada automaticamente como **pre-release** no
GitHub (o workflow deteta o hífen). O `electron-updater`, numa instalação
normal (versão estável, sem hífen), consulta sempre
`GET /repos/.../releases/latest` — um endpoint do próprio GitHub que exclui
pre-releases e drafts por definição — por isso um RC nunca é servido como
atualização a ninguém a correr uma versão estável. (Uma instalação que já
seja ela própria um RC passa a aceitar novos RCs também — comportamento
esperado de canal de teste, não um problema.)

## Assinatura

Sem os secrets `CSC_LINK`/`CSC_KEY_PASSWORD` configurados no repositório, o
workflow assina automaticamente com identidade **ad-hoc** (local, gratuita,
sem conta Apple Developer) e desliga a notarização. Assim que esses secrets
(mais, opcionalmente, `APPLE_API_KEY_ID`/`APPLE_API_ISSUER` ou
`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` para notarização)
forem adicionados, o mesmo workflow passa a assinar com o certificado real e a
notarizar automaticamente — sem precisar de nenhuma alteração ao workflow.

## Testar no Mac (build ad-hoc, sem Apple Developer)

1. Descarrega e abre o `.dmg`.
2. Arrasta a app para "Applications".
3. Abre a app — o macOS mostra o aviso "developer não identificado" (normal,
   é ad-hoc).
4. Definições do Sistema → Privacidade e Segurança → desce até à secção de
   segurança → "Abrir mesmo assim". Só é preciso fazer isto uma vez.

## Diagnóstico quando não abre

Se a app não abrir, ou fechar imediatamente sem mostrar nenhum erro, corre
estes comandos no Terminal do Mac e envia o output completo de todos eles —
não apenas o que parecer relevante.

**O mais importante é o primeiro** — corre a app a partir do Terminal em vez
de a partir do Finder, para veres o erro que a interface gráfica normalmente
engole:

```bash
ELECTRON_ENABLE_LOGGING=1 "/Applications/LINHA.app/Contents/MacOS/LINHA"
```

Deixa correr até fechar (ou até tu fechares, se ficar pendurado) e copia todo
o texto que aparecer.

Depois, confirma a assinatura, a arquitetura real do binário, e o atributo de
quarentena (confirma que o download veio mesmo da internet, como um
utilizador real receberia):

```bash
codesign -vvv --strict "/Applications/LINHA.app"
lipo -archs "/Applications/LINHA.app/Contents/MacOS/LINHA"
xattr -l "/Applications/LINHA.app"
```

`lipo -archs` deve devolver só `arm64` (não `x86_64 arm64`) — se devolver mais
do que isso, ou der erro por não ser um binário fat/universal, confirma que
não estás a testar uma build antiga.
