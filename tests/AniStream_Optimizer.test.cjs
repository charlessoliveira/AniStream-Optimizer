const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'AniStream_Optimizer.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function extrairFuncao(nome, proximaFuncao) {
    const inicios = [
        source.indexOf(`    function ${nome}(`),
        source.indexOf(`    async function ${nome}(`)
    ].filter(indice => indice !== -1);
    const inicio = inicios.length ? Math.min(...inicios) : -1;
    const fim = source.indexOf(`    function ${proximaFuncao}(`, inicio);
    assert.notEqual(inicio, -1, `Função ${nome} não encontrada`);
    assert.notEqual(fim, -1, `Limite da função ${nome} não encontrado`);
    return source.slice(inicio, fim);
}

function criarCenario() {
    let agora = 1000;
    let videos = [];
    const mensagens = [];
    const servidorAnterior = {
        isConnected: true,
        active: true,
        cliques: 0,
        click() { this.cliques++; }
    };
    const botaoFHD = {
        isConnected: true,
        active: false,
        cliques: 0,
        click() {
            this.cliques++;
            servidorAnterior.active = false;
            this.active = true;
            videos = [videoNovo];
        }
    };
    const videoNovo = {
        isConnected: true,
        paused: true,
        ended: false,
        muted: false,
        currentTime: 0,
        videoWidth: 1920,
        videoHeight: 1080,
        readyState: 4,
        seeking: false,
        currentSrc: 'novo-stream',
        pause() { this.paused = true; }
    };
    let servidores = [
        { botao: servidorAnterior, rotulo: 'Servidor 720p' },
        { botao: botaoFHD, rotulo: 'Full HD 1080p' }
    ];

    const contexto = {
        autoFHD: true,
        ehJanelaPrincipal: true,
        estadoAutoFHD: 'espera',
        tentativaAutoFHD: null,
        sequenciaTentativaAutoFHD: 0,
        estabilidadeListaServidores: { assinatura: '', desde: 0 },
        tentouMudarQualidade: false,
        watchdogTempo: 8,
        epoca: 1,
        document: {},
        REGEX_SERVIDOR_FULLHD: /\b(?:FHD|FULL\s*HD|1080P?)\b/i,
        Date: class extends Date {
            static now() { return agora; }
        },
        Set,
        Map,
        clearTimeout() {},
        coletarTodosOsDocumentosIncluindoIframes() { return [{}]; },
        obterBotoesDeServidor() { return servidores; },
        obterVideosDoPlayer() { return videos; },
        listarTodosOsVideosEncontrados() { return videos; },
        obterOuCriarEstadoDoVideo(video) { return video.estado || { tPlaying: 0 }; },
        videoEstaTocandoHaMaisDeVinteSegundos(video) {
            return !video.paused && !video.ended &&
                (Number(video.currentTime) > 20 ||
                    (video.estado && Date.now() - video.estado.tPlaying > 20000));
        },
        botaoServidorEstaAtivo(botao) { return botao.active; },
        tentarRestaurarServidorAnterior(tentativa) {
            if (!tentativa || !tentativa.servidorAnterior || !tentativa.servidorAnterior.isConnected) return false;
            tentativa.servidorAnterior.click();
            return true;
        },
        liberarSolicitacaoTeatroAutoFHD() {},
        exibirMensagemBreveNoPainel(mensagem) { mensagens.push(mensagem); }
    };

    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('concluirTentativaAutoFHD', 'obterVideosDoPlayer'),
        extrairFuncao('falharTentativaAutoFHD', 'atualizarAutoFHD'),
        extrairFuncao('atualizarAutoFHD', 'tentarClicarProximoServidor')
    ].join('\n'), contexto);

    return {
        contexto, mensagens, servidorAnterior, botaoFHD, videoNovo,
        definirAgora(valor) { agora = valor; },
        definirVideos(valor) { videos = valor; },
        definirServidores(valor) { servidores = valor; },
        atualizar() { contexto.atualizarAutoFHD(); }
    };
}

test('Full HD já ativo não provoca clique', () => {
    const cenario = criarCenario();
    cenario.botaoFHD.active = true;
    cenario.atualizar();

    assert.equal(cenario.botaoFHD.cliques, 0);
    assert.equal(cenario.contexto.estadoAutoFHD, 'concluido');
});

test('vídeo reproduzido há mais de 20 segundos não é interrompido', () => {
    const cenario = criarCenario();
    cenario.definirVideos([{
        paused: false,
        ended: false,
        currentTime: 21,
        estado: { tPlaying: 900 }
    }]);
    cenario.atualizar();

    assert.equal(cenario.botaoFHD.cliques, 0);
    assert.equal(cenario.contexto.estadoAutoFHD, 'concluido');
});

test('lista de servidores instável aguarda estabilização antes do clique', () => {
    const cenario = criarCenario();
    cenario.atualizar();
    cenario.definirAgora(2100);
    cenario.definirServidores([
        { botao: cenario.servidorAnterior, rotulo: 'Servidor 720p' },
        { botao: cenario.botaoFHD, rotulo: 'Full HD 1080p' },
        { botao: { isConnected: true, get active() { return false; } }, rotulo: 'Servidor 480p' }
    ]);
    cenario.atualizar();
    cenario.definirAgora(3000);
    cenario.atualizar();
    assert.equal(cenario.botaoFHD.cliques, 0);
    assert.equal(cenario.contexto.estadoAutoFHD, 'espera');

    cenario.definirAgora(3400);
    cenario.atualizar();
    assert.equal(cenario.botaoFHD.cliques, 1);
    assert.equal(cenario.contexto.estadoAutoFHD, 'verificando');
});

test('troca bem-sucedida exige reprodução avançando com dimensões de imagem', () => {
    const cenario = criarCenario();
    cenario.atualizar();
    cenario.definirAgora(3000);
    cenario.atualizar();
    assert.equal(cenario.contexto.estadoAutoFHD, 'verificando');

    cenario.videoNovo.paused = false;
    cenario.videoNovo.currentTime = 1;
    cenario.definirAgora(4000);
    cenario.atualizar();
    cenario.videoNovo.currentTime = 2;
    cenario.definirAgora(5000);
    cenario.atualizar();

    assert.equal(cenario.contexto.estadoAutoFHD, 'concluido');
    assert.ok(cenario.mensagens.some(mensagem => mensagem.includes('reproduzindo com imagem')));
});

test('tela preta com tempo avançando tenta restaurar o servidor anterior e não repete', () => {
    const cenario = criarCenario();
    cenario.atualizar();
    cenario.definirAgora(3000);
    cenario.atualizar();

    cenario.videoNovo.paused = false;
    cenario.videoNovo.videoWidth = 0;
    cenario.videoNovo.videoHeight = 0;
    cenario.videoNovo.currentTime = 1;
    cenario.definirAgora(4000);
    cenario.atualizar();
    cenario.videoNovo.currentTime = 2;
    cenario.definirAgora(5000);
    cenario.atualizar();
    cenario.videoNovo.currentTime = 3;
    cenario.definirAgora(7000);
    cenario.atualizar();
    cenario.atualizar();

    assert.equal(cenario.contexto.estadoAutoFHD, 'concluido');
    assert.equal(cenario.botaoFHD.cliques, 1);
    assert.equal(cenario.servidorAnterior.cliques, 1);
    assert.ok(cenario.mensagens.some(mensagem => mensagem.includes('tela preta')));
});

test('verificação sem resultado termina em 10 segundos sem clicar em servidor desconhecido', () => {
    const cenario = criarCenario();
    cenario.definirServidores([{ botao: cenario.botaoFHD, rotulo: 'Full HD 1080p' }]);
    cenario.atualizar();
    cenario.definirAgora(3000);
    cenario.atualizar();
    cenario.definirAgora(13000);
    cenario.atualizar();
    cenario.atualizar();

    assert.equal(cenario.contexto.estadoAutoFHD, 'concluido');
    assert.equal(cenario.botaoFHD.cliques, 1);
    assert.equal(cenario.servidorAnterior.cliques, 0);
});

test('tentativa inicial expira após 15 segundos se os servidores não aparecerem', () => {
    const cenario = criarCenario();
    cenario.definirServidores([]);
    cenario.atualizar();
    cenario.definirAgora(16000);
    cenario.atualizar();

    assert.equal(cenario.contexto.estadoAutoFHD, 'concluido');
    assert.equal(cenario.botaoFHD.cliques, 0);
});

test('Auto-FHD não escolhe uma resolução alternativa quando Full HD está ausente', () => {
    const cenario = criarCenario();
    const servidor720 = {
        isConnected: true,
        cliques: 0,
        click() { this.cliques++; }
    };
    cenario.definirServidores([{ botao: servidor720, rotulo: '720p' }]);
    cenario.atualizar();
    cenario.definirAgora(16000);
    cenario.atualizar();

    assert.equal(servidor720.cliques, 0);
    assert.equal(cenario.botaoFHD.cliques, 0);
    assert.equal(cenario.contexto.estadoAutoFHD, 'concluido');
});

function criarCenarioTeatro() {
    const video = {
        isConnected: true,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 1920,
        videoHeight: 1080,
        currentSrc: 'video-atual'
    };
    const janela = {};
    janela.top = janela;
    const contexto = {
        autoFHD: true,
        ehJanelaPrincipal: true,
        estadoAutoFHD: 'espera',
        tentativaAutoFHD: { epoca: 7, id: 7, videosAnteriores: new Set() },
        epoca: 7,
        window: janela,
        clearTimeout() {},
        timerSolicitacaoTeatroAutoFHD: null,
        sequenciaSolicitacaoTeatro: 0,
        expansaoTeatroPendente: false,
        solicitacaoTeatroAutoFHD: null,
        ativacoes: 0,
        desativacoes: 0,
        obterVideosDoPlayer() { return [video]; },
        ativarModoTeatro: videoAtivado => {
            assert.equal(videoAtivado, video);
            contexto.ativacoes++;
        },
        desativarModoTeatro: () => { contexto.desativacoes++; },
        obterVideoAtualParaTeatro() { return video; },
        exibirMensagemBreveNoPainel() {},
        tentarRestaurarServidorAnterior() { return false; }
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('autoFHD AguardandoTeatro'.replace(' ', ''), 'obterVideoAtualParaTeatro'),
        extrairFuncao('obterVideoAtualParaTeatro', 'executarSolicitacaoTeatroAutoFHD'),
        extrairFuncao('executarSolicitacaoTeatroAutoFHD', 'liberarSolicitacaoTeatroAutoFHD'),
        extrairFuncao('liberarSolicitacaoTeatroAutoFHD', 'concluirTentativaAutoFHD'),
        extrairFuncao('concluirTentativaAutoFHD', 'obterVideosDoPlayer'),
        extrairFuncao('falharTentativaAutoFHD', 'atualizarAutoFHD'),
        extrairFuncao('solicitarModoTeatro', 'alternarModoTeatro')
    ].join('\n'), contexto);
    return { contexto, video };
}

test('expansão espera o resultado terminal do Auto-FHD e só então usa o vídeo atual', () => {
    const { contexto, video } = criarCenarioTeatro();
    contexto.solicitarModoTeatro(video, true);

    assert.equal(contexto.ativacoes, 0);
    assert.equal(contexto.expansaoTeatroPendente, true);

    contexto.tentativaAutoFHD.videoConfirmado = video;
    contexto.tentativaAutoFHD.fonteVideoConfirmado = video.currentSrc;
    contexto.concluirTentativaAutoFHD('', true);

    assert.equal(contexto.estadoAutoFHD, 'concluido');
    assert.equal(contexto.ativacoes, 1);
    assert.equal(contexto.expansaoTeatroPendente, false);
});

test('falha do Auto-FHD libera a expansão usando o vídeo válido disponível', () => {
    const { contexto, video } = criarCenarioTeatro();
    contexto.solicitarModoTeatro(video, true);

    contexto.falharTentativaAutoFHD('falha simulada');

    assert.equal(contexto.estadoAutoFHD, 'concluido');
    assert.equal(contexto.ativacoes, 1);
    assert.equal(contexto.expansaoTeatroPendente, false);
});

test('Auto-FHD desativado não atrasa a expansão', () => {
    const { contexto, video } = criarCenarioTeatro();
    contexto.autoFHD = false;
    contexto.solicitarModoTeatro(video, true);

    assert.equal(contexto.ativacoes, 1);
    assert.equal(contexto.expansaoTeatroPendente, false);
});

test('recolher durante a espera cancela a expansão pendente', () => {
    const { contexto, video } = criarCenarioTeatro();
    contexto.solicitarModoTeatro(video, true);
    contexto.solicitarModoTeatro(video, false);

    assert.equal(contexto.expansaoTeatroPendente, false);
    assert.equal(contexto.solicitacaoTeatroAutoFHD, null);
    assert.equal(contexto.ativacoes, 0);

    contexto.concluirTentativaAutoFHD('', true);
    assert.equal(contexto.ativacoes, 0);
});

test('callback de Auto-FHD de outra época não expande o player', () => {
    const { contexto, video } = criarCenarioTeatro();
    contexto.solicitarModoTeatro(video, true);
    contexto.epoca++;

    contexto.concluirTentativaAutoFHD('', true);

    assert.equal(contexto.ativacoes, 0);
    assert.equal(contexto.expansaoTeatroPendente, false);
});

test('menu não contém ações redundantes e mantém o atalho independente de teatro', () => {
    assert.doesNotMatch(source, /closeMenu|Fechar menu flutuante|lidarComEscapeMenuFlutuante/);
    assert.doesNotMatch(source, /data-au-acao="atalho-teatro"|data-au-acao="fechar"/);
    assert.match(source, /theater:\s*'t'/);
    assert.match(source, /\['Expandir\/recolher player',\s*'theater'\]/);
    assert.match(source, /function gerarHtmlBotoesBarra\(\)/);
    assert.match(source, /\.\.\.atalhosSalvosAnteriormente,\s*\.\.\.novaConfig/);
});

test('abrir comandos altera o estado do menu sem alternar o modo expandido', () => {
    const inicio = source.indexOf('abrirMenuFlutuante = () => {');
    const fim = source.indexOf('\n        };', inicio);
    assert.notEqual(inicio, -1);
    assert.notEqual(fim, -1);
    const abrir = source.slice(inicio, fim);

    assert.match(abrir, /classList\.add\('au-menu-flutuante-aberto'\)/);
    assert.doesNotMatch(abrir, /au-teatro-ativo|definirModoTeatro|solicitarModoTeatro/);
    assert.match(source, /setAttribute\('aria-expanded', String\(menuAberto\)\)/);
    assert.match(source, /setAttribute\('aria-pressed', String\(expandido\)\)/);
});

test('clique simples abre menu e clique duplo cancela o clique simples e alterna o modo', () => {
    const inicio = source.indexOf("fabTeatro.addEventListener('click', e =>");
    const fim = source.indexOf('\n        });', inicio);
    assert.notEqual(inicio, -1);
    assert.notEqual(fim, -1);
    const listener = source.slice(inicio, fim);

    assert.match(listener, /if \(timerCliqueFab !== null\)/);
    assert.match(listener, /clearTimeout\(timerCliqueFab\)/);
    assert.match(listener, /if \(!expandido && videoAtivo\) ativarTelaCheiaNoVideo\(videoAtivo, true\)/);
    assert.match(listener, /definirModoTeatro\(!expandido\)/);
    assert.match(listener, /setTimeout\(\(\) => \{[\s\S]*?abrirMenuFlutuante\(\);[\s\S]*?\}, 350\)/);
    assert.match(listener, /document\.body\.classList\.remove\('au-menu-flutuante-aberto'\)/);
});

test('duplo clique no FAB pode solicitar fullscreen nativo mesmo com Auto Fullscreen desligado', () => {
    const video = { isConnected: true };
    let solicitacoes = 0;
    const contexto = {
        autoFullscreen: false,
        fullscreenTentado: false,
        document: { fullscreenElement: null, webkitFullscreenElement: null },
        obterAdaptadorDeVideo() { return { requestFullscreen() { solicitacoes++; } }; },
        obterAlvoTelaCheia() { return { isConnected: true }; },
        prepararControlesParaTelaCheia() {},
        registrarListenerDeTelaCheia() {},
        restaurarControlesAposTelaCheia() {}
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('ativarTelaCheiaNoVideo', 'obterAlvoTelaCheia'), contexto);

    contexto.ativarTelaCheiaNoVideo(video);
    assert.equal(solicitacoes, 0);
    contexto.ativarTelaCheiaNoVideo(video, true);
    assert.equal(solicitacoes, 1);
});

test('autoclicker não aciona botões genéricos fora de uma área de embed', () => {
    const inicio = source.indexOf('    const SELETORES_AUTOCLICK_INICIAR = ');
    const fim = source.indexOf('    const SELETORES_AUTOCLICK_ALTERNAR = ', inicio);
    assert.notEqual(inicio, -1);
    assert.notEqual(fim, -1);
    const seletores = source.slice(inicio, fim);
    assert.doesNotMatch(seletores, /\.play-button/);
    assert.match(source, /if \(!controleSemVideoEhInicioDeEmbed\(btn\)\) return;/);

    const contexto = {
        SELETOR_AUTOCLICK_EMBED_SEGURO: '#pembed .embed-play .play-btn, .player-embed .embed-play .play-btn'
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('controleSemVideoEhInicioDeEmbed', 'executarAutoClickerDePlayers'), contexto);

    const botaoBusca = { matches: selector => selector.includes('.play-button') };
    const botaoEmbed = { matches: selector => selector.includes('.embed-play .play-btn') };
    assert.equal(contexto.controleSemVideoEhInicioDeEmbed(botaoBusca), false);
    assert.equal(contexto.controleSemVideoEhInicioDeEmbed(botaoEmbed), true);
});

test('botão X fecha somente o menu e tem nome acessível', () => {
    const inicio = source.indexOf("botaoFecharMenu.addEventListener('click', e =>");
    const fim = source.indexOf('\n            });', inicio);
    assert.notEqual(inicio, -1);
    assert.notEqual(fim, -1);
    const listener = source.slice(inicio, fim);

    assert.match(source, /botaoFecharMenu\.setAttribute\('aria-label', 'Fechar menu de comandos do player'\)/);
    assert.match(listener, /fecharMenuFlutuante\(\)/);
    assert.doesNotMatch(listener, /definirModoTeatro|solicitarModoTeatro|desativarModoTeatro/);
    const inicioFechar = source.indexOf('function fecharMenuFlutuante()');
    const fimFechar = source.indexOf('\n    let ignorarProximoFocoFab', inicioFechar);
    assert.notEqual(inicioFechar, -1);
    assert.notEqual(fimFechar, -1);
    assert.doesNotMatch(source.slice(inicioFechar, fimFechar), /au-teatro-ativo|definirModoTeatro|solicitarModoTeatro|desativarModoTeatro/);
});

test('arrasto e posição persistente permanecem ligados ao botão principal', () => {
    assert.match(source, /fabTeatro\.addEventListener\('pointerdown'/);
    assert.match(source, /fabTeatro\.addEventListener\('pointermove'/);
    assert.match(source, /fabTeatro\.addEventListener\('pointerup'/);
    assert.match(source, /GM_setValue\('au_fab_posicao_v1', pos\)/);
    assert.match(source, /const direcoes = \[[\s\S]*?\['moveDown', 0, 1\]/);
});

test('normalização aceita somente intervalos OP/ED válidos para busca, cache e frames', () => {
    const contexto = {};
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('normalizarResultadosAniSkip', 'aniskipMalIdValido'), contexto);
    const resultado = contexto.normalizarResultadosAniSkip([
        { skipType: 'op', interval: { startTime: 10, endTime: 30 } },
        { skipType: 'ed', interval: { startTime: 90, endTime: 110 } },
        { skipType: 'recap', interval: { startTime: 30, endTime: 40 } },
        { skipType: 'op', interval: { startTime: 40, endTime: 40 } },
        null
    ]);

    assert.deepEqual(JSON.parse(JSON.stringify(resultado)), [
        { skipType: 'op', interval: { startTime: 10, endTime: 30 }, jaPulou: false },
        { skipType: 'ed', interval: { startTime: 90, endTime: 110 }, jaPulou: false }
    ]);
});

test('falha temporária agenda retry crescente e libera a busca', () => {
    let agora = 10000;
    const contexto = {
        aniskipBuscado: true,
        tentativasLeituraAniSkip: 0,
        tentativasFalhaAniSkip: 0,
        proximaBuscaAniSkipEm: 0,
        Date: { now: () => agora },
        Math
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('agendarRetryAniSkip', 'aniskipBuscaAindaAtual'), contexto);

    assert.equal(contexto.agendarRetryAniSkip(), 5000);
    assert.equal(contexto.aniskipBuscado, false);
    assert.equal(contexto.proximaBuscaAniSkipEm, 15000);
    agora += 5000;
    assert.equal(contexto.agendarRetryAniSkip(), 10000);
    assert.equal(contexto.proximaBuscaAniSkipEm, 25000);
    assert.match(source, /if \(msgErro\.includes\('HTTP 429'\)\)[\s\S]*?repetirBusca = true/);
    assert.match(source, /finally \{[\s\S]*?agendarRetryAniSkip\(aguardandoMetadados\)/);
});

test('iframe agenda uma única busca local em 1,5 s se o pai não respondeu', () => {
    let agoraAgendado;
    let callbackAgendado;
    let buscas = 0;
    const contexto = {
        ehJanelaPrincipal: false,
        autoAniSkip: true,
        temporizadorBuscaLocalAniSkip: null,
        aniskipBuscaEmAndamento: false,
        aniskipBuscado: false,
        cacheAniSkip: null,
        executarBuscaLocalAniSkip() { buscas++; contexto.aniskipBuscaEmAndamento = true; },
        buscaLocalAniSkipCallbackIndisponivel: false,
        sequenciaSolicitacaoDadosAniSkip: 0,
        tokenSolicitacaoDadosAniSkip: null,
        tokenDadosAniSkipRecebidos: null,
        urlSolicitacaoDadosAniSkip: '',
        epocaSolicitacaoDadosAniSkip: -1,
        epoca: 2,
        sequenciaBuscaAniSkip: 4,
        proximaBuscaAniSkipEm: 0,
        window: { location: { href: 'https://anidrive.click/token/abc' } },
        Date,
        setTimeout(callback, atraso) {
            callbackAgendado = callback;
            agoraAgendado = atraso;
            return 17;
        },
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('obterTokenSolicitacaoDadosAniSkip', 'tokenSolicitacaoDadosAniSkipAindaAtual'),
        extrairFuncao('tokenSolicitacaoDadosAniSkipAindaAtual', 'agendarBuscaLocalAniSkip'),
        extrairFuncao('agendarBuscaLocalAniSkip', 'solicitarDadosAniSkipAoPai')
    ].join('\n'), contexto);

    contexto.agendarBuscaLocalAniSkip();
    contexto.agendarBuscaLocalAniSkip();
    assert.equal(agoraAgendado, 1500);
    assert.equal(contexto.temporizadorBuscaLocalAniSkip, 17);
    assert.equal(buscas, 0);

    callbackAgendado();
    assert.equal(contexto.temporizadorBuscaLocalAniSkip, null);
    assert.equal(buscas, 1);
});

test('fallback local espera uma única vez pelo callback e não bloqueia nova inicialização', () => {
    const timers = [];
    let buscas = 0;
    const contexto = {
        ehJanelaPrincipal: false,
        autoAniSkip: true,
        temporizadorBuscaLocalAniSkip: null,
        aniskipBuscaEmAndamento: false,
        aniskipBuscado: false,
        cacheAniSkip: null,
        executarBuscaLocalAniSkip: null,
        buscaLocalAniSkipCallbackIndisponivel: false,
        sequenciaSolicitacaoDadosAniSkip: 0,
        tokenSolicitacaoDadosAniSkip: null,
        tokenDadosAniSkipRecebidos: null,
        urlSolicitacaoDadosAniSkip: '',
        epocaSolicitacaoDadosAniSkip: -1,
        epoca: 1,
        sequenciaBuscaAniSkip: 0,
        proximaBuscaAniSkipEm: 0,
        window: { location: { href: 'https://anidrive.click/token/late-init' } },
        Date,
        setTimeout(callback, atraso) { timers.push({ callback, atraso }); return timers.length; },
        console: { error() {} }
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('obterTokenSolicitacaoDadosAniSkip', 'tokenSolicitacaoDadosAniSkipAindaAtual'),
        extrairFuncao('tokenSolicitacaoDadosAniSkipAindaAtual', 'agendarBuscaLocalAniSkip'),
        extrairFuncao('agendarBuscaLocalAniSkip', 'solicitarDadosAniSkipAoPai')
    ].join('\n'), contexto);

    contexto.agendarBuscaLocalAniSkip();
    assert.equal(timers[0].atraso, 1500);
    timers.shift().callback();
    assert.equal(timers[0].atraso, 250);
    assert.equal(contexto.aniskipBuscado, false);

    contexto.executarBuscaLocalAniSkip = () => { buscas++; };
    timers.shift().callback();
    assert.equal(buscas, 1);
    assert.equal(contexto.buscaLocalAniSkipCallbackIndisponivel, false);
    assert.match(source, /executarBuscaLocalAniSkip = \(\) => buscarTemposAniSkip\(\)/);
});

test('fallback local atrasado é descartado após mudança de URL, época ou dados do pai', () => {
    function criarFallback() {
        let callback;
        let buscas = 0;
        const contexto = {
            ehJanelaPrincipal: false,
            autoAniSkip: true,
            temporizadorBuscaLocalAniSkip: null,
            aniskipBuscaEmAndamento: false,
            aniskipBuscado: false,
            cacheAniSkip: null,
            executarBuscaLocalAniSkip() { buscas++; },
            buscaLocalAniSkipCallbackIndisponivel: false,
            sequenciaSolicitacaoDadosAniSkip: 0,
            tokenSolicitacaoDadosAniSkip: null,
            tokenDadosAniSkipRecebidos: null,
            urlSolicitacaoDadosAniSkip: '',
            epocaSolicitacaoDadosAniSkip: -1,
            epoca: 1,
            sequenciaBuscaAniSkip: 3,
            proximaBuscaAniSkipEm: 0,
            window: { location: { href: 'https://anidrive.click/token/ep-1' } },
            Date,
            setTimeout(fn) { callback = fn; return 5; },
        };
        vm.createContext(contexto);
        vm.runInContext([
            extrairFuncao('obterTokenSolicitacaoDadosAniSkip', 'tokenSolicitacaoDadosAniSkipAindaAtual'),
            extrairFuncao('tokenSolicitacaoDadosAniSkipAindaAtual', 'agendarBuscaLocalAniSkip'),
            extrairFuncao('agendarBuscaLocalAniSkip', 'solicitarDadosAniSkipAoPai')
        ].join('\n'), contexto);
        contexto.agendarBuscaLocalAniSkip();
        return { contexto, executar() { callback(); }, obterBuscas() { return buscas; } };
    }

    const urlMudou = criarFallback();
    urlMudou.contexto.window.location.href = 'https://anidrive.click/token/ep-2';
    urlMudou.executar();
    assert.equal(urlMudou.obterBuscas(), 0);

    const epocaMudou = criarFallback();
    epocaMudou.contexto.epoca++;
    epocaMudou.executar();
    assert.equal(epocaMudou.obterBuscas(), 0);

    const paiRespondeu = criarFallback();
    paiRespondeu.contexto.cacheAniSkip = [{ skipType: 'op', interval: { startTime: 1, endTime: 2 } }];
    paiRespondeu.executar();
    assert.equal(paiRespondeu.obterBuscas(), 0);

    assert.match(source, /cancelarBuscaLocalAniSkip\(\);[\s\S]{0,250}if \(aniskipBuscaEmAndamento\)[\s\S]{0,100}sequenciaBuscaAniSkip\+\+;[\s\S]{0,140}cacheAniSkip = temposRecebidos;/);
    assert.match(source, /requestId === tokenDadosAniSkipRecebidos\) return;/);
    assert.match(source, /requestId,[\s\S]*?dados: cacheAniSkip/);
});

test('fallback local aguarda o backoff AniSkip em vez de consumir a única tentativa', () => {
    let agora = 1000;
    const timers = [];
    let buscas = 0;
    const contexto = {
        ehJanelaPrincipal: false,
        autoAniSkip: true,
        temporizadorBuscaLocalAniSkip: null,
        aniskipBuscaEmAndamento: false,
        aniskipBuscado: false,
        cacheAniSkip: null,
        executarBuscaLocalAniSkip() { buscas++; },
        buscaLocalAniSkipCallbackIndisponivel: false,
        sequenciaSolicitacaoDadosAniSkip: 0,
        tokenSolicitacaoDadosAniSkip: null,
        tokenDadosAniSkipRecebidos: null,
        urlSolicitacaoDadosAniSkip: '',
        epocaSolicitacaoDadosAniSkip: -1,
        epoca: 2,
        sequenciaBuscaAniSkip: 4,
        proximaBuscaAniSkipEm: 8000,
        window: { location: { href: 'https://anidrive.click/token/backoff' } },
        Date: { now: () => agora },
        setTimeout(callback, atraso) { timers.push({ callback, atraso }); return timers.length; },
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('obterTokenSolicitacaoDadosAniSkip', 'tokenSolicitacaoDadosAniSkipAindaAtual'),
        extrairFuncao('tokenSolicitacaoDadosAniSkipAindaAtual', 'agendarBuscaLocalAniSkip'),
        extrairFuncao('agendarBuscaLocalAniSkip', 'solicitarDadosAniSkipAoPai')
    ].join('\n'), contexto);
    contexto.agendarBuscaLocalAniSkip();

    assert.equal(timers[0].atraso, 1500);
    agora = 2500;
    timers.shift().callback();
    assert.equal(buscas, 0);
    assert.equal(timers[0].atraso, 5500);

    agora = 8000;
    timers.shift().callback();
    assert.equal(buscas, 1);
});

test('token de resposta AniSkip muda junto com URL ou época e rejeita tokens antigos', () => {
    const contexto = {
        sequenciaSolicitacaoDadosAniSkip: 0,
        tokenSolicitacaoDadosAniSkip: null,
        tokenDadosAniSkipRecebidos: null,
        urlSolicitacaoDadosAniSkip: '',
        epocaSolicitacaoDadosAniSkip: -1,
        epoca: 7,
        window: { location: { href: 'https://anidrive.click/token/ep-7' } },
        Date
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('obterTokenSolicitacaoDadosAniSkip', 'tokenSolicitacaoDadosAniSkipAindaAtual'),
        extrairFuncao('tokenSolicitacaoDadosAniSkipAindaAtual', 'agendarBuscaLocalAniSkip')
    ].join('\n'), contexto);

    const tokenAntigo = contexto.obterTokenSolicitacaoDadosAniSkip();
    assert.equal(contexto.tokenSolicitacaoDadosAniSkipAindaAtual(tokenAntigo), true);
    contexto.window.location.href = 'https://anidrive.click/token/ep-8';
    const tokenNovo = contexto.obterTokenSolicitacaoDadosAniSkip();
    assert.notEqual(tokenNovo, tokenAntigo);
    assert.equal(contexto.tokenSolicitacaoDadosAniSkipAindaAtual(tokenAntigo), false);
    contexto.epoca++;
    const tokenDaEpocaNova = contexto.obterTokenSolicitacaoDadosAniSkip();
    assert.notEqual(tokenDaEpocaNova, tokenNovo);
    assert.equal(contexto.tokenSolicitacaoDadosAniSkipAindaAtual(tokenNovo), false);
});

test('busca simulada recupera falha de rede e transmite os intervalos no retry', async () => {
    let agora = 1000;
    let requisicoes = 0;
    let transmissao = 0;
    let aplicacaoPulo = 0;
    const contexto = {
        autoAniSkip: true,
        aniskipBuscado: false,
        aniskipBuscaEmAndamento: false,
        sequenciaBuscaAniSkip: 0,
        tentativasFalhaAniSkip: 0,
        tentativasLeituraAniSkip: 0,
        proximaBuscaAniSkipEm: 0,
        epoca: 4,
        cacheAniSkip: null,
        window: { location: { href: 'https://anime.test/episode-7' } },
        Date: class { static now() { return agora; } },
        URLSearchParams,
        GM_getValue(chave, padrao) { return chave === 'aniskip_malid_teste' ? 55 : padrao; },
        extrairInfoDoEpisodioParaAniSkip() { return { nomeLimpo: 'Teste', episodio: 7 }; },
        nomeAnimeAtualParaExibicao: '',
        obterMalIdManualParaEpisodio() { return null; },
        garantirMetadadosDoAnime() { return Promise.resolve(); },
        atualizarStatusAniSkip() {},
        obterChaveDaSerie() { return 'teste'; },
        requisitarJsonAniSkip() {
            requisicoes++;
            if (requisicoes === 1) return Promise.reject(new Error('Erro de rede'));
            return Promise.resolve({
                found: true,
                results: [{ skipType: 'op', interval: { startTime: 80, endTime: 100 } }]
            });
        },
        normalizarResultadosAniSkip(resultados) {
            return resultados.filter(item => item && item.interval &&
                Number.isFinite(item.interval.startTime) &&
                Number.isFinite(item.interval.endTime) &&
                item.interval.endTime > item.interval.startTime)
                .map(item => Object.assign({}, item, { jaPulou: false }));
        },
        aniskipMalIdValido(valor) { return Number.isSafeInteger(Number(valor)) && Number(valor) > 0; },
        aniskipBuscaAindaAtual(sequencia, epoca, url) {
            return sequencia === contexto.sequenciaBuscaAniSkip &&
                epoca === contexto.epoca && url === contexto.window.location.href;
        },
        agendarRetryAniSkip() {
            contexto.aniskipBuscado = false;
            const atraso = Math.min(60000, 5000 * (2 ** Math.min(contexto.tentativasFalhaAniSkip, 4)));
            contexto.tentativasFalhaAniSkip++;
            contexto.proximaBuscaAniSkipEm = agora + atraso;
            return atraso;
        },
        transmitirDadosAniSkipParaFrames() { transmissao++; },
        aplicarPuloAniSkipSeJaEstiverNoTrecho() { aplicacaoPulo++; }
    };
    vm.createContext(contexto);
    vm.runInContext(
        extrairFuncao('buscarTemposAniSkip', 'auxiliarDeAutoplayInjetadoNaPagina'),
        contexto
    );

    await contexto.buscarTemposAniSkip();
    assert.equal(contexto.aniskipBuscaEmAndamento, false);
    assert.equal(contexto.aniskipBuscado, false);
    assert.equal(contexto.proximaBuscaAniSkipEm, 6000);
    assert.equal(requisicoes, 1);

    agora = contexto.proximaBuscaAniSkipEm;
    await contexto.buscarTemposAniSkip();
    assert.equal(requisicoes, 2);
    assert.equal(contexto.aniskipBuscado, true);
    assert.equal(contexto.cacheAniSkip[0].interval.endTime, 100);
    assert.equal(transmissao, 1);
    assert.equal(aplicacaoPulo, 1);
});

test('resolução AniSkip pendente é descartada ao mudar o episódio durante a busca offline', async () => {
    let resolverOffline;
    let requisicoes = 0;
    const mensagens = [];
    const contexto = {
        autoAniSkip: true,
        aniskipBuscado: false,
        aniskipBuscaEmAndamento: false,
        sequenciaBuscaAniSkip: 0,
        tentativasFalhaAniSkip: 0,
        tentativasLeituraAniSkip: 0,
        proximaBuscaAniSkipEm: 0,
        epoca: 3,
        cacheAniSkip: null,
        window: { location: { href: 'https://anime.test/episode-3' } },
        Date,
        URLSearchParams,
        GM_getValue() { return null; },
        GM_setValue() { assert.fail('Busca obsoleta não pode persistir dados'); },
        extrairInfoDoEpisodioParaAniSkip() { return { nomeLimpo: 'Teste', episodio: 3 }; },
        nomeAnimeAtualParaExibicao: '',
        obterMalIdManualParaEpisodio() { return null; },
        buscarMalIdOffline() { return new Promise(resolve => { resolverOffline = resolve; }); },
        buscarMalIdViaAniList() { assert.fail('Busca obsoleta não deve avançar para AniList'); },
        garantirMetadadosDoAnime() {},
        atualizarStatusAniSkip(_nome, _ep, mensagem) { mensagens.push(mensagem); },
        obterChaveDaSerie() { return 'teste'; },
        requisitarJsonAniSkip() { requisicoes++; },
        aniskipMalIdValido(valor) { return Number.isSafeInteger(Number(valor)) && Number(valor) > 0; },
        aniskipBuscaAindaAtual(sequencia, epoca, url) {
            return sequencia === contexto.sequenciaBuscaAniSkip &&
                epoca === contexto.epoca && url === contexto.window.location.href;
        },
        agendarRetryAniSkip() { assert.fail('Busca obsoleta não deve agendar retry'); }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('buscarTemposAniSkip', 'auxiliarDeAutoplayInjetadoNaPagina'), contexto);

    const busca = contexto.buscarTemposAniSkip();
    await Promise.resolve();
    const mensagensAntesDaMudanca = mensagens.length;
    contexto.sequenciaBuscaAniSkip++;
    contexto.epoca++;
    contexto.window.location.href = 'https://anime.test/episode-4';
    resolverOffline(null);
    await busca;

    assert.equal(mensagens.length, mensagensAntesDaMudanca);
    assert.equal(requisicoes, 0);
    assert.equal(contexto.cacheAniSkip, null);
});

test('resolução AniList pendente não persiste nem consulta AniSkip após mudança de episódio', async () => {
    let resolverAniList;
    let sinalizarAniListChamado;
    let requisicoes = 0;
    const mensagens = [];
    const aniListChamado = new Promise(resolve => { sinalizarAniListChamado = resolve; });
    const contexto = {
        autoAniSkip: true,
        aniskipBuscado: false,
        aniskipBuscaEmAndamento: false,
        sequenciaBuscaAniSkip: 0,
        tentativasFalhaAniSkip: 0,
        tentativasLeituraAniSkip: 0,
        proximaBuscaAniSkipEm: 0,
        epoca: 5,
        cacheAniSkip: null,
        window: { location: { href: 'https://anime.test/episode-5' } },
        Date,
        URLSearchParams,
        GM_getValue() { return null; },
        GM_setValue() { assert.fail('Busca obsoleta não pode persistir dados'); },
        extrairInfoDoEpisodioParaAniSkip() { return { nomeLimpo: 'Teste', episodio: 5 }; },
        nomeAnimeAtualParaExibicao: '',
        obterMalIdManualParaEpisodio() { return null; },
        buscarMalIdOffline() { return Promise.resolve(null); },
        buscarMalIdViaAniList() {
            return new Promise(resolve => {
                resolverAniList = resolve;
                sinalizarAniListChamado();
            });
        },
        garantirMetadadosDoAnime() {},
        atualizarStatusAniSkip(_nome, _ep, mensagem) { mensagens.push(mensagem); },
        obterChaveDaSerie() { return 'teste'; },
        requisitarJsonAniSkip() { requisicoes++; },
        aniskipMalIdValido(valor) { return Number.isSafeInteger(Number(valor)) && Number(valor) > 0; },
        aniskipBuscaAindaAtual(sequencia, epoca, url) {
            return sequencia === contexto.sequenciaBuscaAniSkip &&
                epoca === contexto.epoca && url === contexto.window.location.href;
        },
        agendarRetryAniSkip() { assert.fail('Busca obsoleta não deve agendar retry'); }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('buscarTemposAniSkip', 'auxiliarDeAutoplayInjetadoNaPagina'), contexto);

    const busca = contexto.buscarTemposAniSkip();
    await aniListChamado;
    const mensagensAntesDaMudanca = mensagens.length;
    contexto.sequenciaBuscaAniSkip++;
    contexto.epoca++;
    contexto.window.location.href = 'https://anime.test/episode-6';
    resolverAniList({ malId: 123, origem: 'teste' });
    await busca;

    assert.equal(mensagens.length, mensagensAntesDaMudanca);
    assert.equal(requisicoes, 0);
    assert.equal(contexto.cacheAniSkip, null);
});

test('resposta AniSkip atrasada de um episódio não altera status nem cache do atual', async () => {
    let resolverTempos;
    let requisicaoIniciada;
    const requisicaoAniSkipIniciada = new Promise(resolve => { requisicaoIniciada = resolve; });
    const mensagens = [];
    const contexto = {
        autoAniSkip: true,
        aniskipBuscado: false,
        aniskipBuscaEmAndamento: false,
        sequenciaBuscaAniSkip: 0,
        tentativasFalhaAniSkip: 0,
        tentativasLeituraAniSkip: 0,
        proximaBuscaAniSkipEm: 0,
        epoca: 9,
        cacheAniSkip: null,
        window: { location: { href: 'https://anime.test/episode-9' } },
        Date,
        URLSearchParams,
        GM_getValue(chave, padrao) { return chave === 'aniskip_malid_teste' ? 55 : padrao; },
        GM_setValue() {},
        extrairInfoDoEpisodioParaAniSkip() { return { nomeLimpo: 'Teste', episodio: 9 }; },
        nomeAnimeAtualParaExibicao: '',
        obterMalIdManualParaEpisodio() { return { malId: 55, origem: 'manual' }; },
        garantirMetadadosDoAnime() { return Promise.resolve(); },
        atualizarStatusAniSkip(_nome, _ep, mensagem) { mensagens.push(mensagem); },
        obterChaveDaSerie() { return 'teste'; },
        aniskipMalIdValido(valor) { return Number.isSafeInteger(Number(valor)) && Number(valor) > 0; },
        requisitarJsonAniSkip() {
            requisicaoIniciada();
            return new Promise(resolve => { resolverTempos = resolve; });
        },
        aniskipBuscaAindaAtual(sequencia, epoca, url) {
            return sequencia === contexto.sequenciaBuscaAniSkip &&
                epoca === contexto.epoca && url === contexto.window.location.href;
        }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('buscarTemposAniSkip', 'auxiliarDeAutoplayInjetadoNaPagina'), contexto);

    const busca = contexto.buscarTemposAniSkip();
    await requisicaoAniSkipIniciada;
    const mensagensAntesDaMudanca = mensagens.length;
    contexto.sequenciaBuscaAniSkip++;
    contexto.epoca++;
    contexto.window.location.href = 'https://anime.test/episode-10';
    resolverTempos({
        found: true,
        results: [{ skipType: 'op', interval: { startTime: 20, endTime: 40 } }]
    });
    await busca;

    assert.equal(mensagens.length, mensagensAntesDaMudanca);
    assert.equal(contexto.cacheAniSkip, null);
});

test('429 agenda nova tentativa e 404 continua sendo tratado como ausência de tempos', async () => {
    async function executarErro(status) {
        const mensagens = [];
        let reagendamentos = 0;
        const contexto = {
            autoAniSkip: true,
            aniskipBuscado: false,
            aniskipBuscaEmAndamento: false,
            sequenciaBuscaAniSkip: 0,
            tentativasFalhaAniSkip: 0,
            tentativasLeituraAniSkip: 0,
            proximaBuscaAniSkipEm: 0,
            epoca: 2,
            cacheAniSkip: null,
            window: { location: { href: 'https://anime.test/episode-2' } },
            Date,
            URLSearchParams,
            GM_getValue(chave, padrao) { return chave === 'aniskip_malid_teste' ? 55 : padrao; },
            extrairInfoDoEpisodioParaAniSkip() { return { nomeLimpo: 'Teste', episodio: 2 }; },
            nomeAnimeAtualParaExibicao: '',
            obterMalIdManualParaEpisodio() { return null; },
            garantirMetadadosDoAnime() { return Promise.resolve(); },
            atualizarStatusAniSkip(_nome, _ep, mensagem) { mensagens.push(mensagem); },
            obterChaveDaSerie() { return 'teste'; },
            requisitarJsonAniSkip() { return Promise.reject(new Error(`HTTP ${status}`)); },
            aniskipMalIdValido(valor) { return Number.isSafeInteger(Number(valor)) && Number(valor) > 0; },
            aniskipBuscaAindaAtual(sequencia, epoca, url) {
                return sequencia === contexto.sequenciaBuscaAniSkip &&
                    epoca === contexto.epoca && url === contexto.window.location.href;
            },
            agendarRetryAniSkip() {
                reagendamentos++;
                contexto.aniskipBuscado = false;
            }
        };
        vm.createContext(contexto);
        vm.runInContext(extrairFuncao('buscarTemposAniSkip', 'auxiliarDeAutoplayInjetadoNaPagina'), contexto);
        await contexto.buscarTemposAniSkip();
        return { contexto, mensagens, reagendamentos };
    }

    const limite = await executarErro(429);
    assert.equal(limite.reagendamentos, 1);
    assert.equal(limite.contexto.aniskipBuscado, false);
    assert.ok(limite.mensagens.some(mensagem => mensagem.includes('Limite de pedidos')));

    const naoMapeado = await executarErro(404);
    assert.equal(naoMapeado.reagendamentos, 0);
    assert.equal(naoMapeado.contexto.aniskipBuscado, true);
    assert.deepEqual(JSON.parse(JSON.stringify(naoMapeado.contexto.cacheAniSkip)), []);
    assert.ok(naoMapeado.mensagens.some(mensagem => mensagem.includes('(404)')));
});

test('ausência temporária de título/EP continua sendo reavaliada em vez de bloquear a série', () => {
    let agora = 2000;
    const contexto = {
        aniskipBuscado: true,
        tentativasLeituraAniSkip: 1,
        tentativasFalhaAniSkip: 0,
        proximaBuscaAniSkipEm: 0,
        Date: { now: () => agora },
        Math
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('agendarRetryAniSkip', 'aniskipBuscaAindaAtual'), contexto);
    assert.equal(contexto.agendarRetryAniSkip(true), 1500);
    assert.equal(contexto.aniskipBuscado, false);
    assert.equal(contexto.proximaBuscaAniSkipEm, 3500);
    contexto.tentativasLeituraAniSkip = 21;
    assert.equal(contexto.agendarRetryAniSkip(true), 15000);
});

test('resposta atrasada de outro episódio não pode preencher o cache atual', () => {
    const contexto = {
        sequenciaBuscaAniSkip: 3,
        epoca: 8,
        window: { location: { href: 'https://site.test/ep-8' } }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('aniskipBuscaAindaAtual', 'transmitirDadosAniSkipParaFrames'), contexto);

    assert.equal(contexto.aniskipBuscaAindaAtual(3, 8, 'https://site.test/ep-8'), true);
    assert.equal(contexto.aniskipBuscaAindaAtual(2, 8, 'https://site.test/ep-8'), false);
    assert.equal(contexto.aniskipBuscaAindaAtual(3, 7, 'https://site.test/ep-8'), false);
    assert.equal(contexto.aniskipBuscaAindaAtual(3, 8, 'https://site.test/ep-7'), false);
    assert.match(source, /sequenciaBuscaAniSkip\+\+;[\s\S]*?aniskipBuscaEmAndamento = false;[\s\S]*?cacheAniSkip = null;/);
});

test('ANISKIP_DADOS aceita somente o pai autorizado ou um caso opaco estrito', () => {
    const topWindow = {};
    const contexto = {
        ehJanelaPrincipal: false,
        cfgSites: {},
        window: { top: topWindow, location: { ancestorOrigins: ['https://anime.test'] } },
        hostnameDeOrigemConfiavel(origem) {
            try { return new URL(origem).hostname; } catch { return null; }
        },
        hostnameDoSitePrincipalPorAncestorOrigins(origens) {
            try { return origens.length ? new URL(origens[origens.length - 1]).hostname : null; } catch { return null; }
        },
        resolverAtivacaoDoSite(host) { return { ativo: host === 'anime.test' }; }
    };
    vm.createContext(contexto);
    vm.runInContext(
        extrairFuncao('mensagemAniSkipVemDoPaiAutorizado', 'transmitirDadosAniSkipParaFrames'),
        contexto
    );

    assert.equal(contexto.mensagemAniSkipVemDoPaiAutorizado({
        source: topWindow, origin: 'https://anime.test'
    }), true);
    assert.equal(contexto.mensagemAniSkipVemDoPaiAutorizado({
        source: {}, origin: 'https://anime.test'
    }), false);
    assert.equal(contexto.mensagemAniSkipVemDoPaiAutorizado({
        source: topWindow, origin: 'https://attacker.test'
    }), false);
    assert.equal(contexto.mensagemAniSkipVemDoPaiAutorizado({
        source: topWindow, origin: 'null'
    }), false);

    contexto.window.location.ancestorOrigins = [];
    assert.equal(contexto.mensagemAniSkipVemDoPaiAutorizado({
        source: topWindow, origin: 'null'
    }), true);
    assert.match(source, /e\.data\.acao === 'ANISKIP_DADOS'\) \{\s*if \(!mensagemAniSkipVemDoPaiAutorizado\(e\)\) return;/);
});

test('mutação SPA reagenda uma varredura e detecta o player inserido dinamicamente', () => {
    let executarTimer;
    let atrasoAgendado;
    let playerAtual = null;
    const contexto = {
        timerVarredura: null,
        setTimeout(callback, atraso) {
            executarTimer = callback;
            atrasoAgendado = atraso;
            return 1;
        },
        buscarEAtivarVideos() {
            contexto.playerEncontrado = playerAtual;
        },
        playerEncontrado: null
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('lidarComMutacoesDoDom', 'agendarBuscaEAtivacaoDeVideos'),
        extrairFuncao('agendarBuscaEAtivacaoDeVideos', 'observarDocumentoParaDeteccaoDeVideo')
    ].join('\n'), contexto);

    const novoPlayer = {};
    playerAtual = novoPlayer;
    contexto.lidarComMutacoesDoDom([{
        target: { nodeType: 1, closest() { return null; } }
    }]);
    contexto.lidarComMutacoesDoDom([{
        target: { nodeType: 1, closest() { return null; } }
    }]);

    assert.equal(atrasoAgendado, 150);
    assert.equal(contexto.timerVarredura, 1);
    executarTimer();
    assert.equal(contexto.timerVarredura, null);
    assert.equal(contexto.playerEncontrado, novoPlayer);
});

test('observar repetidamente o mesmo documento não duplica listeners nem observers', () => {
    let listeners = 0;
    let observadores = 0;
    let injecoes = 0;
    const doc = {
        documentElement: {},
        addEventListener() { listeners++; }
    };
    const contexto = {
        EVENTOS_MIDIA: ['timeupdate', 'playing'],
        docsObservados: new WeakSet(),
        document: doc,
        injetarScriptAuxiliarNoDocumento() { injecoes++; },
        injetarCSSNoDocumento() { injecoes++; },
        documentoNaoRecebeUserscript() { return false; },
        lidarComEventosDoPlayerDeVideo() {},
        lidarComMutacoesDoDom() {},
        lidarComCliqueDoUsuarioNaPagina() {},
        lidarComAtalhosDeTeclado() {},
        MutationObserver: class {
            constructor() { observadores++; }
            observe() {}
        }
    };
    vm.createContext(contexto);
    vm.runInContext(
        extrairFuncao('observarDocumentoParaDeteccaoDeVideo', 'garantirQuePainelDeStatusEstaVisivel'),
        contexto
    );
    contexto.observarDocumentoParaDeteccaoDeVideo(doc);
    contexto.observarDocumentoParaDeteccaoDeVideo(doc);

    assert.equal(listeners, 2);
    assert.equal(observadores, 1);
    assert.equal(injecoes, 2);
});

test('resultados válidos são encaminhados a frames que aguardam o pai', () => {
    const recebido = [];
    const frame = { postMessage(mensagem) { recebido.push(mensagem); } };
    const contexto = {
        ehJanelaPrincipal: true,
        cacheAniSkip: [{ skipType: 'op', interval: { startTime: 12, endTime: 24 } }],
        framesAguardandoDadosAniSkip: new Map([[frame, 'request-42']]),
        enviarDadosAniSkipParaFrame(janela, _origem, requestId) {
            janela.postMessage({
                app: 'ANIME_V44',
                acao: 'ANISKIP_DADOS',
                requestId,
                dados: contexto.cacheAniSkip
            });
        }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('transmitirDadosAniSkipParaFrames', 'aplicarPuloAniSkipSeJaEstiverNoTrecho'), contexto);
    contexto.transmitirDadosAniSkipParaFrames();

    assert.equal(recebido.length, 1);
    assert.equal(recebido[0].acao, 'ANISKIP_DADOS');
    assert.equal(recebido[0].requestId, 'request-42');
    assert.equal(recebido[0].dados[0].interval.endTime, 24);
    assert.equal(contexto.framesAguardandoDadosAniSkip.size, 0);
    assert.match(source, /const temposRecebidos = normalizarResultadosAniSkip\(e\.data\.dados\);[\s\S]*?cacheAniSkip = temposRecebidos;[\s\S]*?aplicarPuloAniSkipSeJaEstiverNoTrecho\(\)/);
});

test('timeupdate pula OP e ED somente ao entrar nos intervalos retornados', () => {
    function executarComIntervalo(skipType) {
        const video = { currentTime: 15, duration: 120, paused: false, seeking: false };
        const pulos = [];
        const contexto = {
            jaAvancou: false,
            estadoAutoFHDVerificando: () => false,
            obterTempoAtualDoVideo: v => v.currentTime,
            obterDuracaoDoVideo: v => v.duration,
            videoAtivo: null,
            monitorarEstabilidadeDeReproducao() {},
            GM_getValue: () => null,
            obterChaveDaSerie: () => 'anime',
            cacheAniSkip: [{ skipType, interval: { startTime: 10, endTime: 20 }, jaPulou: false }],
            autoAniSkip: true,
            autoNext: false,
            siteUsaAutoNextNativo: () => false,
            solicitarPuloAniSkipComConfirmacao(_video, item, fim) {
                pulos.push({ item, fim });
                return true;
            },
            autoPlay: false,
            expandirVideoConformeHierarquia() {},
            Date: { now: () => 5000 },
            ultimoAvisoTempo: 5000,
            atualizarPainelDeStatusNaJanela() {},
            ehJanelaPrincipal: true,
            verificarSeEpisodioEstaTerminando() {}
        };
        vm.createContext(contexto);
        vm.runInContext(extrairFuncao('lidarComAtualizacaoDeTempoDoVideo', 'lidarComMutacoesDoDom'), contexto);
        contexto.lidarComAtualizacaoDeTempoDoVideo(video);
        return pulos;
    }

    for (const tipo of ['op', 'ed']) {
        const pulos = executarComIntervalo(tipo);
        assert.equal(pulos.length, 1);
        assert.equal(pulos[0].item.skipType, tipo);
        assert.equal(pulos[0].fim, 20);
    }
});

test('timeupdate aplica AniSkip mesmo antes de o player informar a duração', () => {
    const video = { currentTime: 3.3, duration: NaN, paused: false, seeking: false };
    let pulos = 0;
    const contexto = {
        jaAvancou: false,
        estadoAutoFHDVerificando: () => false,
        obterTempoAtualDoVideo: v => v.currentTime,
        obterDuracaoDoVideo: v => v.duration,
        videoAtivo: null,
        monitorarEstabilidadeDeReproducao() {},
        cacheAniSkip: [{ skipType: 'op', interval: { startTime: 0, endTime: 122 }, jaPulou: false }],
        autoAniSkip: true,
        autoNext: false,
        siteUsaAutoNextNativo: () => false,
        solicitarPuloAniSkipComConfirmacao() { pulos++; return true; }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('lidarComAtualizacaoDeTempoDoVideo', 'lidarComMutacoesDoDom'), contexto);
    contexto.lidarComAtualizacaoDeTempoDoVideo(video);

    assert.equal(pulos, 1);
});

test('timeupdate fora do intervalo da OP não solicita pulo', () => {
    const video = { currentTime: 5, duration: 120, paused: false, seeking: false };
    let pulos = 0;
    const contexto = {
        jaAvancou: false,
        estadoAutoFHDVerificando: () => false,
        obterTempoAtualDoVideo: v => v.currentTime,
        obterDuracaoDoVideo: v => v.duration,
        videoAtivo: null,
        monitorarEstabilidadeDeReproducao() {},
        GM_getValue: () => null,
        obterChaveDaSerie: () => 'anime',
        cacheAniSkip: [{ skipType: 'op', interval: { startTime: 10, endTime: 20 }, jaPulou: false }],
        autoAniSkip: true,
        autoNext: false,
        siteUsaAutoNextNativo: () => false,
        solicitarPuloAniSkipComConfirmacao() { pulos++; return true; },
        autoPlay: false,
        expandirVideoConformeHierarquia() {},
        Date: { now: () => 5000 },
        ultimoAvisoTempo: 5000,
        atualizarPainelDeStatusNaJanela() {},
        ehJanelaPrincipal: true,
        verificarSeEpisodioEstaTerminando() {}
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('lidarComAtualizacaoDeTempoDoVideo', 'lidarComMutacoesDoDom'), contexto);
    contexto.lidarComAtualizacaoDeTempoDoVideo(video);

    assert.equal(pulos, 0);
    assert.equal(contexto.cacheAniSkip[0].jaPulou, false);
});

test('ED aciona Auto-Next no intervalo retornado mesmo sem depender do salto de OP', () => {
    const video = { currentTime: 95, duration: 120, paused: false, seeking: false };
    let avancos = 0;
    const contexto = {
        jaAvancou: false,
        estadoAutoFHDVerificando: () => false,
        obterTempoAtualDoVideo: v => v.currentTime,
        obterDuracaoDoVideo: v => v.duration,
        videoAtivo: null,
        monitorarEstabilidadeDeReproducao() {},
        GM_getValue: () => null,
        obterChaveDaSerie: () => 'anime',
        cacheAniSkip: [{ skipType: 'ed', interval: { startTime: 90, endTime: 100 }, jaPulou: false }],
        autoAniSkip: true,
        autoNext: true,
        siteUsaAutoNextNativo: () => false,
        avancarParaProximoEpisodio() { avancos++; },
        exibirMensagemBreveNoPainel() {},
        autoPlay: false,
        expandirVideoConformeHierarquia() {},
        Date: { now: () => 5000 },
        ultimoAvisoTempo: 5000,
        atualizarPainelDeStatusNaJanela() {},
        ehJanelaPrincipal: true,
        verificarSeEpisodioEstaTerminando() {}
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('lidarComAtualizacaoDeTempoDoVideo', 'lidarComMutacoesDoDom'), contexto);
    contexto.lidarComAtualizacaoDeTempoDoVideo(video);

    assert.equal(avancos, 1);
    assert.equal(contexto.cacheAniSkip[0].jaPulou, true);
});

test('seek AniSkip limita fim do intervalo à duração reproduzível do vídeo', () => {
    let timerAgendado;
    let destinoSolicitado;
    const item = { jaPulou: false, puloPendente: null };
    const video = {
        readyState: 4,
        duration: 100,
        currentTime: 20,
        seeking: false,
        isConnected: true,
        listeners: {},
        addEventListener(nome, callback) { this.listeners[nome] = callback; },
        removeEventListener(nome) { delete this.listeners[nome]; }
    };
    const contexto = {
        epoca: 4,
        obterTempoAtualDoVideo(v) { return v.currentTime; },
        buscarVideoPara(v, destino) {
            destinoSolicitado = destino;
            v.currentTime = destino;
            return true;
        },
        clearTimeout() {},
        setTimeout(callback) { timerAgendado = callback; return 1; },
        exibirMensagemBreveNoPainel() {}
    };
    vm.createContext(contexto);
    vm.runInContext(
        extrairFuncao('solicitarPuloAniSkipComConfirmacao', 'lidarComAtualizacaoDeTempoDoVideo'),
        contexto
    );

    assert.equal(contexto.solicitarPuloAniSkipComConfirmacao(video, item, 122, 'OP pulada'), true);
    assert.equal(destinoSolicitado, 99.75);
    timerAgendado();
    assert.equal(item.jaPulou, true);
    assert.equal(item.puloPendente, null);
});

test('AniSkip sem tempos válidos não bloqueia autoplay nem o Auto-Next', () => {
    const video = { currentTime: 99, duration: 100, paused: true, seeking: false };
    let reproducoes = 0;
    let avancos = 0;
    const contexto = {
        jaAvancou: false,
        estadoAutoFHDVerificando: () => false,
        obterTempoAtualDoVideo: v => v.currentTime,
        obterDuracaoDoVideo: v => v.duration,
        videoAtivo: null,
        monitorarEstabilidadeDeReproducao() {},
        GM_getValue: () => null,
        obterChaveDaSerie: () => 'anime',
        cacheAniSkip: null,
        autoAniSkip: true,
        autoNext: true,
        siteUsaAutoNextNativo: () => false,
        autoPlay: true,
        tentarReproduzirVideoAutomaticamente(v) {
            reproducoes++;
            v.paused = false;
        },
        expandirVideoConformeHierarquia() {},
        Date: { now: () => 5000 },
        ultimoAvisoTempo: 5000,
        atualizarPainelDeStatusNaJanela() {},
        ehJanelaPrincipal: true,
        tempoPulo: 3,
        armado: true,
        avancarParaProximoEpisodio() { avancos++; }
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('lidarComAtualizacaoDeTempoDoVideo', 'lidarComMutacoesDoDom'),
        extrairFuncao('verificarSeEpisodioEstaTerminando', 'obterRaizesDoPlayerParaRetomada')
    ].join('\n'), contexto);
    contexto.lidarComAtualizacaoDeTempoDoVideo(video);

    assert.equal(reproducoes, 1);
    assert.equal(avancos, 1);
});

test('recusa de retomada no AnimesOnline limita raízes ao player', () => {
    const seletoresConsultados = [];
    const doc = {
        location: { hostname: 'animesonline.io' },
        body: { id: 'body' },
        querySelectorAll(seletor) {
            seletoresConsultados.push(seletor);
            return [{ seletor }];
        }
    };
    const contexto = {
        hostCorrespondeADominio: (host, dominio) => host === dominio
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('obterRaizesDoPlayerParaRetomada', 'elementoVisivelParaRetomada'), contexto);

    const raizes = contexto.obterRaizesDoPlayerParaRetomada(doc);
    assert.deepEqual(seletoresConsultados, [
        '#pembed', '.player-embed', '#video_player', '.jwplayer',
        '.vjs-modal-dialog', '[role="dialog"][aria-modal="true"]'
    ]);
    assert.equal(raizes.length, seletoresConsultados.length);
    assert.equal(raizes.includes(doc.body), false);
});

test('contexto de recusa exige texto explícito no próprio modal visível', () => {
    const body = {
        innerText: 'Continuar assistindo de onde parou',
        matches: seletor => seletor.includes('[class*="resume"]'),
        parentElement: null
    };
    const criarEstrutura = textoModal => {
        const modal = {
            innerText: textoModal,
            ownerDocument: { body },
            parentElement: body,
            matches: seletor => seletor.includes('[role="dialog"]'),
            isConnected: true,
            getClientRects: () => [1]
        };
        const botao = {
            ownerDocument: { body },
            parentElement: modal,
            matches: () => false
        };
        return { botao };
    };
    const contexto = {
        elementoVisivelParaRetomada: elemento => elemento.isConnected,
        normalizarTextoParaComparacao: texto => texto.toLowerCase()
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('contextoIndicaRetomada', 'forcarVideoParaComecarDoZero'), contexto);

    const modalDeRetomada = criarEstrutura('Deseja continuar assistindo de onde parou?');
    assert.equal(contexto.contextoIndicaRetomada(modalDeRetomada.botao), true);

    const modalSemTexto = criarEstrutura('Deseja começar do zero?');
    assert.equal(contexto.contextoIndicaRetomada(modalSemTexto.botao), false);
});

test('recusa nunca clica em link de navegação e registra o clique seguro antes de executá-lo', () => {
    const eventos = [];
    const linkReal = {
        href: 'https://animesonline.io/anime/outro-anime/',
        getAttribute: () => 'https://animesonline.io/anime/outro-anime/'
    };
    const criarBotao = (anchor = null) => ({
        tagName: 'BUTTON',
        id: 'resume-no',
        className: 'resume-control',
        innerText: 'Não',
        textContent: 'Não',
        ownerDocument: {},
        closest: seletor => seletor === 'a[href]' ? anchor : null,
        matches: seletor => seletor.includes('button'),
        click() { eventos.push('click'); }
    });
    const contexto = {
        console: { info: (mensagem, dados) => eventos.push({ mensagem, dados }) },
        forcarVideoParaComecarDoZero: () => eventos.push('reset')
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('ehLinkDeNavegacao', 'clicarBotaoDeRecusaEZerarVideo'),
        extrairFuncao('clicarBotaoDeRecusaEZerarVideo', 'buscarERecusarPopupDeContinuarAssistindo')
    ].join('\n'), contexto);

    assert.equal(contexto.clicarBotaoDeRecusaEZerarVideo(criarBotao(linkReal)), false);
    assert.deepEqual(eventos, []);

    assert.equal(contexto.clicarBotaoDeRecusaEZerarVideo(criarBotao()), true);
    assert.equal(eventos[0].mensagem, '[AniStream][Resume] recusando');
    assert.equal(eventos[0].dados.href, null);
    assert.deepEqual(eventos.slice(1), ['click', 'reset']);
});

test('JSON inválido da API AniSkip rejeita a requisição sem dados falsos', async () => {
    const contexto = {
        GM_xmlhttpRequest(opcoes) {
            opcoes.onload({ status: 200, responseText: '{malformado' });
        },
        setTimeout
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('requisitarJsonAniSkip', 'obterChaveDaSerie'), contexto);

    await assert.rejects(
        contexto.requisitarJsonAniSkip('https://api.aniskip.com/test'),
        erro => erro && erro.name === 'SyntaxError'
    );
});

test('X permanece discreto e fecha apenas o menu sem propagar o clique', () => {
    assert.match(source, /#au-menu-fechar \{[\s\S]*?width: 18px !important; height: 18px !important/);
    assert.match(source, /font: 500 12px\/1 system-ui, sans-serif !important/);
    assert.match(source, /#au-menu-fechar:hover \{[\s\S]*?rgba\(6,78,59,\.9\)/);
    const inicio = source.indexOf("botaoFecharMenu.addEventListener('click', e =>");
    const fim = source.indexOf('\n            });', inicio);
    const listener = source.slice(inicio, fim);
    assert.match(source, /botaoFecharMenu\.addEventListener\('click', e =>/);
    assert.match(listener, /e\.stopImmediatePropagation\(\)/);
    assert.match(listener, /fecharMenuFlutuante\(\)/);
    assert.doesNotMatch(listener, /definirModoTeatro|solicitarModoTeatro|desativarModoTeatro/);
});

test('X é independente da barra e aparece somente com o menu aberto', () => {
    assert.match(source, /document\.body\.appendChild\(controlBar\);\s*document\.body\.appendChild\(botaoFecharMenu\);/);
    assert.doesNotMatch(source, /controlBar\.appendChild\(botaoFecharMenu\)/);
    assert.match(source, /body\.au-menu-flutuante-aberto #au-menu-fechar \{ display: inline-flex !important; \}/);
    assert.match(source, /display: none !important; align-items: center !important; justify-content: center !important;/);
});

test('posição do X acompanha o FAB, respeita margens e muda de lado se faltar espaço', () => {
    const inicio = source.indexOf('        const posicionarMenuFlutuante = () => {');
    const fim = source.indexOf('        const limitarPosicaoFab', inicio);
    assert.notEqual(inicio, -1);
    assert.notEqual(fim, -1);
    const trecho = source.slice(inicio, fim).replace('        const posicionarMenuFlutuante = () => {', 'posicionarMenuFlutuante = () => {');
    const fab = { left: 80, top: 40, right: 132, bottom: 92, width: 52, height: 52 };
    const writes = {};
    const closeButton = {
        offsetWidth: 18,
        style: { setProperty(name, value) { writes[name] = value; } }
    };
    const bar = {
        getBoundingClientRect() { return { width: 100, height: 60 }; },
        style: { setProperty() {} }
    };
    const contexto = {
        botaoFecharMenu: closeButton,
        fabTeatro: { getBoundingClientRect: () => fab },
        document: {
            body: { classList: { contains: () => true } },
            getElementById: () => bar
        },
        window: { innerWidth: 400, innerHeight: 300 },
        Math
    };
    vm.createContext(contexto);
    vm.runInContext(trecho, contexto);
    contexto.posicionarMenuFlutuante();
    assert.equal(writes.left, '138px');
    assert.equal(writes.top, '57px');

    fab.left = 330;
    fab.right = 382;
    contexto.window.innerWidth = 400;
    contexto.posicionarMenuFlutuante();
    assert.equal(writes.left, '306px');
    assert.ok(Number.parseFloat(writes.left) >= 8);
    assert.ok(Number.parseFloat(writes.left) + closeButton.offsetWidth <= 392);
});

test('logo AO reutilizável é SVG inline, decorativo e sem recursos externos', () => {
    const contexto = {};
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('logoAOSvg', 'iconeSvg'), contexto);
    const svgFab = contexto.logoAOSvg('au-logo-ao-fab');
    const svgMenu = contexto.logoAOSvg('au-logo-ao-menu');

    for (const svg of [svgFab, svgMenu]) {
        assert.match(svg, /<svg\b[^>]*viewBox="0 0 64 48"/);
        assert.match(svg, /aria-hidden="true"/);
        assert.match(svg, /pointer-events:none/);
        assert.match(svg, /stroke="#f4f8f8"/);
        assert.match(svg, /stroke="#10dca2"/);
        assert.match(svg, /fill="#22f0bd"/);
        assert.doesNotMatch(svg, /(?:href|src)\s*=|data:image|base64|<image\b/i);
    }
    assert.match(svgFab, /class="au-logo-ao-fab"/);
    assert.match(svgMenu, /class="au-logo-ao-menu"/);
});

test('FAB mantém a mesma logo nos estados expandido/recolhido e não troca por ícone genérico', () => {
    assert.match(source, /fabTeatro\.innerHTML = logoAOSvg\('au-logo-ao-fab'\)/);
    const inicio = source.indexOf('        atualizarVisualFabExpandido = () => {');
    const fim = source.indexOf('\n        };', inicio);
    const atualizador = source.slice(inicio, fim);
    assert.doesNotMatch(atualizador, /fabTeatro\.innerHTML|iconeSvg\(/);
    assert.match(source, /#au-fab-teatro \.au-logo-ao-fab[\s\S]*?width: 38px !important; height: 29px !important/);
    assert.match(source, /fabTeatro\.setAttribute\('aria-pressed', String\(expandido\)\)/);
});

test('logo compacta fica à esquerda dos comandos sem interferir no X nem nos botões', () => {
    assert.match(source, /marcaAniStream\.className = 'au-menu-brand'/);
    assert.match(source, /marcaAniStream\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(source, /marcaAniStream\.innerHTML = logoAOSvg\('au-logo-ao-menu'\)/);
    assert.match(source, /controlBar\.insertBefore\(marcaAniStream, controlBar\.firstChild\)/);
    assert.match(source, /\.au-logo-ao-menu \{[\s\S]*?width: 24px !important; height: 19px !important/);
    assert.match(source, /\.au-logo-ao-menu \{ width: 20px !important; height: 16px !important; \}/);
    assert.match(source, /document\.body\.appendChild\(controlBar\);\s*document\.body\.appendChild\(botaoFecharMenu\);/);
    assert.doesNotMatch(source, /controlBar\.appendChild\(botaoFecharMenu\)/);
});

test('Auto Fullscreen prefere um contêiner de player aos controles nativos isolados do vídeo', () => {
    const body = { tagName: 'BODY' };
    const documentElement = { tagName: 'HTML' };
    const wrapper = { tagName: 'DIV', isConnected: true };
    const parent = { tagName: 'DIV', isConnected: true };
    const video = {
        tagName: 'VIDEO',
        ownerDocument: { body, documentElement },
        parentElement: parent,
        isConnected: true,
        closest(selector) { return selector.includes('.player-wrapper') ? wrapper : null; }
    };
    const contexto = { document: {} };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('obterAlvoTelaCheia', 'prepararControlesParaTelaCheia'), contexto);

    assert.equal(contexto.obterAlvoTelaCheia(video, { elemento: { tagName: 'DIV', isConnected: true } }).tagName, 'DIV');
    assert.equal(contexto.obterAlvoTelaCheia(video, null), wrapper);
    video.closest = () => null;
    assert.equal(contexto.obterAlvoTelaCheia(video, null), parent);
    video.parentElement = body;
    assert.equal(contexto.obterAlvoTelaCheia(video, null), video);
});

test('Auto Fullscreen aplica modo teatro automaticamente uma vez por episódio', () => {
    const video = {};
    const solicitacoes = [];
    const contexto = {
        autoFullscreen: true,
        autoTeatro: false,
        teatroTentado: false,
        solicitarModoTeatro(videoRecebido, ligar) {
            solicitacoes.push({ video: videoRecebido, ligar });
        },
        ativarTelaCheiaNoVideo() {
            assert.fail('Não deve solicitar fullscreen nativo sem gesto do usuário');
        }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('expandirVideoConformeHierarquia', 'lidarComAtalhosDeTeclado'), contexto);

    contexto.expandirVideoConformeHierarquia(video);
    contexto.expandirVideoConformeHierarquia(video);

    assert.deepEqual(solicitacoes, [{ video, ligar: true }]);
    assert.equal(contexto.teatroTentado, true);
});

test('controles flutuantes entram no contêiner fullscreen e retornam à posição original ao sair', () => {
    function criarPai(nome) {
        const classes = new Set();
        const pai = {
            nome,
            filhos: [],
            classList: {
                add(valor) { classes.add(valor); },
                remove(valor) { classes.delete(valor); },
                contains(valor) { return classes.has(valor); }
            },
            appendChild(elemento) {
                if (elemento.parentNode) {
                    const antigos = elemento.parentNode.filhos;
                    antigos.splice(antigos.indexOf(elemento), 1);
                }
                this.filhos.push(elemento);
                elemento.parentNode = this;
                return elemento;
            },
            insertBefore(elemento, proximo) {
                if (elemento.parentNode) {
                    const antigos = elemento.parentNode.filhos;
                    antigos.splice(antigos.indexOf(elemento), 1);
                }
                const indice = this.filhos.indexOf(proximo);
                this.filhos.splice(indice < 0 ? this.filhos.length : indice, 0, elemento);
                elemento.parentNode = this;
                return elemento;
            },
            contains(elemento) {
                for (let atual = elemento; atual; atual = atual.parentNode) {
                    if (atual === this) return true;
                }
                return false;
            }
        };
        return pai;
    }
    function criarElemento(id) {
        const classes = new Set();
        const elemento = {
            id,
            parentNode: null,
            classList: {
                add(valor) { classes.add(valor); },
                remove(valor) { classes.delete(valor); },
                contains(valor) { return classes.has(valor); }
            },
            get nextSibling() {
                if (!this.parentNode) return null;
                const filhos = this.parentNode.filhos;
                return filhos[filhos.indexOf(this) + 1] || null;
            }
        };
        return elemento;
    }
    const body = criarPai('body');
    const target = criarPai('player');
    target.tagName = 'DIV';
    const before = criarElemento('before');
    const controles = ['au-fab-teatro', 'au-control-bar', 'au-menu-fechar', 'au-skip-toast'].map(criarElemento);
    const after = criarElemento('after');
    [before, ...controles, after].forEach(elemento => body.appendChild(elemento));
    const porId = new Map(controles.map(elemento => [elemento.id, elemento]));
    const contexto = {
        controlesMovidosParaTelaCheia: null,
        document: { getElementById(id) { return porId.get(id) || null; } }
    };
    vm.createContext(contexto);
    vm.runInContext(
        extrairFuncao('prepararControlesParaTelaCheia', 'colocarControlesNaTelaCheia') +
        extrairFuncao('restaurarControlesAposTelaCheia', 'registrarListenerDeTelaCheia'),
        contexto
    );

    assert.equal(contexto.prepararControlesParaTelaCheia(target), true);
    assert.deepEqual(target.filhos, controles);
    assert.equal(target.classList.contains('au-autofullscreen-container'), true);
    contexto.restaurarControlesAposTelaCheia();
    assert.deepEqual(body.filhos, [before, ...controles, after]);
    assert.equal(target.classList.contains('au-autofullscreen-container'), false);
});

test('Goyabu seleciona somente o primeiro player iframe HD e não repete a troca', () => {
    let clicksFhd = 0;
    let clicksHd = 0;
    const attr = (label, type) => ({
        'data-player-name': label,
        'data-player-type': type,
        class: '',
        'aria-selected': null,
        'aria-pressed': null,
        'aria-current': null,
        'data-active': null
    });
    const fhdAttrs = attr('FHD', 'iframe');
    const hdAttrs = attr('HD', 'iframe');
    const fhd = {
        isConnected: true,
        disabled: false,
        textContent: 'FHD',
        getAttribute(name) { return fhdAttrs[name] ?? null; },
        click() { clicksFhd++; }
    };
    const hd = {
        isConnected: true,
        disabled: false,
        textContent: 'HD',
        getAttribute(name) { return hdAttrs[name] ?? null; },
        click() {
            clicksHd++;
            fhdAttrs.class = '';
            hdAttrs.class = 'active';
        }
    };
    fhdAttrs.class = 'active';
    const player = {
        querySelectorAll(selector) {
            return selector.includes('data-player-type') ? [hd] : [fhd, hd];
        }
    };
    const logs = [];
    const contexto = {
        ehJanelaPrincipal: true,
        siteGoyabu: true,
        goyabuHdSelecionado: false,
        goyabuFallbackParaHdFeito: false,
        goyabuFhdIndisponivel: false,
        fallbackTentativas: 0,
        watchdogTempo: 9,
        REGEX_SERVIDOR_FULLHD: /\b(?:FHD|FULL\s*HD|1080P?)\b/i,
        document: {
            querySelector(selector) { return selector === '#player' ? player : null; },
            querySelectorAll() { return [fhd, hd]; }
        },
        console: { info(...args) { logs.push(args); } }
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('obterRotuloDoBotaoServidor', 'obterBotoesDeServidor'),
        extrairFuncao('obterBotaoHdGoyabu', 'logDiagnostico'),
        extrairFuncao('logDiagnostico', 'selecionarHdGoyabu'),
        extrairFuncao('selecionarHdGoyabu', 'garantirPlayerHdGoyabu'),
        extrairFuncao('garantirPlayerHdGoyabu', 'botaoServidorEstaAtivo'),
        extrairFuncao('botaoServidorEstaAtivo', 'estadoAutoFHDVerificando')
    ].join('\n'), contexto);

    assert.equal(contexto.garantirPlayerHdGoyabu(), true);
    assert.equal(clicksHd, 1);
    assert.equal(clicksFhd, 0);
    assert.equal(contexto.goyabuFhdIndisponivel, true);
    assert.equal(logs.some(([message]) => message === '[Goyabu] FHD indisponível: decode_blogger_video retornou play vazio'), true);
    assert.equal(logs.some(([message]) => message === '[Goyabu] HD selecionado'), true);
    assert.equal(contexto.garantirPlayerHdGoyabu(), true);
    assert.equal(clicksHd, 1);
});

test('fallback Goyabu ignora watchdog e limita erro confirmado a uma troca segura para HD', () => {
    const tabs = [];
    let hdClicks = 0;
    const hdAttrs = {
        'data-player-name': 'HD',
        'data-player-type': 'iframe',
        class: '',
        'aria-selected': null,
        'aria-pressed': null,
        'aria-current': null,
        'data-active': null
    };
    const hd = {
        isConnected: true,
        disabled: false,
        textContent: 'HD',
        getAttribute(name) { return hdAttrs[name] ?? null; },
        click() { hdClicks++; hdAttrs.class = 'active'; }
    };
    const fhdAttrs = {
        'data-player-name': 'FHD',
        'data-player-type': 'iframe',
        class: 'active',
        'aria-selected': null,
        'aria-pressed': null,
        'aria-current': null,
        'data-active': null
    };
    const fhd = {
        isConnected: true,
        disabled: false,
        textContent: 'FHD',
        getAttribute(name) { return fhdAttrs[name] ?? null; },
        click() { assert.fail('O FHD nunca deve ser acionado'); }
    };
    tabs.push(fhd, hd);
    const player = { querySelectorAll(selector) { return selector.includes('data-player-type') ? [hd] : tabs; } };
    const contexto = {
        ehJanelaPrincipal: true,
        siteGoyabu: true,
        goyabuHdSelecionado: false,
        goyabuFallbackParaHdFeito: false,
        goyabuFhdIndisponivel: false,
        fallbackTentativas: 0,
        watchdogTempo: 0,
        jaAvancou: false,
        autoFHDControlandoSelecao() { return false; },
        REGEX_SERVIDOR_FULLHD: /\b(?:FHD|FULL\s*HD|1080P?)\b/i,
        document: {
            querySelector(selector) { return selector === '#player' ? player : null; },
            querySelectorAll() { return tabs; }
        },
        console: { info() {} }
    };
    vm.createContext(contexto);
    vm.runInContext([
        extrairFuncao('obterRotuloDoBotaoServidor', 'obterBotoesDeServidor'),
        extrairFuncao('obterBotaoHdGoyabu', 'logDiagnostico'),
        extrairFuncao('logDiagnostico', 'selecionarHdGoyabu'),
        extrairFuncao('selecionarHdGoyabu', 'garantirPlayerHdGoyabu'),
        extrairFuncao('botaoServidorEstaAtivo', 'estadoAutoFHDVerificando'),
        extrairFuncao('tentarClicarProximoServidor', 'verificarSeEpisodioEstaTerminando')
    ].join('\n'), contexto);

    contexto.tentarClicarProximoServidor('watchdog');
    assert.equal(hdClicks, 0);
    contexto.tentarClicarProximoServidor('media-error');
    contexto.tentarClicarProximoServidor('media-error');
    assert.equal(hdClicks, 1);
    assert.equal(contexto.goyabuFallbackParaHdFeito, true);
});

test('watchdog reconhece iframe cross-origin do player sem trocar por ausência de videoAtivo', () => {
    const frame = { getAttribute() { return 'https://www.blogger.com/video.g?token=abc'; } };
    const contexto = {
        document: {
            location: { href: 'https://goyabu.io/75242', origin: 'https://goyabu.io' },
            querySelectorAll() { return [frame]; }
        },
        URL
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('iframeCrossOriginDePlayerExiste', 'garantirPermissaoDeAutoplayNoIframe'), contexto);
    assert.equal(contexto.iframeCrossOriginDePlayerExiste(), true);
    frame.getAttribute = () => 'https://goyabu.io/embed';
    assert.equal(contexto.iframeCrossOriginDePlayerExiste(), false);
});

test('permissões do iframe Blogger são aplicadas sem recarregar ou alterar src', () => {
    const attrs = { src: 'https://www.blogger.com/video.g?token=abc', allow: '' };
    const frame = {
        getAttribute(name) { return attrs[name] || ''; },
        setAttribute(name, value) { attrs[name] = value; }
    };
    const contexto = {
        iframesComPermissaoAjustada: new WeakSet(),
        HOSTS_DE_PLAYER_CONHECIDOS: ['blogger.com', 'googlevideo.com', 'drive.google.com'],
        autoFullscreen: false,
        window: { location: { href: 'https://goyabu.io/75242' } },
        URL,
        hostCorrespondeADominio(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('garantirPermissaoDeAutoplayNoIframe', 'coletarTodosOsDocumentosIncluindoIframes'), contexto);
    contexto.garantirPermissaoDeAutoplayNoIframe(frame);
    assert.match(attrs.allow, /autoplay/);
    assert.match(attrs.allow, /fullscreen/);
    assert.equal(attrs.src, 'https://www.blogger.com/video.g?token=abc');
    const inicio = source.indexOf('        for (const f of iframes) {');
    assert.notEqual(inicio, -1);
    assert.match(source.slice(inicio, source.indexOf('function documentoNaoRecebeUserscript', inicio)),
        /if \(!iframesLigados\.has\(f\)\)[\s\S]*?\}\s*garantirPermissaoDeAutoplayNoIframe\(f\);/);
});

test('primeiro play em iframe Blogger define muted, defaultMuted, autoplay e playsinline', () => {
    const logs = [];
    const estado = { epoca: 1, tentativas: 0, ultima: 0, pausaAteMs: 0, estavel: false, falhasPlay: 0 };
    const video = {
        paused: true,
        ended: false,
        muted: false,
        defaultMuted: false,
        autoplay: false,
        currentSrc: 'https://video.test/source.mp4',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        play() {
            assert.equal(this.muted, true);
            assert.equal(this.defaultMuted, true);
            assert.equal(this.autoplay, true);
            assert.equal(this.attributes.playsinline, '');
            return undefined;
        }
    };
    const contexto = {
        autoPlay: true,
        jaAvancou: false,
        iframeBlogger: true,
        frameBloggerDoAnimesDrive: false,
        precisaMudo: false,
        estadoAutoFHDVerificando() { return false; },
        tentativaAutoFHD: null,
        videoEhElegivelParaAutoplay() { return true; },
        videoPossuiFonteDeMidia() { return true; },
        obterOuCriarEstadoDoVideo() { return estado; },
        tentativaDePlayEmAndamento() { return false; },
        agendarSegundoAcionamentoDoPlayerMobile() {},
        logDiagnostico(message) { logs.push(message); },
        Date
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('tentarReproduzirVideoAutomaticamente', 'forcarReproducaoDoVideo'), contexto);
    contexto.tentarReproduzirVideoAutomaticamente(video);
    assert.equal(contexto.precisaMudo, true);
    assert.ok(logs.includes('[Autoplay] tentativa muted'));
});
