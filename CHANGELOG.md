AniStream Optimizer 1.3.2

- Corrige a seleção de player no Goyabu: prioriza HD, não alterna servidores por ausência de vídeo detectável e tenta fallback apenas após erro confirmado.
- Ajusta autoplay em iframes Blogger para iniciar silenciado e aplica permissões sem recarregar o iframe.
- Impede que controles genéricos de resultados de busca sejam acionados pelo autoclicker.
- Faz o duplo clique no botão flutuante solicitar fullscreen nativo durante o gesto e mantém o modo teatro automático entre episódios quando Auto Fullscreen está ativo.

AniStream Optimizer 1.3.1

- Corrige AniSkip em players cross-origin carregados com atraso, incluindo AnimesROLL.

AniStream Optimizer 1.3.0

- Adiciona a identidade visual AO ao botão flutuante e ao menu usando SVG inline, sem imagens ou dependências externas.
- Unifica o controle do player: clique simples no botão flutuante abre os comandos; clique duplo alterna o modo expandido.
- Posiciona o botão X compacto fora do menu e ao lado do botão principal; ele fecha somente os comandos e acompanha o reposicionamento do botão.
- Torna a seleção automática Full HD mais segura, aguardando estabilidade e validando a reprodução antes de concluir a troca.
- Melhora a recuperação do AniSkip após falhas temporárias, valida os intervalos recebidos e ignora respostas atrasadas de episódios anteriores.
- Adiciona testes automatizados para AniSkip, seleção Full HD, menu, botão flutuante e identidade visual.

AniStream Optimizer 1.2.2

- Melhora a acessibilidade e a operação por teclado do menu e do botão flutuante, incluindo foco, estados anunciados e reposicionamento.
- Ajusta os avisos de pulo e o botão Desfazer, incluindo o atalho Ctrl+Z enquanto a notificação estiver visível.
- Corrige a inicialização da preferência de qualidade e aprimora a detecção de players e fontes.
- Melhora o autoplay no player Mobile do AnimesDrive e reduz para 5 segundos a espera para tentar outra fonte sem progresso.
- Mantém a preferência de qualidade em Automática por padrão.

- Adiciona um comando direto para ativar/desativar os atalhos globais; os botões do player continuam disponíveis e a mudança vale sem recarregar a página.
- Acrescenta descrições exibidas ao passar o mouse sobre os comandos do menu do Tampermonkey (requer Tampermonkey 5.0 ou superior).
- Move 'Atalhos e ajuda' para o início do menu para ficar visível sem rolar a lista de comandos.
- Faz 'Atalhos e ajuda' abrir um painel integrado com atalhos atuais, estado global e configuração de teclas, sem depender de prompt do navegador.
- Permite editar todos os atalhos (incluindo combinações com Ctrl, Alt, Shift e Meta), configurar o reposicionamento do botão e os passos de movimento, e impede combinações duplicadas.
- Substitui a barra inserida junto ao player por um único menu flutuante; o botão verde abre os comandos tanto no player normal quanto no expandido. Reúne próximo episódio, pulo manual, Auto Play, Auto Next, AniSkip e Auto Expandir.
