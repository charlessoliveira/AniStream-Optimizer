# AniStream Optimizer (Autoplay + Auto-Next + SPA + AniSkip)

Userscript para automatizar tarefas comuns ao assistir animes: iniciar a reprodução, avançar para o próximo episódio, expandir o player e pular aberturas/encerramentos com dados do AniSkip. Inclui controles flutuantes, atalhos configuráveis e preferências por site.

## Recursos

- **Auto Play:** tenta iniciar o vídeo automaticamente quando o player aparece ou é atualizado. O navegador ou o próprio site pode exigir interação, ou bloquear a reprodução com áudio; nesses casos, o comportamento depende do player.
- **Auto Next:** aciona o próximo episódio automaticamente perto do fim. O tempo de antecipação pode ser configurado no menu do Tampermonkey (padrão: 3 segundos).
- **Expansão:** duplo clique no botão flutuante expande o player e solicita tela cheia nativa do navegador, usando o próprio gesto do usuário. Auto Fullscreen também mantém o player expandido automaticamente entre episódios com o modo teatro.
- **Auto Expandir:** expande o player para o modo de teatro do AniStream automaticamente. Também é possível alternar manualmente pelo botão flutuante.
- **Recusar/permitir retomada:** controla a opção de continuar de onde parou nos players compatíveis. Por padrão, o script recusa a retomada em Anroll, AnimesOnline e Anidrive.
- **AniSkip:** consulta os tempos de abertura e encerramento disponíveis para a série e tenta pular os trechos automaticamente. A disponibilidade depende de haver dados para o anime/episódio e de o player permitir controlar a reprodução.
- **AniSkip manual:** permite informar o MAL ID da série ou registrar manualmente o intervalo da abertura.
- **Informações do anime:** exibe uma ficha com metadados da série quando encontrados no AniList.
- **Base MAL offline:** pode baixar uma base de títulos para localizar séries localmente. O cache também cresce conforme novos títulos são resolvidos; a base completa é opcional.
- **Aviso de pulo e Desfazer:** mostra um aviso visual curto quando um trecho é pulado. Quando o player permite, o aviso oferece **Desfazer**; `Ctrl+Z` também desfaz enquanto o aviso ainda está visível.
- **Preferência de qualidade:** em players compatíveis com JW Player ou Plyr, permite escolher Automática, maior disponível, 1080p, 720p, 480p ou 360p. Em resoluções fixas, usa a opção disponível mais próxima. Automática é o padrão.
- **Priorizar servidor FHD:** tenta priorizar fontes Full HD quando o site disponibiliza mais de um servidor/fonte.
- **Menu flutuante único:** o botão AO abre os controles tanto no player normal quanto no expandido, sem inserir uma barra no fluxo da página. Inclui ações de próximo episódio e pular intro, além de alternadores de Auto Play, Auto Next, AniSkip e Auto Expandir. Um clique abre o menu; clique duplo no botão principal alterna o modo expandido. O X compacto ao lado do botão fecha somente o menu.
- **Identidade visual AO:** monograma A metálico, O esmeralda e play integrado, renderizado como SVG inline sem imagens externas.
- **Botão flutuante reposicionável:** pode ser arrastado e sua posição é guardada. Com o teclado, os atalhos configurados movem o botão e leitores de tela recebem um anúncio da posição.
- **Compatibilidade com páginas SPA:** acompanha mudanças de URL e de conteúdo sem exigir uma recarga completa da página.
- **Players diferentes:** identifica e usa controles específicos de JW Player e Plyr quando disponíveis, com suporte de fallback para vídeo HTML5. O alcance das funções varia conforme o player e o site.
- **Atalhos editáveis:** o painel **Atalhos e ajuda…** permite alterar as combinações, inclusive usando `Ctrl`, `Alt`, `Shift` e `Meta`. Também permite ajustar os tempos de avanço de intro/final e os passos de movimento do botão. Combinações duplicadas são recusadas.
- **Atalhos globais opcionais:** podem ser ativados/desativados no painel ou pelo comando do Tampermonkey; os botões na interface continuam disponíveis.
- **Acessibilidade:** estados anunciados com atributos ARIA, foco visível e atalhos ignorados enquanto o usuário digita em campos editáveis.
- **Preferências por site:** o script vem habilitado nos domínios abaixo. Pelo menu do Tampermonkey, é possível ativá-lo ou desativá-lo para o site atual.

## Sites habilitados por padrão

- `sushianimes.com.br`
- `goyabu.io`
- `animesdrive.cloud`
- `animesonline.io`
- `animeq.cloud`
- `anroll.io`
- `anidrive.click`
- `dattebayo-br.com`

O userscript pode ser carregado em qualquer domínio pelo gerenciador, mas suas funções são iniciadas apenas nos domínios habilitados. O funcionamento específico depende da estrutura do site, do player e das restrições do navegador.

## Instalação e uso

1. Instale o **Tampermonkey** no navegador.
2. Instale o AniStream Optimizer pelo botão de instalação desta página do Greasy Fork.
3. Abra um episódio em um dos sites habilitados e permita o userscript no Tampermonkey.
4. Abra o menu do Tampermonkey para ligar/desligar recursos, escolher qualidade, configurar atalhos, preparar a base offline ou ativar/desativar o script naquele site.
5. Use o botão AO para os comandos manuais: um clique abre o menu e um clique duplo expande ou recolhe o player. Toque duplo funciona como alternância em dispositivos móveis compatíveis com o gesto.

## Atalhos padrão

Todos podem ser alterados em **Atalhos e ajuda…**. `Shift` junto a um atalho de direção move o botão em passos maiores.

| Ação | Padrão |
| --- | --- |
| Próximo episódio | `N` |
| Pular intro | `V` |
| Pular vinheta/final | `Q` |
| Expandir/recolher player | `T` |
| Mover botão | `Alt` + setas |
| Passo maior ao mover | `Shift` |
| Desfazer pulo (enquanto o aviso aparece) | `Ctrl+Z` |

Os avanços manuais padrão são **85 segundos** para a intro e **10 segundos** para a vinheta/final; ambos são configuráveis. O Auto Next antecipa **3 segundos** por padrão.

## Privacidade e conexões

Para obter dados de AniSkip, o script consulta `api.aniskip.com`; pode consultar o AniList para identificar a série/episódio e usar a base offline de anime do projeto Manami. As informações e preferências do script são guardadas localmente pelo Tampermonkey. O script não inclui uma conta própria nem sincronização de preferências entre dispositivos.

## Observações

- Nem todos os episódios têm tempos cadastrados no AniSkip.
- Autoplay e tela cheia podem ser limitados pelas políticas do navegador ou do site.
- Qualidade fixa só está disponível quando o player expõe opções compatíveis; em Automática, a escolha permanece sob controle do player.
- Auto Next e os comandos de expansão dependem de o site expor um controle reconhecível.
- O projeto não hospeda nem fornece vídeos; ele controla funções da página em que o usuário já está assistindo.
