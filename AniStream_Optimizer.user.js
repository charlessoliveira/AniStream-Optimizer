// ==UserScript==
// @name         AniStream Optimizer (Autoplay + Auto-Next + SPA + AniSkip)
// @namespace    http://tampermonkey.net/
// @version      1.2.2
// @description  Autoplay persistente, auto-next, suporte a SPA, recusa automática de retomada e pulo de abertura/encerramento via AniSkip.
// @author       Você (com apoio do Claude e do Gemini)
// @license      MIT
// @match        *://*/*
// @allFrames    true
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      objects.githubusercontent.com
// @connect      release-assets.githubusercontent.com
// @connect      graphql.anilist.co
// @connect      api.aniskip.com
// ==/UserScript==

(function() {
    'use strict';

    const ehJanelaPrincipal = (window === window.top);
    const hostAtual = window.location.hostname;

    const RESTRINGIR_IFRAMES = true;

    let sitesPadrao = [
        'sushianimes.com.br',
        'goyabu.io',
        'animesdrive.cloud',
        'animesonline.io',
        'animeq.cloud',
        'anroll.io',
        'anidrive.click',
        'dattebayo-br.com'
    ];

    // ---------- POLÍTICA DE SITES E FRAMES ----------
    const CHAVE_SITES_PERSONALIZADOS = 'sites_personalizados';
    const CHAVE_SITES_DESATIVADOS = 'sites_desativados';
    const CHAVE_SITES_LEGADO = 'sites_permitidos';
    const CHAVE_SITES_VERSAO = 'sites_config_versao';
    const VERSAO_CONFIG_SITES = 1;
    const SITES_PADRAO_LEGADOS = [
        'sushianimes.com.br', 'goyabu.io', 'animesdrive.cloud', 'animesonline.io',
        'animeq.cloud', 'anroll.io', 'anidrive.click', 'dattebayo-br.com'
    ];
    const LIMITE_DOMINIOS_NA_LISTA = 500;
    const REGEX_HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

    function normalizarHostname(valor) {
        if (typeof valor !== 'string') return null;
        let h = valor.trim().toLowerCase();
        while (h.endsWith('.')) h = h.slice(0, -1);
        if (!h || h.length > 253 || !REGEX_HOSTNAME.test(h)) return null;
        if (h.split('.').some(l => l.length > 63)) return null;
        if (h.startsWith('www.') && h.indexOf('.', 4) !== -1) h = h.slice(4);
        return h;
    }

    function hostCorrespondeADominio(host, dominio) {
        const h = normalizarHostname(host), d = normalizarHostname(dominio);
        if (!h || !d) return false;
        return h === d || h.endsWith('.' + d);
    }

    function sanitizarListaDeDominios(bruto) {
        if (typeof bruto === 'string') bruto = [bruto];
        if (!Array.isArray(bruto)) return [];
        const saida = [];
        for (const item of bruto) {
            const n = normalizarHostname(item);
            if (n && !saida.includes(n)) { saida.push(n); if (saida.length >= LIMITE_DOMINIOS_NA_LISTA) break; }
        }
        return saida;
    }

    function uniaoDeDominios(a, b) { return sanitizarListaDeDominios([].concat(a || [], b || [])); }

    function resolverAtivacaoDoSite(host, cfg) {
        const h = normalizarHostname(host);
        if (!h || !cfg) return { ativo: false, regra: null };
        let melhor = null;
        const avaliar = (lista, tipo, prioridade) => {
            (Array.isArray(lista) ? lista : []).forEach(d => {
                if (!hostCorrespondeADominio(h, d)) return;
                const espec = normalizarHostname(d).split('.').length;
                if (!melhor || espec > melhor.espec || (espec === melhor.espec && prioridade > melhor.prioridade)) {
                    melhor = { tipo, dominio: normalizarHostname(d), espec, prioridade };
                }
            });
        };
        avaliar(cfg.padrao, 'padrao', 1);
        avaliar(cfg.personalizados, 'personalizado', 2);
        avaliar(cfg.desativados, 'desativado', 3);
        if (!melhor) return { ativo: false, regra: null };
        return { ativo: melhor.tipo !== 'desativado', regra: { tipo: melhor.tipo, dominio: melhor.dominio } };
    }

    function ativarSiteNaConfiguracao(cfg, host) {
        const h = normalizarHostname(host);
        if (!h) return cfg;
        const nova = { padrao: cfg.padrao, personalizados: cfg.personalizados.slice(), desativados: cfg.desativados.filter(d => d !== h) };
        if (!resolverAtivacaoDoSite(h, nova).ativo) nova.personalizados = uniaoDeDominios(nova.personalizados, [h]);
        return nova;
    }

    function desativarSiteNaConfiguracao(cfg, host) {
        const h = normalizarHostname(host);
        if (!h) return cfg;
        return {
            padrao: cfg.padrao,
            personalizados: cfg.personalizados.filter(d => d !== h),
            desativados: uniaoDeDominios(cfg.desativados, [h])
        };
    }

    function migrarConfiguracaoDeSites(legadoBruto, padrao, personalizadosAtuais, desativadosAtuais) {
        const legado = sanitizarListaDeDominios(legadoBruto);
        const registrosPadrao = uniaoDeDominios(SITES_PADRAO_LEGADOS, padrao);
        const ehRegistroPadrao = e => registrosPadrao.some(p => e === p || e.endsWith('.' + p));
        const personalizados = uniaoDeDominios(personalizadosAtuais, legado.filter(e => !ehRegistroPadrao(e)));
        let desativados = sanitizarListaDeDominios(desativadosAtuais);
        if (legado.some(e => SITES_PADRAO_LEGADOS.includes(e))) {
            SITES_PADRAO_LEGADOS.forEach(p => {
                if (!legado.some(e => p === e || p.endsWith('.' + e))) desativados = uniaoDeDominios(desativados, [p]);
            });
        }
        return { personalizados, desativados };
    }

    function carregarConfiguracaoDeSites(ler, gravar, padraoBruto) {
        const padrao = sanitizarListaDeDominios(padraoBruto);
        const lerSeguro = (k, def) => { try { const v = ler(k, def); return v === undefined ? def : v; } catch (e) { return def; } };
        const gravarSeguro = (k, v) => { try { gravar(k, v); } catch (e) {} };
        let personalizados = sanitizarListaDeDominios(lerSeguro(CHAVE_SITES_PERSONALIZADOS, []));
        let desativados = sanitizarListaDeDominios(lerSeguro(CHAVE_SITES_DESATIVADOS, []));
        if (lerSeguro(CHAVE_SITES_VERSAO, 0) !== VERSAO_CONFIG_SITES) {
            const m = migrarConfiguracaoDeSites(lerSeguro(CHAVE_SITES_LEGADO, []), padrao, personalizados, desativados);
            personalizados = m.personalizados;
            desativados = m.desativados;
            if (lerSeguro(CHAVE_SITES_VERSAO, 0) !== VERSAO_CONFIG_SITES) {
                gravarSeguro(CHAVE_SITES_PERSONALIZADOS, personalizados);
                gravarSeguro(CHAVE_SITES_DESATIVADOS, desativados);
                gravarSeguro(CHAVE_SITES_VERSAO, VERSAO_CONFIG_SITES);
            } else {
                personalizados = sanitizarListaDeDominios(lerSeguro(CHAVE_SITES_PERSONALIZADOS, []));
                desativados = sanitizarListaDeDominios(lerSeguro(CHAVE_SITES_DESATIVADOS, []));
            }
        }
        return { padrao, personalizados, desativados };
    }

    function alterarConfiguracaoDeSites(ler, gravar, padraoBruto, alteracao) {
        const nova = alteracao(carregarConfiguracaoDeSites(ler, gravar, padraoBruto));
        gravar(CHAVE_SITES_PERSONALIZADOS, nova.personalizados);
        gravar(CHAVE_SITES_DESATIVADOS, nova.desativados);
        return nova;
    }

    function hostnameDeOrigemConfiavel(origem) {
        if (typeof origem !== 'string' || !origem || origem === 'null') return null;
        let u;
        try { u = new URL(origem); } catch (e) { return null; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return normalizarHostname(u.hostname);
    }

    function hostnameDoSitePrincipalPorAncestorOrigins(ancestorOrigins) {
        try {
            if (!ancestorOrigins || typeof ancestorOrigins.length !== 'number' || ancestorOrigins.length < 1) return null;
            return hostnameDeOrigemConfiavel(ancestorOrigins[ancestorOrigins.length - 1]);
        } catch (e) { return null; }
    }

    function decidirAutorizacaoDoFrame(ancestorOrigins, cfg) {
        const host = hostnameDoSitePrincipalPorAncestorOrigins(ancestorOrigins);
        if (!host) return { acao: 'consultar', motivo: 'origem-principal-indisponivel' };
        return resolverAtivacaoDoSite(host, cfg).ativo
            ? { acao: 'executar', motivo: 'principal-autorizado' }
            : { acao: 'bloquear', motivo: 'principal-nao-autorizado' };
    }

    const AUTH_APP = 'ANIME_AUTH';
    const AUTH_ATRASOS_MS = [0, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000, 15000, 30000, 60000];
    const AUTH_ENCERRAR_APOS_MS = 65000;

    function gerarIdDeConsulta() {
        let a = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        try {
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                const v = new Uint32Array(4); crypto.getRandomValues(v);
                a = Array.from(v).map(n => n.toString(36)).join('');
            }
        } catch (e) {}
        return a + Date.now().toString(36);
    }

    function solicitarAutorizacaoDoSitePrincipal(janela, cfg, aoAutorizar, agendar, cancelar) {
        agendar = agendar || ((fn, ms) => setTimeout(fn, ms));
        cancelar = cancelar || (t => clearTimeout(t));
        const id = gerarIdDeConsulta();
        const timers = [];
        let concluido = false;
        function encerrar() {
            concluido = true;
            try { janela.removeEventListener('message', ouvinte); } catch (e) {}
            timers.forEach(t => { try { cancelar(t); } catch (e) {} });
        }
        function ouvinte(e) {
            if (concluido) return;
            try {
                if (!e || e.source == null || e.source !== janela.top) return;
                const d = e.data;
                if (!d || typeof d !== 'object' || d.app !== AUTH_APP || d.acao !== 'RESPOSTA') return;
                if (d.id !== id || d.autorizado !== true) return;
                const host = hostnameDeOrigemConfiavel(e.origin);
                if (!host || !resolverAtivacaoDoSite(host, cfg).ativo) return;
            } catch (err) { return; }
            encerrar();
            aoAutorizar();
        }
        janela.addEventListener('message', ouvinte);
        AUTH_ATRASOS_MS.forEach(ms => timers.push(agendar(() => {
            if (concluido) return;
            try { janela.top.postMessage({ app: AUTH_APP, acao: 'CONSULTA', id }, '*'); } catch (e) {}
        }, ms)));
        timers.push(agendar(encerrar, AUTH_ENCERRAR_APOS_MS));
        return { cancelar: encerrar };
    }

    function ouvirConsultasDeAutorizacao(janela) {
        const ouvinte = e => {
            try {
                if (!e || !e.source || e.source === janela) return;
                if (e.source.top !== janela) return;
                const d = e.data;
                if (!d || typeof d !== 'object' || d.app !== AUTH_APP || d.acao !== 'CONSULTA') return;
                if (typeof d.id !== 'string' || !d.id || d.id.length > 64) return;
                const alvo = (typeof e.origin === 'string' && e.origin && e.origin !== 'null') ? e.origin : '*';
                e.source.postMessage({ app: AUTH_APP, acao: 'RESPOSTA', id: d.id, autorizado: true }, alvo);
            } catch (err) {}
        };
        janela.addEventListener('message', ouvinte);
        return ouvinte;
    }

    function iniciarConformePoliticaDeSites(ctx) {
        const janela = ctx.janela, cfg = ctx.cfg;
        if (ctx.ehPrincipal) {
            if (!resolverAtivacaoDoSite(ctx.host, cfg).ativo) { ctx.aoOferecerAtivacao(); return 'principal-inativo'; }
            ouvirConsultasDeAutorizacao(janela);
            ctx.iniciar();
            return 'executou';
        }
        if (!ctx.restringirIframes) { ctx.iniciar(); return 'executou'; }
        let ancestorOrigins = null;
        try { ancestorOrigins = janela.location.ancestorOrigins; } catch (e) {}
        const d = decidirAutorizacaoDoFrame(ancestorOrigins, cfg);
        if (d.acao === 'executar') { ctx.iniciar(); return 'executou'; }
        if (d.acao === 'bloquear') return 'bloqueado';
        solicitarAutorizacaoDoSitePrincipal(janela, cfg, ctx.iniciar, ctx.agendar, ctx.cancelar);
        return 'aguardando';
    }
    // ---------- FIM DA POLÍTICA DE SITES E FRAMES ----------

    const cfgSites = carregarConfiguracaoDeSites(GM_getValue, GM_setValue, sitesPadrao);

    // O servidor Mobile do AnimesDrive usa o player do Blogger. Em iframes
    // cross-origin, iniciar já mudo evita esperar a rejeição de autoplay com áudio.
    const frameBloggerDoAnimesDrive = (() => {
        if (ehJanelaPrincipal || !hostCorrespondeADominio(hostAtual, 'blogger.com')) return false;
        try {
            const hostPrincipal = hostnameDoSitePrincipalPorAncestorOrigins(window.location.ancestorOrigins);
            return hostCorrespondeADominio(hostPrincipal, 'animesdrive.cloud');
        } catch (e) { return false; }
    })();

    let autoPlay = GM_getValue('ativar_autoplay', true);
    let autoNext = GM_getValue('ativar_autonext', true);
    let tempoPulo = GM_getValue('segundos_pulo', 3);

    let autoFullscreen = GM_getValue('ativar_fullscreen', false);
    let teclaPularIntro = GM_getValue('tecla_pular_intro', 'v');
    let segundosPularIntro = GM_getValue('segundos_pular_intro', 85);
    let teclaPularVinheta = GM_getValue('tecla_pular_vinheta', 'q');
    let segundosPularVinheta = GM_getValue('segundos_pular_vinheta', 10);
    let teclaProximoEp = GM_getValue('tecla_proximo_ep', 'n');
    const CHAVE_ATALHOS_PERSONALIZADOS = 'atalhos_personalizados_v1';
    const ATALHOS_PADRAO_PERSONALIZADOS = {
        next: 'n', intro: 'v', outro: 'q', theater: 't', closeMenu: 'Escape', undo: 'Ctrl+Z',
        moveLeft: 'Alt+ArrowLeft', moveRight: 'Alt+ArrowRight', moveUp: 'Alt+ArrowUp', moveDown: 'Alt+ArrowDown',
        fastMoveModifier: 'Shift', moveStep: 12, moveLargeStep: 40
    };

    function normalizarNomeDeTecla(tecla) {
        const valor = String(tecla || '').trim();
        if (!valor) return '';
        const aliases = { esc: 'Escape', spacebar: 'Space', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', ctrl: 'Control', cmd: 'Meta' };
        return aliases[valor.toLowerCase()] || (valor.length === 1 ? valor.toLowerCase() : valor);
    }

    function analisarAtalho(texto, permitirSoModificador = false) {
        const partes = String(texto || '').split('+').map(p => p.trim()).filter(Boolean);
        const cfg = { key: '', ctrl: false, alt: false, shift: false, meta: false };
        const mods = { ctrl: ['ctrl', 'control'], alt: ['alt', 'option'], shift: ['shift'], meta: ['meta', 'cmd', 'command', 'super'] };
        for (const parte of partes) {
            const normal = parte.toLowerCase();
            const mod = Object.keys(mods).find(k => mods[k].includes(normal));
            if (mod) {
                if (cfg[mod]) return null;
                cfg[mod] = true;
            } else {
                if (cfg.key) return null;
                cfg.key = normalizarNomeDeTecla(parte);
            }
        }
        if (!cfg.key && !permitirSoModificador) return null;
        const chavesNomeadas = ['Escape', 'Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
        if (cfg.key && cfg.key.length !== 1 && !chavesNomeadas.includes(cfg.key) && !/^F([1-9]|1[0-2])$/i.test(cfg.key)) return null;
        return cfg;
    }

    function formatarAtalho(cfg) {
        if (!cfg) return '';
        const partes = [];
        if (cfg.ctrl) partes.push('Ctrl');
        if (cfg.alt) partes.push('Alt');
        if (cfg.shift) partes.push('Shift');
        if (cfg.meta) partes.push('Meta');
        if (cfg.key) partes.push(cfg.key.length === 1 ? cfg.key.toUpperCase() : cfg.key);
        return partes.join('+');
    }

    function lerAtalhosPersonalizados() {
        let salvos = {};
        try { salvos = GM_getValue(CHAVE_ATALHOS_PERSONALIZADOS, {}) || {}; } catch (e) {}
        const padroes = { ...ATALHOS_PADRAO_PERSONALIZADOS, next: teclaProximoEp, intro: teclaPularIntro, outro: teclaPularVinheta };
        const resultado = {};
        Object.keys(padroes).forEach(chave => {
            if (chave === 'moveStep' || chave === 'moveLargeStep') {
                const valor = Number(salvos[chave] ?? padroes[chave]);
                resultado[chave] = Number.isFinite(valor) && valor >= 1 && valor <= 200 ? Math.round(valor) : padroes[chave];
                return;
            }
            if (chave === 'fastMoveModifier') {
                const valor = String(salvos[chave] || padroes[chave]);
                resultado[chave] = ['Shift', 'Alt', 'Ctrl', 'Meta', 'Nenhum'].includes(valor) ? valor : padroes[chave];
                return;
            }
            const cfg = analisarAtalho(salvos[chave] || padroes[chave]);
            resultado[chave] = cfg ? formatarAtalho(cfg) : padroes[chave];
        });
        return resultado;
    }

    function eventoAcionaAtalho(evento, texto, permitirModificadorDePasso = null) {
        const cfg = analisarAtalho(texto);
        if (!cfg || normalizarNomeDeTecla(evento.key) !== cfg.key) return false;
        if (!!evento.ctrlKey !== cfg.ctrl || !!evento.altKey !== cfg.alt || !!evento.metaKey !== cfg.meta) return false;
        const campoPasso = { Shift: 'shiftKey', Alt: 'altKey', Ctrl: 'ctrlKey', Meta: 'metaKey' }[permitirModificadorDePasso];
        const shiftExtraValido = permitirModificadorDePasso === 'Shift' && !cfg.shift && !!evento.shiftKey;
        const modExtraValido = campoPasso && permitirModificadorDePasso !== 'Shift' && !cfg[permitirModificadorDePasso.toLowerCase()] && !!evento[campoPasso];
        return (!!evento.shiftKey === cfg.shift || shiftExtraValido || modExtraValido);
    }
    const CHAVE_MIGRACAO_AUTO_RECUSA_RETOMADA = 'anistream_auto_recusar_retomada_1_2_3';
    const hostUsaPlayerComRetomada = hostCorrespondeADominio(hostAtual, 'anroll.io') ||
        hostCorrespondeADominio(hostAtual, 'animesonline.io') || hostCorrespondeADominio(hostAtual, 'anidrive.click');
    let valorRecusarRetomada = GM_getValue('ativar_recusar_retomar', true);
    if (hostUsaPlayerComRetomada && !GM_getValue(CHAVE_MIGRACAO_AUTO_RECUSA_RETOMADA, false)) {
        GM_setValue('ativar_recusar_retomar', true);
        GM_setValue(CHAVE_MIGRACAO_AUTO_RECUSA_RETOMADA, true);
        valorRecusarRetomada = true;
    }
    let recusarRetomar = valorRecusarRetomada;
    function normalizarPreferenciaQualidade(valor) {
        const texto = String(valor == null ? 'auto' : valor).trim().toLowerCase();
        if (texto === 'auto' || texto === 'automática' || texto === 'automatica') return 'auto';
        if (texto === 'highest' || texto === 'melhor' || texto === 'max') return 'highest';
        const numero = Number(texto.replace(/\s*p$/, ''));
        return [1080, 720, 480, 360].includes(numero) ? String(numero) : 'auto';
    }
    let autoFHD = GM_getValue('ativar_fhd', false);
    let qualidadePlayerPreferida = normalizarPreferenciaQualidade(GM_getValue('preferencia_qualidade_player', 'auto'));

    let autoAniSkip = GM_getValue('ativar_aniskip', true);
    let cacheAniSkip = null;
    const framesAguardandoDadosAniSkip = new Set();
    let aniskipBuscado = false;
    let aniskipSolicitouDadosAoPai = false;
    let tentativasSolicitarDadosAniSkip = 0;
    let temporizadorSolicitarDadosAniSkip = null;
    let buscaLocalAniSkipNoPlayer = false;
    let tentativasLeituraAniSkip = 0;
    let proximaBuscaAniSkipEm = 0;

    function solicitarDadosAniSkipAoPai() {
        if (ehJanelaPrincipal || !autoAniSkip || aniskipSolicitouDadosAoPai || (Array.isArray(cacheAniSkip) && cacheAniSkip.length)) return;
        try {
            window.top.postMessage({ app: 'ANIME_V44', acao: 'ANISKIP_SOLICITAR_DADOS' }, '*');
            aniskipSolicitouDadosAoPai = true;
            const atrasos = [300, 700, 1500, 3000, 5000, 8000];
            if (tentativasSolicitarDadosAniSkip < atrasos.length) {
                clearTimeout(temporizadorSolicitarDadosAniSkip);
                temporizadorSolicitarDadosAniSkip = setTimeout(() => {
                    temporizadorSolicitarDadosAniSkip = null;
                    if (Array.isArray(cacheAniSkip) && cacheAniSkip.length) return;
                    aniskipSolicitouDadosAoPai = false;
                    tentativasSolicitarDadosAniSkip++;
                    solicitarDadosAniSkipAoPai();
                }, atrasos[tentativasSolicitarDadosAniSkip]);
            } else if (!buscaLocalAniSkipNoPlayer && hostCorrespondeADominio(hostAtual, 'anidrive.click')) {
                // O Anroll pode não encaminhar a resposta AniSkip ao iframe do Anidrive.
                // Após esgotar a sincronização com o pai, procura os tempos pelo título do player.
                buscaLocalAniSkipNoPlayer = true;
                buscarTemposAniSkip();
            }
        } catch (e) {}
    }

    function enviarDadosAniSkipParaFrame(frameWindow, origem = '*') {
        if (!frameWindow || !Array.isArray(cacheAniSkip) || !cacheAniSkip.length) return;
        try {
            const destino = origem && origem !== 'null' ? origem : '*';
            frameWindow.postMessage({ app: 'ANIME_V44', acao: 'ANISKIP_DADOS', dados: cacheAniSkip }, destino);
        } catch (e) {}
    }

    function transmitirDadosAniSkipParaFrames() {
        if (!ehJanelaPrincipal || !Array.isArray(cacheAniSkip) || !cacheAniSkip.length) return;
        const destinos = new Set(framesAguardandoDadosAniSkip);
        try {
            document.querySelectorAll('iframe').forEach(frame => { if (frame.contentWindow) destinos.add(frame.contentWindow); });
        } catch (e) {}
        destinos.forEach(frameWindow => enviarDadosAniSkipParaFrame(frameWindow));
        framesAguardandoDadosAniSkip.clear();
    }

    function aplicarPuloAniSkipSeJaEstiverNoTrecho() {
        if (!autoAniSkip || !Array.isArray(cacheAniSkip) || !cacheAniSkip.length) return;
        try {
            const docs = coletarTodosOsDocumentosIncluindoIframes(document, [], 0);
            const video = listarTodosOsVideosEncontrados(docs).find(v => {
                const atual = obterTempoAtualDoVideo(v);
                return Number.isFinite(atual) && cacheAniSkip.some(item => {
                    const intervalo = item && item.interval;
                    return intervalo && Number.isFinite(intervalo.startTime) && Number.isFinite(intervalo.endTime) &&
                        atual >= intervalo.startTime && atual <= intervalo.endTime;
                });
            });
            if (video) lidarComAtualizacaoDeTempoDoVideo(video);
        } catch (e) {}
    }

    function adiarBuscaAniSkipAteTituloCarregar() {
        const siteAlvo = hostCorrespondeADominio(hostAtual, 'anroll.io') ||
            hostCorrespondeADominio(hostAtual, 'animesonline.io');
        if (!siteAlvo || tentativasLeituraAniSkip >= 20) return;
        tentativasLeituraAniSkip++;
        aniskipBuscado = false;
        proximaBuscaAniSkipEm = Date.now() + 1500;
    }

    let metadadosAnimeAtual = null;
    let nomeAnimeAtualParaExibicao = '';

    let autoTeatro = GM_getValue('ativar_teatro', false);
    let teatroAtivoNoVideo = false;
    const pedidosExpandirNativo = new Map();
    let ultimoCliqueExpandirNativo = 0;

    let videoAtivo = null;
    let fullscreenTentado = false;
    let teatroTentado = false;

    let jaAvancou = false;
    let ultimoAvisoTempo = 0;
    let base64Injetado = false;
    let tentouMudarQualidade = false;
    let fallbackTentativas = 0;
    let watchdogTempo = 0;
    let indiceServidorFallback = -1;

    let epoca = 0;
    let ultimoReset = 0;
    let armado = false;
    let precisaMudo = false;
    const contagemOcultoTocando = new WeakMap();
    let bordaAplicada = false;
    let timerVarredura = null;
    const estadoVideo = new WeakMap();
    const docsObservados = new WeakSet();
    const iframesLigados = new WeakSet();
    const iframesComPermissaoAjustada = new WeakSet();
    const botoesDeRecusaDeRetomadaProcessados = new WeakSet();

    // ==========================================
    // 2. INICIALIZAÇÃO CONFORME A POLÍTICA DE SITES
    // ==========================================
    function iniciarAniStreamNoFrameAutorizado() {
    let uiStatus, uiTempo, uiAP, uiAniSkip;

    if (ehJanelaPrincipal) {
        GM_registerMenuCommand("🔴 Desativar neste site", () => {
            alterarConfiguracaoDeSites(GM_getValue, GM_setValue, sitesPadrao, cfg => desativarSiteNaConfiguracao(cfg, hostAtual));
            location.reload();
        }, { title: 'Desativa o AniStream neste domínio e recarrega a página.' });
        GM_registerMenuCommand("⌨️ Atalhos e ajuda…", configurarAtalhos, { title: 'Mostra os atalhos atuais e permite configurar as teclas e os tempos de avanço.' });
        GM_registerMenuCommand(`⏱️ Antecipar Auto Next: ${tempoPulo}s`, () => {
            let novo = prompt("Quantos segundos antes do final deseja saltar?", tempoPulo);
            if (novo !== null && !isNaN(novo) && novo >= 0) {
                GM_setValue('segundos_pulo', parseFloat(novo));
                location.reload();
            }
        }, { title: 'Define quantos segundos antes do fim o próximo episódio será acionado.' });
        GM_registerMenuCommand(`▶️ Auto Play: ${autoPlay ? "ON" : "OFF"}`, () => {
            GM_setValue('ativar_autoplay', !autoPlay);
            location.reload();
        }, { title: 'Ativa ou desativa a reprodução automática do vídeo.' });
        GM_registerMenuCommand(`⏭️ Auto Next: ${autoNext ? "ON" : "OFF"}`, () => {
            GM_setValue('ativar_autonext', !autoNext);
            location.reload();
        }, { title: 'Ativa ou desativa a troca automática para o próximo episódio.' });
        GM_registerMenuCommand(`🖥️ Auto Fullscreen: ${autoFullscreen ? "ON" : "OFF"}`, () => {
            GM_setValue('ativar_fullscreen', !autoFullscreen);
            location.reload();
        }, { title: 'Ativa ou desativa a tela cheia automática.' });
        GM_registerMenuCommand(`🙅 Retomar: ${recusarRetomar ? "recusa" : "permite"}`, () => {
            GM_setValue('ativar_recusar_retomar', !recusarRetomar);
            location.reload();
        }, { title: 'Escolhe se o AniStream recusa ou permite a janela de continuar de onde parou.' });
        GM_registerMenuCommand("🎚️ Qualidade do player…", configurarQualidadePlayer, { title: 'Define a qualidade preferida em players compatíveis; Automática mantém a escolha do player.' });
        GM_registerMenuCommand(`📺 Priorizar servidor FHD: ${autoFHD ? "ON" : "OFF"}`, () => {
            GM_setValue('ativar_fhd', !autoFHD);
            location.reload();
        }, { title: 'Prioriza servidores Full HD quando o site oferece mais de uma fonte.' });
        GM_registerMenuCommand(`⏩ AniSkip: ${autoAniSkip ? "ON" : "OFF"}`, () => {
            GM_setValue('ativar_aniskip', !autoAniSkip);
            location.reload();
        }, { title: 'Ativa ou desativa a busca e o pulo automático de abertura e encerramento.' });
        function configurarAniSkipManual() {
            const escolha = prompt("AniSkip manual:\n1 — Definir MAL ID da série\n2 — Gravar tempo da abertura", "1");
            if (escolha === "1") {
                const chave = obterChaveDaSerie();
                const atualObj = normalizarMapeamentoManual(GM_getValue('aniskip_malid_manual_' + chave, null));
                const textoAtual = formatarMapeamentoParaTexto(atualObj);
                const instrucoes = "MAL ID do MyAnimeList. Exemplos: 56252 ou 1-25:21,26-50:22.\nPode combinar ranges e um ID de fallback. Digite 'limpar' para remover.";
                let novoTexto = prompt(instrucoes, textoAtual);
                if (novoTexto === null || novoTexto.trim() === '') return;
                novoTexto = novoTexto.trim();
                if (novoTexto.toLowerCase() === 'limpar') {
                    GM_setValue('aniskip_malid_manual_' + chave, null);
                    alert('MAL ID manual removido. A busca automática será usada.');
                    location.reload();
                    return;
                }
                const novoObj = parseMapeamentoDeTexto(novoTexto);
                if (!novoObj) { alert('Formato inválido. Exemplo: 56252 ou 1-25:21,26-50:22'); return; }
                GM_setValue('aniskip_malid_manual_' + chave, novoObj);
                alert('MAL ID salvo: ' + (formatarMapeamentoParaTexto(novoObj) || '(vazio)'));
                location.reload();
            } else if (escolha === "2") {
                const chave = obterChaveDaSerie();
                const inicio = prompt("Segundo em que a abertura começa (ex.: 85):");
                if (!inicio || isNaN(inicio)) return;
                const fim = prompt("Segundo em que a abertura termina (ex.: 175):");
                if (!fim || isNaN(fim)) return;
                GM_setValue('smartskip_op_' + chave, { s: parseFloat(inicio), e: parseFloat(fim) });
                alert("Abertura salva para esta série.");
                location.reload();
            }
        }

        function configurarAtalhos() {
            let overlay = document.getElementById('au-shortcuts-help');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'au-shortcuts-help';
                overlay.setAttribute('role', 'presentation');
                overlay.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;display:none;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,.72);font:14px/1.45 system-ui,sans-serif;color:#e2e8f0;';

                const painel = document.createElement('section');
                painel.setAttribute('role', 'dialog');
                painel.setAttribute('aria-modal', 'true');
                painel.setAttribute('aria-labelledby', 'au-shortcuts-title');
                painel.style.cssText = 'position:relative;box-sizing:border-box;width:min(560px,96vw);max-height:88vh;overflow:auto;padding:22px;border:1px solid #ffffff30;border-radius:16px;background:#171a20;color:#e2e8f0;box-shadow:0 20px 60px #0009;';

                const fechar = document.createElement('button');
                fechar.type = 'button';
                fechar.textContent = '×';
                fechar.setAttribute('aria-label', 'Fechar atalhos e ajuda');
                fechar.style.cssText = 'position:absolute;right:12px;top:10px;width:34px;height:34px;border:1px solid #ffffff30;border-radius:50%;background:#ffffff12;color:#fff;font-size:24px;cursor:pointer;';
                const fecharPainel = () => { overlay.style.display = 'none'; };
                fechar.addEventListener('click', fecharPainel);
                overlay.addEventListener('click', e => { if (e.target === overlay) fecharPainel(); });
                overlay.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.target.matches('input')) fecharPainel(); });

                const titulo = document.createElement('h2');
                titulo.id = 'au-shortcuts-title';
                titulo.textContent = 'Atalhos e ajuda';
                titulo.style.cssText = 'margin:0 40px 8px 0;color:#fff;font-size:21px;';
                const descricao = document.createElement('p');
                descricao.textContent = 'Edite teclas simples ou combinações, como Ctrl+Shift+K. Os atalhos continuam sendo ignorados enquanto você digita em campos de texto.';
                descricao.style.cssText = 'margin:0 0 14px;color:#cbd5e1;';

                const lista = document.createElement('div');
                lista.style.cssText = 'display:grid;gap:1px;margin-bottom:16px;border:1px solid #ffffff20;border-radius:10px;overflow:hidden;background:#ffffff20;';
                const atalhos = [
                    ['Próximo episódio', 'next'],
                    ['Pular intro', 'intro'],
                    ['Pular vinheta', 'outro'],
                    ['Expandir/recolher player', 'theater'],
                    ['Mover botão para a esquerda', 'moveLeft'],
                    ['Mover botão para a direita', 'moveRight'],
                    ['Mover botão para cima', 'moveUp'],
                    ['Mover botão para baixo', 'moveDown'],
                    ['Passo maior ao mover', 'fastMoveModifier'],
                    ['Fechar menu flutuante', 'escape'],
                    ['Desfazer pulo enquanto o aviso aparece', 'undo']
                ];
                atalhos.forEach(([nome, chave]) => {
                    const linha = document.createElement('div');
                    linha.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:8px 10px;background:#20242b;';
                    const rotulo = document.createElement('span');
                    rotulo.textContent = nome;
                    const valor = document.createElement('strong');
                    valor.dataset.auShortcutValue = chave;
                    valor.style.cssText = 'color:#a7f3d0;text-align:right;';
                    linha.append(rotulo, valor);
                    lista.appendChild(linha);
                });

                const habilitar = document.createElement('label');
                habilitar.style.cssText = 'display:flex;align-items:center;gap:9px;margin:0 0 14px;font-weight:700;';
                const habilitarInput = document.createElement('input');
                habilitarInput.type = 'checkbox';
                habilitarInput.dataset.auShortcutEnabled = 'true';
                habilitarInput.style.cssText = 'width:18px;height:18px;accent-color:#10b981;';
                habilitar.append(habilitarInput, document.createTextNode('Atalhos globais ativos'));
                habilitarInput.addEventListener('change', () => GM_setValue('ativar_atalhos_teclado', habilitarInput.checked));

                const formulario = document.createElement('form');
                formulario.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;';
                const criarCampo = (rotulo, nome, tipo, valor) => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display:grid;gap:5px;color:#cbd5e1;font-size:12px;';
                    label.appendChild(document.createTextNode(rotulo));
                    const input = document.createElement('input');
                    input.name = nome;
                    input.type = tipo;
                    input.value = valor;
                    input.required = true;
                    if (tipo === 'text') { input.maxLength = 40; input.autocomplete = 'off'; input.placeholder = 'Ex.: Ctrl+Shift+K'; }
                    else { input.min = '1'; input.max = nome.includes('Step') ? '200' : '600'; input.step = '1'; }
                    input.style.cssText = 'box-sizing:border-box;width:100%;min-height:38px;padding:7px 10px;border:1px solid #64748b;border-radius:8px;background:#0f172a;color:#fff;font:inherit;';
                    label.appendChild(input);
                    formulario.appendChild(label);
                };
                criarCampo('Tecla para próximo episódio', 'next', 'text', teclaProximoEp);
                criarCampo('Tecla para pular intro', 'intro', 'text', teclaPularIntro);
                criarCampo('Avanço da intro (segundos)', 'introSeconds', 'number', segundosPularIntro);
                criarCampo('Tecla para pular vinheta', 'outro', 'text', teclaPularVinheta);
                criarCampo('Avanço da vinheta (segundos)', 'outroSeconds', 'number', segundosPularVinheta);
                const configAoCriar = lerAtalhosPersonalizados();
                criarCampo('Expandir/recolher player', 'theater', 'text', configAoCriar.theater);
                criarCampo('Fechar menu flutuante', 'closeMenu', 'text', configAoCriar.closeMenu);
                criarCampo('Desfazer pulo', 'undo', 'text', configAoCriar.undo);
                criarCampo('Mover para a esquerda', 'moveLeft', 'text', configAoCriar.moveLeft);
                criarCampo('Mover para a direita', 'moveRight', 'text', configAoCriar.moveRight);
                criarCampo('Mover para cima', 'moveUp', 'text', configAoCriar.moveUp);
                criarCampo('Mover para baixo', 'moveDown', 'text', configAoCriar.moveDown);
                criarCampo('Modificador do passo maior', 'fastMoveModifier', 'text', configAoCriar.fastMoveModifier);
                criarCampo('Passo normal (pixels)', 'moveStep', 'number', configAoCriar.moveStep);
                criarCampo('Passo maior (pixels)', 'moveLargeStep', 'number', configAoCriar.moveLargeStep);

                const salvar = document.createElement('button');
                salvar.type = 'submit';
                salvar.textContent = 'Salvar atalhos';
                salvar.style.cssText = 'min-height:40px;border:0;border-radius:8px;background:#059669;color:#fff;font-weight:700;cursor:pointer;';
                formulario.appendChild(salvar);
                const status = document.createElement('span');
                status.setAttribute('role', 'status');
                status.setAttribute('aria-live', 'polite');
                status.style.cssText = 'align-self:center;color:#a7f3d0;';
                formulario.appendChild(status);
                formulario.addEventListener('submit', e => {
                    e.preventDefault();
                    const obter = nome => formulario.elements.namedItem(nome).value.trim();
                    const cfgAtual = lerAtalhosPersonalizados();
                    const novaConfig = { ...cfgAtual };
                    ['next', 'intro', 'outro', 'theater', 'closeMenu', 'undo', 'moveLeft', 'moveRight', 'moveUp', 'moveDown'].forEach(chave => {
                        const campo = chave === 'closeMenu' ? 'closeMenu' : chave;
                        const analisado = analisarAtalho(obter(campo));
                        if (!analisado) novaConfig[chave] = null;
                        else novaConfig[chave] = formatarAtalho(analisado);
                    });
                    const next = novaConfig.next, intro = novaConfig.intro, outro = novaConfig.outro;
                    const introSeconds = Number(obter('introSeconds')), outroSeconds = Number(obter('outroSeconds'));
                    novaConfig.fastMoveModifier = obter('fastMoveModifier');
                    novaConfig.moveStep = Number(obter('moveStep'));
                    novaConfig.moveLargeStep = Number(obter('moveLargeStep'));
                    const atalhosValidos = ['next', 'intro', 'outro', 'theater', 'closeMenu', 'undo', 'moveLeft', 'moveRight', 'moveUp', 'moveDown'].every(chave => novaConfig[chave]);
                    const combinacoes = ['next', 'intro', 'outro', 'theater', 'closeMenu', 'undo', 'moveLeft', 'moveRight', 'moveUp', 'moveDown'].map(chave => String(novaConfig[chave] || '').toLowerCase());
                    const semConflitos = new Set(combinacoes).size === combinacoes.length;
                    if (!atalhosValidos || !semConflitos || !['Shift', 'Alt', 'Ctrl', 'Meta', 'Nenhum'].includes(novaConfig.fastMoveModifier) ||
                        !Number.isInteger(novaConfig.moveStep) || novaConfig.moveStep < 1 || novaConfig.moveStep > 200 ||
                        !Number.isInteger(novaConfig.moveLargeStep) || novaConfig.moveLargeStep < 1 || novaConfig.moveLargeStep > 200 ||
                        !Number.isInteger(introSeconds) || introSeconds < 1 || introSeconds > 600 ||
                        !Number.isInteger(outroSeconds) || outroSeconds < 1 || outroSeconds > 600) {
                        status.textContent = !semConflitos ? 'Cada ação precisa de uma combinação diferente.' : 'Confira as teclas/combinações e use valores entre 1 e 200 px ou 1 e 600 segundos.';
                        return;
                    }
                    teclaProximoEp = analisarAtalho(next).key;
                    teclaPularIntro = analisarAtalho(intro).key;
                    teclaPularVinheta = analisarAtalho(outro).key;
                    segundosPularIntro = introSeconds;
                    segundosPularVinheta = outroSeconds;
                    GM_setValue('tecla_proximo_ep', teclaProximoEp);
                    GM_setValue('tecla_pular_intro', teclaPularIntro);
                    GM_setValue('tecla_pular_vinheta', teclaPularVinheta);
                    GM_setValue('segundos_pular_intro', segundosPularIntro);
                    GM_setValue('segundos_pular_vinheta', segundosPularVinheta);
                    GM_setValue(CHAVE_ATALHOS_PERSONALIZADOS, novaConfig);
                    document.querySelectorAll('[data-au-acao="atalho-proximo"]').forEach(btn => { btn.title = `Próximo episódio (${next})`; });
                    document.querySelectorAll('[data-au-acao="atalho-intro"]').forEach(btn => { btn.title = `Pular intro (+${segundosPularIntro}s, ${intro})`; });
                    document.querySelectorAll('[data-au-acao="atalho-teatro"]').forEach(btn => { btn.title = `Expandir/recolher player (${novaConfig.theater})`; });
                    fabTeatro.setAttribute('aria-keyshortcuts', [novaConfig.moveLeft, novaConfig.moveRight, novaConfig.moveUp, novaConfig.moveDown].join(' '));
                    atualizarAtalhosVisiveis();
                    status.textContent = 'Atalhos salvos.';
                });

                painel.append(fechar, titulo, descricao, lista, habilitar, formulario);
                overlay.appendChild(painel);
                document.body.appendChild(overlay);

                function atualizarAtalhosVisiveis() {
                    const cfg = lerAtalhosPersonalizados();
                    const valores = {
                        next: cfg.next,
                        intro: `${cfg.intro} · +${segundosPularIntro}s`,
                        outro: `${cfg.outro} · +${segundosPularVinheta}s`,
                        theater: cfg.theater,
                        moveLeft: cfg.moveLeft,
                        moveRight: cfg.moveRight,
                        moveUp: cfg.moveUp,
                        moveDown: cfg.moveDown,
                        fastMoveModifier: `${cfg.fastMoveModifier} · ${cfg.moveLargeStep}px`,
                        escape: cfg.closeMenu,
                        undo: cfg.undo
                    };
                    lista.querySelectorAll('[data-au-shortcut-value]').forEach(el => { el.textContent = valores[el.dataset.auShortcutValue] || ''; });
                }
                overlay._auAtualizarAtalhos = atualizarAtalhosVisiveis;
            }

            const cfgAtual = lerAtalhosPersonalizados();
            ['next', 'intro', 'outro', 'theater', 'closeMenu', 'undo', 'moveLeft', 'moveRight', 'moveUp', 'moveDown', 'fastMoveModifier', 'moveStep', 'moveLargeStep'].forEach(chave => {
                const campo = overlay.querySelector(`[name="${chave}"]`);
                if (campo) campo.value = cfgAtual[chave];
            });
            overlay.querySelector('[name="introSeconds"]').value = segundosPularIntro;
            overlay.querySelector('[name="outroSeconds"]').value = segundosPularVinheta;
            overlay.querySelector('[data-au-shortcut-enabled]').checked = GM_getValue('ativar_atalhos_teclado', true);
            overlay._auAtualizarAtalhos();
            overlay.style.display = 'flex';
            overlay.querySelector('button[aria-label="Fechar atalhos e ajuda"]').focus();
        }

        GM_registerMenuCommand("🧩 AniSkip manual…", configurarAniSkipManual, { title: 'Informa o MAL ID ou grava manualmente o intervalo da abertura desta série.' });
        GM_registerMenuCommand("🗄️ Base MAL offline…", confirmarEIniciarCacheOffline, { title: 'Baixa e prepara a base offline de dados MAL usada pelo AniSkip.' });
        GM_registerMenuCommand("⌨️ Alternar atalhos globais", () => {
            const ativos = GM_getValue('ativar_atalhos_teclado', true);
            GM_setValue('ativar_atalhos_teclado', !ativos);
            alert(`Atalhos globais ${ativos ? 'desativados' : 'ativados'}. Os botões do player continuam funcionando.`);
        }, { title: 'Liga ou desliga os atalhos de teclado globais sem desativar os botões do player.' });
        let modalInfo = document.createElement('div');
        modalInfo.id = 'au-info-overlay';
        modalInfo.innerHTML = `
            <div id="au-info-modal">
                <button id="au-info-fechar" type="button" title="Fechar">✖</button>
                <div id="au-info-header">
                    <h2 id="au-info-titulo"></h2>
                    <div id="au-info-nota"></div>
                </div>
                <div id="au-info-generos"></div>
                <div id="au-info-sinopse"></div>
            </div>
        `;
        document.body.appendChild(modalInfo);
        modalInfo.addEventListener('click', (e) => { if (e.target === modalInfo) fecharModalInfo(); });
        document.getElementById('au-info-fechar').onclick = fecharModalInfo;

        let fabTeatro = document.createElement('button');
        fabTeatro.id = 'au-fab-teatro';
        fabTeatro.type = 'button';
        fabTeatro.setAttribute('aria-controls', 'au-control-bar');
        fabTeatro.setAttribute('aria-expanded', 'false');
        fabTeatro.setAttribute('aria-pressed', 'false');
        const atalhosFab = lerAtalhosPersonalizados();
        fabTeatro.setAttribute('aria-keyshortcuts', [atalhosFab.moveLeft, atalhosFab.moveRight, atalhosFab.moveUp, atalhosFab.moveDown].join(' '));
        fabTeatro.setAttribute('aria-label', 'Abrir modo Expandir. Arraste para mover ou use os atalhos configurados.');
        fabTeatro.innerHTML = iconeSvg('expand');
        fabTeatro.title = 'Abrir Expandir';
        const anuncioPosicaoFab = document.createElement('div');
        anuncioPosicaoFab.id = 'au-fab-position-status';
        anuncioPosicaoFab.setAttribute('role', 'status');
        anuncioPosicaoFab.setAttribute('aria-live', 'polite');
        anuncioPosicaoFab.setAttribute('aria-atomic', 'true');
        anuncioPosicaoFab.style.cssText = 'position:fixed!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;';
        let ultimoCliqueFabExpandido = 0;
        let arrastoFab = null;
        let ignorarCliqueFabAte = 0;
        const atualizarVisualFabExpandido = () => {
            const expandido = document.body.classList.contains('au-teatro-ativo');
            const barraControles = document.getElementById('au-control-bar');
            const menuAberto = !!barraControles && document.body.classList.contains('au-menu-flutuante-aberto');
            const estadoVisual = `${expandido}-${menuAberto}`;
            if (barraControles) fabTeatro.setAttribute('aria-controls', 'au-control-bar');
            else fabTeatro.removeAttribute('aria-controls');
            if (fabTeatro.dataset.auExpanded !== estadoVisual) {
                fabTeatro.dataset.auExpanded = estadoVisual;
                fabTeatro.innerHTML = iconeSvg(expandido ? 'collapse' : 'expand');
            }
            fabTeatro.setAttribute('aria-label', 'Modo de expansão do player');
            const atalhosFab = lerAtalhosPersonalizados();
            fabTeatro.setAttribute('aria-keyshortcuts', [atalhosFab.moveLeft, atalhosFab.moveRight, atalhosFab.moveUp, atalhosFab.moveDown].join(' '));
            fabTeatro.setAttribute('aria-description', `${expandido ? 'Player expandido.' : 'Player recolhido.'} ${menuAberto ? 'Comandos abertos.' : 'Comandos fechados.'} Arraste ou use ${atalhosFab.moveLeft}, ${atalhosFab.moveRight}, ${atalhosFab.moveUp} e ${atalhosFab.moveDown} para mover.`);
            fabTeatro.setAttribute('aria-expanded', String(menuAberto));
            fabTeatro.setAttribute('aria-pressed', String(expandido));
            fabTeatro.title = expandido
                ? 'Arraste para mover; toque abre os comandos; toque duplo recolhe'
                : 'Arraste para mover; toque para expandir';
            document.querySelectorAll('[data-au-acao="atalho-teatro"]').forEach(btn => {
                if (btn.dataset.auExpanded === estadoVisual) return;
                btn.dataset.auExpanded = estadoVisual;
                const fecharMenu = expandido && menuAberto;
                const rotulo = fecharMenu ? 'Fechar menu' : (expandido ? 'Recolher' : 'Expandir');
                btn.innerHTML = `${iconeSvg(fecharMenu ? 'close' : (expandido ? 'collapse' : 'expand'))}<span>${rotulo}</span>`;
                const teclasUI = lerAtalhosPersonalizados();
                btn.title = fecharMenu ? `Fechar menu (${teclasUI.closeMenu})` : (expandido ? 'Recolher player (toque duplo)' : `Expandir player (${teclasUI.theater})`);
                btn.setAttribute('aria-label', fecharMenu ? 'Fechar menu' : `${rotulo} player`);
            });
        };
        new MutationObserver(atualizarVisualFabExpandido).observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
        const abrirMenuFlutuante = () => {
            if (!document.getElementById('au-control-bar')) return false;
            document.body.classList.add('au-menu-flutuante-aberto');
            fabTeatro.setAttribute('aria-label', 'Comandos do player abertos. Arraste para mover; toque duas vezes para recolher.');
            fabTeatro.title = 'Arraste para mover; toque duplo recolhe';
            atualizarVisualFabExpandido();
            resetarInatividade();
            requestAnimationFrame(posicionarMenuFlutuante);
            return true;
        };
        fabTeatro.addEventListener('mouseenter', abrirMenuFlutuante);
        const posicaoFabSalva = GM_getValue('au_fab_posicao_v1', null);
        const posicionarMenuFlutuante = () => {
            const barra = document.getElementById('au-control-bar');
            if (!barra || !document.body.classList.contains('au-menu-flutuante-aberto')) return;
            const fab = fabTeatro.getBoundingClientRect();
            const tamanho = barra.getBoundingClientRect();
            if (!tamanho.width || !tamanho.height) return;
            const margem = 8;
            const espacamento = 10;
            let left;
            let top = fab.top + (fab.height - tamanho.height) / 2;
            if (fab.left - tamanho.width - espacamento >= margem) {
                left = fab.left - tamanho.width - espacamento;
            } else if (fab.right + tamanho.width + espacamento <= window.innerWidth - margem) {
                left = fab.right + espacamento;
            } else {
                left = Math.min(window.innerWidth - tamanho.width - margem, Math.max(margem, fab.right - tamanho.width));
                if (fab.top - tamanho.height - espacamento >= margem) top = fab.top - tamanho.height - espacamento;
                else top = fab.bottom + espacamento;
            }
            top = Math.max(margem, Math.min(top, window.innerHeight - tamanho.height - margem));
            barra.style.setProperty('left', `${left}px`, 'important');
            barra.style.setProperty('top', `${top}px`, 'important');
            barra.style.setProperty('right', 'auto', 'important');
            barra.style.setProperty('bottom', 'auto', 'important');
        };
        const limitarPosicaoFab = (esquerda, topo) => ({
            left: Math.max(8, Math.min(Number(esquerda) || 8, window.innerWidth - fabTeatro.offsetWidth - 8)),
            top: Math.max(8, Math.min(Number(topo) || 8, window.innerHeight - fabTeatro.offsetHeight - 8))
        });
        const aplicarPosicaoFab = (esquerda, topo, salvar = false) => {
            const pos = limitarPosicaoFab(esquerda, topo);
            fabTeatro.style.setProperty('left', `${pos.left}px`, 'important');
            fabTeatro.style.setProperty('top', `${pos.top}px`, 'important');
            fabTeatro.style.setProperty('right', 'auto', 'important');
            fabTeatro.style.setProperty('bottom', 'auto', 'important');
            requestAnimationFrame(posicionarMenuFlutuante);
            if (salvar) GM_setValue('au_fab_posicao_v1', pos);
            return pos;
        };
        let timerAnunciarPosicaoFab = null;
        fabTeatro.addEventListener('keydown', e => {
            const cfg = lerAtalhosPersonalizados();
            const direcoes = [
                ['moveLeft', -1, 0], ['moveRight', 1, 0], ['moveUp', 0, -1], ['moveDown', 0, 1]
            ];
            const direcao = direcoes.find(([chave]) => eventoAcionaAtalho(e, cfg[chave], cfg.fastMoveModifier === 'Nenhum' ? null : cfg.fastMoveModifier));
            if (!direcao) return;
            const modificadorGrande = { Shift: 'shiftKey', Alt: 'altKey', Ctrl: 'ctrlKey', Meta: 'metaKey' }[cfg.fastMoveModifier];
            const passo = modificadorGrande && e[modificadorGrande] ? cfg.moveLargeStep : cfg.moveStep;
            const rect = fabTeatro.getBoundingClientRect();
            let left = rect.left;
            let top = rect.top;
            left += direcao[1] * passo;
            top += direcao[2] * passo;

            e.preventDefault();
            e.stopPropagation();
            aplicarPosicaoFab(left, top);
            clearTimeout(timerAnunciarPosicaoFab);
            timerAnunciarPosicaoFab = setTimeout(() => {
                const rectAtual = fabTeatro.getBoundingClientRect();
                const posicaoAtual = limitarPosicaoFab(rectAtual.left, rectAtual.top);
                GM_setValue('au_fab_posicao_v1', posicaoAtual);
                const maxLeft = Math.max(1, window.innerWidth - fabTeatro.offsetWidth - 16);
                const maxTop = Math.max(1, window.innerHeight - fabTeatro.offsetHeight - 16);
                const percentualX = Math.round(((posicaoAtual.left - 8) / maxLeft) * 100);
                const percentualY = Math.round(((posicaoAtual.top - 8) / maxTop) * 100);
                anuncioPosicaoFab.textContent = `Botão reposicionado: ${percentualX}% da esquerda e ${percentualY}% do topo.`;
            }, 220);
        });
        fabTeatro.addEventListener('pointerdown', e => {
            if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
            const rect = fabTeatro.getBoundingClientRect();
            arrastoFab = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moveu: false };
            try { fabTeatro.setPointerCapture(e.pointerId); } catch (err) {}
        });
        fabTeatro.addEventListener('pointermove', e => {
            if (!arrastoFab || e.pointerId !== arrastoFab.id) return;
            const dx = e.clientX - arrastoFab.x;
            const dy = e.clientY - arrastoFab.y;
            if (!arrastoFab.moveu && Math.hypot(dx, dy) < 7) return;
            arrastoFab.moveu = true;
            fabTeatro.classList.add('au-fab-arrastando');
            aplicarPosicaoFab(arrastoFab.left + dx, arrastoFab.top + dy);
            if (e.cancelable) e.preventDefault();
        });
        const terminarArrastoFab = e => {
            if (!arrastoFab || (e && e.pointerId !== arrastoFab.id)) return;
            if (arrastoFab.moveu) {
                const rect = fabTeatro.getBoundingClientRect();
                aplicarPosicaoFab(rect.left, rect.top, true);
                ignorarCliqueFabAte = Date.now() + 500;
            }
            fabTeatro.classList.remove('au-fab-arrastando');
            arrastoFab = null;
        };
        fabTeatro.addEventListener('pointerup', terminarArrastoFab);
        fabTeatro.addEventListener('pointercancel', terminarArrastoFab);
        fabTeatro.addEventListener('click', e => {
            if (Date.now() < ignorarCliqueFabAte) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            if (document.body.classList.contains('au-teatro-ativo')) {
                const agora = Date.now();
                if (agora - ultimoCliqueFabExpandido <= 650) {
                    ultimoCliqueFabExpandido = 0;
                    definirModoTeatro(false);
                    return;
                }
                ultimoCliqueFabExpandido = agora;
                abrirMenuFlutuante();
                resetarInatividade();
            }
            else abrirMenuFlutuante();
            if (!document.body.classList.contains('au-teatro-ativo')) resetarInatividade();
        });
        document.body.appendChild(fabTeatro);
        document.body.appendChild(anuncioPosicaoFab);
        if (posicaoFabSalva && Number.isFinite(Number(posicaoFabSalva.left)) && Number.isFinite(Number(posicaoFabSalva.top))) {
            requestAnimationFrame(() => aplicarPosicaoFab(posicaoFabSalva.left, posicaoFabSalva.top));
        }
        window.addEventListener('resize', () => {
            const rect = fabTeatro.getBoundingClientRect();
            aplicarPosicaoFab(rect.left, rect.top, true);
        });
        atualizarVisualFabExpandido();

        const toastPulo = document.createElement('div');
        toastPulo.id = 'au-skip-toast';
        toastPulo.setAttribute('role', 'status');
        toastPulo.setAttribute('aria-live', 'polite');
        toastPulo.innerHTML = '<span class="au-skip-toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m4 5 7 7-7 7M13 5l7 7-7 7"/></svg></span><span class="au-skip-toast-text"></span><button class="au-skip-toast-undo" type="button" hidden>Desfazer (Ctrl+Z)</button><span class="au-skip-toast-progress" aria-hidden="true"></span>';
        document.body.appendChild(toastPulo);

        {
            let controlBar = document.createElement('div');
            controlBar.id = 'au-control-bar';
            controlBar.setAttribute('role', 'group');
            controlBar.setAttribute('aria-label', 'Comandos do player');
            controlBar.innerHTML = gerarHtmlBotoesBarra(false);
            document.body.appendChild(controlBar);
            ligarBotoesDaBarra(controlBar);
            conectarStatusNaBarra(controlBar);
            atualizarVisualFabExpandido();
        }

        window.addEventListener('message', (e) => {
            if (!origemNaMesmaArvoreDeFrames(e)) return;
            if (e.data && e.data.app === 'ANIME_V44') {
                if (e.data.acao === 'TEMPO') {
                    const tAtual = Number(e.data.atual), tTotal = Number(e.data.total);
                    if (Number.isFinite(tAtual) && Number.isFinite(tTotal) && tTotal > 0) {
                        if (tAtual > 0) watchdogTempo = 0;
                        atualizarPainelDeStatusNaJanela(tAtual, tTotal);
                    }
                }
                else if (e.data.acao === 'PULAR') avancarParaProximoEpisodio(!!e.data.manual);
                else if (e.data.acao === 'MUDO') {
                    const els = Array.from(document.querySelectorAll('.au-status-label'));
                    if (uiStatus && !els.includes(uiStatus)) els.push(uiStatus);
                    els.forEach(el => { el.innerHTML = '<span>🔇 AutoPlay mudo</span>'; });
                }
                else if (e.data.acao === 'NOVO_EP') reiniciarEstadoParaNovoEpisodio('iframe mudou de episódio', 'remoto');
                else if (e.data.acao === 'AP') {
                    const els = Array.from(document.querySelectorAll('.au-status-message'));
                    if (uiAP && !els.includes(uiAP)) els.push(uiAP);
                    els.forEach(el => { el.style.display = 'inline'; el.textContent = String(e.data.txt || '').slice(0, 80); });
                    if (e.data.toast) mostrarAvisoDePulo(e.data.txt);
                }
                else if (e.data.acao === 'ANISKIP_UI') {
                    const els = Array.from(document.querySelectorAll('.au-status-aniskip'));
                    if (uiAniSkip && !els.includes(uiAniSkip)) els.push(uiAniSkip);
                    els.forEach(el => { el.style.display = 'block'; definirHtmlSanitizado(el, e.data.txt); });
                }
                else if (e.data.acao === 'ANISKIP_SOLICITAR_DADOS' && e.source) {
                    if (Array.isArray(cacheAniSkip) && cacheAniSkip.length) {
                        enviarDadosAniSkipParaFrame(e.source, e.origin);
                    } else {
                        framesAguardandoDadosAniSkip.add(e.source);
                    }
                }
                else if (e.data.acao === 'FALLBACK_SERVIDOR') tentarClicarProximoServidor();
            }
        });
    }

    window.addEventListener('message', (e) => {
        const msgExpandirDoIframeFilho = e.data && e.data.app === 'ANIME_UNIVERSAL' && ['TEATRO_ON', 'TEATRO_OFF', 'TEATRO_IDLE', 'TEATRO_ACTIVE'].includes(e.data.acao) && (() => {
            try { return Array.from(document.querySelectorAll('iframe')).some(frame => frame.contentWindow === e.source); }
            catch (err) { return false; }
        })();
        if (!msgExpandirDoIframeFilho && !origemNaMesmaArvoreDeFrames(e)) return;
        if (e.data && e.data.app === 'ANIME_V44') {
            if (e.data.acao === 'RESET') {
                reiniciarEstadoParaNovoEpisodio('reset vindo do frame pai', 'remoto');
            } else if (e.data.acao === 'TOGGLE_TEATRO') {
                if (videoAtivo) alternarModoTeatro();
                else {
                    document.querySelectorAll('iframe').forEach(i => {
                        try { i.contentWindow.postMessage({ app: 'ANIME_V44', acao: 'TOGGLE_TEATRO' }, '*'); } catch(err){}
                    });
                }
            } else if (e.data.acao === 'SET_TEATRO') {
                const ligar = !!e.data.ligar;
                if (videoAtivo) {
                    if (ligar && !teatroAtivoNoVideo) ativarModoTeatro(videoAtivo);
                    else if (!ligar && teatroAtivoNoVideo) desativarModoTeatro(videoAtivo);
                } else {
                    document.querySelectorAll('iframe').forEach(i => {
                        try { i.contentWindow.postMessage({ app: 'ANIME_V44', acao: 'SET_TEATRO', ligar }, '*'); } catch(err){}
                    });
                }
            } else if (e.data.acao === 'ANISKIP_DADOS') {
                cacheAniSkip = e.data.dados;
                clearTimeout(temporizadorSolicitarDadosAniSkip);
                temporizadorSolicitarDadosAniSkip = null;
                aniskipSolicitouDadosAoPai = true;
                tentativasSolicitarDadosAniSkip = 0;
                document.querySelectorAll('iframe').forEach(i => { try { i.contentWindow.postMessage(e.data, '*'); } catch (err) {} });
                aplicarPuloAniSkipSeJaEstiverNoTrecho();
            }
        }
        else if (e.data && e.data.app === 'ANIME_UNIVERSAL') {
            if (e.data.acao === 'TEATRO_ON' || e.data.acao === 'TEATRO_OFF') {
                const ligar = e.data.acao === 'TEATRO_ON';
                try {
                    document.body.classList.toggle('au-teatro-ativo', ligar);
                    if (!ligar) document.body.classList.remove('au-menu-flutuante-aberto');
                } catch (err) {}
                if (ligar) resetarInatividade();
                else {
                    clearTimeout(timerInatividade);
                    document.body.classList.remove('au-idle');
                    redimensionarPlayerExpandido(false);
                }

                let iframeRemetente = null;
                try {
                    document.querySelectorAll('iframe').forEach(i => {
                        if (i.contentWindow === e.source) iframeRemetente = i;
                    });
                } catch (err) {}

                if (!iframeRemetente && ligar) {
                    let maxArea = 0;
                    document.querySelectorAll('iframe').forEach(i => {
                        try {
                            let rect = i.getBoundingClientRect();
                            let area = rect.width * rect.height;
                            if (area > maxArea && rect.width > 200) {
                                maxArea = area;
                                iframeRemetente = i;
                            }
                        } catch (err) {}
                    });
                }

                if (iframeRemetente) {
                    iframeRemetente.classList.toggle('au-modo-teatro', ligar);
                    lidarComStackingContext(iframeRemetente, ligar);
                }

                if (window !== window.top) {
                    try { window.parent.postMessage(e.data, '*'); } catch (err) {}
                }
            }
            else if (e.data.acao === 'TEATRO_IDLE' || e.data.acao === 'TEATRO_ACTIVE') {
                const ocioso = e.data.acao === 'TEATRO_IDLE';
                document.body.classList.toggle('au-idle', ocioso);
                redimensionarPlayerExpandido(ocioso);
                if (!ocioso) resetarInatividade(false);
                if (window === window.top || e.data.cascata) {
                    document.querySelectorAll('iframe').forEach(frame => {
                        try { frame.contentWindow.postMessage({ app: 'ANIME_UNIVERSAL', acao: e.data.acao, cascata: true }, '*'); } catch (err) {}
                    });
                } else if (window !== window.top) {
                    try { window.parent.postMessage({ app: 'ANIME_UNIVERSAL', acao: e.data.acao }, '*'); } catch (err) {}
                }
            }
            else if (e.data.acao === 'SYNC_VARS') {
                aplicarVarsSincronizadas(e.data.vars);
                if (window === window.top || e.data.cascata) {
                    propagarSincronizacaoParaIframes(e.data.vars);
                }
            }
            else if (e.data.acao === 'ABRIR_INFO') {
                if (ehJanelaPrincipal) abrirModalInfo();
            }
            else if (e.data.acao === 'CACHE_OFFLINE') {
                if (ehJanelaPrincipal) confirmarEIniciarCacheOffline();
            }
            else if (e.data.acao === 'EXPANDIR_NATIVO_PEDIDO') {
                const agora = Date.now();
                let usado = agora - ultimoCliqueExpandirNativo < 800;
                if (!usado) {
                    let iframeRemetente = null;
                    try {
                        document.querySelectorAll('iframe').forEach(i => {
                            if (i.contentWindow === e.source) iframeRemetente = i;
                        });
                    } catch (err) {}
                    usado = clicarExpandirNativo(document, iframeRemetente);
                    if (usado) ultimoCliqueExpandirNativo = agora;
                }
                try { e.source.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'EXPANDIR_NATIVO_RESULTADO', id: e.data.id, usado }, '*'); } catch (err) {}
            }
            else if (e.data.acao === 'EXPANDIR_NATIVO_RESULTADO') {
                const pedido = pedidosExpandirNativo.get(e.data.id);
                if (pedido) {
                    clearTimeout(pedido.timer);
                    pedidosExpandirNativo.delete(e.data.id);
                    if (!e.data.usado) pedido.fallback();
                }
            }
            else if (e.data.acao === 'PULAR_VIDEO') {
                const tipo = e.data.tipo;
                if (tipo === 'intro' || tipo === 'vinheta') {
                    if (!pularVideoAtivo(tipo) && (e.data.cascata || window === window.top)) {
                        document.querySelectorAll('iframe').forEach(i => {
                            try { i.contentWindow.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'PULAR_VIDEO', tipo, cascata: true }, '*'); } catch (err) {}
                        });
                    }
                }
            }
            else if (e.data.acao === 'INFO_STATUS') {
                document.querySelectorAll('[data-au-acao="info"]').forEach(btn => btn.classList.toggle('au-oculto', !e.data.disponivel));
                if (e.data.cascata) propagarInfoStatusParaIframes(e.data.disponivel);
            }
        }
    });

    function formatarTempoEmMinutosSegundos(s) {
        if (!s || isNaN(s)) return "00:00";
        let min = Math.floor(s / 60).toString().padStart(2, '0');
        let sec = Math.floor(s % 60).toString().padStart(2, '0');
        return `${min}:${sec}`;
    }

    // ==========================================
    // 5.7 MODAL "ℹ️ INFO" — metadados textuais do anime (sem imagens)
    // ==========================================
    function origemNaMesmaArvoreDeFrames(e) {
        try {
            const s = e.source;
            if (!s) return false;
            if (s === window) return true;
            return s.top === window.top;
        } catch (err) { return false; }
    }

    function definirHtmlSanitizado(el, html) {
        if (!el) return;
        try {
            const doc = new DOMParser().parseFromString('<body>' + String(html || '').slice(0, 4000) + '</body>', 'text/html');
            const PERMITIDAS = new Set(['DIV', 'SPAN', 'B', 'BR']);
            const ESTILO_OK = /^\s*(color|margin-top|margin-bottom|padding-bottom|border-bottom)\s*:/i;
            const ESTILO_RUIM = /url\s*\(|expression|javascript|@import/i;
            const limpar = (no) => {
                Array.from(no.childNodes).forEach(filho => {
                    if (filho.nodeType === 3) return;
                    if (filho.nodeType !== 1 || !PERMITIDAS.has(filho.tagName)) { filho.remove(); return; }
                    Array.from(filho.attributes).forEach(a => {
                        if (a.name === 'style') {
                            filho.setAttribute('style', a.value.split(';').filter(r => ESTILO_OK.test(r) && !ESTILO_RUIM.test(r)).join(';'));
                        } else {
                            filho.removeAttribute(a.name);
                        }
                    });
                    limpar(filho);
                });
            };
            limpar(doc.body);
            el.textContent = '';
            Array.from(doc.body.childNodes).forEach(n => el.appendChild(document.importNode(n, true)));
        } catch (err) {
            el.textContent = String(html || '').replace(/<[^>]*>/g, '').slice(0, 500);
        }
    }

    function escapeHtmlSimples(txt) {
        const div = document.createElement('div');
        div.textContent = txt == null ? '' : String(txt);
        return div.innerHTML;
    }

    function limparHtmlDaSinopse(txt) {
        if (!txt) return '';
        return txt
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?(i|b|em|strong|p)>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function buscarMetadadosViaAniList(malId) {
        const query = `query ($malId: Int) {
            Media(idMal: $malId, type: ANIME) {
                description(asHtml: false)
                averageScore
                genres
            }
        }`;
        const corpo = JSON.stringify({ query, variables: { malId: malId } });
        return new Promise((resolve, reject) => {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://graphql.anilist.co',
                    timeout: 15000,
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    data: corpo,
                    onload: (res) => {
                        try {
                            if (!res || res.status < 200 || res.status >= 300) { reject(new Error('HTTP ' + (res && res.status))); return; }
                            const json = JSON.parse(res.responseText);
                            const media = json && json.data && json.data.Media;
                            if (!media) { reject(new Error('AniList: metadados não encontrados')); return; }
                            resolve({
                                description: limparHtmlDaSinopse(media.description || ''),
                                averageScore: Number.isFinite(media.averageScore) ? media.averageScore : null,
                                genres: Array.isArray(media.genres) ? media.genres : []
                            });
                        } catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('Erro de rede (AniList metadados)')),
                    ontimeout: () => reject(new Error('Timeout (AniList metadados)')),
                    onabort: () => reject(new Error('Abortado (AniList metadados)'))
                });
            } catch (e) { reject(e); }
        });
    }

    async function garantirMetadadosDoAnime(malId) {
        if (!malId || !ehJanelaPrincipal) return;
        if (metadadosAnimeAtual && metadadosAnimeAtual.malId === malId) return;

        const chaveMeta = 'aniskip_meta_' + malId;
        const emCache = GM_getValue(chaveMeta, null);
        if (emCache) {
            metadadosAnimeAtual = Object.assign({ malId }, emCache);
            atualizarVisibilidadeBotaoInfo();
            return;
        }

        try {
            const meta = await buscarMetadadosViaAniList(malId);
            GM_setValue(chaveMeta, meta);
            metadadosAnimeAtual = Object.assign({ malId }, meta);
            atualizarVisibilidadeBotaoInfo();
        } catch (e) {
        }
    }

    function atualizarVisibilidadeBotaoInfo() {
        if (!ehJanelaPrincipal) return;
        const disponivel = !!metadadosAnimeAtual;
        document.querySelectorAll('[data-au-acao="info"]').forEach(btn => btn.classList.toggle('au-oculto', !disponivel));
        propagarInfoStatusParaIframes(disponivel);
    }

    function abrirModalInfo() {
        if (!metadadosAnimeAtual) return;
        const overlay = document.getElementById('au-info-overlay');
        if (!overlay) return;

        const tituloEl = document.getElementById('au-info-titulo');
        if (tituloEl) tituloEl.textContent = nomeAnimeAtualParaExibicao || 'Anime';

        const notaEl = document.getElementById('au-info-nota');
        if (notaEl) {
            const nota = metadadosAnimeAtual.averageScore;
            notaEl.innerHTML = Number.isFinite(nota) && nota > 0
                ? `⭐ ${(nota / 10).toFixed(1)}`
                : '';
            notaEl.style.display = (Number.isFinite(nota) && nota > 0) ? '' : 'none';
        }

        const generosEl = document.getElementById('au-info-generos');
        if (generosEl) {
            const generos = metadadosAnimeAtual.genres || [];
            generosEl.innerHTML = generos.map(g => `<span class="au-pill">${escapeHtmlSimples(g)}</span>`).join('');
        }

        const sinopseEl = document.getElementById('au-info-sinopse');
        if (sinopseEl) sinopseEl.textContent = metadadosAnimeAtual.description || 'Sinopse não disponível.';

        document.body.appendChild(overlay);
        overlay.classList.add('au-info-aberto');
    }

    function fecharModalInfo() {
        const overlay = document.getElementById('au-info-overlay');
        if (overlay) overlay.classList.remove('au-info-aberto');
    }

    function atualizarPainelDeStatusNaJanela(atual, total) {
        if (jaAvancou) return;
        const estados = Array.from(document.querySelectorAll('.au-status-label'));
        const tempos = Array.from(document.querySelectorAll('.au-status-time'));
        if (uiStatus && !estados.includes(uiStatus)) estados.push(uiStatus);
        if (uiTempo && !tempos.includes(uiTempo)) tempos.push(uiTempo);
        estados.forEach(el => { if (!el.innerHTML.includes('🔇')) el.textContent = '● Player conectado'; });
        const textoTempo = `${formatarTempoEmMinutosSegundos(atual)} / ${formatarTempoEmMinutosSegundos(total)} · faltam ${formatarTempoEmMinutosSegundos(Math.max(0, total - atual))}`;
        tempos.forEach(el => { el.textContent = textoTempo; });
    }

    function exibirMensagemBreveNoPainel(mensagem, desfazer = null) {
        try {
            document.querySelectorAll('.au-status-message').forEach(el => { el.style.display = 'inline'; el.textContent = mensagem; });
            if (uiAP) { uiAP.style.display = 'inline'; uiAP.textContent = mensagem; }
            const notificarPulo = /Abertura pulada|Encerramento pulado|Encerramento detetado! Saltando de epis/i.test(mensagem);
            if (notificarPulo) mostrarAvisoDePulo(mensagem, desfazer);
            if (!ehJanelaPrincipal) window.top.postMessage({ app: 'ANIME_V44', acao: 'AP', txt: mensagem, toast: false }, '*');
        } catch (e) {}
    }

    let temporizadorAvisoPulo = null;
    function agendarOcultarAvisoDePulo(toast, duracao) {
        clearTimeout(temporizadorAvisoPulo);
        temporizadorAvisoPulo = setTimeout(() => {
            if (toast.contains(document.activeElement)) return;
            toast.classList.remove('au-visible');
        }, duracao);
    }

    function mostrarAvisoDePulo(mensagem, desfazer = null) {
        try {
            let toast = document.getElementById('au-skip-toast');
            if (!toast) {
                injetarCSSNoDocumento(document);
                toast = document.createElement('div');
                toast.id = 'au-skip-toast';
                toast.setAttribute('role', 'status');
                toast.setAttribute('aria-live', 'polite');
                toast.innerHTML = '<span class="au-skip-toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m4 5 7 7-7 7M13 5l7 7-7 7"/></svg></span><span class="au-skip-toast-text"></span><button class="au-skip-toast-undo" type="button" hidden>Desfazer (Ctrl+Z)</button><span class="au-skip-toast-progress" aria-hidden="true"></span>';
                (document.body || document.documentElement).appendChild(toast);
            }
            const texto = toast.querySelector('.au-skip-toast-text');
            const botaoDesfazer = toast.querySelector('.au-skip-toast-undo');
            if (!texto) return;
            toast.onfocusin = () => clearTimeout(temporizadorAvisoPulo);
            toast.onfocusout = e => {
                if (toast.contains(e.relatedTarget)) return;
                if (toast.classList.contains('au-visible')) agendarOcultarAvisoDePulo(toast, 1600);
            };
            let rotulo = String(mensagem || '');
            if (/Encerramento detetado! Saltando de epis/i.test(rotulo)) rotulo = 'Encerramento pulado · próximo episódio';
            else if (/Memória Inteligente/i.test(rotulo)) rotulo = 'Abertura pulada';
            else if (/Encerramento/i.test(rotulo)) rotulo = 'Encerramento pulado';
            else rotulo = 'Abertura pulada';
            texto.textContent = rotulo;
            toast.__auDesfazer = desfazer;
            if (botaoDesfazer) {
                const atalhoDesfazer = lerAtalhosPersonalizados().undo;
                botaoDesfazer.textContent = `Desfazer (${atalhoDesfazer})`;
                const focoEstavaNoDesfazer = document.activeElement === botaoDesfazer;
                botaoDesfazer.hidden = !desfazer;
                botaoDesfazer.disabled = false;
                botaoDesfazer.setAttribute('aria-label', desfazer ? `Desfazer último pulo (${atalhoDesfazer})` : 'Desfazer indisponível');
                if (!desfazer && focoEstavaNoDesfazer) {
                    try { fabTeatro.focus({ preventScroll: true }); } catch (e) { fabTeatro.focus(); }
                }
                botaoDesfazer.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const estado = toast.__auDesfazer;
                    if (!estado || !estado.video || !estado.video.isConnected) return;
                    const video = estado.video;
                    const tempoAtual = obterTempoAtualDoVideo(video);
                    if (video.seeking || !Number.isFinite(tempoAtual) || Math.abs(tempoAtual - estado.posicaoPulada) > 7) {
                        const devolverFoco = document.activeElement === botaoDesfazer;
                        toast.__auDesfazer = null;
                        botaoDesfazer.hidden = true;
                        toast.classList.remove('au-has-undo');
                        texto.textContent = 'Não foi possível desfazer este pulo';
                        if (devolverFoco) {
                            try { fabTeatro.focus({ preventScroll: true }); } catch (erro) { fabTeatro.focus(); }
                        }
                        agendarOcultarAvisoDePulo(toast, 1800);
                        return;
                    }

                    botaoDesfazer.disabled = true;
                    const tempoAnterior = estado.posicaoAnterior;
                    let timerDesfazer = null;
                    let finalizado = false;
                    const concluirDesfazer = confirmar => {
                        if (finalizado) return;
                        finalizado = true;
                        clearTimeout(timerDesfazer);
                        video.removeEventListener('seeked', aoDesfazerBuscar);
                        const voltou = confirmar && video.isConnected && !video.seeking &&
                            Math.abs(obterTempoAtualDoVideo(video) - tempoAnterior) <= 1.5;
                        if (voltou) {
                            const devolverFoco = document.activeElement === botaoDesfazer;
                            toast.__auDesfazer = null;
                            botaoDesfazer.hidden = true;
                            toast.classList.remove('au-has-undo');
                            texto.textContent = 'Pulo desfeito';
                            if (devolverFoco) {
                                try { fabTeatro.focus({ preventScroll: true }); } catch (erro) { fabTeatro.focus(); }
                            }
                            toast.style.setProperty('--au-skip-toast-duration', '1.6s');
                            clearTimeout(temporizadorAvisoPulo);
                            toast.classList.remove('au-visible');
                            void toast.offsetWidth;
                            toast.classList.add('au-visible');
                            agendarOcultarAvisoDePulo(toast, 1600);
                        } else {
                            botaoDesfazer.disabled = false;
                        }
                    };
                    const aoDesfazerBuscar = () => concluirDesfazer(true);
                    video.addEventListener('seeked', aoDesfazerBuscar);
                    try {
                        if (!buscarVideoPara(video, tempoAnterior)) throw new Error('Não foi possível restaurar o tempo anterior');
                    }
                    catch (erro) {
                        video.removeEventListener('seeked', aoDesfazerBuscar);
                        botaoDesfazer.disabled = false;
                        finalizado = true;
                        return;
                    }
                    timerDesfazer = setTimeout(() => concluirDesfazer(true), 2500);
                };
            }
            toast.classList.toggle('au-has-undo', !!desfazer);
            toast.style.setProperty('--au-skip-toast-duration', desfazer ? '5s' : '2.8s');
            toast.classList.remove('au-visible');
            void toast.offsetWidth;
            toast.classList.add('au-visible');
            agendarOcultarAvisoDePulo(toast, desfazer ? 5000 : 2800);
        } catch (e) {}
    }

    function lidarComCtrlZDesfazerPulo(e) {
        if (!e || !eventoAcionaAtalho(e, lerAtalhosPersonalizados().undo)) return;
        const alvo = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
        const ativo = document.activeElement;
        const campoEditavel = elemento => {
            try {
                return !!(elemento && (
                    elemento.isContentEditable ||
                    (elemento.closest && elemento.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]'))
                ));
            } catch (erro) { return false; }
        };
        if (campoEditavel(alvo) || campoEditavel(ativo)) return;

        const toast = document.getElementById('au-skip-toast');
        if (!toast || !toast.classList.contains('au-visible')) return;
        const botao = toast.querySelector('.au-skip-toast-undo');
        if (!botao || botao.hidden || botao.disabled || !toast.__auDesfazer) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        botao.click();
    }

    // ==========================================
    // 3. CORRETOR ORTOGRÁFICO E AUTO-NEXT
    // ==========================================
    function normalizarTextoParaComparacao(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }

    function siteUsaAutoNextNativo() {
        let host = hostAtual;
        if (!ehJanelaPrincipal) {
            try {
                host = hostnameDoSitePrincipalPorAncestorOrigins(window.location.ancestorOrigins) || host;
            } catch (e) {}
        }
        return hostCorrespondeADominio(host, 'anroll.io') ||
            hostCorrespondeADominio(host, 'animesonline.io');
    }

    function avancarParaProximoEpisodio(manual = false) {
        if (jaAvancou || (!autoNext && !manual)) return;
        if (!manual && siteUsaAutoNextNativo()) return;
        jaAvancou = true;

        if (ehJanelaPrincipal) {
            if (uiStatus) uiStatus.innerHTML = '<span style="color:#0f0;">⏭️ A saltar de episódio!</span>';
            document.body.style.border = "8px solid #0f0";
            bordaAplicada = true;

            const candidatos = Array.from(document.querySelectorAll('a, button'));

            const btnProximo = candidatos.find(el => {
                let texto = normalizarTextoParaComparacao(el.textContent || '');
                let aria = normalizarTextoParaComparacao(el.getAttribute('aria-label') || '');
                let titulo = normalizarTextoParaComparacao(el.getAttribute('title') || '');
                let classe = (el.className || '').toLowerCase();
                let rel = (el.getAttribute('rel') || '').toLowerCase();
                let idAttr = (el.id || '').toLowerCase();
                let href = el.getAttribute('href') || '';

                let classePai = (el.parentElement && el.parentElement.className && typeof el.parentElement.className === 'string') ? el.parentElement.className.toLowerCase() : '';

                let pareceAnterior = texto.includes('anterior') || texto.includes('voltar') || texto.includes('prev') ||
                                      aria.includes('anterior') || aria.includes('voltar') || aria.includes('prev') ||
                                      classe.includes('anterior') || classe.includes('prev') || rel === 'prev' || classePai.includes('prev');

                if (pareceAnterior) return false;

                let semDestinoReal = !href || /^(#|javascript:)/i.test(href) || el.href === window.location.href;

                let pareceProximo = idAttr === 'btn-proximo' || rel === 'next' ||
                       texto.includes('proximo') || texto.includes('next') || texto.includes('seguinte') ||
                       aria.includes('proximo') || aria.includes('next') ||
                       titulo.includes('proximo') || titulo.includes('next') ||
                       classe.includes('next') || classe.includes('proximo') || classePai.includes('next') || classePai.includes('proximo');

                if (semDestinoReal && !pareceProximo) return false;

                return pareceProximo;
            });

            if (btnProximo) {
                let disabled = btnProximo.hasAttribute('disabled') || (btnProximo.className || '').toLowerCase().includes('disabled') || ((btnProximo.parentElement && btnProximo.parentElement.className) || '').toLowerCase().includes('disabled');

                if (disabled) {
                    if (uiStatus) uiStatus.innerHTML = '<span style="color:#f00;">❌ Fim da temporada (Botão desativado).</span>';
                    document.body.style.border = "8px solid #f00";
                    return;
                }

                let href = btnProximo.getAttribute('href');
                if (btnProximo.tagName === 'A' && href && !/^(#|javascript:)/i.test(href)) {
                    window.location.href = btnProximo.href;
                } else {
                    btnProximo.click();
                }
            } else {
                if (uiStatus) uiStatus.innerHTML = '<span style="color:#f00;">❌ Botão Próximo não encontrado.</span>';
                document.body.style.border = "8px solid #f00";
                jaAvancou = false;
            }
        } else {
            window.top.postMessage({ app: 'ANIME_V44', acao: 'PULAR', manual: !!manual }, '*');
        }
    }

    function tentarClicarProximoServidor() {
        if (fallbackTentativas >= 4 || jaAvancou) return;
        fallbackTentativas++;
        watchdogTempo = 0;

        const raizAnimeq = document.querySelector('[id^="animeq-player-"]');
        const seletoresServidor = '.animeq-player__server, .dropdown-source, [data-player-name], [data-source-name], .server-item, .player-tab, [role="tab"], [aria-controls]';
        let botoes = Array.from((raizAnimeq || document).querySelectorAll(seletoresServidor));
        let servidores = botoes.filter(btn => {
            let ehLinkReal = btn.tagName === 'A' && btn.getAttribute('href') && !/^(#|javascript:)/i.test(btn.getAttribute('href')) && btn.href !== window.location.href;
            return !ehLinkReal && btn.offsetParent !== null;
        });

        if (servidores.length <= 1) return;

        if (indiceServidorFallback === -1) {
            let idx = servidores.findIndex(btn => btn.classList.contains('active') || btn.classList.contains('is-active') || btn.classList.contains('selected') || btn.getAttribute('aria-selected') === 'true' || btn.getAttribute('aria-pressed') === 'true');
            indiceServidorFallback = idx !== -1 ? idx : 0;
        }

        indiceServidorFallback++;
        if (indiceServidorFallback >= servidores.length) {
            indiceServidorFallback = 0;
        }

        try { servidores[indiceServidorFallback].click(); } catch (e) {}
    }

    function verificarSeEpisodioEstaTerminando(atual, total) {
        if (total - atual > tempoPulo + 2) armado = true;
        if (armado && total - atual <= tempoPulo) avancarParaProximoEpisodio();
    }

    // ==========================================
    // 3.5 RECUSAR "CONTINUAR DE ONDE PAROU"
    // ==========================================
    function obterRaizesDoPlayerParaRetomada(doc) {
        const seletoresPorHost = [
            { dominio: 'anroll.io', seletores: ['#ep-player-box', '.ep-player-box'] },
            { dominio: 'animesonline.io', seletores: ['#pembed', '.player-embed'] },
            { dominio: 'anidrive.click', seletores: ['#video_player', '.jwplayer'] }
        ];
        const raizes = [];
        let host = '';
        try { host = doc.location.hostname; } catch (e) {}

        for (const config of seletoresPorHost) {
            if (!hostCorrespondeADominio(host, config.dominio)) continue;
            for (const seletor of config.seletores) {
                try { doc.querySelectorAll(seletor).forEach(el => raizes.push(el)); } catch (e) {}
            }
        }

        // Players de outros sites usam estruturas variadas; inclui diálogos e overlays comuns.
        try {
            doc.querySelectorAll('[role="dialog"], [aria-modal="true"], .jw-modal, .jw-overlay, .vjs-modal-dialog, .plyr__control, [class*="resume"], [id*="resume"], [class*="continue"], [id*="continue"], [class*="modal"], [id*="modal"], [class*="dialog"], [id*="dialog"]').forEach(el => raizes.push(el));
        } catch (e) {}
        if (doc.body) raizes.push(doc.body);
        return Array.from(new Set(raizes));
    }

    function elementoVisivelParaRetomada(el) {
        try {
            if (!el.isConnected || el.getClientRects().length === 0) return false;
            const estilo = el.ownerDocument.defaultView.getComputedStyle(el);
            return estilo.display !== 'none' && estilo.visibility !== 'hidden' && Number(estilo.opacity) !== 0;
        } catch (e) { return false; }
    }

    function textoDoControleDeRetomada(el) {
        const partes = [el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('value'),
            el.getAttribute('data-action'), el.getAttribute('data-testid')];
        try { partes.push(el.id); } catch (e) {}
        return partes.filter(Boolean).map(texto => normalizarTextoParaComparacao(String(texto).trim()).replace(/^[^a-z0-9]+/i, '')).filter(Boolean);
    }

    function acaoDoControleIndicaRecusa(el) {
        const partes = [el.getAttribute('data-action'), el.getAttribute('data-testid'), el.id];
        try { if (typeof el.className === 'string') partes.push(el.className); } catch (e) {}
        return partes.filter(Boolean).some(texto => /(?:^|[^a-z0-9])(?:no|decline|dismiss|cancel|restart|start[-_]over)(?:$|[^a-z0-9])/i.test(texto));
    }

    function contextoIndicaRetomada(el, raiz) {
        const regexRetomada = /continuar.{0,80}(?:onde parou|assistindo|ultima posicao|ultimo ponto)|(?:onde parou|ultima posicao|ultimo ponto).{0,80}continuar|retomar(?:.{0,60}(?:video|reproducao|assistindo|de onde))?|\bresume\b.{0,80}(?:playback|watching|from|position)?|continue.{0,80}(?:watching|from|playback|where)|where you left off|last (?:watched|playback) position/i;
        let atual = el;
        for (let nivel = 0; atual && nivel < 12; nivel++, atual = atual.parentElement) {
            let texto = '';
            try { texto = atual.innerText || atual.textContent || ''; } catch (e) {}
            if (texto.length > 1800) break;
            if (regexRetomada.test(normalizarTextoParaComparacao(texto))) return true;
            if (atual === raiz || atual === el.ownerDocument.body) break;
        }
        return false;
    }

    function forcarVideoParaComecarDoZero(doc) {
        if (!recusarRetomar) return;
        try {
            let v = videoAtivo && videoAtivo.ownerDocument === doc ? videoAtivo : null;
            if (!v) v = doc.querySelector('#video_player video, .jwplayer video, video');
            if (!v) return;

            const zerar = () => {
                try {
                    if (v.isConnected && v.readyState >= 1 && obterTempoAtualDoVideo(v) > 1) buscarVideoPara(v, 0);
                } catch (e) {}
            };
            if (v.readyState < 1) v.addEventListener('loadedmetadata', zerar, { once: true });
            setTimeout(zerar, 200);
        } catch (e) {}
    }

    function clicarBotaoDeRecusaEZerarVideo(el) {
        try { el.click(); } catch (e) {}
        forcarVideoParaComecarDoZero(el.ownerDocument);
    }

    function buscarERecusarPopupDeContinuarAssistindo(docs = [document]) {
        if (!recusarRetomar) return;
        // O Anidrive usa <bt id="btn_resume_no">, um elemento personalizado que
        // não corresponde a button. Incluí-lo evita que o contador escolha "Sim".
        const seletoresControles = '#btn_resume_no, bt, button, a, [role="button"], [onclick], [aria-label], [title], input[type="button"], input[type="submit"], .jw-button-color, .plyr__control, .vjs-control, div, span';
        const regexRecusa = /^(?:nao\b|no\b|cancel(?:ar)?\b|fechar\b|recomec(?:ar|e)\b|restart\b|start over\b|do (?:zero|inicio|comeco)\b|comecar do (?:zero|inicio|comeco)\b|begin from start\b|start from beginning\b)/i;
        for (const doc of docs) {
            try {
                // No Anidrive usado pelo AnimesOnline, o texto ao redor do diálogo
                // pode variar. O ID do botão é específico e já identifica a recusa.
                let host = '';
                try { host = doc.location.hostname; } catch (e) {}
                if (hostCorrespondeADominio(host, 'anidrive.click')) {
                    const botaoRecusar = doc.querySelector('#btn_resume_no');
                    if (botaoRecusar && !botoesDeRecusaDeRetomadaProcessados.has(botaoRecusar) &&
                        elementoVisivelParaRetomada(botaoRecusar) && !botaoRecusar.disabled &&
                        botaoRecusar.getAttribute('aria-disabled') !== 'true') {
                        botoesDeRecusaDeRetomadaProcessados.add(botaoRecusar);
                        clicarBotaoDeRecusaEZerarVideo(botaoRecusar);
                        exibirMensagemBreveNoPainel('🙅 Retomada recusada; começando do início.');
                        return;
                    }
                }

                const controlesVisitados = new WeakSet();
                for (const raiz of obterRaizesDoPlayerParaRetomada(doc)) {
                    const elementos = raiz.matches && raiz.matches(seletoresControles)
                        ? [raiz, ...raiz.querySelectorAll(seletoresControles)]
                        : raiz.querySelectorAll(seletoresControles);
                    for (const el of elementos) {
                        if (controlesVisitados.has(el)) continue;
                        controlesVisitados.add(el);
                        if (botoesDeRecusaDeRetomadaProcessados.has(el) || !elementoVisivelParaRetomada(el)) continue;
                        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

                        const rotulos = textoDoControleDeRetomada(el);
                        if (!rotulos.some(txt => txt.length <= 90 && regexRecusa.test(txt)) && !acaoDoControleIndicaRecusa(el)) continue;
                        if (!contextoIndicaRetomada(el, raiz)) continue;

                        botoesDeRecusaDeRetomadaProcessados.add(el);
                        clicarBotaoDeRecusaEZerarVideo(el);
                        exibirMensagemBreveNoPainel('🙅 Retomada recusada; começando do início.');
                        return;
                    }
                }
            } catch (e) {}
        }
    }

    // ==========================================
    // 4. AUTOMAÇÃO DE CLIQUE E QUALIDADE
    // ==========================================
    function aplicarComandoDeDesbloqueio(v) {
        if (!v) return;
        try {
            const r = v.getBoundingClientRect();
            const visivel = r.width > 0 && r.height > 0;
            if (!visivel) return;
            v.muted = false;
            if (v.paused) v.play().catch(() => {});
        } catch (e) {}
    }

    function lidarComCliqueDoUsuarioNaPagina(e) {
        precisaMudo = false;
        if (autoFullscreen && !autoTeatro && videoAtivo && !fullscreenTentado) {
            ativarTelaCheiaNoVideo(videoAtivo);
        }
        if (autoPlay) {
            let doc = (e && e.target && e.target.ownerDocument) || document;
            let v = doc.querySelector('video');
            aplicarComandoDeDesbloqueio(v);
            if (videoAtivo && videoAtivo !== v && videoAtivo.muted) {
                try { videoAtivo.muted = false; } catch (err) {}
            }
            try {
                coletarTodosOsDocumentosIncluindoIframes(document, [], 0).forEach(d => { try { d.dispatchEvent(new Event('au-unmute')); } catch (er) {} });
            } catch (er) {}
            if (ehJanelaPrincipal) {
                if (uiStatus && uiStatus.innerHTML.includes('🔇')) {
                    uiStatus.innerHTML = '<span style="color:#0f0;">✅ Vídeo Conectado!</span>';
                }
                let iframes = document.querySelectorAll('iframe');
                for (let i of iframes) {
                    try { i.contentWindow.postMessage({ app: 'ANIME_V44', acao: 'OMNI_CLICK' }, '*'); } catch(err){}
                }
            }
        }
    }
    window.addEventListener('click', lidarComCliqueDoUsuarioNaPagina, true);

    window.addEventListener('message', (e) => {
        if (!origemNaMesmaArvoreDeFrames(e)) return;
        if (e.data && e.data.app === 'ANIME_V44' && e.data.acao === 'OMNI_CLICK' && autoPlay) {
            precisaMudo = false;
            let v = document.querySelector('video');
            aplicarComandoDeDesbloqueio(v);
        }
    });

    // ---------- Auto-clicker de players ----------
    const SELETORES_AUTOCLICK_INICIAR = '.embed-play .play-btn, .vjs-big-play-button, .vjs-poster, .plyr__control--overlaid, .play-button';
    const SELETORES_AUTOCLICK_ALTERNAR = '.vjs-play-control, .jw-display-icon-display';
    const SELETOR_CONTAINER_DE_PLAYER = '.video-js, .jwplayer, .plyr';
    const AUTOCLICK_MAX_TENTATIVAS_POR_CONTROLE = 3;
    const AUTOCLICK_INTERVALO_MIN_MS = 2000;
    const AUTOCLICK_MAX_POR_EPOCA = 8;
    const AUTOCLICK_FALHAS_PLAY_PARA_CLIQUE = 3;
    const AUTOCLICK_PAUSA_APOS_CLIQUE_MS = 1500;
    const registroAutoClick = new WeakMap();
    let cliquesAutoNaEpoca = { epoca: -1, n: 0 };

    function documentoTemVideoVisivelTocando(doc) {
        try {
            return Array.from(doc.querySelectorAll('video')).some(v => {
                if (v.paused || v.ended) return false;
                const r = v.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
        } catch (e) { return false; }
    }

    function jwGeridoPeloAuxiliar(container) {
        try {
            return !!(container && container.matches && container.matches('.jwplayer') &&
                container.ownerDocument.documentElement.getAttribute('data-au-jw') === '1');
        } catch (e) { return false; }
    }

    function clicarControleDeInicioUmaVez(btn, chave) {
        const agora = Date.now();
        if (cliquesAutoNaEpoca.epoca !== epoca) cliquesAutoNaEpoca = { epoca, n: 0 };
        if (cliquesAutoNaEpoca.n >= AUTOCLICK_MAX_POR_EPOCA) return false;

        let reg = registroAutoClick.get(chave);
        if (!reg || reg.epoca !== epoca) { reg = { epoca, n: 0, ultimo: 0 }; registroAutoClick.set(chave, reg); }
        if (reg.n >= AUTOCLICK_MAX_TENTATIVAS_POR_CONTROLE) return false;
        if (agora - reg.ultimo < AUTOCLICK_INTERVALO_MIN_MS) return false;

        reg.n++;
        reg.ultimo = agora;
        cliquesAutoNaEpoca.n++;

        const ehVjs = typeof btn.className === 'string' && btn.className.includes('vjs');
        if (reg.n >= 2 && ehVjs) {
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
                try { btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
            });
        } else {
            try { btn.click(); } catch (e) {}
        }
        return true;
    }

    function executarAutoClickerDePlayers() {
        const candidatos = document.querySelectorAll(SELETORES_AUTOCLICK_INICIAR + ', ' + SELETORES_AUTOCLICK_ALTERNAR);
        if (!candidatos.length) return;
        let docTemVideoTocando = null;

        candidatos.forEach(btn => {
            try {
                if (btn.offsetParent === null) return;
                const pai = btn.closest('a[href]');
                const ehLinkReal = pai && /^https?:|^\//.test(pai.getAttribute('href') || '') && pai.href !== window.location.href;
                if (ehLinkReal) return;

                const ehAlternar = btn.matches(SELETORES_AUTOCLICK_ALTERNAR);
                const container = btn.closest(SELETOR_CONTAINER_DE_PLAYER);
                const video = container ? container.querySelector('video') : null;

                if (video) {
                    if (video.ended || !video.paused) return;
                    if (!videoEhElegivelParaAutoplay(video)) return;
                    const st = obterOuCriarEstadoDoVideo(video);
                    if (st.estavel) return;
                    if (jwGeridoPeloAuxiliar(container)) return;

                    if (ehAlternar) {
                        tentarReproduzirVideoAutomaticamente(video);
                        return;
                    }

                    if (tentativaDePlayEmAndamento(st)) return;

                    const temFonte = videoPossuiFonteDeMidia(video);
                    if (temFonte && st.falhasPlay < AUTOCLICK_FALHAS_PLAY_PARA_CLIQUE) {
                        tentarReproduzirVideoAutomaticamente(video);
                        return;
                    }
                    if (clicarControleDeInicioUmaVez(btn, video)) {
                        st.pausaAteMs = Date.now() + AUTOCLICK_PAUSA_APOS_CLIQUE_MS;
                    }
                    return;
                }

                if (ehAlternar) return;
                if (docTemVideoTocando === null) docTemVideoTocando = documentoTemVideoVisivelTocando(document);
                if (docTemVideoTocando) return;
                clicarControleDeInicioUmaVez(btn, container || btn);
            } catch (e) {}
        });
    }

    {
        setInterval(() => {
            if (jaAvancou || !autoPlay) return;

            try { executarAutoClickerDePlayers(); } catch (e) {}

            if (autoFHD && ehJanelaPrincipal && !tentouMudarQualidade) {
                let botoesQualidade = Array.from(document.querySelectorAll('a, button, .aba, .Aba, .tab, .player-tab, .item, .animeq-player__server, .dropdown-source'));
                let btnFHD = botoesQualidade.find(btn => {
                    let txt = (btn.textContent || '').toUpperCase();
                    let name = (btn.getAttribute('data-player-name') || '').toUpperCase();
                    let source = (btn.getAttribute('data-source-name') || '').toUpperCase();
                    return txt.includes('FHD') || txt.includes('FULL HD') || txt.includes('FULLHD') || txt.includes('1080') || name.includes('FULLHD') || source.includes('FHD');
                });
                if (btnFHD) {
                    tentouMudarQualidade = true;
                    let classes = (btnFHD.className || '').toLowerCase();
                    let ehLinkDeVerdade = btnFHD.tagName === 'A' && btnFHD.getAttribute('href') &&
                        !/^(#|javascript:)/i.test(btnFHD.getAttribute('href')) &&
                        btnFHD.href !== window.location.href;
                    if (!ehLinkDeVerdade && !classes.includes('selected') && !classes.includes('active') && !classes.includes('ativo') && !classes.includes('selecionado')) {
                        btnFHD.click();
                    }
                }
            }

            try {
                document.querySelectorAll('video').forEach(v => {
                    try {
                        const r = v.getBoundingClientRect();
                        const ocultoTocando = !v.paused && (r.width === 0 || r.height === 0);
                        if (!ocultoTocando) {
                            contagemOcultoTocando.delete(v);
                            return;
                        }
                        const n = (contagemOcultoTocando.get(v) || 0) + 1;
                        contagemOcultoTocando.set(v, n);
                        if (n >= 2) {
                            v.pause();
                            v.muted = true;
                        }
                    } catch (e) {}
                });
            } catch (e) {}

            let lixo = document.querySelectorAll('.ppVepb');
            for (let el of lixo) { try { el.remove(); } catch(e) {} }

            try {
                if (typeof window.jwplayer === 'function' && document.documentElement.getAttribute('data-au-jw') !== '1') {
                    let p = window.jwplayer();
                    if (p && typeof p.getState === 'function' && p.getState() === 'idle') p.play();
                }
            } catch(e) {}

        }, 1000);
    }

    // ==========================================
    // 4.5 AUTO-FULLSCREEN E ATALHOS DE TECLADO
    // ==========================================
    function ativarTelaCheiaNoVideo(video) {
        if (!autoFullscreen || fullscreenTentado || !video) return;
        if (document.fullscreenElement) { fullscreenTentado = true; return; }
        fullscreenTentado = true;
        try {
            const adaptador = obterAdaptadorDeVideo(video);
            let p = adaptador ? adaptador.requestFullscreen() : video.requestFullscreen();
            if (p && p.catch) p.catch(() => { fullscreenTentado = false; });
        } catch (e) {
            fullscreenTentado = false;
        }
    }

    // ==========================================
    // 4.6 MODO TEATRO (100vw/100vh, sem Fullscreen nativo)
    // ==========================================
    function lidarComStackingContext(elementoBase, ligar) {
        try {
            let el = elementoBase;
            while (el) {
                try { el.ownerDocument.body.classList.toggle('au-teatro-ativo', !!ligar); } catch(e){}

                if (el !== el.ownerDocument.body && el !== el.ownerDocument.documentElement) {
                    el.classList.toggle('au-teatro-ancestor', !!ligar);
                }

                if (el.parentElement) {
                    el = el.parentElement;
                } else if (el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.frameElement) {
                    let iframe = el.ownerDocument.defaultView.frameElement;
                    iframe.classList.toggle('au-modo-teatro', !!ligar);
                    el = iframe;
                } else {
                    break;
                }
            }
        } catch (e) {}
    }

    function ativarModoTeatro(video) {
        if (!video) return;
        injetarCSSNoDocumento(video.ownerDocument);
        let wrapper = null;
        try {
            wrapper = video.closest('.jwplayer, .plyr, .video-content, .player-video, .playerContainer, #player, section.animeq-player, .animeq-player') || video.parentElement;
            if (wrapper === video.ownerDocument.body || wrapper === video.ownerDocument.documentElement) wrapper = video;
            wrapper.classList.add('au-modo-teatro');
        } catch (e) {}
        try {
            document.body.classList.toggle('au-teatro-ativo', true);
        } catch (e) {}
        teatroAtivoNoVideo = true;
        if (wrapper) lidarComStackingContext(wrapper, true);
        if (window !== window.top) {
            try { window.parent.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'TEATRO_ON' }, '*'); } catch (e) {}
        }
        resetarInatividade();
    }

    function desativarModoTeatro(video) {
        let wrapper = null;
        redimensionarPlayerExpandido(false);
        try {
            if (video) {
                wrapper = video.closest('.jwplayer, .plyr, .video-content, .player-video, .playerContainer, #player, section.animeq-player, .animeq-player') || video.parentElement;
                if (wrapper === video.ownerDocument.body || wrapper === video.ownerDocument.documentElement) wrapper = video;
            }
            if (wrapper) wrapper.classList.remove('au-modo-teatro');
        } catch (e) {}
        try {
            document.body.classList.toggle('au-teatro-ativo', false);
            document.body.classList.remove('au-menu-flutuante-aberto');
        } catch (e) {}
        teatroAtivoNoVideo = false;
        clearTimeout(timerInatividade);
        document.body.classList.remove('au-idle');
        if (wrapper) lidarComStackingContext(wrapper, false);
        if (window !== window.top) {
            try { window.parent.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'TEATRO_OFF' }, '*'); } catch (e) {}
        }
    }

    function textoDeControleExpandir(el) {
        const partes = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-tooltip'), el.innerText, el.textContent]
            .filter(Boolean).map(s => String(s).replace(/[\uE000-\uF8FF]/g, ' ').replace(/\s+/g, ' ').trim());
        return partes.join(' ').toLocaleLowerCase();
    }

    function clicarExpandirNativo(doc, iframePlayer) {
        if (!doc) return false;
        const raizes = [];
        if (iframePlayer) {
            let el = iframePlayer.parentElement;
            for (let i = 0; el && i < 7; i++, el = el.parentElement) raizes.push(el);
        }
        ['#ep-player-box', '.ep-player-box', '#player', '.animeq-player', '.player-container', '.player-video', '.video-player']
            .forEach(sel => { try { doc.querySelectorAll(sel).forEach(el => raizes.push(el)); } catch (e) {} });
        if (!raizes.length) raizes.push(doc.body);

        const seletor = 'button, a, [role="button"], [onclick], [tabindex], .expand, .expandir, .fullscreen, .theater, span, div';
        const regex = /(?:^|\b)(expandir|expand|tela cheia|fullscreen|theater|theatre|recolher|reduzir|restaurar)(?:\b|$)/i;
        const visitadas = new Set();
        for (const raiz of raizes) {
            if (!raiz || visitadas.has(raiz)) continue;
            visitadas.add(raiz);
            let elementos = [];
            try { elementos = Array.from(raiz.querySelectorAll(seletor)); } catch (e) {}
            const alvos = elementos.map(el => {
                if (el.closest && el.closest('[id^="au-"]')) return null;
                const label = textoDeControleExpandir(el);
                if (!label || label.length > 100 || !regex.test(label)) return null;
                const semantico = /^(BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'button' || el.hasAttribute('onclick') || /expand|fullscreen|theater/i.test(String(el.className || ''));
                const textoVisivel = String(el.innerText || el.textContent || '').replace(/[\uE000-\uF8FF]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
                const textoCurto = textoVisivel.length < 40;
                const textoExato = /^(expandir|expand|tela cheia|fullscreen|theater|theatre|recolher|reduzir|restaurar)$/i.test(textoVisivel);
                return { el, score: (semantico ? 4 : 0) + (textoCurto ? 2 : 0) + (textoExato ? 4 : 0) + 1 };
            }).filter(Boolean).sort((a, b) => b.score - a.score);
            if (alvos.length) {
                try { alvos[0].el.click(); return true; } catch (e) {}
            }
        }
        return false;
    }

    function alternarModoExpandirPeloScript(video) {
        if (!video) return;
        if (teatroAtivoNoVideo) desativarModoTeatro(video);
        else ativarModoTeatro(video);
    }

    function alternarModoTeatro() {
        if (!videoAtivo) return;
        alternarModoExpandirPeloScript(videoAtivo);
    }

    function definirModoTeatro(ligar) {
        const ativo = !!(teatroAtivoNoVideo || document.body.classList.contains('au-teatro-ativo'));
        if (videoAtivo) {
            if (ligar && !ativo) ativarModoTeatro(videoAtivo);
            else if (!ligar && ativo) desativarModoTeatro(videoAtivo);
            return;
        }
        if (window !== window.top) {
            try { window.parent.postMessage({ app: 'ANIME_V44', acao: 'SET_TEATRO', ligar: !!ligar }, '*'); } catch (e) {}
            return;
        }
        document.querySelectorAll('iframe').forEach(i => {
            try { i.contentWindow.postMessage({ app: 'ANIME_V44', acao: 'SET_TEATRO', ligar: !!ligar }, '*'); } catch (e) {}
        });
    }

    function pularVideoAtivo(tipo) {
        if (!videoAtivo || (tipo !== 'intro' && tipo !== 'vinheta')) return false;
        const segundos = tipo === 'intro' ? segundosPularIntro : segundosPularVinheta;
        const atual = obterTempoAtualDoVideo(videoAtivo);
        const duracao = obterDuracaoDoVideo(videoAtivo);
        return buscarVideoPara(videoAtivo, Math.min(atual + segundos, Number.isFinite(duracao) && duracao > 0 ? duracao : Infinity));
    }

    function acionarPuloManual(tipo) {
        if (pularVideoAtivo(tipo)) return;
        const comando = { app: 'ANIME_UNIVERSAL', acao: 'PULAR_VIDEO', tipo, cascata: true };
        if (window === window.top) {
            document.querySelectorAll('iframe').forEach(i => {
                try { i.contentWindow.postMessage(comando, '*'); } catch (e) {}
            });
        } else {
            try { window.top.postMessage({ app: comando.app, acao: comando.acao, tipo: comando.tipo, cascata: false }, '*'); } catch (e) {}
        }
    }

    function expandirVideoConformeHierarquia(video) {
        if (autoTeatro) {
            if (!teatroTentado) {
                teatroTentado = true;
                ativarModoTeatro(video);
            }
        } else {
            ativarTelaCheiaNoVideo(video);
        }
    }

    function lidarComAtalhosDeTeclado(e) {
        if (!e || (!e.manual && (!GM_getValue('ativar_atalhos_teclado', true) || e.defaultPrevented))) return;
        const cfg = lerAtalhosPersonalizados();
        let docAtivo = (e && e.target && e.target.ownerDocument) || document;
        if (!e.manual) {
            const alvo = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
            const ativo = docAtivo.activeElement;
            const seletorInterativo = 'input, textarea, select, option, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
            const estaEmCampoInterativo = elemento => {
                try { return !!(elemento && (elemento.isContentEditable || (elemento.closest && elemento.closest(seletorInterativo)))); }
                catch (erro) { return false; }
            };
            if (estaEmCampoInterativo(alvo) || estaEmCampoInterativo(ativo)) return;
        }

        const tecla = String(e.key || '').toLowerCase();
        if ((e.manual && (e.manualAction === 'next' || tecla === teclaProximoEp)) || (!e.manual && eventoAcionaAtalho(e, cfg.next))) {
            avancarParaProximoEpisodio(true);
            return;
        }
        if ((e.manual && (e.manualAction === 'theater' || tecla === 't')) || (!e.manual && eventoAcionaAtalho(e, cfg.theater))) {
            if (videoAtivo) alternarModoTeatro();
            else if (ehJanelaPrincipal) {
                document.querySelectorAll('iframe').forEach(i => {
                    try { i.contentWindow.postMessage({ app: 'ANIME_V44', acao: 'TOGGLE_TEATRO' }, '*'); } catch(err){}
                });
            }
            return;
        }

        if ((e.manual && (e.manualAction === 'intro' || tecla === teclaPularIntro)) || (!e.manual && eventoAcionaAtalho(e, cfg.intro))) { acionarPuloManual('intro'); return; }
        if ((e.manual && (e.manualAction === 'outro' || tecla === teclaPularVinheta)) || (!e.manual && eventoAcionaAtalho(e, cfg.outro))) { acionarPuloManual('vinheta'); return; }
    }
    let timerInatividade = null;
    let ultimaSincronizacaoAtiva = 0;
    const estilosAlturaExpansao = new Map();
    function sincronizarInatividadeEntreFrames(ocioso, forcar = false) {
        if (!document.body.classList.contains('au-teatro-ativo')) return;
        const agora = Date.now();
        if (!ocioso && !forcar && agora - ultimaSincronizacaoAtiva < 500) return;
        if (!ocioso) ultimaSincronizacaoAtiva = agora;
        const acao = ocioso ? 'TEATRO_IDLE' : 'TEATRO_ACTIVE';
        if (window === window.top) {
            document.querySelectorAll('iframe').forEach(frame => {
                try { frame.contentWindow.postMessage({ app: 'ANIME_UNIVERSAL', acao, cascata: true }, '*'); } catch (e) {}
            });
        } else {
            try { window.parent.postMessage({ app: 'ANIME_UNIVERSAL', acao }, '*'); } catch (e) {}
        }
    }

    function redimensionarPlayerExpandido(ocioso) {
        if (ocioso) return;
        let mudou = false;
        estilosAlturaExpansao.forEach((originais, el) => {
            for (const [propriedade, chave] of [['height', 'height'], ['max-height', 'maxHeight']]) {
                const [valor, prioridade] = originais[chave];
                if (valor) el.style.setProperty(propriedade, valor, prioridade);
                else el.style.removeProperty(propriedade);
            }
            mudou = true;
        });
        estilosAlturaExpansao.clear();
        if (mudou) {
            setTimeout(() => {
                try { window.dispatchEvent(new Event('resize')); } catch (e) {}
            }, 240);
        }
    }

    function resetarInatividade(propagar = true) {
        const estavaOcioso = document.body.classList.contains('au-idle');
        document.body.classList.remove('au-idle');
        if (estavaOcioso) redimensionarPlayerExpandido(false);
        if (propagar && estavaOcioso) sincronizarInatividadeEntreFrames(false, true);
        else if (propagar && document.body.classList.contains('au-teatro-ativo')) sincronizarInatividadeEntreFrames(false);
        clearTimeout(timerInatividade);
        if (teatroAtivoNoVideo || document.body.classList.contains('au-teatro-ativo') || document.body.classList.contains('au-menu-flutuante-aberto')) {
            timerInatividade = setTimeout(() => {
                document.body.classList.add('au-idle');
                document.body.classList.remove('au-menu-flutuante-aberto');
                atualizarVisualFabExpandido();
                redimensionarPlayerExpandido(true);
                sincronizarInatividadeEntreFrames(true);
            }, 3000);
        }
    }
    function fecharMenuFlutuante(devolverFoco = true) {
        if (!document.body.classList.contains('au-menu-flutuante-aberto')) return false;
        document.body.classList.remove('au-menu-flutuante-aberto');
        atualizarVisualFabExpandido();
        if (devolverFoco && document.activeElement !== fabTeatro) {
            ignorarProximoFocoFab = true;
            try { fabTeatro.focus({ preventScroll: true }); } catch (err) { fabTeatro.focus(); }
        }
        resetarInatividade();
        return true;
    }
    function lidarComEscapeMenuFlutuante(e) {
        if (!e || !eventoAcionaAtalho(e, lerAtalhosPersonalizados().closeMenu) || !document.body.classList.contains('au-menu-flutuante-aberto')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        fecharMenuFlutuante();
    }
    let ignorarProximoFocoFab = false;
    document.addEventListener('focusin', e => {
        if (e.target === fabTeatro) {
            if (ignorarProximoFocoFab) ignorarProximoFocoFab = false;
            else abrirMenuFlutuante();
            return;
        }
        const barra = document.getElementById('au-control-bar');
        if (barra && barra.contains(e.target)) resetarInatividade();
    }, true);
    document.addEventListener('focusout', e => {
        const barra = document.getElementById('au-control-bar');
        const saiuDoFabOuMenu = e.target === fabTeatro || (barra && barra.contains(e.target));
        const alvo = e.relatedTarget;
        const continuouNoFabOuMenu = alvo === fabTeatro || (barra && alvo && barra.contains(alvo));
        if (saiuDoFabOuMenu && !continuouNoFabOuMenu) resetarInatividade();
    }, true);
    window.addEventListener('keydown', lidarComCtrlZDesfazerPulo, true);
    window.addEventListener('keydown', lidarComEscapeMenuFlutuante, true);
    window.addEventListener('mousemove', resetarInatividade, true);
    window.addEventListener('pointermove', resetarInatividade, true);
    window.addEventListener('pointerdown', resetarInatividade, true);
    window.addEventListener('click', resetarInatividade, true);
    window.addEventListener('touchstart', resetarInatividade, true);
    window.addEventListener('touchmove', resetarInatividade, { capture: true, passive: true });
    window.addEventListener('wheel', resetarInatividade, { capture: true, passive: true });
    window.addEventListener('keydown', resetarInatividade, true);

    window.addEventListener('keydown', lidarComAtalhosDeTeclado, true);

    // ==========================================
    // 4.7 MENU FLUTUANTE — comandos do player fora do fluxo do site
    // ==========================================
    function iconeSvg(nome) {
        const desenhos = {
            play: '<path d="m8 5 11 7-11 7z"/>',
            pause: '<path d="M8 5h3v14H8zM15 5h3v14h-3z"/>',
            next: '<path d="M5 6v12l8-6zM14 6v12l7-6z"/>',
            skip: '<path d="M4 5v14l11-7zM17 5v14M20 5v14"/>',
            expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/>',
            collapse: '<path d="M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5"/>',
            logo: '<path d="M4 7h16M7 4v6m10-6v6M5 11h14l-1 9H6z"/>',
            screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
            info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
            database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
            close: '<path d="m6 6 12 12M18 6 6 18"/>',
        };
        return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${desenhos[nome] || desenhos.info}</svg>`;
    }

    function gerarHtmlBotoesBarra(comFechar) {
        const iconeAutoPlay = iconeSvg(autoPlay ? 'pause' : 'play');
        const expandido = document.body.classList.contains('au-teatro-ativo');
        const acaoExpandir = expandido ? 'Recolher' : 'Expandir';
        const iconeExpandir = expandido ? 'collapse' : 'expand';
        let html = `
            <div class="au-btn-bar au-btn-bar-text" data-au-acao="atalho-proximo" title="Próximo episódio (tecla ${teclaProximoEp.toUpperCase()})" aria-label="Próximo episódio">${iconeSvg('next')}<span>Próx</span></div>
            <div class="au-btn-bar au-btn-bar-text" data-au-acao="atalho-intro" title="Pular intro (+${segundosPularIntro}s, tecla ${teclaPularIntro.toUpperCase()})" aria-label="Pular intro">${iconeSvg('skip')}<span>Intro</span></div>
            <div class="au-btn-bar au-btn-bar-text" data-au-acao="atalho-teatro" data-au-expanded="${expandido}" title="${acaoExpandir} player (tecla T)" aria-label="${acaoExpandir} player">${iconeSvg(iconeExpandir)}<span>${acaoExpandir}</span></div>
            <div class="au-btn-bar ${autoPlay ? 'ativo' : ''}" data-au-toggle="autoplay" title="Auto Play: ${autoPlay ? 'Ligado' : 'Desligado'}" aria-label="Auto Play" aria-pressed="${autoPlay}">${iconeAutoPlay}</div>
            <div class="au-btn-bar ${autoNext ? 'ativo' : ''}" data-au-toggle="autonext" title="Auto Next: ${autoNext ? 'Ligado' : 'Desligado'}" aria-label="Auto Next" aria-pressed="${autoNext}">${iconeSvg('next')}</div>
            <div class="au-btn-bar ${autoAniSkip ? 'ativo' : ''}" data-au-toggle="aniskip" title="AniSkip: ${autoAniSkip ? 'Ligado' : 'Desligado'}" aria-label="AniSkip" aria-pressed="${autoAniSkip}">${iconeSvg('skip')}</div>
            <div class="au-btn-bar ${autoTeatro ? 'ativo' : ''}" data-au-toggle="teatro" title="Auto Expandir: ${autoTeatro ? 'Ligado' : 'Desligado'}" aria-label="Auto Expandir" aria-pressed="${autoTeatro}">${iconeSvg('expand')}</div>
        `;
        if (comFechar) html += `<div class="au-btn-bar" data-au-acao="fechar" title="Recolher player" aria-label="Recolher player">${iconeSvg('close')}</div>`;
        const controles = `<span class="au-control-primary">${html}</span>`
            .replace(/<div class="au-btn-bar/g, '<button type="button" class="au-btn-bar')
            .replace(/<\/div>/g, '</button>');
        return controles;
    }

    function conectarStatusNaBarra(barraEl) {
        if (!barraEl) return;
        uiStatus = barraEl.querySelector('.au-status-label') || uiStatus;
        uiTempo = barraEl.querySelector('.au-status-time') || uiTempo;
        uiAniSkip = barraEl.querySelector('.au-status-aniskip') || uiAniSkip;
        uiAP = barraEl.querySelector('.au-status-message') || uiAP;
    }

    function ligarBotoesDaBarra(barraEl) {
        if (!barraEl) return;
        const alternadores = {
            autoplay:   () => { autoPlay = !autoPlay; GM_setValue('ativar_autoplay', autoPlay); },
            autonext:   () => { autoNext = !autoNext; GM_setValue('ativar_autonext', autoNext); },
            aniskip:    () => { autoAniSkip = !autoAniSkip; GM_setValue('ativar_aniskip', autoAniSkip); },
            fullscreen: () => { autoFullscreen = !autoFullscreen; GM_setValue('ativar_fullscreen', autoFullscreen); },
            teatro:     () => {
                autoTeatro = !autoTeatro;
                GM_setValue('ativar_teatro', autoTeatro);
                if (autoTeatro && videoAtivo) ativarModoTeatro(videoAtivo);
            },
        };
        barraEl.querySelectorAll('[data-au-toggle]').forEach(btn => {
            const chave = btn.getAttribute('data-au-toggle');
            if (!alternadores[chave]) return;
            btn.onclick = () => { alternadores[chave](); sincronizarVarsGlobalmente(); resetarInatividade(); };
        });
        barraEl.querySelectorAll('[data-au-acao]').forEach(btn => {
            const acao = btn.getAttribute('data-au-acao');
            if (acao === 'info') btn.onclick = () => { acionarInfo(); resetarInatividade(); };
            else if (acao === 'cache') btn.onclick = () => { acionarCacheOffline(); resetarInatividade(); };
            else if (acao === 'fechar') btn.onclick = () => { desativarModoTeatro(videoAtivo); resetarInatividade(); };
            else if (acao === 'atalho-proximo') btn.onclick = () => { lidarComAtalhosDeTeclado({ key: teclaProximoEp, target: btn, manual: true, manualAction: 'next' }); resetarInatividade(); };
            else if (acao === 'atalho-intro') btn.onclick = () => { lidarComAtalhosDeTeclado({ key: teclaPularIntro, target: btn, manual: true, manualAction: 'intro' }); resetarInatividade(); };
            else if (acao === 'atalho-vinheta') btn.onclick = () => { lidarComAtalhosDeTeclado({ key: teclaPularVinheta, target: btn, manual: true, manualAction: 'outro' }); resetarInatividade(); };
            else if (acao === 'atalho-teatro') btn.onclick = () => {
                if (document.body.classList.contains('au-teatro-ativo') && document.body.classList.contains('au-menu-flutuante-aberto')) {
                    fecharMenuFlutuante();
                } else {
                    lidarComAtalhosDeTeclado({ key: 't', target: btn, manual: true, manualAction: 'theater' });
                }
                resetarInatividade();
            };
        });
    }

    function atualizarVisualBotoesDeControle() {
        const mapa = { autoplay: autoPlay, autonext: autoNext, aniskip: autoAniSkip, fullscreen: autoFullscreen, teatro: autoTeatro };
        const titulos = { autoplay: 'Auto Play', autonext: 'Auto Next', aniskip: 'AniSkip', fullscreen: 'Auto Fullscreen', teatro: 'Auto Expandir' };
        document.querySelectorAll('[data-au-toggle]').forEach(btn => {
            const chave = btn.getAttribute('data-au-toggle');
            if (!(chave in mapa)) return;
            const ligado = !!mapa[chave];
            btn.classList.toggle('ativo', ligado);
            btn.title = `${titulos[chave]}: ${ligado ? 'Ligado' : 'Desligado'}`;
            btn.setAttribute('aria-pressed', ligado ? 'true' : 'false');
            btn.setAttribute('aria-label', `${titulos[chave]}: ${ligado ? 'ligado' : 'desligado'}`);
            if (chave === 'autoplay') btn.innerHTML = iconeSvg(ligado ? 'pause' : 'play');
        });
    }

    function acionarInfo() {
        if (ehJanelaPrincipal) {
            abrirModalInfo();
        } else {
            try { window.top.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'ABRIR_INFO' }, '*'); } catch (e) {}
        }
    }

    function acionarCacheOffline() {
        if (ehJanelaPrincipal) {
            confirmarEIniciarCacheOffline();
        } else {
            try { window.top.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'CACHE_OFFLINE' }, '*'); } catch (e) {}
        }
    }

    function aplicarVarsSincronizadas(vars) {
        if (!vars) return;
        if (vars.autoNext !== undefined) autoNext = vars.autoNext;
        if (vars.autoPlay !== undefined) autoPlay = vars.autoPlay;
        if (vars.autoAniSkip !== undefined) autoAniSkip = vars.autoAniSkip;
        if (vars.autoFullscreen !== undefined) autoFullscreen = vars.autoFullscreen;
        if (vars.autoTeatro !== undefined) autoTeatro = vars.autoTeatro;
        if (vars.qualidadePlayerPreferida !== undefined) {
            const novaPreferencia = normalizarPreferenciaQualidade(vars.qualidadePlayerPreferida);
            if (novaPreferencia !== qualidadePlayerPreferida) {
                qualidadePlayerPreferida = novaPreferencia;
                document.querySelectorAll('video').forEach(video => {
                    if (novaPreferencia === 'auto') restaurarQualidadeAutomaticaNoVideo(video);
                    else aplicarQualidadePreferidaNoVideo(video);
                });
            }
        }
        atualizarVisualBotoesDeControle();
    }

    function propagarSincronizacaoParaIframes(vars) {
        document.querySelectorAll('iframe').forEach(f => {
            try { f.contentWindow.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'SYNC_VARS', vars, cascata: true }, '*'); } catch (e) {}
        });
    }

    function sincronizarVarsGlobalmente() {
        atualizarVisualBotoesDeControle();
        const vars = { autoNext, autoPlay, autoAniSkip, autoFullscreen, autoTeatro, qualidadePlayerPreferida };
        if (window === window.top) {
            propagarSincronizacaoParaIframes(vars);
        } else {
            try { window.top.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'SYNC_VARS', vars }, '*'); } catch (e) {}
        }
    }

    function propagarInfoStatusParaIframes(disponivel) {
        document.querySelectorAll('iframe').forEach(f => {
            try { f.contentWindow.postMessage({ app: 'ANIME_UNIVERSAL', acao: 'INFO_STATUS', disponivel, cascata: true }, '*'); } catch (e) {}
        });
    }

    // ==========================================
    // 5. AUTOPLAY FORTE E PERSISTENTE
    // ==========================================
    function obterOuCriarEstadoDoVideo(video) {
        let s = estadoVideo.get(video);
        if (!s || s.epoca !== epoca) {
            s = {
                epoca, tentativas: 0, ultima: 0, tPlaying: 0, estavel: false, src: '',
                playPendente: false, playDesde: 0, playId: 0, falhasPlay: 0, pausaAteMs: 0
            };
            try { s.src = video.currentSrc || video.src || ''; } catch (e) {}
            estadoVideo.set(video, s);
        }
        return s;
    }

    function videoPossuiFonteDeMidia(video) {
        try {
            return !!(video.currentSrc || video.src || video.querySelector('source'));
        } catch (e) { return false; }
    }

    function videoEhElegivelParaAutoplay(video) {
        try {
            if (video.loop) return false;
            const duracao = obterDuracaoDoVideo(video);
            if (isFinite(duracao) && duracao > 0 && duracao <= 60) return false;

            const rVisibilidade = video.getBoundingClientRect();
            if (rVisibilidade.width === 0 || rVisibilidade.height === 0) return false;

            const doc = video.ownerDocument;
            const emIframe = doc && doc !== document;
            if (!emIframe) {
                if (rVisibilidade.width < 160 || rVisibilidade.height < 90) return false;
            }
            return true;
        } catch (e) { return true; }
    }

    function monitorarEstabilidadeDeReproducao(video) {
        const s = obterOuCriarEstadoDoVideo(video);
        if (s.estavel) return;
        if (!video.paused && !video.ended) {
            if (!s.tPlaying) s.tPlaying = Date.now();
            else if (Date.now() - s.tPlaying > 1500) s.estavel = true;
        } else {
            s.tPlaying = 0;
        }
    }

    function notificarQueAutoplayEstaMudo() {
        if (ehJanelaPrincipal) {
            if (uiStatus) uiStatus.innerHTML = '<span style="color:#ff9800;">🔇 AutoPlay Mudo Ativo (Clique para som)</span>';
        } else {
            try { window.top.postMessage({ app: 'ANIME_V44', acao: 'MUDO' }, '*'); } catch(e) {}
        }
    }

    function ativarReproducaoEmModoMudo(video) {
        precisaMudo = true;
        try { video.muted = true; } catch (e) {}
        let p = null;
        try {
            p = video.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) { p = null; }
        notificarQueAutoplayEstaMudo();
        return p;
    }

    const PLAY_PENDENTE_MAX_MS = 10000;

    function tentativaDePlayEmAndamento(s) {
        if (!s.playPendente) return false;
        if (Date.now() - s.playDesde < PLAY_PENDENTE_MAX_MS) return true;
        s.playPendente = false;
        s.playId++;
        s.falhasPlay++;
        return false;
    }

    function acompanharPromiseDePlay(s, p, aoFalhar) {
        const id = ++s.playId;
        s.playPendente = true;
        s.playDesde = Date.now();
        const ehAtual = () => s.playId === id && s.epoca === epoca;
        p.then(() => {
            if (!ehAtual()) return;
            s.playPendente = false;
            s.falhasPlay = 0;
        }, err => {
            if (!ehAtual()) return;
            if (aoFalhar && aoFalhar(err)) return;
            s.playPendente = false;
            if (!err || err.name !== 'AbortError') s.falhasPlay++;
        });
    }

    function agendarSegundoAcionamentoDoPlayerMobile(video, s) {
        if (!frameBloggerDoAnimesDrive || s.segundoAcionamentoMobileAgendado || s.segundoAcionamentoMobileJaExecutado) return;
        s.segundoAcionamentoMobileAgendado = true;
        setTimeout(() => {
            s.segundoAcionamentoMobileAgendado = false;
            s.segundoAcionamentoMobileJaExecutado = true;
            if (!video || !video.isConnected || video.ended || !video.paused) return;
            // Alguns carregamentos do player Mobile só iniciam após uma segunda chamada.
            // Invalida a Promise anterior, que pode ficar pendente enquanto o iframe prepara a mídia.
            if (s.playPendente) {
                s.playPendente = false;
                s.playId++;
            }
            tentarReproduzirVideoAutomaticamente(video, true);
        }, 750);
    }

    function tentarReproduzirVideoAutomaticamente(video, ignorarEspera) {
        if (!autoPlay || !video || jaAvancou) return;
        if (video.ended || !video.paused) return;
        if (!videoEhElegivelParaAutoplay(video) || !videoPossuiFonteDeMidia(video)) return;

        try {
            if (video.closest && video.closest('.jwplayer') &&
                video.ownerDocument.documentElement.getAttribute('data-au-jw') === '1') return;
        } catch (e) {}

        const s = obterOuCriarEstadoDoVideo(video);
        if (s.estavel) return;
        if (tentativaDePlayEmAndamento(s)) return;

        const agora = Date.now();
        if (!ignorarEspera && agora < s.pausaAteMs) return;
        const espera = s.tentativas < 40 ? 350 : 1500;
        if (!ignorarEspera && agora - s.ultima < espera) return;
        s.ultima = agora;
        s.tentativas++;

        try {
            if (frameBloggerDoAnimesDrive && !s.modoMudoInicialAplicado) {
                video.muted = true;
                video.defaultMuted = true;
                precisaMudo = true;
                s.modoMudoInicialAplicado = true;
                notificarQueAutoplayEstaMudo();
            }
            video.autoplay = true;
            video.setAttribute('playsinline', '');
            if (precisaMudo && !video.muted) video.muted = true;
        } catch (e) {}

        let p, lancouExcecao = false;
        try { p = video.play(); } catch (e) { p = null; lancouExcecao = true; }
        if (lancouExcecao) {
            s.falhasPlay++;
            agendarSegundoAcionamentoDoPlayerMobile(video, s);
            return;
        }
        agendarSegundoAcionamentoDoPlayerMobile(video, s);
        if (p && typeof p.then === 'function') {
            acompanharPromiseDePlay(s, p, err => {
                if (!err || err.name !== 'NotAllowedError') return false;
                const pm = ativarReproducaoEmModoMudo(video);
                if (pm && typeof pm.then === 'function') {
                    acompanharPromiseDePlay(s, pm, null);
                    return true;
                }
                return false;
            });
        }
    }

    function forcarReproducaoDoVideo(video) { tentarReproduzirVideoAutomaticamente(video, true); }

    // ==========================================
    // 5.5b BASE OFFLINE DE MAL IDs (IndexedDB) — cache que cresce sozinho + download opcional
    // ==========================================
    const NOME_DB_OFFLINE = 'AniStreamOptimizerDB';
    const VERSAO_DB_OFFLINE = 1;
    const STORE_TITULOS = 'titulosMAL';
    const STORE_META = 'metaMAL';
    const URL_BASE_OFFLINE = 'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json';
    const VALIDADE_CACHE_OFFLINE_MS = 7 * 24 * 60 * 60 * 1000;

    let promessaDbOffline = null;
    let baixandoBaseOffline = false;

    function abrirBaseOffline() {
        if (promessaDbOffline) return promessaDbOffline;
        promessaDbOffline = new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(NOME_DB_OFFLINE, VERSAO_DB_OFFLINE); }
            catch (e) { reject(e); return; }
            req.onupgradeneeded = (ev) => {
                const db = ev.target.result;
                if (!db.objectStoreNames.contains(STORE_TITULOS)) db.createObjectStore(STORE_TITULOS);
                if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Falha ao abrir IndexedDB'));
            req.onblocked = () => reject(new Error('IndexedDB bloqueado (outra aba com versão antiga aberta)'));
        });
        return promessaDbOffline;
    }

    function dbObterMeta(chave) {
        return abrirBaseOffline().then(db => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_META, 'readonly');
                const req = tx.objectStore(STORE_META).get(chave);
                req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbDefinirMeta(chave, valor) {
        return abrirBaseOffline().then(db => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_META, 'readwrite');
                tx.objectStore(STORE_META).put(valor, chave);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbBuscarTitulo(chaveNormalizada) {
        return abrirBaseOffline().then(db => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_TITULOS, 'readonly');
                const req = tx.objectStore(STORE_TITULOS).get(chaveNormalizada);
                req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbBuscarTituloPorFuzzy(chaveAlvo, limiarMinimo) {
        return abrirBaseOffline().then(db => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_TITULOS, 'readonly');
                const store = tx.objectStore(STORE_TITULOS);
                const req = store.openCursor();

                let melhorScore = 0;
                let melhorMalId = null;
                let melhorTitulo = null;
                const tamanhoAlvo = chaveAlvo.length;
                const diffMaximaPermitida = Math.ceil(tamanhoAlvo * (1 - limiarMinimo)) + 2;

                req.onsuccess = (ev) => {
                    const cursor = ev.target.result;
                    if (!cursor) {
                        resolve(melhorMalId ? { malId: melhorMalId, titulo: melhorTitulo, score: melhorScore } : null);
                        return;
                    }
                    const chaveCandidata = cursor.key;
                    if (typeof chaveCandidata === 'string' &&
                        Math.abs(chaveCandidata.length - tamanhoAlvo) <= diffMaximaPermitida) {
                        const score = calcularSimilaridadeDeStrings(chaveAlvo, chaveCandidata);
                        if (score > melhorScore) {
                            melhorScore = score;
                            melhorMalId = cursor.value;
                            melhorTitulo = chaveCandidata;
                        }
                    }
                    cursor.continue();
                };
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbGravarTitulo(chaveNormalizada, malId) {
        return abrirBaseOffline().then(db => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_TITULOS, 'readwrite');
                tx.objectStore(STORE_TITULOS).put(malId, chaveNormalizada);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbSubstituirTodosOsTitulos(mapaTitulos) {
        return abrirBaseOffline().then(db => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_TITULOS, 'readwrite');
                const store = tx.objectStore(STORE_TITULOS);
                store.clear();
                for (const [chave, malId] of mapaTitulos) store.put(malId, chave);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) { reject(e); }
        }));
    }

    function normalizarTituloParaBusca(txt) {
        if (!txt) return '';
        return txt
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    const LIMIAR_SIMILARIDADE_OFFLINE = 0.85;
    const LIMIAR_SIMILARIDADE_ANILIST = 0.80;

    function calcularSimilaridadeDeStrings(a, b) {
        a = a || '';
        b = b || '';
        if (a === b) return 1;
        if (a.length === 0 || b.length === 0) return 0;

        if (a.length > b.length) { const tmp = a; a = b; b = tmp; }
        const m = a.length, n = b.length;

        let linhaAnterior = new Array(m + 1);
        for (let i = 0; i <= m; i++) linhaAnterior[i] = i;

        for (let j = 1; j <= n; j++) {
            const linhaAtual = new Array(m + 1);
            linhaAtual[0] = j;
            const codigoB = b.charCodeAt(j - 1);
            for (let i = 1; i <= m; i++) {
                const custoSubstituicao = (a.charCodeAt(i - 1) === codigoB) ? 0 : 1;
                linhaAtual[i] = Math.min(
                    linhaAnterior[i] + 1,
                    linhaAtual[i - 1] + 1,
                    linhaAnterior[i - 1] + custoSubstituicao
                );
            }
            linhaAnterior = linhaAtual;
        }

        const distancia = linhaAnterior[m];
        const maiorTamanho = Math.max(m, n);
        return maiorTamanho === 0 ? 1 : 1 - (distancia / maiorTamanho);
    }

    function baixarJsonGrande(url) {
        return new Promise((resolve, reject) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 60000,
                    headers: { 'Accept': 'application/json' },
                    onload: (res) => {
                        try {
                            if (!res || res.status < 200 || res.status >= 300) { reject(new Error('HTTP ' + (res && res.status))); return; }
                            resolve(JSON.parse(res.responseText));
                        } catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('Erro de rede (base offline)')),
                    ontimeout: () => reject(new Error('Timeout (base offline)')),
                    onabort: () => reject(new Error('Abortado (base offline)'))
                });
            } catch (e) { reject(e); }
        });
    }

    function processarAniOfflineDatabase(json) {
        const mapa = new Map();
        const dados = json && Array.isArray(json.data) ? json.data : [];
        for (const item of dados) {
            if (!item || !Array.isArray(item.sources)) continue;

            let malId = null;
            for (const src of item.sources) {
                const m = typeof src === 'string' && src.match(/myanimelist\.net\/anime\/(\d+)/);
                if (m) { malId = parseInt(m[1], 10); break; }
            }
            if (!malId) continue;

            const titulos = [item.title, ...(Array.isArray(item.synonyms) ? item.synonyms : [])];
            for (const t of titulos) {
                if (!t) continue;
                const chave = normalizarTituloParaBusca(t);
                if (chave && !mapa.has(chave)) mapa.set(chave, malId);
            }
        }
        return mapa;
    }

    async function atualizarBaseOfflineEmBackground(motivo) {
        if (baixandoBaseOffline) return;
        baixandoBaseOffline = true;
        try {
            console.log('[AniStream Optimizer] Baixando base offline completa de MAL IDs (' + motivo + ')...');
            const json = await baixarJsonGrande(URL_BASE_OFFLINE);
            const mapa = processarAniOfflineDatabase(json);
            await dbSubstituirTodosOsTitulos(mapa);
            await dbDefinirMeta('ultimaAtualizacao', Date.now());
            await dbDefinirMeta('totalTitulos', mapa.size);
            console.log('[AniStream Optimizer] Base offline atualizada: ' + mapa.size + ' títulos indexados.');
        } catch (e) {
            console.warn('[AniStream Optimizer] Falha ao baixar a base offline completa de MAL IDs:', (e && e.message) || e);
        } finally {
            baixandoBaseOffline = false;
        }
    }

    async function confirmarEIniciarCacheOffline() {
        let total = null, ultima = null;
        try { total = await dbObterMeta('totalTitulos'); } catch (e) {}
        try { ultima = await dbObterMeta('ultimaAtualizacao'); } catch (e) {}
        const dataTxt = ultima ? new Date(ultima).toLocaleString() : 'nunca (cache construído aos poucos, via AniList)';
        const totalTxt = total != null ? total.toLocaleString() : '0';
        const querBaixar = confirm(
            `📦 Cache offline de MAL IDs\n\n` +
            `Títulos indexados agora: ${totalTxt}\n` +
            `Última base completa baixada: ${dataTxt}\n\n` +
            `Este cache cresce SOZINHO: cada anime novo resolvido via AniList fica ` +
            `salvo aqui, e da 2ª vez em diante a busca é 100% local (sem rede).\n\n` +
            `Se preferires, também podes baixar a Anime Offline Database completa ` +
            `de uma vez (projeto arquivado desde 04/07/2026, ~59 MB, pode travar a ` +
            `aba por um tempo — recomendado em Wi-Fi). Queres baixar agora?`
        );
        if (querBaixar) {
            alert('Baixando ~59 MB em segundo plano... a aba pode ficar lenta por alguns segundos. Acompanhe o console (F12) para ver o progresso.');
            atualizarBaseOfflineEmBackground('forçado pelo menu/barra (download completo)');
        }
    }

    async function buscarMalIdOffline(nomeLimpo) {
        const chave = normalizarTituloParaBusca(nomeLimpo);
        if (!chave) return null;

        try {
            const malIdExato = await dbBuscarTitulo(chave);
            if (malIdExato) return { malId: malIdExato, origem: 'offline (exato)' };
        } catch (e) { }

        try {
            const resultado = await dbBuscarTituloPorFuzzy(chave, LIMIAR_SIMILARIDADE_OFFLINE);
            if (resultado && resultado.score >= LIMIAR_SIMILARIDADE_OFFLINE) {
                return {
                    malId: resultado.malId,
                    origem: `offline (fuzzy ${(resultado.score * 100).toFixed(0)}%: "${resultado.titulo}")`
                };
            }
        } catch (e) { }

        return null;
    }

    function buscarMalIdViaAniList(nomeLimpo) {
        const chaveAlvo = normalizarTituloParaBusca(nomeLimpo);
        const query = `query ($busca: String) {
            Page(perPage: 5) {
                media(search: $busca, type: ANIME) {
                    idMal
                    title { romaji english native }
                    description(asHtml: false)
                    averageScore
                    genres
                }
            }
        }`;
        const corpo = JSON.stringify({ query, variables: { busca: nomeLimpo } });
        return new Promise((resolve, reject) => {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://graphql.anilist.co',
                    timeout: 15000,
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    data: corpo,
                    onload: (res) => {
                        try {
                            if (!res || res.status < 200 || res.status >= 300) { reject(new Error('HTTP ' + (res && res.status))); return; }
                            const json = JSON.parse(res.responseText);
                            const lista = (json && json.data && json.data.Page && json.data.Page.media) || [];
                            const candidatos = lista.filter(item => item && item.idMal);
                            if (!candidatos.length) { reject(new Error('AniList: título não encontrado')); return; }

                            let melhorItem = null;
                            let melhorScore = 0;
                            for (const item of candidatos) {
                                const titulos = [
                                    item.title && item.title.romaji,
                                    item.title && item.title.english,
                                    item.title && item.title.native
                                ].filter(Boolean);
                                for (const t of titulos) {
                                    const score = calcularSimilaridadeDeStrings(chaveAlvo, normalizarTituloParaBusca(t));
                                    if (score > melhorScore) { melhorScore = score; melhorItem = item; }
                                }
                            }

                            const topResultado = candidatos[0];

                            const empacotar = (item, origem) => ({
                                malId: item.idMal,
                                origem,
                                metadados: {
                                    description: limparHtmlDaSinopse(item.description || ''),
                                    averageScore: Number.isFinite(item.averageScore) ? item.averageScore : null,
                                    genres: Array.isArray(item.genres) ? item.genres : []
                                }
                            });

                            if (melhorItem && melhorItem !== topResultado) {
                                if (melhorScore >= LIMIAR_SIMILARIDADE_ANILIST) {
                                    resolve(empacotar(melhorItem, `AniList (fuzzy ${(melhorScore * 100).toFixed(0)}%)`));
                                    return;
                                }
                            }

                            resolve(empacotar(topResultado, 'AniList (top resultado)'));
                        } catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('Erro de rede (AniList)')),
                    ontimeout: () => reject(new Error('Timeout (AniList)')),
                    onabort: () => reject(new Error('Abortado (AniList)'))
                });
            } catch (e) { reject(e); }
        });
    }

    // ==========================================
    // 5.6 ANISKIP — pula OP/ED automaticamente (base offline + AniList p/ mal_id + api.aniskip.com)
    // ==========================================
    function requisitarJsonAniSkip(url, tentativa = 1) {
        return new Promise((resolve, reject) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 15000,
                    headers: { 'Accept': 'application/json' },
                    onload: (res) => {
                        try {
                            let status = res && res.status;
                            if ([429, 502, 503, 504].includes(status) && tentativa < 4) {
                                setTimeout(() => {
                                    requisitarJsonAniSkip(url, tentativa + 1).then(resolve).catch(reject);
                                }, tentativa * 2000);
                                return;
                            }
                            if (!res || status < 200 || status >= 300) { reject(new Error('HTTP ' + status)); return; }
                            resolve(JSON.parse(res.responseText));
                        } catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('Erro de rede')),
                    ontimeout: () => reject(new Error('Timeout')),
                    onabort: () => reject(new Error('Abortado'))
                });
            } catch (e) { reject(e); }
        });
    }

    function obterChaveDaSerie() {
        let caminho = window.location.pathname;

        caminho = caminho.replace(/-(?:temporada|season|epis[oó]dio|episode|ep)(?![a-z])[\s\S]*$/i, '');

        caminho = caminho.replace(/(?:-\d+)+\/?$/, '');

        return caminho.replace(/[^a-z0-9]/gi, '');
    }

    // ==========================================
    // 5.5 MAPEAMENTO MANUAL DE MAL ID POR RANGE DE EPISÓDIOS
    // ==========================================

    function normalizarMapeamentoManual(bruto) {
        if (bruto == null || bruto === '') return { fallback: null, ranges: [] };

        if (typeof bruto === 'string' || typeof bruto === 'number') {
            const id = parseInt(bruto, 10);
            return { fallback: (isNaN(id) || id <= 0) ? null : id, ranges: [] };
        }

        if (typeof bruto === 'object') {
            const ranges = Array.isArray(bruto.ranges)
                ? bruto.ranges.filter(r => r &&
                    Number.isFinite(r.inicio) && Number.isFinite(r.fim) && Number.isFinite(r.malId) &&
                    r.inicio > 0 && r.fim >= r.inicio && r.malId > 0)
                : [];
            const fallback = Number.isFinite(bruto.fallback) && bruto.fallback > 0 ? bruto.fallback : null;
            return { fallback, ranges };
        }

        return { fallback: null, ranges: [] };
    }

    function formatarMapeamentoParaTexto(obj) {
        const partes = [];
        (obj.ranges || []).forEach(r => partes.push(`${r.inicio}-${r.fim}:${r.malId}`));
        if (obj.fallback) partes.push(String(obj.fallback));
        return partes.join(',');
    }

    function parseMapeamentoDeTexto(texto) {
        const ranges = [];
        let fallback = null;

        const tokens = texto.split(',').map(t => t.trim()).filter(Boolean);
        for (const token of tokens) {
            const mRange = token.match(/^(\d+)\s*-\s*(\d+)\s*:\s*(\d+)$/);
            if (mRange) {
                const inicio = parseInt(mRange[1], 10);
                const fim = parseInt(mRange[2], 10);
                const malId = parseInt(mRange[3], 10);
                if (inicio > 0 && fim >= inicio && malId > 0) ranges.push({ inicio, fim, malId });
                continue;
            }
            const mSimples = token.match(/^(\d+)$/);
            if (mSimples) {
                const id = parseInt(mSimples[1], 10);
                if (id > 0) fallback = id;
            }
        }

        if (!ranges.length && fallback == null) return null;
        return { fallback, ranges };
    }

    function obterMalIdManualParaEpisodio(chaveSerie, episodio) {
        const bruto = GM_getValue('aniskip_malid_manual_' + chaveSerie, null);
        if (bruto == null || bruto === '') return null;

        const mapa = normalizarMapeamentoManual(bruto);

        if (episodio != null && mapa.ranges.length) {
            const faixa = mapa.ranges.find(r => episodio >= r.inicio && episodio <= r.fim);
            if (faixa) return { malId: faixa.malId, origem: `manual (EP ${faixa.inicio}-${faixa.fim})` };
        }

        if (mapa.fallback) {
            return { malId: mapa.fallback, origem: 'manual (fallback)' };
        }

        return null;
    }

    function extrairInfoDoEpisodioParaAniSkip() {
        const candidatos = [];
        const adicionarCandidato = (valor) => {
            const texto = String(valor || '').replace(/\s+/g, ' ').trim();
            if (texto && texto.length <= 240 && !candidatos.includes(texto)) candidatos.push(texto);
        };

        const seletores = [
            'h1',
            '.entry-title',
            '.player-title',
            '.episode-title',
            '[class*="episode-title"]',
            '[class*="player-title"]',
            '[class*="anime-title"]',
            'meta[property="og:title"]',
            'title'
        ];
        for (const seletor of seletores) {
            try {
                document.querySelectorAll(seletor).forEach(el => {
                    adicionarCandidato(el.tagName === 'META' ? el.content : el.textContent);
                });
            } catch (e) {}
        }
        adicionarCandidato(document.title);

        const limparMarcaDoSite = texto => texto
            .replace(/\s*(?:[-|–—]\s*)?(?:animesroll|animes online(?: grátis)?)\s*$/i, '')
            .trim();

        const limparNomeDaSerie = texto => limparMarcaDoSite(texto)
            .replace(/^(?:assistir|anime)\s*[-–|:]?\s*/i, '')
            .replace(/(?:epis[oó]dio|episode|ep\.?)\s*#?\s*0*\d+\b/gi, ' ')
            .replace(/(?:^|\s)0*\d{1,4}(?=\s*(?:[-|–—]\s*)?(?:dublado|legendado|online|hd|fhd))*\s*$/i, ' ')
            .replace(/\(?(?:dublado|legendado|hd|fhd|online|assistir|completo|gratis)\)?/gi, ' ')
            .replace(/\b(?:temporada|season|parte)\s*\d+\b/gi, ' ')
            .replace(/[-–|:()]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const extrairNumeroDoTexto = texto => {
            const base = limparMarcaDoSite(texto);
            const explicito = base.match(/(?:epis[oó]dio|episode|ep\.?)\s*(?:n[ºo°]?\s*)?#?\s*0*(\d{1,4})\b/i);
            if (explicito) return parseInt(explicito[1], 10);

            const final = base.match(/(?:^|\s)0*(\d{1,4})(?:\s*(?:[-|–—]\s*)?(?:dublado|legendado|online|hd|fhd))*\s*$/i);
            if (final) return parseInt(final[1], 10);
            return null;
        };

        const analisados = candidatos.map(texto => ({
            texto,
            episodio: extrairNumeroDoTexto(texto),
            nome: limparNomeDaSerie(texto)
        }));
        const melhorCandidato = analisados.find(item => item.episodio > 0 && item.nome) ||
            analisados.find(item => item.episodio > 0);
        let bruto = melhorCandidato ? melhorCandidato.texto : '';
        let episodio = melhorCandidato ? melhorCandidato.episodio : null;

        if (episodio == null) {
            const caminho = window.location.pathname || '';
            const doCaminho = caminho.match(/(?:epis[oó]dio|episode|ep)[-_/]?0*(\d{1,4})(?:\/|$)/i);
            if (doCaminho) episodio = parseInt(doCaminho[1], 10);
        }

        if (!bruto) {
            const candidatoComNome = analisados.find(item => item.nome);
            bruto = candidatoComNome ? candidatoComNome.texto : (document.title || '');
        }

        const chave = obterChaveDaSerie();
        const nomeManual = GM_getValue('aniskip_custom_' + chave, '');
        const nomeLimpo = nomeManual || limparNomeDaSerie(bruto);

        return { nomeLimpo, episodio };
    }
    function atualizarStatusAniSkip(nome, ep, mensagem, tempos = null) {
        if (!autoAniSkip) return;

        let msgHtml = `<div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.1);"><b>Anime:</b> <span style="color:#e2e8f0;">${nome || 'Desconhecido'}</span><br><b>EP:</b> <span style="color:#e2e8f0;">${ep || '?'}</span></div>`;
        msgHtml += `<div style="margin-bottom:4px; color:#fbbf24;"><b>Status:</b> ${mensagem}</div>`;

        if (tempos && tempos.length > 0) {
            let op = tempos.find(t => t.skipType === 'op');
            let ed = tempos.find(t => t.skipType === 'ed');

            if (op) {
                msgHtml += `<div><b>OP:</b> ${formatarTempoEmMinutosSegundos(op.interval.startTime)} até ${formatarTempoEmMinutosSegundos(op.interval.endTime)} 🟢</div>`;
            } else {
                msgHtml += `<div><b>OP:</b> Não encontrada 🔴</div>`;
            }

            if (ed) {
                msgHtml += `<div><b>ED:</b> ${formatarTempoEmMinutosSegundos(ed.interval.startTime)} até ${formatarTempoEmMinutosSegundos(ed.interval.endTime)} 🟢</div>`;
            } else {
                msgHtml += `<div><b>ED:</b> Não encontrada 🔴</div>`;
            }
        }

        if (GM_getValue('smartskip_op_' + obterChaveDaSerie(), null)) {
            msgHtml += '<div style="margin-top:4px;">🧠 <b>SmartSkip Ativo</b></div>';
        }

        if (ehJanelaPrincipal && uiAniSkip) {
            uiAniSkip.style.display = 'block';
            definirHtmlSanitizado(uiAniSkip, msgHtml);
        } else if (!ehJanelaPrincipal) {
            try { window.top.postMessage({ app: 'ANIME_V44', acao: 'ANISKIP_UI', txt: msgHtml }, '*'); } catch (e) {}
        }
    }

    async function buscarTemposAniSkip() {
        let nomeParaAviso = 'Desconhecido';
        let epParaAviso = '?';
        try {
            const { nomeLimpo, episodio } = extrairInfoDoEpisodioParaAniSkip();
            nomeParaAviso = nomeLimpo || 'Desconhecido';
            epParaAviso = episodio || '?';
            nomeAnimeAtualParaExibicao = nomeParaAviso;

            let malId = null;
            let origemMalId = null;

            const manual = obterMalIdManualParaEpisodio(obterChaveDaSerie(), episodio);
            if (manual) {
                malId = manual.malId;
                origemMalId = manual.origem;
            }

            if (!malId) {
                if (!nomeLimpo || !episodio) {
                    atualizarStatusAniSkip(nomeParaAviso, epParaAviso, '⚠️ Falha ao ler Título/EP');
                    adiarBuscaAniSkipAteTituloCarregar();
                    return;
                }

                const chaveCache = 'aniskip_malid_' + nomeLimpo.toLowerCase();
                const malIdEmCache = GM_getValue(chaveCache, null);

                if (malIdEmCache) {
                    malId = malIdEmCache;
                    origemMalId = 'cache local';
                } else {
                    atualizarStatusAniSkip(nomeParaAviso, epParaAviso, 'Consultando cache offline (MAL ID)...');
                    const resultadoOffline = await buscarMalIdOffline(nomeLimpo);

                    if (resultadoOffline) {
                        malId = resultadoOffline.malId;
                        origemMalId = resultadoOffline.origem;
                        GM_setValue(chaveCache, malId);
                    } else {
                        atualizarStatusAniSkip(nomeParaAviso, epParaAviso, 'Não achado offline, tentando AniList...');
                        try {
                            const resultadoAniList = await buscarMalIdViaAniList(nomeLimpo);
                            malId = resultadoAniList.malId;
                            origemMalId = resultadoAniList.origem;
                            GM_setValue(chaveCache, malId);
                            const chaveOffline = normalizarTituloParaBusca(nomeLimpo);
                            if (chaveOffline) dbGravarTitulo(chaveOffline, malId).catch(() => {});

                            if (resultadoAniList.metadados) {
                                GM_setValue('aniskip_meta_' + malId, resultadoAniList.metadados);
                                metadadosAnimeAtual = Object.assign({ malId }, resultadoAniList.metadados);
                                atualizarVisibilidadeBotaoInfo();
                            }
                        } catch (e) {
                            atualizarStatusAniSkip(nomeParaAviso, epParaAviso, '❌ Não achado (cache offline + AniList)');
                            return;
                        }
                    }
                }
            }

            garantirMetadadosDoAnime(malId).catch(() => {});

            if (!episodio) {
                atualizarStatusAniSkip(nomeParaAviso, epParaAviso, '⚠️ EP não identificado');
                adiarBuscaAniSkipAteTituloCarregar();
                return;
            }

            atualizarStatusAniSkip(nomeParaAviso, epParaAviso, `Lendo tempos (MAL ID: ${malId} — ${origemMalId || 'automático'})...`);

            const parametrosAniSkip = new URLSearchParams();
            parametrosAniSkip.append('types', 'op');
            parametrosAniSkip.append('types', 'ed');
            parametrosAniSkip.set('episodeLength', '0');
            const urlAniSkip = 'https://api.aniskip.com/v2/skip-times/' + malId + '/' + episodio + '?' + parametrosAniSkip.toString();
            const dadosAniSkip = await requisitarJsonAniSkip(urlAniSkip);

            if (dadosAniSkip && dadosAniSkip.found && Array.isArray(dadosAniSkip.results) && dadosAniSkip.results.length) {
                cacheAniSkip = dadosAniSkip.results;
                atualizarStatusAniSkip(nomeParaAviso, epParaAviso, `Tempos encontrados! (${origemMalId || 'automático'})`, cacheAniSkip);

                transmitirDadosAniSkipParaFrames();
                aplicarPuloAniSkipSeJaEstiverNoTrecho();
            } else {
                atualizarStatusAniSkip(nomeParaAviso, epParaAviso, '❌ Sem tempos para este EP');
            }
        } catch (e) {
            let msgErro = e.message || 'Erro de API ou Rede';
            if (msgErro.includes('HTTP 429')) {
                msgErro = 'Limite de pedidos (Muitos pedidos)';
                atualizarStatusAniSkip(nomeParaAviso, epParaAviso, '⚠️ Erro: ' + msgErro);
                return;
            }
            if (msgErro.includes('HTTP 404')) {
                atualizarStatusAniSkip(nomeParaAviso, epParaAviso, '⚪ Tempos não mapeados pela comunidade (404)');
                return;
            }
            atualizarStatusAniSkip(nomeParaAviso, epParaAviso, '⚠️ Erro: ' + msgErro);
        }
    }

    // ==========================================
    // 5.5 AUXILIAR DE PÁGINA (JW Player) — corre no mundo JS da própria página/iframe
    // ==========================================
    function auxiliarDeAutoplayInjetadoNaPagina() {
        if (document.__auAP) return;
        document.__auAP = 1;

        var tent = 0, arrancou = false, ultimoFile = null, mutou = false;
        var hooks = 0, hooked = null, ticks = 0, ultimoRep = '', inicio = Date.now(), iv = null;

        function rep(t) {
            if (t === ultimoRep) return;
            ultimoRep = t;
            try { window.top.postMessage({ app: 'ANIME_V44', acao: 'AP', txt: t }, '*'); } catch (e) {}
        }

        function api() {
            try {
                if (typeof window.jwplayer !== 'function') return null;
                for (var i = 0; i < 6; i++) {
                    var p = null;
                    try { p = window.jwplayer(i); } catch (e) { p = null; }
                    if (!p || typeof p.getState !== 'function') continue;
                    var st = null;
                    try { st = p.getState(); } catch (e) {}
                    if (typeof st !== 'string') continue;
                    var pl = null;
                    try { pl = p.getPlaylist(); } catch (e) {}
                    if (pl && pl.length) return p;
                }
            } catch (e) {}
            return null;
        }

        function clicar(el) {
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
                try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
            });
        }
        function videoDireto() {
            try {
                var v = document.querySelector('.jw-media video, video');
                if (v) {
                    v.muted = true;
                    var pr = v.play();
                    if (pr && pr.catch) pr.catch(function () {});
                    return true;
                }
            } catch (e) {}
            return false;
        }

        function mudoPlay(p) {
            try { p.setMute(true); mutou = true; } catch (e) {}
            try { p.play(true); } catch (e) {}
            rep('🔇 JW: play mudo (tentativa ' + tent + ')');
        }
        function desmutar() {
            setTimeout(function () {
                try {
                    var p = api();
                    if (p && mutou && p.getMute()) p.setMute(false);
                    mutou = false;
                } catch (e) {}
            }, 80);
        }
        document.addEventListener('pointerdown', desmutar, true);
        document.addEventListener('keydown', desmutar, true);
        document.addEventListener('au-unmute', desmutar, true);

        function tick() {
            ticks++;
            var p = api();
            if (!p) {
                var seg = Math.round((Date.now() - inicio) / 1000);
                rep(typeof window.jwplayer === 'function'
                    ? '⏳ JW carregado, à espera do setup (' + seg + 's)'
                    : '🔧 auxiliar ativo, sem JW (' + seg + 's)');
                if (Date.now() - inicio > 180000 && iv) { clearInterval(iv); iv = null; }
                return;
            }
            try { document.documentElement.setAttribute('data-au-jw', '1'); } catch (e) {}

            if (p !== hooked && hooks < 5) {
                hooked = p; hooks++;
                try { p.on('autostartNotAllowed', function () { mudoPlay(p); }); } catch (e) {}
                try { p.on('playAttemptFailed', function () { mudoPlay(p); }); } catch (e) {}
                try { p.on('playlistItem', function () { arrancou = false; tent = 0; }); } catch (e) {}
                try { p.on('error', function () { rep('⚠️ JW Erro de Reprodução'); window.top.postMessage({ app: 'ANIME_V44', acao: 'FALLBACK_SERVIDOR' }, '*'); }); } catch (e) {}
                try { p.on('setupError', function () { rep('⚠️ JW Erro de Setup'); window.top.postMessage({ app: 'ANIME_V44', acao: 'FALLBACK_SERVIDOR' }, '*'); }); } catch (e) {}
            }

            var st = p.getState();
            var f = null;
            try {
                var it = p.getPlaylistItem();
                f = (it && (it.file || (it.sources && it.sources[0] && it.sources[0].file))) || null;
            } catch (e) {}
            if (f !== ultimoFile) { ultimoFile = f; arrancou = false; tent = 0; }

            if (st === 'playing') {
                if (!arrancou) {
                    arrancou = true;
                    var m = false; try { m = p.getMute(); } catch (e) {}
                    rep(m ? '🔇 JW a tocar (mudo)' : '✅ JW a tocar');
                }
                return;
            }
            if (arrancou || st === 'complete') return;
            if (st === 'buffering') { rep('⏳ JW a carregar…'); return; }

            tent++;
            if (tent <= 2) {
                try { p.play(true); } catch (e) { rep('⚠️ JW play erro: ' + (e && e.message)); }
                rep('▶️ JW play (tentativa ' + tent + ', ' + st + ')');
            } else {
                mudoPlay(p);
                if (tent === 6 || tent === 12) { if (videoDireto()) rep('🎞️ fallback: video.play() mudo (t' + tent + ')'); }
                if (tent === 9) {
                    var st2 = null; try { st2 = p.getState(); } catch (e) {}
                    var d = document.querySelector('.jw-display-icon-display, .jw-icon-display, .jw-display-icon-container');
                    if (d && (st2 === 'idle' || st2 === 'paused')) { clicar(d); rep('🖱️ fallback: clique no ícone play (t' + tent + ')'); }
                }
            }
        }
        rep('🔧 auxiliar ativo');
        iv = setInterval(tick, 500);
        tick();
    }

    function injetarScriptAuxiliarNoDocumento(doc) {
        if (!autoPlay) return;
        try {
            const raiz = doc.documentElement;
            if (!raiz || raiz.hasAttribute('data-au-ap')) return;
            raiz.setAttribute('data-au-ap', '1');
            const sc = doc.createElement('script');
            sc.textContent = '(' + auxiliarDeAutoplayInjetadoNaPagina.toString() + ')();';
            raiz.appendChild(sc);
            sc.remove();
        } catch (e) {}
    }

    // ==========================================
    // 6.1 MODO TEATRO — CSS universal (100vw/100vh, sem Fullscreen nativo)
    // ==========================================
    const CSS_MODO_TEATRO = `
        /* Ocultador de Inatividade (Esconde o rato e o painel) */
        body.au-teatro-ativo.au-idle, body.au-teatro-ativo.au-idle * { cursor: none !important; }

        /* Transições Suaves */
        body.au-teatro-ativo { transition: background-color 0.4s ease !important; }

        /* 1. Libertação Total (Escapar do layout do site) */
        .au-teatro-ancestor {
            transform: none !important; contain: none !important; clip-path: none !important;
            filter: none !important; perspective: none !important; will-change: auto !important;
            backdrop-filter: none !important; mask: none !important; z-index: auto !important;
        }

        /* 2. Player fixo acima da barra inferior do Expandir */
        .au-modo-teatro {
            position: fixed !important; top: 0 !important; left: 0 !important; right: auto !important; bottom: auto !important;
            width: 100vw !important; height: calc(100vh - 56px) !important; max-height: calc(100vh - 56px) !important;
            z-index: 2147483647 !important; margin: 0 !important; padding: 0 !important; border: none !important;
            background: #000 !important; display: block !important; transition: height 0.22s ease, max-height 0.22s ease !important;
        }

        /* 3. Força Bruta: Obriga os players a respeitarem a nossa Caixa Mestra */
        .au-modo-teatro .animeq-player__stage, .au-modo-teatro .animeq-player__source,
        .au-modo-teatro .animeq-player__media, .au-modo-teatro .jw-aspect {
            position: absolute !important; top: 0 !important; left: 0 !important;
            width: 100% !important; height: 100% !important;
            padding: 0 !important; margin: 0 !important;
        }
        .au-modo-teatro video, .au-modo-teatro iframe {
            position: absolute !important; top: 0 !important; left: 0 !important;
            width: 100% !important; height: 100% !important; object-fit: contain !important;
            margin: 0 !important; padding: 0 !important;
        }

        /* 4. Limpa as impurezas visuais em volta do player */
        body.au-teatro-ativo { padding-top: 0 !important; overflow: hidden !important; background: #000 !important; }
        body.au-teatro-ativo header, body.au-teatro-ativo footer, body.au-teatro-ativo aside,
        body.au-teatro-ativo .sidebar, body.au-teatro-ativo .app-header, body.au-teatro-ativo .app-aside,
        .au-modo-teatro .animeq-player__meta, .au-modo-teatro .animeq-player__resume, .au-modo-teatro .animeq-player__next {
            display: none !important;
        }

        /* Botão Flutuante (Mobile UI) */
        #au-fab-teatro {
            position: fixed !important; bottom: 20px !important; right: 20px !important;
            width: 52px !important; height: 52px !important; border-radius: 18px !important;
            background: linear-gradient(145deg, #047857, #065f46) !important; backdrop-filter: blur(12px) !important;
            -webkit-backdrop-filter: blur(12px) !important; border: 1px solid rgba(255,255,255,0.32) !important;
            color: #fff !important; cursor: pointer !important; padding: 0 !important;
            appearance: none !important; -webkit-appearance: none !important;
            display: flex !important; justify-content: center !important; align-items: center !important;
            z-index: 99999999 !important; box-shadow: 0 8px 24px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.25) !important;
            transition: opacity 0.4s ease, transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
            touch-action: none !important; user-select: none !important; -webkit-user-select: none !important;
        }
        #au-fab-teatro svg { width: 23px !important; height: 23px !important; }
        #au-fab-teatro[data-au-expanded="true"] { background: linear-gradient(145deg, #0f766e, #115e59) !important; box-shadow: 0 8px 24px rgba(0,0,0,0.42), 0 0 0 3px rgba(52,211,153,.2), inset 0 1px 0 rgba(255,255,255,0.25) !important; }
        #au-fab-teatro.au-fab-arrastando, #au-fab-teatro.au-fab-arrastando:hover { transition: none !important; transform: none !important; cursor: grabbing !important; }
        #au-fab-teatro:hover { transform: translateY(-2px) !important; box-shadow: 0 12px 28px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3) !important; }
        #au-fab-teatro:active { transform: scale(0.94) !important; }
        #au-fab-teatro:focus-visible, .au-btn-bar:focus-visible { outline: 2px solid #a7f3d0 !important; outline-offset: 2px !important; }
        body.au-idle #au-fab-teatro { opacity: 0 !important; pointer-events: none !important; }

        #au-skip-toast {
            position: fixed !important; left: 50% !important; bottom: 92px !important; z-index: 2147483647 !important;
            display: flex !important; align-items: center !important; gap: 11px !important; min-height: 48px !important;
            max-width: min(90vw, 440px) !important; padding: 0 14px !important; box-sizing: border-box !important;
            overflow: hidden !important; border: 1px solid rgba(255,255,255,.16) !important; border-radius: 12px !important;
            background: rgba(17, 24, 39, .94) !important; color: #fff !important;
            box-shadow: 0 8px 28px rgba(0,0,0,.42) !important; backdrop-filter: blur(12px) !important;
            -webkit-backdrop-filter: blur(12px) !important; font: 600 14px/1.2 system-ui, sans-serif !important;
            opacity: 0 !important; visibility: hidden !important; transform: translate(-50%, 12px) scale(.97) !important;
            pointer-events: none !important; transition: opacity .2s ease, transform .2s ease, visibility .2s !important;
        }
        #au-skip-toast.au-visible { opacity: 1 !important; visibility: visible !important; transform: translate(-50%, 0) scale(1) !important; }
        .au-skip-toast-icon { display: inline-flex !important; flex: 0 0 25px !important; color: #6ee7b7 !important; padding-right: 3px !important; }
        .au-skip-toast-icon svg { display: block !important; width: 25px !important; height: 25px !important; fill: none !important; stroke: currentColor !important; stroke-width: 2.8 !important; stroke-linecap: round !important; stroke-linejoin: round !important; }
        .au-skip-toast-text { flex: 1 1 auto !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
        .au-skip-toast-undo { display: none !important; flex: 0 0 auto !important; position: relative !important; z-index: 1 !important; padding: 7px 10px !important; border: 1px solid rgba(110,231,183,.48) !important; border-radius: 8px !important; background: rgba(16,185,129,.16) !important; color: #a7f3d0 !important; font: 650 12px/1 system-ui, sans-serif !important; cursor: pointer !important; pointer-events: auto !important; }
        #au-skip-toast.au-has-undo .au-skip-toast-undo { display: inline-flex !important; align-items: center !important; justify-content: center !important; }
        .au-skip-toast-undo[hidden] { display: none !important; }
        .au-skip-toast-undo:disabled { opacity: .55 !important; cursor: wait !important; }
        .au-skip-toast-progress { position: absolute !important; left: 0 !important; bottom: 0 !important; height: 2px !important; width: 100% !important; background: #34d399 !important; transform-origin: left center !important; }
        #au-skip-toast.au-visible .au-skip-toast-progress { animation: au-skip-toast-countdown var(--au-skip-toast-duration, 2.8s) linear forwards !important; }
        @keyframes au-skip-toast-countdown { to { transform: scaleX(0); } }
        @media (max-width: 480px) { #au-skip-toast { bottom: 78px !important; min-height: 44px !important; font-size: 13px !important; } }
        @media (prefers-reduced-motion: reduce) { #au-skip-toast { transition: none !important; } #au-skip-toast.au-visible .au-skip-toast-progress { animation-duration: .01ms !important; } }

        /* Barra inferior fixa do Expandir - o CONTAINER é pointer-events:none: o espaço
           vazio ao redor/acima das bolinhas nunca deve interceptar cliques destinados ao
           <video> por baixo dele. Só os botões (.au-btn-bar) reativam pointer-events. */
        #au-control-bar {
            position: fixed !important; top: auto !important; bottom: 0 !important; left: 0 !important; width: 100vw !important;
            height: 56px !important; min-height: 56px !important; background: rgba(10, 15, 25, 0.88) !important;
            backdrop-filter: blur(18px) saturate(145%) !important; -webkit-backdrop-filter: blur(18px) saturate(145%) !important;
            border-top: 1px solid rgba(148,163,184,0.2) !important; display: none; align-items: center !important;
            justify-content: flex-start !important; gap: 8px !important;
            padding: 6px 18px !important; box-sizing: border-box !important; z-index: 2147483647 !important;
            overflow-x: auto !important; white-space: nowrap !important;
            scrollbar-width: none !important; box-shadow: 0 -8px 28px rgba(0,0,0,0.22) !important;
            transition: opacity 0.4s ease !important;
            pointer-events: none !important;
        }
        #au-control-bar::-webkit-scrollbar { display: none !important; }
        body.au-teatro-ativo #au-control-bar { display: flex !important; }
        body.au-idle #au-control-bar {
            opacity: 0 !important; transform: translateY(8px) !important; pointer-events: none !important;
        }
        body.au-idle #au-control-bar * { pointer-events: none !important; }

        .au-control-primary {
            display: flex !important; align-items: center !important; gap: 8px !important;
        }
        .au-status-chip {
            display: flex !important; align-items: center !important; gap: 8px !important;
            flex: 0 1 auto !important; min-width: 0 !important; max-width: 42vw !important;
            padding: 0 10px !important; color: #cbd5e1 !important; font: 11px/1.2 system-ui, sans-serif !important;
            white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
            border-right: 1px solid rgba(255,255,255,0.12) !important;
        }
        .au-status-label { color: #86efac !important; overflow: hidden !important; text-overflow: ellipsis !important; }
        .au-status-time { color: #fbbf24 !important; font-variant-numeric: tabular-nums !important; }
        .au-status-aniskip, .au-status-message { display: none; max-width: 24vw; overflow: hidden; text-overflow: ellipsis; color: #cbd5e1 !important; }

        /* Botões glass (Barra Inline + Barra do Expandir), com SVGs consistentes,
           rótulos nos atalhos e estados ativos claros. "pointer-events:auto" garante que o
           botão é clicável mesmo
           dentro de um container pointer-events:none (caso da barra do Expandir). */
        .au-btn-bar {
            position: relative !important;
            width: 40px !important; height: 40px !important; min-width: 40px !important; flex-shrink: 0 !important;
            display: inline-flex !important; align-items: center !important; justify-content: center !important;
            gap: 6px !important; background: linear-gradient(155deg, rgba(51,65,85,0.72), rgba(15,23,42,0.82)) !important;
            backdrop-filter: blur(10px) !important; -webkit-backdrop-filter: blur(10px) !important;
            color: #e2e8f0 !important; border: 1px solid rgba(203,213,225,0.18) !important;
            border-radius: 13px !important; font-size: 13px !important; line-height: 1 !important;
            cursor: pointer !important; font-family: system-ui, -apple-system, sans-serif !important;
            appearance: none !important; -webkit-appearance: none !important; padding: 0 !important;
            box-shadow: 0 3px 10px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06) !important;
            transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease !important;
            user-select: none !important; -webkit-tap-highlight-color: transparent !important;
            pointer-events: auto !important;
        }
        .au-btn-bar svg { display: block !important; flex: 0 0 auto !important; width: 17px !important; height: 17px !important; }
        .au-btn-bar:hover { transform: translateY(-1px) !important; background: linear-gradient(155deg, rgba(71,85,105,0.9), rgba(30,41,59,0.94)) !important; border-color: rgba(226,232,240,0.32) !important; }
        .au-btn-bar:active { transform: scale(0.96) !important; }
        .au-btn-bar-text {
            width: auto !important; min-width: 40px !important; padding: 0 11px !important;
            border-radius: 12px !important; font-size: 12px !important; font-weight: 650 !important;
        }
        .au-btn-bar-text span { line-height: 1 !important; }
        .au-btn-bar.ativo { background: linear-gradient(145deg, rgba(16,185,129,0.3), rgba(5,150,105,0.2)) !important; color: #6ee7b7 !important; border-color: rgba(52,211,153,0.65) !important; box-shadow: 0 3px 12px rgba(16,185,129,0.14), inset 0 1px 0 rgba(167,243,208,0.14) !important; }
        .au-btn-bar.ativo::after { content: "✓" !important; position: absolute !important; right: 2px !important; bottom: 2px !important; width: 12px !important; height: 12px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; border: 1px solid rgba(255,255,255,.9) !important; border-radius: 50% !important; background: #d1fae5 !important; color: #064e3b !important; font: 800 9px/1 system-ui, sans-serif !important; }
        .au-btn-bar.ativo:hover { background: linear-gradient(145deg, rgba(16,185,129,0.42), rgba(5,150,105,0.3)) !important; }

        /* 📱 COMPORTAMENTO RETRATO (VERTICAL) */
        @media (orientation: portrait) {
            /* Aumenta o padding para caber o vídeo + a barra (56.25vw + ~56px de bolinhas) */
            body.au-teatro-ativo { padding-top: calc(56.25vw + 56px) !important; background: #0b0b0b !important; }
        }
        /* 🖥️ COMPORTAMENTO PAISAGEM (HORIZONTAL / DESKTOP) */
        @media (orientation: landscape) {
            body.au-teatro-ativo { padding-top: 0 !important; overflow: hidden !important; }
            body.au-teatro-ativo::before {
                content: "" !important; position: fixed !important; top: 0 !important; left: 0 !important;
                width: 100vw !important; height: 100vh !important; background: #000 !important; z-index: 2147483646 !important;
            }
            .au-modo-teatro { height: 100vh !important; max-height: 100vh !important; }
            body.au-teatro-ativo #au-control-bar { display: none !important; }
        }

        /* Esconde botões (ex.: "ℹ️ Info" enquanto não há metadados) sem depender de
           !important adicional nos estilos inline, já que .au-btn-bar já usa
           "display: inline-flex !important". */
        /* Layout final do Expandir: barra inferior em qualquer orientação. */
        body.au-teatro-ativo { padding-top: 0 !important; overflow: hidden !important; background: #000 !important; }
        body.au-teatro-ativo::before { z-index: 2147483644 !important; }
        .au-modo-teatro {
            height: calc(100vh - 56px) !important; max-height: calc(100vh - 56px) !important;
            z-index: 2147483645 !important;
        }
        body.au-teatro-ativo #au-control-bar {
            display: flex !important; top: auto !important; bottom: 0 !important;
            height: 56px !important; min-height: 56px !important; z-index: 2147483647 !important;
            opacity: 1 !important; transform: none !important; pointer-events: auto !important;
        }
        @supports (height: 100dvh) {
            .au-modo-teatro { height: calc(100dvh - 56px) !important; max-height: calc(100dvh - 56px) !important; }
        }
        body.au-teatro-ativo.au-idle #au-control-bar,
        body.au-teatro-ativo.au-idle #au-control-bar * {
            opacity: 1 !important; transform: none !important; pointer-events: auto !important;
        }
        @media (max-width: 600px) {
            #au-control-bar {
                height: 56px !important; min-height: 56px !important; flex-direction: row !important;
                align-items: center !important; justify-content: space-between !important; gap: 3px !important;
                padding: 5px 8px !important; overflow: visible !important;
            }
            .au-status-chip { max-width: 29vw !important; min-width: 0 !important; justify-content: center !important; border-right: 0 !important; padding: 0 3px !important; box-sizing: border-box !important; }
            .au-status-label, .au-status-aniskip, .au-status-message { display: none !important; }
            .au-status-time { overflow: hidden !important; text-overflow: ellipsis !important; }
            .au-control-primary { width: auto !important; flex: 1 1 auto !important; justify-content: space-between !important; gap: 3px !important; }
            .au-control-primary .au-btn-bar-text { padding-left: 6px !important; padding-right: 6px !important; font-size: 11px !important; }
        }
        @media (max-width: 380px) {
            .au-control-primary .au-btn-bar-text { min-width: 40px !important; width: 40px !important; padding: 0 !important; }
            .au-control-primary .au-btn-bar-text span { display: none !important; }
        }

        /* 📱 Expandir em celular vertical: player no topo, comandos logo abaixo.
           O layout reserva só a proporção 16:9 do player; o restante da tela fica livre
           para o menu, inclusive quando a tela é alta e estreita. */
        @media (max-width: 600px) and (orientation: portrait) {
            .au-modo-teatro {
                top: 0 !important; left: 0 !important; right: auto !important; bottom: auto !important;
                width: 100vw !important; height: 56.25vw !important; max-height: 56.25vw !important;
            }
            body.au-teatro-ativo.au-idle .au-modo-teatro {
                height: 56.25vw !important; max-height: 56.25vw !important;
            }
            body.au-teatro-ativo #au-control-bar,
            body.au-teatro-ativo.au-idle #au-control-bar {
                top: 56.25vw !important; right: 0 !important; bottom: auto !important; left: 0 !important;
                width: 100vw !important; height: auto !important; min-height: 56px !important;
                max-height: calc(100dvh - 56.25vw) !important; flex-wrap: wrap !important;
                align-content: flex-start !important; justify-content: center !important;
                overflow-x: hidden !important; overflow-y: auto !important;
                padding: 8px !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important;
            }
            body.au-teatro-ativo #au-control-bar .au-control-primary,
            body.au-teatro-ativo.au-idle #au-control-bar * { pointer-events: auto !important; }
        }

        /* Menu flutuante do Expandir. A caixa do player nunca reserva espaço para
           controles: a interface abre sobre ela, em uma camada própria, e fecha após
           três segundos sem atividade. Assim um iframe não pode esconder a barra sob
           o vídeo nem impedir o botão de voltar. */
        body.au-teatro-ativo .au-modo-teatro {
            height: 100vh !important; max-height: 100vh !important;
            z-index: 2147483645 !important;
        }
        @supports (height: 100dvh) {
            body.au-teatro-ativo .au-modo-teatro {
                height: 100dvh !important; max-height: 100dvh !important;
            }
        }
        body.au-teatro-ativo #au-fab-teatro {
            z-index: 2147483647 !important;
        }
        body.au-teatro-ativo #au-control-bar,
        body.au-teatro-ativo.au-idle #au-control-bar {
            display: none !important; position: fixed !important;
            top: auto !important; right: 84px !important; bottom: 20px !important; left: auto !important;
            width: auto !important; max-width: calc(100vw - 104px) !important;
            height: auto !important; min-height: 56px !important; max-height: calc(100dvh - 40px) !important;
            padding: 8px 10px !important; border: 1px solid rgba(148,163,184,0.28) !important;
            border-radius: 18px !important; opacity: 0 !important; transform: translateY(8px) scale(0.98) !important;
            pointer-events: none !important; overflow: auto !important;
            box-shadow: 0 14px 36px rgba(0,0,0,0.42) !important;
        }
        body.au-teatro-ativo.au-menu-flutuante-aberto #au-control-bar {
            display: flex !important; align-items: center !important; justify-content: center !important;
            flex-wrap: wrap !important; gap: 8px !important;
            opacity: 1 !important; transform: none !important; pointer-events: auto !important;
        }
        body.au-teatro-ativo.au-menu-flutuante-aberto #au-control-bar * { pointer-events: auto !important; }
        /* O mesmo painel fica disponível no player normal, sem inserir elementos no fluxo do site. */
        body.au-menu-flutuante-aberto:not(.au-teatro-ativo) #au-control-bar {
            display: flex !important; position: fixed !important; top: auto !important; right: auto !important;
            bottom: auto !important; left: auto !important; width: max-content !important;
            max-width: min(calc(100vw - 96px), 520px) !important; height: auto !important; min-height: 56px !important;
            max-height: calc(100vh - 24px) !important; padding: 8px 10px !important;
            border: 1px solid rgba(148,163,184,0.28) !important; border-radius: 18px !important;
            opacity: 1 !important; transform: none !important; pointer-events: auto !important;
            overflow: auto !important; align-items: center !important; justify-content: center !important;
            box-shadow: 0 14px 36px rgba(0,0,0,0.42) !important;
        }
        body.au-menu-flutuante-aberto:not(.au-teatro-ativo) #au-control-bar .au-control-primary {
            max-width: 100% !important; flex-wrap: wrap !important; justify-content: center !important;
        }
        body.au-menu-flutuante-aberto:not(.au-teatro-ativo) #au-control-bar * { pointer-events: auto !important; }
        @media (max-width: 600px) {
            body.au-menu-flutuante-aberto:not(.au-teatro-ativo) #au-control-bar {
                max-width: calc(100vw - 92px) !important; max-height: calc(100vh - 24px) !important;
                padding: 7px !important;
            }
            body.au-menu-flutuante-aberto:not(.au-teatro-ativo) #au-control-bar .au-control-primary {
                gap: 5px !important;
            }
        }
        /* O botão fica visualmente oculto após três segundos sem atividade. Ele mantém
           uma zona de toque no lugar para reativar os controles em players dentro de iframe. */
        body.au-teatro-ativo.au-idle #au-fab-teatro { opacity: 0 !important; pointer-events: auto !important; }
        @media (max-width: 600px) and (orientation: portrait) {
            body.au-teatro-ativo .au-modo-teatro {
                height: 56.25vw !important; max-height: 56.25vw !important;
            }
            body.au-teatro-ativo #au-control-bar,
            body.au-teatro-ativo.au-idle #au-control-bar {
                right: 12px !important; bottom: 12px !important; left: 12px !important;
                width: auto !important; max-width: none !important; max-height: calc(100dvh - 24px) !important;
            }
        }

        .au-btn-bar.au-oculto { display: none !important; }

        /* ===== Modal/Overlay "ℹ️ Info" — glassmorphism, 100% tipografia, SEM imagens ===== */
        #au-info-overlay {
            position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;
            background: rgba(0,0,0,0.55) !important; backdrop-filter: blur(10px) !important;
            -webkit-backdrop-filter: blur(10px) !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
            padding: 20px !important; box-sizing: border-box !important;
            opacity: 0 !important; visibility: hidden !important; pointer-events: none !important;
            transition: opacity 0.25s ease, visibility 0s linear 0.25s !important;
            font-family: system-ui, -apple-system, sans-serif !important;
        }
        #au-info-overlay.au-info-aberto {
            opacity: 1 !important; visibility: visible !important; pointer-events: auto !important;
            transition: opacity 0.25s ease, visibility 0s linear 0s !important;
        }

        #au-info-modal {
            background: rgba(20, 20, 24, 0.85) !important; backdrop-filter: blur(18px) !important;
            -webkit-backdrop-filter: blur(18px) !important;
            border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 18px !important;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6) !important;
            width: min(480px, 100%) !important; max-height: min(78vh, 640px) !important;
            padding: 24px !important; box-sizing: border-box !important;
            display: flex !important; flex-direction: column !important; gap: 14px !important;
            position: relative !important; color: #e2e8f0 !important;
            transform: translateY(8px) scale(0.98) !important; transition: transform 0.25s ease !important;
        }
        #au-info-overlay.au-info-aberto #au-info-modal { transform: translateY(0) scale(1) !important; }

        #au-info-fechar {
            position: absolute !important; top: 12px !important; right: 12px !important;
            width: 30px !important; height: 30px !important; border-radius: 50% !important;
            background: rgba(255,255,255,0.08) !important; border: 1px solid rgba(255,255,255,0.15) !important;
            color: #e2e8f0 !important; font-size: 14px !important; cursor: pointer !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
            transition: background 0.2s ease !important; padding: 0 !important;
        }
        #au-info-fechar:hover { background: rgba(255,255,255,0.18) !important; }

        #au-info-header {
            display: flex !important; align-items: flex-start !important; justify-content: space-between !important;
            gap: 12px !important; padding-right: 26px !important; flex-shrink: 0 !important;
        }
        #au-info-titulo {
            margin: 0 !important; font-size: 20px !important; font-weight: 800 !important;
            line-height: 1.3 !important; color: #fff !important; letter-spacing: 0.2px !important;
        }
        #au-info-nota {
            flex-shrink: 0 !important; background: rgba(251, 191, 36, 0.15) !important;
            color: #fbbf24 !important; border: 1px solid rgba(251, 191, 36, 0.3) !important;
            border-radius: 20px !important; padding: 4px 10px !important; margin-top: 2px !important;
            font-size: 13px !important; font-weight: 700 !important; white-space: nowrap !important;
        }

        #au-info-generos { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; flex-shrink: 0 !important; }
        .au-pill {
            background: rgba(16, 185, 129, 0.12) !important; color: #6ee7b7 !important;
            border: 1px solid rgba(16, 185, 129, 0.25) !important; border-radius: 20px !important;
            padding: 4px 12px !important; font-size: 11.5px !important; font-weight: 600 !important;
            letter-spacing: 0.3px !important; text-transform: uppercase !important; white-space: nowrap !important;
        }

        #au-info-sinopse {
            color: #cbd5e1 !important; font-size: 13.5px !important; line-height: 1.65 !important;
            overflow-y: auto !important; padding-right: 8px !important; white-space: pre-line !important;
            scrollbar-width: thin !important; scrollbar-color: rgba(16,185,129,0.5) transparent !important;
        }
        #au-info-sinopse::-webkit-scrollbar { width: 6px !important; }
        #au-info-sinopse::-webkit-scrollbar-track { background: transparent !important; }
        #au-info-sinopse::-webkit-scrollbar-thumb { background: rgba(16,185,129,0.4) !important; border-radius: 10px !important; }
        #au-info-sinopse::-webkit-scrollbar-thumb:hover { background: rgba(16,185,129,0.7) !important; }

        @media (max-width: 480px) {
            #au-info-modal { padding: 18px !important; border-radius: 14px !important; max-height: 82vh !important; width: 92vw !important; }
            #au-info-titulo { font-size: 17px !important; }
            #au-info-sinopse { font-size: 13px !important; }
        }
    `;

    function injetarCSSNoDocumento(doc) {
        if (!doc || doc.getElementById('au-teatro-css')) return;
        try {
            let style = doc.createElement('style');
            style.id = 'au-teatro-css';
            style.innerHTML = CSS_MODO_TEATRO;
            doc.head.appendChild(style);
        } catch (e) {}
    }
    injetarCSSNoDocumento(document);

    // ==========================================
    // 6. OBSERVADOR SPA (URL + DOM) E RASTREADOR HÍBRIDO
    // ==========================================
    const adaptadoresDeVideo = new WeakMap();
    const jwPlayersComListenerDeQualidade = new WeakSet();

    function alturaDeOpcaoDeQualidade(opcao) {
        if (typeof opcao === 'number') return Number.isFinite(opcao) && opcao > 0 ? opcao : 0;
        if (!opcao) return 0;
        const direta = Number(opcao.height || opcao.value || opcao.quality);
        if (Number.isFinite(direta) && direta > 0) return direta;
        const rotulo = String(opcao.label || opcao.name || opcao.title || '');
        const correspondencia = rotulo.match(/(?:^|\D)(\d{3,4})\s*p?/i);
        return correspondencia ? Number(correspondencia[1]) : 0;
    }

    function configurarQualidadePlayer() {
        const opcoes = [
            '0 — Automática (recomendado)',
            '1 — Maior disponível',
            '2 — 1080p',
            '3 — 720p',
            '4 — 480p',
            '5 — 360p'
        ].join('\n');
        const atual = qualidadePlayerPreferida === 'auto' ? '0' : qualidadePlayerPreferida === 'highest' ? '1' : ({ '1080': '2', '720': '3', '480': '4', '360': '5' }[qualidadePlayerPreferida] || '0');
        const resposta = prompt(`Preferência de qualidade do player (JW Player/Plyr):\n${opcoes}\n\nEm resoluções fixas, será usada a opção disponível mais próxima.`, atual);
        if (resposta === null) return;
        const mapa = { '0': 'auto', '1': 'highest', '2': '1080', '3': '720', '4': '480', '5': '360' };
        const valor = mapa[String(resposta).trim()];
        if (!valor) {
            alert('Escolha um número de 0 a 5.');
            return;
        }
        qualidadePlayerPreferida = normalizarPreferenciaQualidade(valor);
        GM_setValue('preferencia_qualidade_player', qualidadePlayerPreferida);
        sincronizarVarsGlobalmente();
        document.querySelectorAll('video').forEach(video => {
            if (qualidadePlayerPreferida === 'auto') restaurarQualidadeAutomaticaNoVideo(video);
            else aplicarQualidadePreferidaNoVideo(video);
        });
        exibirMensagemBreveNoPainel(`Qualidade: ${valor === 'auto' ? 'Automática' : valor === 'highest' ? 'Maior disponível' : `${valor}p`}`);
    }

    function obterAdaptadorDeVideo(video) {
        if (!video || video.tagName !== 'VIDEO') return null;
        const anterior = adaptadoresDeVideo.get(video);
        if (anterior && anterior.elemento && anterior.elemento.isConnected) return anterior;

        const obterNumero = (leitura, fallback) => {
            try {
                const n = Number(leitura());
                return Number.isFinite(n) && n >= 0 ? n : Number(fallback) || 0;
            } catch (e) { return Number(fallback) || 0; }
        };

        const jwContainer = video.closest('.jwplayer');
        if (jwContainer && typeof window.jwplayer === 'function') {
            try {
                const player = window.jwplayer(jwContainer.id || jwContainer);
                if (player && typeof player.getPosition === 'function' &&
                    typeof player.getDuration === 'function' && typeof player.seek === 'function') {
                    const adaptador = {
                        tipo: 'jwplayer', elemento: jwContainer, api: player,
                        getCurrentTime: () => obterNumero(() => player.getPosition(), video.currentTime),
                        getDuration: () => {
                            const duracao = obterNumero(() => player.getDuration(), 0);
                            return duracao > 0 ? duracao : Number(video.duration) || 0;
                        },
                        getQualityOptions: () => {
                            const niveis = player.getQualityLevels();
                            return Array.isArray(niveis) ? niveis.map((nivel, indice) => ({
                                value: Number.isInteger(Number(nivel && nivel.index)) && Number(nivel.index) > 0 ? Number(nivel.index) : indice + 1,
                                height: alturaDeOpcaoDeQualidade(nivel),
                                label: String(nivel && nivel.label || '')
                            })) : [];
                        },
                        getCurrentQuality: () => player.getCurrentQuality(),
                        setQuality: valor => { player.setCurrentQuality(valor); return true; },
                        setAutoQuality: () => { player.setCurrentQuality(0); return true; },
                        seek: tempo => { player.seek(tempo); return true; },
                        requestFullscreen: () => {
                            if (typeof player.setFullscreen === 'function') return player.setFullscreen(true);
                            const request = jwContainer.requestFullscreen || jwContainer.webkitRequestFullscreen;
                            return request ? request.call(jwContainer) : false;
                        }
                    };
                    adaptadoresDeVideo.set(video, adaptador);
                    if (!jwPlayersComListenerDeQualidade.has(player) && typeof player.on === 'function') {
                        jwPlayersComListenerDeQualidade.add(player);
                        const reaplicarQualidade = () => setTimeout(() => {
                            const videoAtual = jwContainer.querySelector('video') || video;
                            aplicarQualidadePreferidaNoVideo(videoAtual);
                        }, 0);
                        try { player.on('levels', reaplicarQualidade); } catch (e) {}
                        try { player.on('firstFrame', reaplicarQualidade); } catch (e) {}
                    }
                    return adaptador;
                }
            } catch (e) {}
        }

        const plyrContainer = video.closest('.plyr');
        let plyr = null;
        try { plyr = video.plyr || (plyrContainer && plyrContainer.plyr) || null; } catch (e) {}
        if (plyr && plyrContainer && typeof plyr.currentTime === 'number' && typeof plyr.duration === 'number') {
            const adaptador = {
                tipo: 'plyr', elemento: plyrContainer, api: plyr,
                getCurrentTime: () => obterNumero(() => plyr.currentTime, video.currentTime),
                getDuration: () => {
                    const duracao = obterNumero(() => plyr.duration, 0);
                    return duracao > 0 ? duracao : Number(video.duration) || 0;
                },
                getQualityOptions: () => {
                    try {
                        const niveis = plyr.config && plyr.config.quality && plyr.config.quality.options;
                        return Array.isArray(niveis) ? niveis.map(valor => ({ value: Number(valor), height: alturaDeOpcaoDeQualidade(valor), label: String(valor) })) : [];
                    } catch (e) { return []; }
                },
                getCurrentQuality: () => plyr.quality,
                setQuality: valor => { plyr.quality = valor; return true; },
                setAutoQuality: () => {
                    const niveis = plyr.config && plyr.config.quality;
                    const options = niveis && niveis.options;
                    const auto = Array.isArray(options) ? options.find(item => /auto|autom/i.test(String(item && (item.label || item.name) || item))) : undefined;
                    if (auto !== undefined) { plyr.quality = typeof auto === 'object' ? auto.value : auto; return true; }
                    return false;
                },
                seek: tempo => { plyr.currentTime = tempo; return true; },
                requestFullscreen: () => {
                    if (plyr.fullscreen && typeof plyr.fullscreen.enter === 'function') return plyr.fullscreen.enter();
                    const request = plyrContainer.requestFullscreen || plyrContainer.webkitRequestFullscreen;
                    return request ? request.call(plyrContainer) : false;
                }
            };
            adaptadoresDeVideo.set(video, adaptador);
            return adaptador;
        }

        const html5Container = video.closest('.video-container') || video;
        return {
            tipo: 'html5', elemento: html5Container, api: video,
            getCurrentTime: () => obterNumero(() => video.currentTime, 0),
            getDuration: () => obterNumero(() => video.duration, 0),
            getQualityOptions: () => [],
            seek: tempo => { video.currentTime = tempo; return true; },
            requestFullscreen: () => {
                if (html5Container.requestFullscreen) return html5Container.requestFullscreen();
                if (html5Container.webkitRequestFullscreen) return html5Container.webkitRequestFullscreen();
                if (video.requestFullscreen) return video.requestFullscreen();
                return false;
            }
        };
    }

    function obterTempoAtualDoVideo(video) {
        const adaptador = obterAdaptadorDeVideo(video);
        return adaptador ? adaptador.getCurrentTime() : Number(video && video.currentTime) || 0;
    }

    function obterDuracaoDoVideo(video) {
        const adaptador = obterAdaptadorDeVideo(video);
        return adaptador ? adaptador.getDuration() : Number(video && video.duration) || 0;
    }

    function buscarVideoPara(video, tempo) {
        const adaptador = obterAdaptadorDeVideo(video);
        try {
            if (adaptador && adaptador.seek(tempo) !== false) return true;
            video.currentTime = tempo;
            return true;
        } catch (e) { return false; }
    }

    function aplicarQualidadePreferidaNoVideo(video) {
        if (qualidadePlayerPreferida === 'auto') return false;
        const adaptador = obterAdaptadorDeVideo(video);
        if (!adaptador || !['jwplayer', 'plyr'].includes(adaptador.tipo) || typeof adaptador.getQualityOptions !== 'function') return false;
        try {
            const opcoes = adaptador.getQualityOptions().map((opcao, indice) => ({
                ...opcao,
                indice,
                altura: Number(opcao.height) || alturaDeOpcaoDeQualidade(opcao)
            })).filter(opcao => Number.isFinite(opcao.altura) && opcao.altura > 0);
            if (!opcoes.length) return false;

            let escolhida;
            if (qualidadePlayerPreferida === 'highest') {
                escolhida = opcoes.reduce((maior, atual) => atual.altura > maior.altura ? atual : maior);
            } else {
                const desejada = Number(qualidadePlayerPreferida);
                escolhida = opcoes.filter(opcao => opcao.altura <= desejada).reduce((maior, atual) => !maior || atual.altura > maior.altura ? atual : maior, null);
                if (!escolhida) escolhida = opcoes.reduce((menor, atual) => atual.altura < menor.altura ? atual : menor);
            }

            const atual = adaptador.getCurrentQuality();
            if (String(atual) === String(escolhida.value)) return true;
            const assinatura = `${qualidadePlayerPreferida}:${opcoes.map(opcao => `${opcao.value}-${opcao.altura}`).join(',')}`;
            if (adaptador.ultimaTentativaQualidade === assinatura && Date.now() - adaptador.ultimaTentativaQualidadeEm < 1200) return false;
            adaptador.ultimaTentativaQualidade = assinatura;
            adaptador.ultimaTentativaQualidadeEm = Date.now();
            return adaptador.setQuality(escolhida.value) !== false;
        } catch (e) { return false; }
    }

    function restaurarQualidadeAutomaticaNoVideo(video) {
        const adaptador = obterAdaptadorDeVideo(video);
        if (!adaptador || !['jwplayer', 'plyr'].includes(adaptador.tipo) || typeof adaptador.setAutoQuality !== 'function') return false;
        try { return adaptador.setAutoQuality() !== false; } catch (e) { return false; }
    }

    const EVENTOS_MIDIA = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'pause', 'timeupdate', 'error'];

    function obterChaveUnicaDaUrlAtual() {
        const l = window.location;
        return l.origin + l.pathname + l.search + (/^#[\/!]/.test(l.hash) ? l.hash : '');
    }
    let chaveUrlAtual = obterChaveUnicaDaUrlAtual();

    function verificarSeOEpisodioMudouNaMesmaPagina() {
        const k = obterChaveUnicaDaUrlAtual();
        if (k !== chaveUrlAtual) {
            chaveUrlAtual = k;
            reiniciarEstadoParaNovoEpisodio('URL mudou');
        }
    }

    function propagarResetDeEpisodioParaIframes() {
        try {
            document.querySelectorAll('iframe').forEach(f => {
                try { f.contentWindow.postMessage({ app: 'ANIME_V44', acao: 'RESET' }, '*'); } catch (e) {}
            });
        } catch (e) {}
    }

    function reiniciarEstadoParaNovoEpisodio(motivo, origem) {
        origem = origem || 'local';
        const agora = Date.now();
        if (agora - ultimoReset < 400) return;
        ultimoReset = agora;

        epoca++;
        jaAvancou = false;
        fullscreenTentado = false;
        teatroTentado = false;
        teatroAtivoNoVideo = false;
        tentouMudarQualidade = false;
        fallbackTentativas = 0;
        watchdogTempo = 0;
        indiceServidorFallback = -1;
        armado = false;
        videoAtivo = null;
        ultimoAvisoTempo = 0;
        cacheAniSkip = null;
        framesAguardandoDadosAniSkip.clear();
        clearTimeout(temporizadorSolicitarDadosAniSkip);
        temporizadorSolicitarDadosAniSkip = null;
        aniskipSolicitouDadosAoPai = false;
        tentativasSolicitarDadosAniSkip = 0;
        buscaLocalAniSkipNoPlayer = false;
        aniskipBuscado = false;
        tentativasLeituraAniSkip = 0;
        proximaBuscaAniSkipEm = 0;
        metadadosAnimeAtual = null;

        if (ehJanelaPrincipal) {
            try {
                if (bordaAplicada && document.body) { document.body.style.border = ''; bordaAplicada = false; }
            } catch (e) {}
            if (uiStatus) uiStatus.innerHTML = '<span style="color:#aaa;">🔄 Novo episódio — procurando player...</span>';
            if (uiTempo) uiTempo.innerHTML = '';
            fecharModalInfo();
            atualizarVisibilidadeBotaoInfo();
        }

        propagarResetDeEpisodioParaIframes();
        if (!ehJanelaPrincipal && origem === 'local') {
            try { window.top.postMessage({ app: 'ANIME_V44', acao: 'NOVO_EP' }, '*'); } catch (e) {}
        }

        agendarBuscaEAtivacaoDeVideos(0);
    }

    const HOSTS_DE_PLAYER_CONHECIDOS = ['blogger.com', 'googlevideo.com', 'drive.google.com'];

    function garantirPermissaoDeAutoplayNoIframe(f) {
        if (iframesComPermissaoAjustada.has(f)) return;
        try {
            const src = f.getAttribute('src') || '';
            let host = '';
            try { host = new URL(src, window.location.href).hostname; } catch (e) {}
            const ehPlayerConhecido = host && HOSTS_DE_PLAYER_CONHECIDOS.some(h => hostCorrespondeADominio(host, h));
            if (!ehPlayerConhecido) return;

            iframesComPermissaoAjustada.add(f);

            const tokens = (f.getAttribute('allow') || '').split(';').map(t => t.trim()).filter(Boolean);
            let mudou = false;
            if (!tokens.some(t => t.startsWith('autoplay'))) { tokens.push('autoplay'); mudou = true; }
            if (autoFullscreen && !tokens.some(t => t.startsWith('fullscreen'))) { tokens.push('fullscreen'); mudou = true; }
            if (!mudou || !src) return;

            f.setAttribute('allow', tokens.join('; '));
            f.setAttribute('src', 'about:blank');
            requestAnimationFrame(() => { try { f.setAttribute('src', src); } catch (e) {} });
        } catch (e) {}
    }

    function coletarTodosOsDocumentosIncluindoIframes(doc, lista, prof) {
        lista.push(doc);
        if (prof >= 5) return lista;
        let iframes;
        try { iframes = doc.querySelectorAll('iframe'); } catch (e) { return lista; }
        for (const f of iframes) {
            if (!iframesLigados.has(f)) {
                iframesLigados.add(f);
                if (autoPlay) garantirPermissaoDeAutoplayNoIframe(f);
                try { f.addEventListener('load', () => agendarBuscaEAtivacaoDeVideos(50)); } catch (e) {}
            }
            try {
                const d = f.contentDocument;
                if (d && d.documentElement) {
                    if (f.hasAttribute('srcdoc') && String(d.location.href) === 'about:blank') continue;
                    coletarTodosOsDocumentosIncluindoIframes(d, lista, prof + 1);
                }
            } catch (e) {}
        }
        return lista;
    }

    function documentoNaoRecebeUserscript(doc) {
        try { return String(doc.location.href).startsWith('about:'); } catch (e) { return false; }
    }

    function lidarComEventosDoPlayerDeVideo(e) {
        const video = e.target;
        if (!video || video.tagName !== 'VIDEO') return;
        if (['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing'].includes(e.type)) {
            aplicarQualidadePreferidaNoVideo(video);
        }

        switch (e.type) {
            case 'loadstart': {
                adaptadoresDeVideo.delete(video);
                const s = obterOuCriarEstadoDoVideo(video);
                let src = '';
                try { src = video.currentSrc || video.src || ''; } catch (err) {}
                if (s.src && src && s.src !== src) {
                    reiniciarEstadoParaNovoEpisodio('fonte do vídeo mudou');
                    obterOuCriarEstadoDoVideo(video);
                }
                obterOuCriarEstadoDoVideo(video).src = src || s.src;
                tentarReproduzirVideoAutomaticamente(video);
                break;
            }
            case 'loadedmetadata':
            case 'loadeddata':
            case 'canplay':
            case 'canplaythrough':
            case 'pause':
                tentarReproduzirVideoAutomaticamente(video);
                break;
            case 'playing': {
                const s = obterOuCriarEstadoDoVideo(video);
                if (!s.tPlaying) s.tPlaying = Date.now();
                if (video.muted && precisaMudo) notificarQueAutoplayEstaMudo();
                break;
            }
            case 'timeupdate':
                lidarComAtualizacaoDeTempoDoVideo(video);
                break;
            case 'error': {
                exibirMensagemBreveNoPainel('⚠️ Servidor falhou. Tentando alternativo...');
                if (ehJanelaPrincipal) {
                    tentarClicarProximoServidor();
                } else {
                    try { window.top.postMessage({ app: 'ANIME_V44', acao: 'FALLBACK_SERVIDOR' }, '*'); } catch(err){}
                }
                break;
            }
        }
    }

    function solicitarPuloAniSkipComConfirmacao(video, item, fim, mensagem) {
        if (!video || item.jaPulou || item.puloPendente || video.readyState < 1) return false;

        try {
            const seekable = video.seekable;
            if (seekable && seekable.length) {
                let destinoDisponivel = false;
                for (let i = 0; i < seekable.length; i++) {
                    if (fim >= seekable.start(i) - 0.25 && fim <= seekable.end(i) + 0.25) {
                        destinoDisponivel = true;
                        break;
                    }
                }
                if (!destinoDisponivel) return false;
            }
        } catch (e) { return false; }

        const epocaDoPedido = epoca;
        const posicaoAnterior = obterTempoAtualDoVideo(video);
        const pendencia = {};
        item.puloPendente = pendencia;
        let timerConfirmacao = null;

        const finalizar = confirmar => {
            if (item.puloPendente !== pendencia) return;
            clearTimeout(timerConfirmacao);
            video.removeEventListener('seeked', aoBuscar);
            item.puloPendente = null;
            if (!confirmar || epoca !== epocaDoPedido || !video.isConnected) return;
            if (!Number.isFinite(obterTempoAtualDoVideo(video)) || Math.abs(obterTempoAtualDoVideo(video) - fim) > 1.5 || video.seeking) return;
            item.jaPulou = true;
            const dadosDesfazer = Number.isFinite(posicaoAnterior) && fim - posicaoAnterior > 1.5
                ? { video, posicaoAnterior, posicaoPulada: fim }
                : null;
            exibirMensagemBreveNoPainel(mensagem, dadosDesfazer);
        };

        const aoBuscar = () => finalizar(true);
        video.addEventListener('seeked', aoBuscar);
        try {
            if (!buscarVideoPara(video, fim)) throw new Error('O adaptador não conseguiu buscar a posição pedida');
        } catch (e) {
            finalizar(false);
            return false;
        }

        // Alguns players não emitem seeked quando o destino ainda não está pronto.
        // Aguarda a busca terminar e só mostra o aviso se o tempo realmente mudou.
        timerConfirmacao = setTimeout(() => {
            if (item.puloPendente !== pendencia) return;
            finalizar(!video.seeking && Math.abs(obterTempoAtualDoVideo(video) - fim) <= 1.5);
        }, 2500);
        return true;
    }

    function lidarComAtualizacaoDeTempoDoVideo(video) {
        if (jaAvancou) return;

        const atual = obterTempoAtualDoVideo(video);
        const total = obterDuracaoDoVideo(video);

        if (!total || isNaN(total) || total <= 60) return;

        videoAtivo = video;
        monitorarEstabilidadeDeReproducao(video);

        let smartSkip = GM_getValue('smartskip_op_' + obterChaveDaSerie(), null);
        if (smartSkip && atual > smartSkip.s && atual < smartSkip.e - 1) {
            buscarVideoPara(video, smartSkip.e);
            exibirMensagemBreveNoPainel('🧠 Abertura pulada (Memória Inteligente)!');
        }

        if (autoAniSkip && cacheAniSkip && cacheAniSkip.length) {
            for (let item of cacheAniSkip) {
                try {
                    const intervalo = item && item.interval;
                    if (!intervalo) continue;
                    const inicio = intervalo.startTime;
                    const fim = intervalo.endTime;
                    if (typeof inicio !== 'number' || typeof fim !== 'number') continue;

                    if (atual >= inicio && atual <= fim) {
                        if (item.jaPulou) continue;

                        const ehEncerramento = item.skipType === 'ed';

                        if (ehEncerramento && autoNext && !siteUsaAutoNextNativo()) {
                            item.jaPulou = true;
                            exibirMensagemBreveNoPainel('⏭️ Encerramento detetado! Saltando de episódio...');
                            avancarParaProximoEpisodio();
                        } else {
                            const mensagem = ehEncerramento ? '⏩ Encerramento pulado!' : '⏩ Abertura pulada!';
                            if (!solicitarPuloAniSkipComConfirmacao(video, item, fim, mensagem)) continue;
                        }
                        break;
                    } else if (atual < inicio - 5 || atual > fim + 5) {
                        item.jaPulou = false;
                    }
                } catch (e) {}
            }
        }

        if (autoPlay && video.paused) {
            tentarReproduzirVideoAutomaticamente(video);
        }

        if (!video.paused) {
            expandirVideoConformeHierarquia(video);
        }

        const agora = Date.now();
        if (agora - ultimoAvisoTempo > 1000) {
            ultimoAvisoTempo = agora;
            atualizarPainelDeStatusNaJanela(atual, total);
            if (!ehJanelaPrincipal) {
                try { window.top.postMessage({ app: 'ANIME_V44', acao: 'TEMPO', atual: atual, total: total }, '*'); } catch(err){}
            }
        }

        verificarSeEpisodioEstaTerminando(atual, total);
    }

    function lidarComMutacoesDoDom(muts) {
        if (muts.length && muts.every(m => {
            const alvo = m.target && (m.target.nodeType === 1 ? m.target : m.target.parentElement);
            return !!(alvo && alvo.closest && alvo.closest('#au-control-bar'));
        })) return;
        agendarBuscaEAtivacaoDeVideos(150);
    }

    function agendarBuscaEAtivacaoDeVideos(ms) {
        if (timerVarredura) return;
        timerVarredura = setTimeout(() => {
            timerVarredura = null;
            buscarEAtivarVideos();
        }, ms);
    }

    function observarDocumentoParaDeteccaoDeVideo(doc) {
        if (docsObservados.has(doc)) return;
        const raiz = doc.documentElement;
        if (!raiz) return;
        docsObservados.add(doc);
        injetarScriptAuxiliarNoDocumento(doc);
        injetarCSSNoDocumento(doc);
        try {
            EVENTOS_MIDIA.forEach(ev => doc.addEventListener(ev, lidarComEventosDoPlayerDeVideo, true));

            if (doc !== document && documentoNaoRecebeUserscript(doc)) {
                doc.addEventListener('click', lidarComCliqueDoUsuarioNaPagina, true);
                doc.addEventListener('keydown', lidarComAtalhosDeTeclado, true);
            }

            new MutationObserver(lidarComMutacoesDoDom).observe(raiz, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'srcdoc']
            });
        } catch (e) {}
    }

    function garantirQuePainelDeStatusEstaVisivel() {
        if (!ehJanelaPrincipal || !document.body) return;
        const barraExpandir = document.getElementById('au-control-bar');
        if (barraExpandir && !barraExpandir.isConnected) document.body.appendChild(barraExpandir);
        conectarStatusNaBarra(barraExpandir);
    }

    function listarTodosOsVideosEncontrados(docs) {
        const todos = [];
        for (const d of docs) {
            try { d.querySelectorAll('video').forEach(v => todos.push(v)); } catch (e) {}
        }
        return todos;
    }

    function buscarEAtivarVideos() {
        verificarSeOEpisodioMudouNaMesmaPagina();
        solicitarDadosAniSkipAoPai();
        garantirQuePainelDeStatusEstaVisivel();
        const docs = coletarTodosOsDocumentosIncluindoIframes(document, [], 0);
        buscarERecusarPopupDeContinuarAssistindo(docs);

        if (ehJanelaPrincipal && autoAniSkip && !aniskipBuscado && Date.now() >= proximaBuscaAniSkipEm) {
            aniskipBuscado = true;
            buscarTemposAniSkip();
        }

        for (const d of docs) observarDocumentoParaDeteccaoDeVideo(d);
        const videos = listarTodosOsVideosEncontrados(docs);
        if (qualidadePlayerPreferida !== 'auto') videos.forEach(video => aplicarQualidadePreferidaNoVideo(video));
        if (!autoPlay) return;
        for (const v of videos) {
            monitorarEstabilidadeDeReproducao(v);
            tentarReproduzirVideoAutomaticamente(v);
        }
    }

    window.addEventListener('popstate', () => agendarBuscaEAtivacaoDeVideos(50));
    window.addEventListener('hashchange', () => agendarBuscaEAtivacaoDeVideos(50));
    try {
        if (window.navigation && window.navigation.addEventListener) {
            window.navigation.addEventListener('navigatesuccess', () => agendarBuscaEAtivacaoDeVideos(50));
        }
    } catch (e) {}

    // ==========================================
    // 6.5 OBSERVADOR DE MUDANÇA DE PÁGINA (SPA) — MutationObserver dedicado
    // ==========================================
    let ultimaUrl = window.location.href;

    const observadorSPA = new MutationObserver(() => {
        if (window.location.href !== ultimaUrl) {
            ultimaUrl = window.location.href;
            reiniciarEstadoParaNovoEpisodio('Observador SPA (MutationObserver) detectou troca de URL');
        }
    });

    observadorSPA.observe(document, { subtree: true, childList: true });

    const intervaloDeteccaoVideo = hostCorrespondeADominio(hostAtual, 'animesdrive.cloud') || frameBloggerDoAnimesDrive ? 250 : 500;
    setInterval(buscarEAtivarVideos, intervaloDeteccaoVideo);

    setInterval(() => {
        if (jaAvancou) return;

        if (ehJanelaPrincipal) {
            if (videoAtivo && (videoAtivo.currentTime > 0 || !videoAtivo.paused)) {
                watchdogTempo = 0;
            } else if (autoPlay) {
                watchdogTempo++;
            }

            const limiteSemProgresso = hostCorrespondeADominio(hostAtual, 'animesdrive.cloud') || frameBloggerDoAnimesDrive ? 5 : 15;
            if (watchdogTempo >= limiteSemProgresso && fallbackTentativas < 4) {
                watchdogTempo = 0;
                exibirMensagemBreveNoPainel(`⏳ Demora excessiva (${fallbackTentativas+1}/4). Testando outro...`);
                tentarClicarProximoServidor();
            }
        }

        const docs = coletarTodosOsDocumentosIncluindoIframes(document, [], 0);
        const validos = listarTodosOsVideosEncontrados(docs).filter(v => obterDuracaoDoVideo(v) > 60);
        const videoEncontrado = validos.find(v => !v.paused) || validos[0] || null;

        if (videoEncontrado) {
            videoAtivo = videoEncontrado;
            let atual = obterTempoAtualDoVideo(videoEncontrado);
            let total = obterDuracaoDoVideo(videoEncontrado);

            monitorarEstabilidadeDeReproducao(videoEncontrado);

            if (autoPlay && videoEncontrado.paused) {
                tentarReproduzirVideoAutomaticamente(videoEncontrado);
            }

            if (!videoEncontrado.paused) {
                expandirVideoConformeHierarquia(videoEncontrado);
            }

            if (total > 0 && !isNaN(total)) {
                if (ehJanelaPrincipal) {
                    atualizarPainelDeStatusNaJanela(atual, total);
                } else {
                    window.top.postMessage({
                        app: 'ANIME_V44',
                        acao: 'TEMPO',
                        atual: atual,
                        total: total
                    }, '*');
                }

                verificarSeEpisodioEstaTerminando(atual, total);
            }
        }
    }, 1000);

    buscarEAtivarVideos();
    }

    iniciarConformePoliticaDeSites({
        janela: window,
        ehPrincipal: ehJanelaPrincipal,
        host: hostAtual,
        cfg: cfgSites,
        restringirIframes: RESTRINGIR_IFRAMES,
        iniciar: iniciarAniStreamNoFrameAutorizado,
        aoOferecerAtivacao: () => {
            GM_registerMenuCommand("🟢 Ativar neste site", () => {
                alterarConfiguracaoDeSites(GM_getValue, GM_setValue, sitesPadrao, cfg => ativarSiteNaConfiguracao(cfg, hostAtual));
                location.reload();
            }, { title: 'Ativa o AniStream neste domínio e recarrega a página.' });
        }
    });

})();
