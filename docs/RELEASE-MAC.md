# Publicar/testar a build macOS

Build produzida sempre num runner `macos-latest` real do GitHub Actions
(`.github/workflows/build-mac.yml`) — nunca empacotada localmente a partir do
Windows. Alvo: **arm64 (Apple Silicon)**, sem Rosetta e sem binário universal.

## NUNCA acentuar o nome do bundle/executável macOS (causa um crash imediato)

**Regra permanente, para nunca ser reintroduzida sem se saber porquê:** o
`.app`, o executável interno, e o volume do `.dmg` no macOS têm de ter nomes
só com ASCII. O nome visível "Análise Tática" (com acentos) causa um crash
de arranque **100% reprodutível** (`EXC_BREAKPOINT`/`SIGTRAP`, thread
`CrBrowserMain`, morre em milissegundos, antes de qualquer janela abrir) —
isolado por uma matriz de bisseção (P0-P7) que testou cada variável de
empacotamento isoladamente, sobre o mesmo código trivial (config aplicada via
override do campo `build` do `package.json`, uma variável de cada vez):

| Config | O que soma à referência (P0) | Exit code |
|--------|-------------------------------|-----------|
| P0 | referência mínima (sem identity/hardenedRuntime/entitlements/asarUnpack, nome ASCII) | 0 |
| P1 | + identity ad-hoc | 0 |
| P2 | + hardenedRuntime true | 0 |
| P3 | + os 4 entitlements | 0 |
| P4 | + asar:false | 0 |
| P5 | **+ productName acentuado ("Análise Tática")** | **133** |
| P6 | + asarUnpack ffmpeg/ffprobe | 0 |
| P7 | config completa da app na altura (repete o crash relatado) | 133 |

Das 6 variáveis de empacotamento testadas isoladamente (P1-P4, P6, mais a
combinação completa em P7 sem o nome ASCII), **nenhuma sozinha reproduz o
crash** — só o nome acentuado o faz (P5), e reaparece assim que volta a estar
presente (P7). A versão do Electron e o código da app já tinham sido
eliminados como causa numa ronda de diagnóstico anterior (controlo A2:
Electron 43.4.0 virgem + `BrowserWindow` mínima, sem nada deste projeto,
arranca sem problema).

Confirma-se também nos logs do P5/P7 que não é só a *string* que aparece no
Info.plist — o `.app`, o caminho do executável, e o ficheiro `.dmg` ficam
todos literalmente nomeados com o acento:

```
APP_PATH=dist/mac-arm64/Análise Tática.app
EXEC_PATH=dist/mac-arm64/Análise Tática.app/Contents/MacOS/Análise Tática
```

comparado com P0-P4/P6, todos `dist/mac-arm64/linha.app/Contents/MacOS/linha`
— o padrão consistente com um crash de nível de caminho de ficheiro/nome de
processo, não uma questão puramente cosmética do Info.plist. A causa exata
dentro do Electron/Chromium nunca foi confirmada além disto — só que o nome
acentuado, sozinho, é suficiente e necessário para reproduzir o crash.

## `productName` é ÚNICO em toda a app — não dá para dividir por plataforma

Foi tentado (e revertido) ter `productName` global `"Análise Tática"` para o
Windows, com `"LINHA"` só no macOS via `mac.executableName` +
`mac.extendInfo.CFBundleName`/`CFBundleDisplayName` + `dmg.title`. Rebentou
outra vez (exit 133, mesmo sinal de sempre), por uma razão diferente da dos
acentos — e vale a pena escrever porquê, para ninguém tentar isto de novo:

O macOS/Chromium usa vários processos "Helper" separados (GPU, Renderer,
Plugin — arquitetura multi-processo obrigatória), cada um o seu próprio
`.app` dentro de `Contents/Frameworks/`. O electron-builder nomeia esses
bundles Helper a partir do `productName` **global**, sempre — não respeita
`mac.executableName` (confirmado no código-fonte, `electron/electronMac.js`):

```js
// Electon uses the application name (CFBundleName) to resolve helper apps
// https://github.com/electron/electron/blob/main/shell/app/electron_main_delegate_mac.mm
// https://github.com/electron-userland/electron-builder/issues/6962
const appFilename = appInfo.sanitizedProductName;   // não usa executableName
```

O próprio comentário no código aponta a causa: o Electron nativo **localiza**
os Helpers pelo `CFBundleName` do app principal. Com `extendInfo` a pôr
`CFBundleName: "LINHA"` mas os bundles Helper em disco continuando
`Análise Tática Helper.app` (nome vindo do `productName` global, sem
override possível nesta versão do electron-builder), o Electron procura por
`LINHA Helper.app` e não encontra nada com esse nome — crash no arranque.
Não existe nenhum campo `helperExecutableName` ou equivalente nesta versão
(26.15.3) — só existem overrides de `helperBundleId` (identidade de
assinatura), não de nome.

**Conclusão: o `productName` tem de ser o mesmo em toda a app, Windows e
macOS incluído.** Não há forma suportada de o dividir por plataforma sem
reescrever a lógica de nomeação dos Helpers a seguir ao empacotamento (não
tentado — exigiria a sua própria ronda de validação). A app chama-se
`"LINHA"` em todo o lado.

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
