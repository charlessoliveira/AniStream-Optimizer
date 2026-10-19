# AniStream Optimizer

Userscript para automatizar e personalizar a reprodução de episódios de anime. O código também está publicado no [Greasy Fork](https://greasyfork.org/pt-BR/scripts/597329-anistream-optimizer-autoplay-auto-next-spa-aniskip).

Versão do repositório: **1.3.2**.

## Recursos

- Reprodução automática e Auto Next com intervalo configurável.
- AniSkip para pular abertura e encerramento quando houver marcações para o anime e episódio, com recuperação de falhas temporárias e comunicação validada entre frames.
- Modo teatro, botão flutuante reposicionável com identidade AO em SVG inline e controles do player em menu flutuante.
- Botão flutuante unificado: clique simples abre os comandos; clique duplo expande/recolhe o player.
- Menu de comandos com botão X compacto e independente, ao lado do botão flutuante.
- Duplo clique no botão flutuante expande o player e solicita tela cheia nativa do navegador; essa solicitação depende do gesto do usuário. Auto Fullscreen também aplica o modo teatro automaticamente entre episódios; Auto Expandir pode ser ativado separadamente. No fullscreen nativo, os controles flutuantes acompanham o player e voltam à posição original ao sair.
- Recusar ou permitir a retomada de reprodução nos players compatíveis.
- Preferência de qualidade em JW Player e Plyr; Automática é o padrão.
- Seleção adaptativa de servidores Full HD quando o site oferece fontes alternativas, com verificação da reprodução e recuperação em caso de falha; no Goyabu, prioriza o player HD em iframe e evita alternância por watchdog sem erro confirmado.
- Atalhos editáveis, aviso de pulo e opção para desfazer o pulo recente.
- Suporte a páginas SPA e a players HTML5, JW Player e Plyr, incluindo players em iframe quando acessíveis.
- Preferências por site e comandos de configuração no Tampermonkey.

### 1.3.2

- Corrige a seleção de player no Goyabu: prioriza HD, não alterna servidores por ausência de vídeo detectável e tenta fallback apenas após erro confirmado.
- Ajusta autoplay em iframes Blogger para iniciar silenciado e aplica permissões sem recarregar o iframe.
- Impede que controles genéricos de resultados de busca sejam acionados pelo autoclicker; o duplo clique no botão flutuante também solicita fullscreen nativo durante o gesto.

### 1.3.1

Corrige AniSkip em players cross-origin carregados com atraso, incluindo AnimesROLL.

## Instalação

1. Instale o [Tampermonkey](https://www.tampermonkey.net/) ou outro gerenciador compatível com userscripts.
2. Instale a versão publicada pelo [Greasy Fork](https://greasyfork.org/pt-BR/scripts/597329-anistream-optimizer-autoplay-auto-next-spa-aniskip), ou abra [`AniStream_Optimizer.user.js`](./AniStream_Optimizer.user.js) e instale a partir do arquivo bruto do GitHub.
3. Abra um episódio em um site habilitado. As opções ficam no menu do Tampermonkey e no botão flutuante do AniStream.

O script vem habilitado por padrão em SushiAnimes, Goyabu, AnimesDrive, AnimesOnline, AnimeQ, Anroll, AniDrive e Dattebayo BR. O suporte a cada recurso depende da estrutura do site, do player e das políticas do navegador.

## Configuração

Abra **Atalhos e ajuda…** no menu do Tampermonkey para configurar as teclas, tempos de avanço e movimento do botão. No botão flutuante, clique uma vez para abrir os comandos e duas vezes para expandir ou recolher o player; o X ao lado fecha somente o menu. As configurações são guardadas localmente pelo gerenciador de userscripts.

Para AniSkip, o script usa a API pública do AniSkip e pode consultar o AniList para identificar o anime. Também oferece uma base offline opcional de IDs MAL.

## Desenvolvimento

O arquivo instalável está na raiz. A cópia de desenvolvimento fica em `src/AniStream_Optimizer.dev.js`.

```powershell
npm run check
npm test
```

Mensagens entre frames ainda usam `postMessage` com destino `*` quando o player é cross-origin e sua origem de destino não pode ser lida com segurança. Os relays permanecem limitados à árvore de frames; dados do AniSkip exigem remetente `window.top` e origem compatível com o domínio autorizado, com exceção restrita para origem opaca.

## Licença

MIT. Consulte [`LICENSE`](./LICENSE).
