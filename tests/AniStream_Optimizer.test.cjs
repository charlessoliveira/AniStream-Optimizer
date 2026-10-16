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
    assert.match(listener, /definirModoTeatro\(!expandido\)/);
    assert.match(listener, /setTimeout\(\(\) => \{[\s\S]*?abrirMenuFlutuante\(\);[\s\S]*?\}, 350\)/);
    assert.match(listener, /document\.body\.classList\.remove\('au-menu-flutuante-aberto'\)/);
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

test('resultados válidos são encaminhados a frames que aguardam o pai', () => {
    const recebido = [];
    const frame = { postMessage(mensagem) { recebido.push(mensagem); } };
    const contexto = {
        ehJanelaPrincipal: true,
        cacheAniSkip: [{ skipType: 'op', interval: { startTime: 12, endTime: 24 } }],
        framesAguardandoDadosAniSkip: new Set([frame]),
        document: { querySelectorAll() { return []; } },
        enviarDadosAniSkipParaFrame(janela) {
            janela.postMessage({ app: 'ANIME_V44', acao: 'ANISKIP_DADOS', dados: contexto.cacheAniSkip });
        }
    };
    vm.createContext(contexto);
    vm.runInContext(extrairFuncao('transmitirDadosAniSkipParaFrames', 'aplicarPuloAniSkipSeJaEstiverNoTrecho'), contexto);
    contexto.transmitirDadosAniSkipParaFrames();

    assert.equal(recebido.length, 1);
    assert.equal(recebido[0].acao, 'ANISKIP_DADOS');
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
