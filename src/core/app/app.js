firebase.initializeApp({
  apiKey:"AIzaSyAePmaLetobYfeG5_7DCcPsbr00BlUHf28",
  authDomain:"conferencia-blu.firebaseapp.com",
  projectId:"conferencia-blu",
  storageBucket:"conferencia-blu.firebasestorage.app",
  messagingSenderId:"744904349409",
  appId:"1:744904349409:web:3d8c67e76e5795632b49a0"
});
const db = firebase.firestore();
const auth = firebase.auth();


const ME = {uid:null,nome:'',email:'',perfil:'',cor:'#9B1C1C',listaAtiva:null,sessaoAtiva:null};
let baseMap = new Map();
const abasBipe = Object.create(null);
const exclusoesDeLista = new Map();
const abaListeners = new Map();
const chatListeners = Object.create(null);
let chatAtivoId = 'geral';
let onlineUsers = Object.create(null);
const intervaloPresenca = 30000;
const validadePresenca = 90000;
let proximaExpiracao;
let somAtivo = localStorage.getItem('blu_som')==='1';
let audioBipagem;
let notifAtivo = localStorage.getItem('blu_notif')!=='0';
let arquivosPendentes = [];
let logListener = null;
let modalBipeAtual = null;
let modalStatusSel = '';
let pausado = false;
let telaAtual = 'dash';
let modoConferencia = 'escolha';
let ultimaRota = null;
let previewRota = null;
let ultimoBipeDesfazivel;
let tempoDesfazerBipe;
let atualizarPresencaOperacional = ()=>{};
let contextoPresencaSessoes = '';

let listasCarregadas = false;
let baseCarregada = false;
let pararBase;
let pararListas;
let pararConferencias;
let renderPendente = 0;
let atualizarMapa = true;
const resumos = new Map();
const paginas = new Map();
const pesquisasCatalogo = new Map();
const filaCatalogos = [];
let catalogosEmCurso = 0;
let catalogos;
let listaDaLimpeza;
let conferenciaAberta;
let conferencias = [];
let erroConferencias = '';
let leituraImportacao = 0;
let leitorDauerAtivo;
const catalogosDaImportacao = new Map();
let importando = false;
let pausaImportacaoSolicitada = false;
let sessaoIniciada = false;
let pedidoInstalacao;
let toastTimer;
let historicoBipes;
const paginaHistoricoBipes = 50;

// ======= ACESSO E INICIALIZAÇÃO =======
observarAcesso();

function iniciar(){
  if(sessaoIniciada)return;
  sessaoIniciada = true;
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('chk-som').checked = somAtivo;
  document.getElementById('chk-notif').checked = notifAtivo;
  try{pausado = sessionStorage.getItem('blu_pausa_'+ME.uid)==='1';}catch{ /* A pausa continua disponível nesta aba. */ }
  iniciarPresenca();
  iniciarContinuidade();
  acompanharInatividade();
  setInterval(renderCronometroBipe,1000);
  ouvirOnline();
  document.getElementById('inp-bipe').addEventListener('focus',fecharCamera);
  document.getElementById('inp-bipe').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();if(!event.repeat)bipar();}
    if(event.key==='Escape')fecharAC();
  });
  document.getElementById('chat-inp').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();enviarChat();}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='F2'){ir('bipe');event.preventDefault();}
    if(event.key==='Escape'){
      if(cameraBipe)fecharCamera();
      else if(document.getElementById('app').classList.contains('menu-mobile-aberto'))fecharMenuBipe();
      else if(!document.fullscreenElement)sairTelaCheia();
    }
  });
  document.addEventListener('click',event=>{if(!event.target.closest('.bipe-wrap'))fecharAC();});
  const drop = document.getElementById('drop-area');
  drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('over');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
  drop.addEventListener('drop',event=>{
    event.preventDefault();
    drop.classList.remove('over');
    importar(event.dataTransfer.files);
  });
  setInterval(()=>{if(telaAtual==='bipe' && modoConferencia==='bipar')atualizarMetricas();},10000);
  document.addEventListener('visibilitychange',()=>sincronizarCronometroBipe());
  window.addEventListener('pagehide',()=>sincronizarCronometroBipe(false));
  window.addEventListener('pageshow',()=>sincronizarCronometroBipe());
  ir('ferramentas');
}

// ======= ONLINE =======
function iniciarPresenca(){
  const ref = db.collection('online').doc(ME.uid);
  const chave = 'blu_presenca_'+ME.uid;
  let enviando = false;
  let ultimoContexto = '';

  function abaAtiva(){
    return document.visibilityState==='visible' && navigator.onLine;
  }

  async function enviarPresenca(){
    if(enviando || !abaAtiva())return;
    const inicio = Date.now();
    const {listaId,sessaoId} = sessaoDePresenca();
    const contexto = listaId+'/'+sessaoId;
    const ultimo = Number(localStorage.getItem(chave))||0;
    if(contexto===ultimoContexto && inicio>=ultimo && inicio-ultimo<intervaloPresenca-1000)return;
    enviando = true;
    try{
      // Transações exigem conexão. Um sinal antigo não fica na fila offline.
      const gravou = await db.runTransaction(async tx=>{
        if(!abaAtiva() || Date.now()-inicio>=intervaloPresenca)return false;
        tx.set(ref,{nome:ME.nome,cor:ME.cor,uid:ME.uid,at:timestamp(),listaId,sessaoId});
        return true;
      });
      if(gravou){ultimoContexto = contexto;localStorage.setItem(chave,String(inicio));}
    }catch(erro){
      if(abaAtiva())console.warn('Presença indisponível:',mensagemErro(erro));
    }finally{
      enviando = false;
      const atual = sessaoDePresenca();
      if(contexto!==atual.listaId+'/'+atual.sessaoId)enviarPresenca();
    }
  }

  atualizarPresencaOperacional = enviarPresenca;
  enviarPresenca();
  setInterval(enviarPresenca,intervaloPresenca);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible')return;
    renderizarOnline();
    enviarPresenca();
  });
  window.addEventListener('online',enviarPresenca);
}

function sessaoDePresenca(){
  if(telaAtual!=='bipe' || modoConferencia!=='bipar' || pausado)return {listaId:'',sessaoId:''};
  const listaId = ME.listaAtiva||'';
  const sessaoId = ME.sessaoAtiva||ultimaRota?.item?.sessaoId||'';
  const sessao = abasBipe[listaId]?.sessoes[sessaoId];
  return {listaId,sessaoId:sessao && !sessao.excluindo?sessaoId:''};
}

function operadoresDaSessao(listaId,sessaoId,agora=Date.now()){
  if(!listaId || !sessaoId)return [];
  return Object.values(onlineUsers).filter(u=>u.uid!==ME.uid && u.listaId===listaId && u.sessaoId===sessaoId && dataMs(u.at)+validadePresenca>agora)
    .map(u=>txt(u.nome)).filter(Boolean);
}

function renderPresencaSessao(){
  const {listaId,sessaoId} = sessaoDePresenca();
  const pessoas = operadoresDaSessao(listaId,sessaoId);
  const aviso = document.getElementById('presenca-sessao');
  const texto = pessoas.length?'Também nesta sessão: '+pessoas.join(', '):'';
  if(aviso.textContent!==texto)aviso.textContent = texto;
  aviso.hidden = !texto;
}

function renderizarOnline(agora=Date.now()){
  clearTimeout(proximaExpiracao);
  const operadores = new Map();
  let primeiraExpiracao = Infinity;

  for(const u of Object.values(onlineUsers)){
    const instante = u.at?.toMillis?.();
    const nome = txt(u.nome);
    const expira = instante+validadePresenca;
    if(!nome || !Number.isFinite(instante) || expira<=agora)continue;
    primeiraExpiracao = Math.min(primeiraExpiracao,expira);
    const chave = u.uid || nomeNormalizado(nome);
    const grupo = operadores.get(chave);
    if(!grupo)operadores.set(chave,{nome,cor:u.cor,instante,quantidade:1});
    else{
      grupo.quantidade++;
      if(instante>grupo.instante)Object.assign(grupo,{nome,cor:u.cor,instante});
    }
  }

  const lista = [...operadores.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  document.getElementById('online-cnt').textContent = lista.length;
  document.getElementById('online-list').innerHTML = lista.map(u=>
    `<div class="online-user">
      <div class="avatar-sm" style="background:${corSegura(u.cor)}" aria-hidden="true">${esc(u.nome[0].toUpperCase())}</div>
      <span class="online-nome">${esc(u.nome)}</span>
      ${u.quantidade>1?`<span class="online-sessoes">${u.quantidade} sessões</span>`:''}
    </div>`
  ).join('');
  if(Number.isFinite(primeiraExpiracao)){
    proximaExpiracao = setTimeout(renderizarOnline,Math.max(1,primeiraExpiracao-agora));
  }
  if(telaAtual==='bipe'){
    renderPresencaSessao();
    const contexto = JSON.stringify(Object.values(onlineUsers).filter(u=>u.uid!==ME.uid && u.listaId===ME.listaAtiva &&
      u.sessaoId && dataMs(u.at)+validadePresenca>agora).map(u=>[u.uid,u.sessaoId,u.nome]));
    if(contexto!==contextoPresencaSessoes && !document.getElementById('sessoes-painel').hidden)renderSessoes();
    contextoPresencaSessoes = contexto;
  }
}

function ouvirOnline(){
  const corte = firebase.firestore.Timestamp.fromMillis(Date.now()-validadePresenca);
  db.collection('online').where('at','>=',corte).onSnapshot(snap=>{
    for(const {type,doc} of snap.docChanges()){
      if(type==='removed')delete onlineUsers[doc.id];
      else onlineUsers[doc.id] = doc.data();
    }
    renderizarOnline();
  },erro=>console.warn('Lista de presença indisponível:',mensagemErro(erro)));
}

// ======= BASE E LISTAS =======
function acompanharBase(necessaria){
  if(!necessaria){
    if(pararBase){pararBase();pararBase=null;baseMap=new Map();baseCarregada=false;agendarRender(true);}
    return;
  }
  if(pararBase)return;
  pararBase = db.collection('base').onSnapshot({includeMetadataChanges:true},snap=>{
    baseMap = new Map(snap.docs.map(doc=>[doc.id,doc.data()]));
    baseCarregada = !snap.metadata.fromCache;
    agendarRender(true);
  },erro=>{
    baseCarregada = false;
    pararBase = null;
    if(telaAtual==='base')toast('Base antiga: '+mensagemErro(erro));
    agendarRender();
  });
}

async function limparBase(){
  if(!exigirPermissao('admin'))return;
  try{
    await apagarColecao(db.collection('base'));
    registrarAuditoria('Base antiga limpa');
    toast('Base antiga limpa.');
  }catch(erro){toast(mensagemErro(erro));}
}

function prepararLista(id,dados){
  const atual = abasBipe[id] ||= {sessoes:{}};
  const mudou = atual.nome!==dados.nome || atual.excluindo!==dados.excluindo || atual.revisaoCatalogo!==dados.revisaoCatalogo;
  Object.assign(atual,dados,{revisaoAcompanhamento:dados.revisaoAcompanhamento});
  if(dados.excluindo)desmarcarLista(id);
  return mudou;
}

function pararSessoesDaLista(id){
  abaListeners.get(id)?.();
  abaListeners.delete(id);
  if(abasBipe[id]){
    abasBipe[id].sessoes = {};
    abasBipe[id].sessoesCarregadas = false;
    abasBipe[id].erroSessoes = '';
  }
  detalhesListas.delete(id);
  resumos.clear();
  atualizarMapa = true;
}

function retirarLista(id){
  pararSessoesDaLista(id);
  esquecerTotaisDaLista(id);
  delete abasBipe[id];
  desmarcarLista(id);
  if(chatAtivoId===id)abrirChat('geral','Chat Geral');
}

function desmarcarLista(id){
  if(ME.listaAtiva!==id)return;
  fecharCamera();
  encerrarTrechoBipagem();
  ME.listaAtiva = null;
  ME.sessaoAtiva = null;
  ultimaRota = null;
  previewRota = null;
  sincronizarCronometroBipe();
  sairTelaCheia();
  if(telaAtual==='bipe')ir('conferencia');
}

function acompanharVazias(lista){
  return !Number.isInteger(lista?.revisaoAcompanhamento) || lista.revisaoAcompanhamento!==(lista.revisao||0);
}

function acompanharListasDaTela(){
  const usaListas = ['conferencia','bipe','divergencias','importar','base','chat'].includes(telaAtual);
  if(usaListas)ouvirAbas();
  else if(pararListas){
    pararListas();
    pararListas = null;
    listasCarregadas = false;
  }
  const ids = new Set();
  if(telaAtual==='bipe')ids.add(ME.listaAtiva);
  if(telaAtual==='divergencias')ids.add(document.getElementById('revisao-lista').value);
  if(telaAtual==='importar')ids.add(document.getElementById('sel-lista-import').value);
  if(telaAtual==='base')for(const id of Object.keys(abasBipe))ids.add(id);
  for(const id of abaListeners.keys())if(!ids.has(id))pararSessoesDaLista(id);
  for(const id of detalhesListas.keys()){
    if(!ids.has(id) && !(telaAtual==='conferencia' && document.getElementById('conferencia-detalhes').open)){
      detalhesListas.delete(id);
      resumos.clear();
    }
  }
  for(const id of ids)if(abasBipe[id] && !abasBipe[id].excluindo && !abaListeners.has(id))ouvirSessoes(id);
  acompanharBase(telaAtual==='base'||[...ids].some(id=>Object.values(abasBipe[id]?.sessoes||{}).some(s=>!s.excluindo && !s.catalogo)));
}

function ouvirAbas(){
  if(pararListas)return;
  pararListas = db.collection('abas').onSnapshot({includeMetadataChanges:true},snap=>{
    const ativas = new Set();
    let mudou = false;
    for(const doc of snap.docs){
      const dados = doc.data();
      if(dados.finalizadaEm || dados.arquivadaEm)continue;
      ativas.add(doc.id);
      mudou = prepararLista(doc.id,dados) || mudou;
    }
    if(!snap.metadata.fromCache){
      for(const id of Object.keys(abasBipe)){
        if(!ativas.has(id)){retirarLista(id);mudou=true;}
      }
    }
    listasCarregadas = !snap.metadata.fromCache;
    document.getElementById('status-listas').textContent = listasCarregadas?'':'Aguardando conexão com o Firebase.';
    acompanharListasDaTela();
    agendarRender(mudou);
  },erro=>{
    listasCarregadas = false;
    document.getElementById('status-listas').textContent = mensagemErro(erro);
    agendarRender();
  });
}

function ouvirSessoes(listaId){
  const ref = listaRef(listaId).collection('sessoes');
  abaListeners.set(listaId,ref.onSnapshot({includeMetadataChanges:true},snap=>{
    const lista = abasBipe[listaId];
    if(!lista)return;
    const mudancas = snap.docChanges();
    if(mudancas.length)lista.revisaoItensPrevia = (lista.revisaoItensPrevia||0)+1;
    for(const change of mudancas){
      const id = change.doc.id;
      if(change.type==='removed'){
        delete lista.sessoes[id];
        if(ME.listaAtiva===listaId && ME.sessaoAtiva===id)ME.sessaoAtiva=null;
        continue;
      }
      const dados = change.doc.data();
      const sessao = lista.sessoes[id] ||= {itens:[]};
      const {catalogoInline,...metadados} = dados;
      Object.assign(sessao,metadados,{acompanharBipes:dados.acompanharBipes});
      if(dados.catalogo && sessao.versaoLida!==dados.catalogo && sessao.carregando!==dados.catalogo){
        carregarItensDaSessao(listaId,id,sessao,dados);
      }
    }
    lista.sessoesCarregadas = !snap.metadata.fromCache;
    lista.erroSessoes = '';
    acompanharListasDaTela();
    agendarRender(mudancas.length>0);
  },erro=>{
    if(abasBipe[listaId])abasBipe[listaId].erroSessoes = mensagemErro(erro);
    agendarRender();
  }));
}

function rodarFilaCatalogos(){
  while(catalogosEmCurso<6 && filaCatalogos.length){
    const {ler,resolver,rejeitar} = filaCatalogos.shift();
    catalogosEmCurso++;
    Promise.resolve().then(ler).then(resolver,rejeitar).finally(()=>{
      catalogosEmCurso--;
      rodarFilaCatalogos();
    });
  }
}

function itensDaSessao(listaId,id,dados){
  const versao = dados.catalogo;
  const local = abasBipe[listaId]?.sessoes[id];
  if(catalogosDaImportacao.has(versao))return catalogosDaImportacao.get(versao);
  if(local?.versaoLida===versao)return local.itens;
  const ler = ()=>lerCatalogoSessao(docSessao(listaId,id),dados);
  if(dados.catalogoInline?.versao===versao)return ler();
  const chave = JSON.stringify([listaId,id,versao]);
  if(!pesquisasCatalogo.has(chave)){
    const tarefa = new Promise((resolver,rejeitar)=>{
      filaCatalogos.push({ler,resolver,rejeitar});
      rodarFilaCatalogos();
    }).finally(()=>pesquisasCatalogo.delete(chave));
    pesquisasCatalogo.set(chave,tarefa);
  }
  return pesquisasCatalogo.get(chave);
}

async function carregarItensDaSessao(listaId,id,sessao,dados){
  const versao = sessao.catalogo;
  sessao.carregando = versao;
  sessao.erroCatalogo = '';
  sessao.itens = [];
  try{
    const itens = await itensDaSessao(listaId,id,dados);
    if(sessao.catalogo!==versao)return;
    sessao.itens = itens;
    sessao.versaoLida = versao;
  }catch(erro){
    if(sessao.catalogo===versao)sessao.erroCatalogo = mensagemErro(erro);
  }finally{
    if(sessao.carregando===versao)sessao.carregando = null;
    const lista = abasBipe[listaId];
    if(lista?.sessoes[id]===sessao){
      lista.revisaoItensPrevia = (lista.revisaoItensPrevia||0)+1;
      agendarRender(true);
    }
  }
}

function agendarRender(alterouCatalogo=false,alterouBipes=false){
  atualizarMapa ||= alterouCatalogo;
  if(alterouCatalogo||alterouBipes)resumos.clear();
  if(renderPendente)return;
  renderPendente = requestAnimationFrame(()=>{
    renderPendente = 0;
    if(telaAtual==='bipe'){
      atualizarEstadoBipe();
      renderSessoes();
      atualizarBadgeSessao();
      if(modoConferencia==='bipar'){
        renderHistorico(ME.listaAtiva);
        atualizarMetricas();
      }
      if(modoConferencia==='resumo')renderResumo();
    }
    if(telaAtual==='conferencia')renderDash();
    if(telaAtual==='divergencias')renderDivergencias();
    if(telaAtual==='base')renderBase();
    if(telaAtual==='chat')renderChatTabs();
    if(telaAtual==='importar' && !importando)atualizarSelectImport();
  });
}

function catalogosAtuais(){
  if(atualizarMapa){
    catalogos = montarCatalogos(abasBipe,baseMap);
    atualizarMapa = false;
  }
  return catalogos;
}

function resumoAtual(listaId){
  const chave = listaId||'';
  if(!resumos.has(chave)){
    const listas = listaId?
      {[listaId]:detalhesListas.get(listaId)?.lista||abasBipe[listaId]}:
      Object.fromEntries(Object.entries(abasBipe).map(([id,lista])=>[id,detalhesListas.get(id)?.lista||lista]));
    const validas = Object.fromEntries(Object.entries(listas).filter(([,lista])=>lista));
    const base = Object.values(validas).find(lista=>lista.baseLegada)?.baseLegada||baseMap;
    resumos.set(chave,dadosDoResumo(montarCatalogos(validas,base),validas,listaId));
  }
  return resumos.get(chave);
}

function paginar(id,linhas,tamanho,filtro=''){
  const el = document.getElementById(id);
  let estado = paginas.get(id);
  if(!estado || estado.filtro!==filtro){estado={pagina:0,filtro};paginas.set(id,estado);}
  const total = Math.max(1,Math.ceil(linhas.length/tamanho));
  estado.pagina = Math.min(total-1,estado.pagina);
  const inicio = estado.pagina*tamanho;
  el.hidden = total===1;
  if(!el.hidden){
    if(!el.children.length){
      el.innerHTML = '<button type="button" class="btn sec btn-sm">Anterior</button><span role="status"></span><button type="button" class="btn sec btn-sm">Próxima</button>';
      const redesenhar = {'pag-dash':renderDash,'pag-base':renderBase,'pag-resumo':renderResumo,'pag-sessoes':renderSessoes,'pag-previa':renderPreviaImportacao,'pag-divergencias':renderDivergencias,'pag-tcl':renderTcl,'pag-furos':renderFuros};
      const mudar = delta=>{const atual=paginas.get(id);atual.pagina=Math.max(0,atual.pagina+delta);redesenhar[id]();};
      el.children[0].onclick = ()=>mudar(-1);
      el.children[2].onclick = ()=>mudar(1);
    }
    el.children[0].disabled = estado.pagina===0;
    el.children[1].textContent = (inicio+1)+'–'+Math.min(inicio+tamanho,linhas.length)+' de '+linhas.length;
    el.children[2].disabled = estado.pagina===total-1;
  }
  return linhas.slice(inicio,inicio+tamanho);
}

function abrirNovaLista(){
  if(!exigirPermissao('supervisao'))return;
  if(!listasCarregadas){toast('Aguarde a conexão com o Firebase.');return;}
  document.getElementById('nova-lista-nome').value = '';
  document.getElementById('nova-lista-erro').textContent = '';
  document.getElementById('modal-nova-lista').style.display = 'flex';
  document.getElementById('nova-lista-nome').focus();
}

async function criarAba(event){
  event.preventDefault();
  if(!exigirPermissao('supervisao'))return;
  const nome = txt(document.getElementById('nova-lista-nome').value);
  if(!nome)return;
  const botao = document.getElementById('btn-criar-lista');
  const erroEl = document.getElementById('nova-lista-erro');
  if(botao.disabled)return;
  botao.disabled = true;
  erroEl.textContent = '';
  try{
    const ref = await criarListaNoBanco(nome);
    if(!abasBipe[ref.id]){
      prepararLista(ref.id,{nome,criadoPor:ME.nome,revisao:0,revisaoAcompanhamento:0,revisaoCatalogo:0,versoes:{},semBipesDiretosAntigos:true});
    }
    fecharModal('modal-nova-lista');
    selecionarLista(ref.id);
    registrarAuditoria('Lista '+nome+' criada');
    toast('Lista criada.');
  }catch(erro){erroEl.textContent=mensagemErro(erro);}
  finally{botao.disabled=false;}
}

function selecionarLista(id){
  historicoBipes = null;
  previewRota = null;
  const lista = abasBipe[id];
  if(!lista || lista.excluindo)return;
  const mudou = ME.listaAtiva!==id;
  if(mudou)encerrarTrechoBipagem();
  ME.listaAtiva = id;
  if(mudou){
    fecharCamera();
    erroCamera('');
    document.getElementById('buscar-sessoes').value = '';
    document.getElementById('filtro-sessoes').value = '';
    mostrarPainelSessoes(false);
    document.getElementById('hist-bipe').open = false;
    document.getElementById('progresso-detalhado').open = false;
  }
  ME.sessaoAtiva = null;
  ultimaRota = null;
  document.getElementById('msg-bipe').className = '';
  fecharAC();
  for(const id of ['f-titulo','f-status','f-secao'])document.getElementById(id).value = '';
  ir('bipe','escolha');
  document.getElementById('bipe-lista-nome').focus({preventScroll:true});
}

function alternarPainelSessoes(){
  mostrarPainelSessoes(document.getElementById('sessoes-painel').hidden);
}

function mostrarPainelSessoes(aberto){
  document.getElementById('sessoes-painel').hidden = !aberto;
  document.getElementById('btn-sessoes-lista').setAttribute('aria-expanded',String(aberto));
  if(aberto)renderSessoes();
}

function abrirModoConferencia(modo){
  if(!ME.listaAtiva)return;
  if(modo==='resumo' && modoConferencia!=='resumo' && ME.sessaoAtiva){
    const filtro = document.getElementById('f-secao');
    inserirSecoes(filtro,resumoAtual(ME.listaAtiva).rows,'Todas as sessões');
    filtro.value = abasBipe[ME.listaAtiva]?.sessoes[ME.sessaoAtiva]?.nome||'';
  }
  ir('bipe',modo);
  if(modo==='resumo' && !matchMedia('(pointer: coarse)').matches)document.getElementById('f-titulo').focus({preventScroll:true});
}

function selecionarSessao(id){
  historicoBipes = null;
  ME.sessaoAtiva = id;
  if(id)document.getElementById('hist-bipe').open = true;
  renderSessoes();
  renderHistorico(ME.listaAtiva);
  atualizarBadgeSessao();
  atualizarPresencaOperacional();
  renderPresencaSessao();
  if(modoConferencia==='resumo'){
    const filtro = document.getElementById('f-secao');
    inserirSecoes(filtro,resumoAtual(ME.listaAtiva).rows,'Todas as sessões');
    filtro.value = id?abasBipe[ME.listaAtiva]?.sessoes[id]?.nome||'':'';
    renderResumo();
  }
  if(modoConferencia==='bipar' && !matchMedia('(pointer: coarse)').matches)document.getElementById('inp-bipe').focus();
}

async function excluirAba(listaId){
  if(!exigirPermissao('admin'))return;
  const lista = abasBipe[listaId];
  if(!lista || exclusoesDeLista.has(listaId))return;
  const pergunta = lista.excluindo?'Retomar a exclusão de “'+lista.nome+'”?':
    'Excluir a lista “'+lista.nome+'”, suas sessões e seus bipes?';
  if(!confirm(pergunta))return;
  exclusoesDeLista.set(listaId,'Excluindo…');
  agendarRender();
  try{
    const excluida = await excluirListaNoBanco(listaId,(feitas,total)=>{
      exclusoesDeLista.set(listaId,'Excluindo '+feitas+'/'+total);
      agendarRender();
    });
    if(excluida)registrarAuditoria('Lista '+lista.nome+' excluída');
    toast(excluida?'Lista excluída.':'A lista já foi excluída.');
  }catch(erro){
    toast('Falha ao excluir a lista. '+mensagemErro(erro)+' Se aparecer Retomar exclusão, use o botão para continuar.');
  }finally{
    exclusoesDeLista.delete(listaId);
    agendarRender();
  }
}

async function excluirSessao(listaId,sessaoId){
  if(!exigirPermissao('admin'))return;
  const sessao = abasBipe[listaId]?.sessoes[sessaoId];
  if(!sessao || !confirm('Excluir a sessão “'+sessao.nome+'” e todas as suas bipagens?'))return;
  try{
    if(await excluirSessaoNoBanco(listaId,sessaoId)){
      registrarAuditoria('Sessão '+sessao.nome+' excluída');
      toast('Sessão excluída.');
    }
  }catch(erro){toast('Falha ao excluir a sessão. '+mensagemErro(erro));}
}

function renderAbas(){
  const ame = Object.entries(abasBipe);
  const nova = document.getElementById('conferencia-nova');
  nova.disabled = !listasCarregadas || ame.filter(([,l])=>!l.excluindo).length>=4;
  document.getElementById('listas-container').innerHTML = ame.map(([id,lista])=>{
    const total = getTotalBipesSessoes(id);
    const sessoes = lista.sessoesCarregadas?Object.values(lista.sessoes).filter(s=>!s.excluindo).length:
      (lista.versoes && lista.semBipesDiretosAntigos?Object.keys(lista.versoes).length:'—');
    const contexto = exclusoesDeLista.get(id)||(lista.excluindo?'Exclusão pendente':sessoes+' sessões · '+(total??'—')+' bipes');
    return `<article class="conferencia-cartao">
      <button class="nome-lista" type="button" onclick="selecionarLista(${arg(id)})" ${lista.excluindo?'disabled':''}>
        <strong>${esc(lista.nome)}</strong><small>${esc(contexto)}</small>
        ${lista.excluindo?'':`<span>${total?'Continuar conferência':'Abrir lista'} <span aria-hidden="true">→</span></span>`}
      </button>
      ${pode('admin')&&lista.excluindo?`<button class="btn sec btn-sm" onclick="excluirAba(${arg(id)})" ${exclusoesDeLista.has(id)?'disabled':''}>Retomar exclusão</button>`:''}
    </article>`;
  }).join('')||(listasCarregadas?'<p class="empty">Nenhuma lista ativa.</p>':'');
}

function getTotalBipesSessoes(listaId){return totalDaConferencia(listaId);}

function renderSessoes(){
  const lista = abasBipe[ME.listaAtiva];
  if(!lista)return;
  const sessoes = Object.entries(lista.sessoes);
  document.getElementById('sessoes-info').textContent = lista.sessoesCarregadas?sessoes.length+' sessões':'Carregando…';
  if(document.getElementById('sessoes-painel').hidden)return;
  const busca = textoDeBusca(document.getElementById('buscar-sessoes').value);
  const filtro = document.getElementById('filtro-sessoes').value;
  const divergencias = new Set();
  if(filtro==='divergencia'){
    const detalhes = pedirDetalhesDaLista(ME.listaAtiva);
    if(!detalhes?.lista){
      document.getElementById('sessoes-grid').textContent = detalhes?.erro||'Carregando divergências…';
      document.getElementById('pag-sessoes').hidden = true;
      return;
    }
    const {rows} = resumoAtual(ME.listaAtiva);
    for(const row of rows){
      if(row.status!=='OK' && row.status!=='PENDENTE')divergencias.add(nomeNormalizado(row.secao));
    }
  }
  let aguardandoTotais = false;
  const filtradas = sessoes.filter(([id,sessao])=>{
    if(busca && !textoDeBusca(sessao.nome).includes(busca))return false;
    if(filtro==='com-bipes' || filtro==='sem-bipes'){
      if(sessao.excluindo)return false;
      const total = totalDaConferencia(ME.listaAtiva,id);
      aguardandoTotais ||= total===null;
      return filtro==='com-bipes'?total>0:total===0;
    }
    if(filtro==='divergencia')return divergencias.has(nomeNormalizado(sessao.nome)) || catalogosAtuais().alertas.has(ME.listaAtiva+'/'+id);
    return true;
  }).sort(([,a],[,b])=>a.nome.localeCompare(b.nome,'pt-BR',{numeric:true}));
  document.getElementById('sessoes-grid').innerHTML = paginar('pag-sessoes',filtradas,48,JSON.stringify([ME.listaAtiva,busca,filtro])).map(([id,sessao])=>{
    const alerta = catalogosAtuais().alertas.has(ME.listaAtiva+'/'+id);
    const pessoas = operadoresDaSessao(ME.listaAtiva,id);
    const total = totalDaConferencia(ME.listaAtiva,id);
    return `<div class="sessao-chip ${ME.sessaoAtiva===id?'ativa':''} ${total>0?'tem-bipes':''}">
      <button class="filtro-sessao" onclick="selecionarSessao(${arg(id)})" ${sessao.excluindo?'disabled':''}>
        ${alerta?'<span class="sc-alert" aria-label="ISBN em alerta" title="ISBN em alerta"></span>':''}
        <span class="sc-nome">${esc(sessao.nome)}</span>
        <span class="sc-cnt">${total??'—'}</span>
        <span class="sc-label">${sessao.excluindo?'exclusão pendente':'bipes'}</span>
        ${pessoas.length?`<small class="sc-presenca">${esc(pessoas.join(', '))}</small>`:''}
      </button>
      ${pode('admin')?`<button class="sc-x" onclick="excluirSessao(${arg(ME.listaAtiva)},${arg(id)})" aria-label="${sessao.excluindo?'Concluir exclusão':'Excluir sessão'} ${esc(sessao.nome)}">×</button>`: ''}
    </div>`;
  }).join('')||'<p class="ajuda">'+(aguardandoTotais?'Consultando o total de bipes por sessão…':!lista.sessoesCarregadas?'Carregando sessões…':sessoes.length?'Nenhuma sessão encontrada para este filtro.':'Importe as planilhas Dauer para adicionar sessões.')+'</p>';
}

function catalogoPronto(lista){
  if(!listasCarregadas || !lista?.sessoesCarregadas || lista.excluindo)return false;
  const versoes = lista.versoes||{};
  if(Object.entries(versoes).some(([id,v])=>lista.sessoes[id]?.versaoLida!==v))return false;
  return Object.entries(lista.sessoes).every(([id,sessao])=>{
    if(sessao.excluindo)return !versoes[id];
    return sessao.catalogo ? versoes[id]===sessao.versaoLida && sessao.versaoLida===sessao.catalogo
      : baseCarregada && !versoes[id];
  });
}

function atualizarEstadoBipe(){
  renderDesfazerBipe();
  const lista = abasBipe[ME.listaAtiva];
  const disponivel = lista && !lista.excluindo;
  const bipando = disponivel && modoConferencia==='bipar';
  if(!bipando)fecharCamera();
  document.getElementById('sem-aba').hidden = Boolean(disponivel);
  document.getElementById('bipe-contexto').hidden = !disponivel;
  document.getElementById('bipe-lista-nome').textContent = disponivel?lista.nome:'';
  document.getElementById('conferencia-modos').hidden = !disponivel;
  document.getElementById('tela-bipe').dataset.modo = modoConferencia;
  document.querySelectorAll('#conferencia-modos button').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.modo===modoConferencia)));
  document.getElementById('com-aba').style.display = bipando?'block':'none';
  document.getElementById('tela-resumo').hidden = !disponivel || modoConferencia!=='resumo';
  if(!disponivel)mostrarPainelSessoes(false);
  for(const id of ['bipe-metricas','hist-bipe'])document.getElementById(id).hidden = !bipando;
  document.getElementById('btn-tela-cheia').hidden = telaAtual!=='bipe' || !bipando;
  const pronto = catalogoPronto(lista);
  const campo = document.getElementById('inp-bipe');
  const estavaBloqueado = campo.disabled;
  campo.disabled = !bipando;
  document.getElementById('btn-registrar-bipe').disabled = !bipando;
  document.getElementById('btn-camera').disabled = !bipando && !cameraBipe;
  sincronizarCronometroBipe();
  const finalizar = document.getElementById('btn-finalizar');
  finalizar.disabled = !pode('supervisao') || !pronto || Boolean(finalizar.dataset.carregando);
  const erro = lista?.erroSessoes || Object.values(lista?.sessoes||{}).find(s=>s.erroCatalogo)?.erroCatalogo;
  document.getElementById('status-bipe').textContent = !disponivel || pronto ? '' : erro||'Carregando sessões para a bipagem…';
  if(bipando && pronto && estavaBloqueado && telaAtual==='bipe' && !cameraBipe && !matchMedia('(pointer: coarse)').matches)campo.focus();
}

function atualizarBadgeSessao(rota=previewRota||ultimaRota){
  const lista = abasBipe[ME.listaAtiva];
  const badge = document.getElementById('sessao-badge');
  const filtroResumo = modoConferencia==='resumo'?document.getElementById('f-secao').value:'';
  if(modoConferencia!=='bipar')rota = null;
  const sessao = modoConferencia==='resumo'?
    Object.values(lista?.sessoes||{}).find(s=>s.nome===filtroResumo):
    lista?.sessoes[(rota && previewRota?.item?.sessaoId) || ME.sessaoAtiva || rota?.item?.sessaoId];
  const nome = sessao?.nome || filtroResumo || (rota?.status==='ALERTA'?'ISBN em conflito':rota?.status?'Sem sessão identificada':'Todas as sessões');
  badge.hidden = !lista || lista.excluindo || !nome;
  if(badge.hidden)return;
  document.getElementById('sb-sessao-nome').textContent = nome;
  const detalhe = document.getElementById('sb-sessao-cnt');
  const entrada = sessao && Object.entries(lista.sessoes).find(([,s])=>s===sessao);
  const total = entrada?totalDaConferencia(ME.listaAtiva,entrada[0]):null;
  detalhe.textContent = sessao?(total??'—')+' bipes':rota?.sessoes?.map(s=>s.secao).join(' · ')||'';
  badge.classList.toggle('com-alerta',rota?.status==='ALERTA');

}

function resultadoDoBipe(rota,codigo,{status,quantidade}){
  if(status==='ALERTA' && !rota.item){
    const nomes = rota.sessoes.map(s=>s.secao+(s.listaId!==ME.listaAtiva?' ('+s.lista+')':'')).join(', ');
    return ['alerta','ALERTA · '+codigo+' está cadastrado em mais de uma sessão: '+nomes+'. Bipe salvo sem sessão.'];
  }
  if(!rota.item){
    const outra = rota.sessoes.map(s=>s.lista+' / '+s.secao).join(', ');
    return ['erro',codigo+(outra?' pertence a '+outra+'.':' não foi encontrado na lista.')+' Bipe salvo sem sessão.'];
  }
  const prefixo = rota.item.titulo+' · '+rota.item.secao+' · '+quantidade+'/'+rota.item.qtd;
  if(status==='ALERTA')return ['alerta','ALERTA · ISBN repetido no arquivo: '+prefixo];
  if(status==='EXCEDIDO')return ['erro','EXCEDIDO · '+prefixo];
  return [status==='OK'?'ok':'aviso',prefixo];
}

function exibirResultadoBipe(elemento,classe,texto,rotulo){
  const situacao = document.createElement('strong');
  situacao.className = 'bipe-resultado-estado';
  situacao.textContent = rotulo;
  elemento.className = classe;
  elemento.replaceChildren(situacao,document.createTextNode(texto));
}

async function bipar(codigoCamera){
  const campo = document.getElementById('inp-bipe');
  const pelaCamera = typeof codigoCamera==='string';
  const codigo = codigoNormalizado(pelaCamera?codigoCamera:campo.value);
  const listaId = ME.listaAtiva;
  if(telaAtual!=='bipe' || modoConferencia!=='bipar' || !codigo || !abasBipe[listaId] || abasBipe[listaId].excluindo)return false;
  if(codigo.length>160){toast('O código excede 160 caracteres.');return false;}
  if(pausado){toast('Retome a conferência antes de bipar.');return false;}
  try{
    const evento = await guardarEventoLocal(listaId,'bipe',codigo);
    if(pelaCamera && cameraBipe?.listaId===listaId){
      cameraBipe.eventoPendente = evento.id;
      mostrarLeituraCamera(codigo,'pendente');
    }
  }catch(erro){
    exibirResultadoBipe(document.getElementById('msg-bipe'),'erro',mensagemErro(erro),'Leitura não armazenada');
    return false;
  }
  if(ME.listaAtiva===listaId && telaAtual==='bipe'){abriuTrechoBipagem = true;limiteVisualCronometro = undefined;}
  if(!pelaCamera && codigoNormalizado(campo.value)===codigo){
    campo.value = '';
    ativarAudioBipe();
    if(ME.listaAtiva===listaId && telaAtual==='bipe')campo.focus();
  }
  previewRota = null;
  fecharAC();
  if(ME.listaAtiva===listaId){
    ultimoBipeDesfazivel = null;
    renderDesfazerBipe();
    exibirResultadoBipe(document.getElementById('msg-bipe'),'aviso',codigo,'Pendente de sincronização');
  }
  atualizarFilaVisivel().catch(()=>{});
  sincronizarBipesPendentes();
  return true;
}

async function enviarBipePendente({id,listaId,codigo},lista,mapa){
    const rota = identificarSessao(mapa,listaId,codigo);
    rota.sessaoNova = Boolean(lista.sessoes[rota.item?.sessaoId]?.criadaNaFase2);
    if(rota.item)rota.diretosLegados = await quantidadeDiretaAntiga(listaId,lista,codigo);
    const registrado = await registrarBipeNoBanco(listaId,rota,codigo,lista.revisaoCatalogo||0,id);
    if(cameraBipe?.eventoPendente===id)mostrarLeituraCamera(codigo,'confirmado');
    if(registrado.duplicado)return;
    if(ME.listaAtiva===listaId && telaAtual==='bipe' && modoConferencia==='bipar'){
      ultimaRota = rota;
      if(ME.sessaoAtiva && ME.sessaoAtiva!==rota.item?.sessaoId)ME.sessaoAtiva=null;
      const el = document.getElementById('msg-bipe');
      const [classe,texto] = resultadoDoBipe(rota,codigo,registrado);
      const rotulos = {OK:'Exemplar registrado',PARCIAL:'Exemplar registrado',EXCEDIDO:'Quantidade excedida',
        ALERTA:'Divergência na localização', 'NÃO ENCONTRADO':'ISBN sem sessão nesta lista'};
      exibirResultadoBipe(el,classe,texto,rotulos[registrado.status]||'Exemplar registrado');
      ultimoBipeDesfazivel = {id,listaId,sessaoId:rota.item?.sessaoId||semSessaoId,ate:Date.now()+120000};
      renderDesfazerBipe();
      beep(classe==='alerta'?'erro':classe);
      atualizarBadgeSessao(previewRota||ultimaRota);
      renderPresencaSessao();
      atualizarPresencaOperacional();
      agendarRender();
    }
    registrarAuditoria('Bipe '+codigo+' · '+registrado.status+' · '+(rota.item?.secao||lista.nome));
    if(['EXCEDIDO','NÃO ENCONTRADO','ALERTA'].includes(registrado.status)){
      enviarMsgSistema(registrado.status+' · '+codigo+' · '+ME.nome,listaId).catch(console.warn);
    }
}

function renderDesfazerBipe(){
  const atual = ultimoBipeDesfazivel;
  const botao = document.getElementById('desfazer-bipe');
  clearTimeout(tempoDesfazerBipe);
  botao.hidden = !atual || atual.listaId!==ME.listaAtiva || modoConferencia!=='bipar' || atual.ate<=Date.now();
  if(!botao.hidden)tempoDesfazerBipe = setTimeout(renderDesfazerBipe,Math.max(1,atual.ate-Date.now()));
}

async function desfazerUltimoBipe(){
  const atual = ultimoBipeDesfazivel;
  const botao = document.getElementById('desfazer-bipe');
  if(!atual || botao.hidden || botao.disabled)return;
  botao.disabled = true;
  try{
    const desfeito = await removerBipeNoBanco(atual.listaId,atual.sessaoId,atual.id,true);
    if(ultimoBipeDesfazivel===atual){
      ultimoBipeDesfazivel = null;
      exibirResultadoBipe(document.getElementById('msg-bipe'),'aviso','A contagem da lista foi atualizada.',desfeito?'Bipe desfeito':'Bipe já removido');
    }
    if(desfeito){
      retirarLeituraDoHistorico(atual.listaId,atual.sessaoId,atual.id);
      registrarAuditoria('Último bipe desfeito · '+atual.id+' · '+atual.listaId);
    }
  }catch(erro){toast('Falha ao desfazer o bipe. '+mensagemErro(erro));}
  finally{botao.disabled = false;renderDesfazerBipe();}
}

async function removerBipe(listaId,sessaoId,bipeId){
  if(!exigirPermissao('supervisao'))return;
  try{
    if(await removerBipeNoBanco(listaId,sessaoId,bipeId)){
      retirarLeituraDoHistorico(listaId,sessaoId,bipeId);
      registrarAuditoria('Bipe removido');
    }
  }catch(erro){toast('Falha ao remover o bipe. '+mensagemErro(erro));}
}

function retirarLeituraDoHistorico(listaId,sessaoId,bipeId){
  if(historicoBipes?.listaId!==listaId)return;
  historicoBipes.registros = historicoBipes.registros.filter(bipe=>bipe.id!==bipeId || bipe.sessaoId!==sessaoId);
  agendarRender();
}

function renderHistorico(listaId){
  if(!document.getElementById('hist-bipe').open || telaAtual!=='bipe' || modoConferencia!=='bipar')return;
  const lista = abasBipe[listaId];
  const sessaoId = ME.sessaoAtiva||'';
  document.getElementById('btn-todos-bipes').hidden = !sessaoId;
  if(!lista)return;
  const chave = JSON.stringify([listaId,sessaoId]);
  if(historicoBipes?.chave!==chave){
    historicoBipes = {chave,listaId,sessaoId,registros:[]};
    lerPaginaHistorico(historicoBipes);
  }
  const estado = historicoBipes;
  if(estado.revisao!=null && !estado.pedido && !estado.erro && !estado.paginado && estado.revisao!==(lista.revisao||0))lerPaginaHistorico(estado);
  const total = totalDaConferencia(listaId,sessaoId);
  estado.temAntigos = !lista.semBipesDiretosAntigos && !estado.mais && !estado.consultouAntigos && Number.isInteger(total) && total>estado.registros.length;
  document.getElementById('cnt-bipe').textContent = (total??'—')+' bipes'+(sessaoId?' · '+(lista.sessoes[sessaoId]?.nome||''):'');
  document.getElementById('tb-bipe').innerHTML = estado.registros.map((b,i)=>{
    const op = txt(b.operador)||'—';
    const codigo = codigoNormalizado(b.codigo);
    const produtos = catalogosAtuais().porLista.get(listaId)?.get(codigo)||[];
    const item = produtos.find(p=>p.sessaoId===b.sessaoId)||produtos[0];
    const status = b.alerta?'ALERTA':b.resultado||(item?'Base':'NÃO ENCONTRADO');
    const hora = b.at?.toDate?.().toLocaleTimeString('pt-BR',{timeZone:fusoBlulivro})||'—';
    const param = [listaId,b.sessaoId,b.id].map(arg).join(',');
    const sessao = lista.sessoes[b.sessaoId]?.nome || (b.resultado?'Sem sessão identificada':'Bipagens antigas');
    return `<tr><td>${i+1}</td><td><code>${esc(codigo)}</code></td><td>${esc(item?.titulo||'—')}</td>
      <td>${esc(sessao)}</td><td><span class="avatar-sm" style="background:${corSegura(b.cor)}">${esc(op[0])}</span>${esc(op)}</td><td>${hora}</td>
      <td>${badgeStatus(status)}</td><td><button class="btn sec btn-sm" onclick="abrirDetalhe(${param})">${b.statusManual?'📝 ':''}Detalhe</button></td>
      <td>${pode('supervisao')?`<button class="btn-x" onclick="removerBipe(${param})" aria-label="Remover bipe">×</button>`: ''}</td></tr>`;
  }).join('')||'<tr><td colspan="9" class="empty">'+esc(estado.erro||(estado.pedido?'Carregando bipagens recentes…':'Nenhum bipe registrado.'))+'</td></tr>';
  const mais = document.getElementById('btn-mais-bipes');
  mais.hidden = !estado.mais && !estado.erro && !estado.temAntigos;
  mais.disabled = Boolean(estado.pedido);
  mais.textContent = estado.erro?'Tentar novamente':estado.mais?'Mostrar mais bipes':'Consultar leituras antigas';
}

function lerPaginaHistorico(estado,mais=false){
  if(estado.pedido)return;
  const {listaId,sessaoId} = estado;
  const revisao = abasBipe[listaId]?.revisao||0;
  estado.erro = '';
  if(!mais)estado.consultouAntigos = false;
  estado.pedido = consultarLeituras(listaId,{sessaoId,limite:paginaHistoricoBipes,cursor:mais?estado.cursor:null}).then(retorno=>{
    estado.registros = mais?[...estado.registros,...retorno.leituras]:retorno.leituras;
    estado.cursor = retorno.cursor;
    estado.mais = retorno.mais && Boolean(retorno.cursor);
    estado.paginado = mais;
    estado.revisao = revisao;
  }).catch(erro=>{estado.erro=mensagemErro(erro);}).finally(()=>{
    estado.pedido = null;
    if(historicoBipes===estado)agendarRender();
  });
}

function atualizarHistoricoBipes(){
  historicoBipes = null;
  renderHistorico(ME.listaAtiva);
}

function lerRegistrosSemHorario(estado){
  if(estado.pedido)return;
  estado.erro = '';
  estado.pedido = consultarLeituras(estado.listaId,{sessaoId:estado.sessaoId}).then(({leituras})=>{
    const existentes = new Set(estado.registros.map(b=>b.sessaoId+'/'+b.id));
    estado.registros.push(...leituras.filter(b=>!b.at && !existentes.has(b.sessaoId+'/'+b.id)));
    estado.consultouAntigos = true;
  }).catch(erro=>{estado.erro=mensagemErro(erro);}).finally(()=>{
    estado.pedido = null;
    if(historicoBipes===estado)agendarRender();
  });
}

function sugerirCodigos(){
  const codigo = codigoNormalizado(document.getElementById('inp-bipe').value);
  const dados = catalogosAtuais();
  const lista = dados.porLista.get(ME.listaAtiva);
  previewRota = lista?.has(codigo)?identificarSessao(dados,ME.listaAtiva,codigo):null;
  atualizarBadgeSessao(previewRota||ultimaRota);
  if(codigo.length<2 || !lista || previewRota){fecharAC();return;}
  const matches = [];
  for(const [k,itens] of lista){
    if(k.includes(codigo)||itens[0].titulo.toLocaleUpperCase('pt-BR').includes(codigo))matches.push(itens[0]);
    if(matches.length===6)break;
  }
  const el = document.getElementById('ac-list');
  el.innerHTML = matches.map(item=>`<button type="button" class="autocomplete-item" onclick="selecionarAC(${arg(item.codigo)})"><code>${esc(item.codigo)}</code>${esc(item.titulo)}</button>`).join('');
  el.style.display = matches.length?'block':'none';
}

function selecionarAC(codigo){
  document.getElementById('inp-bipe').value = codigo;
  bipar();
}

function fecharAC(){
  document.getElementById('ac-list').style.display = 'none';
}

function mostrarMaisBipes(){
  if(!historicoBipes)return;
  if(historicoBipes.temAntigos)lerRegistrosSemHorario(historicoBipes);
  else lerPaginaHistorico(historicoBipes,Boolean(historicoBipes.cursor));
  renderHistorico(ME.listaAtiva);
}

function checkboxesLimpeza(id,sessoes){
  document.getElementById(id).innerHTML = sessoes.map(([sid,sessao])=>
    `<label class="limpeza-item"><input type="checkbox" value="${esc(sid)}">
      <span class="li-nome">${esc(sessao.nome)}</span><span class="li-info">0 bipes</span></label>`).join('');
}

async function abrirLimpezaSessoes(){
  if(!exigirPermissao('admin'))return;
  const id = ME.listaAtiva;
  if(!id)return;
  try{
    const {documentos} = await carregarCatalogoServidor(id,{somenteMetadados:true});
    const vazias = (await mapearEmLotes(documentos.filter(doc=>!doc.get('excluindo')),6,async doc=>
      (await doc.ref.collection('bipes').limit(1).get(servidor)).empty?[doc.id,doc.data()]:null))
      .filter(Boolean).sort(([,a],[,b])=>a.nome.localeCompare(b.nome,'pt-BR',{numeric:true}));
    if(ME.listaAtiva!==id)return;
    if(!vazias.length){toast('Nenhuma sessão sem bipes nesta lista.');return;}
    listaDaLimpeza = id;
    checkboxesLimpeza('limpeza-lista',vazias);
    document.getElementById('modal-limpeza').style.display = 'flex';
  }catch(erro){toast(mensagemErro(erro));}
}

function selecionarTodasLimpeza(id='limpeza-lista'){
  document.getElementById(id).querySelectorAll('input[type=checkbox]').forEach(c=>{c.checked=true;});
}

function sessoesMarcadas(id){
  return Array.from(document.getElementById(id).querySelectorAll('input:checked'),input=>input.value);
}

async function executarLimpeza(){
  if(!exigirPermissao('admin'))return;
  const selecionadas = sessoesMarcadas('limpeza-lista');
  if(!selecionadas.length){toast('Marque as sessões que deseja excluir.');return;}
  if(!confirm('Excluir as '+selecionadas.length+' sessões marcadas?'))return;
  const botao = document.getElementById('btn-executar-limpeza');
  botao.disabled = true;
  try{
    const n = await limparSessoesNoBanco(listaDaLimpeza,selecionadas);
    fecharModal('modal-limpeza');
    registrarAuditoria('Sessões vazias excluídas: '+n);
    toast(n+' sessão(ões) excluída(s).'+(n<selecionadas.length?' As demais já mudaram ou receberam bipes.':''));
  }catch(erro){toast('Falha na limpeza. '+mensagemErro(erro));}
  finally{botao.disabled=false;}
}

function obterRelatorio(listaId,listas=abasBipe,mapa=catalogosAtuais()){
  const dados = dadosDoResumo(mapa,listas,listaId);
  const lista = listas[listaId];
  const sessoes = lista ? Object.values(lista.sessoes).filter(s=>!s.excluindo) : [];
  const totais = {...estatisticas(dados.rows),totalBipes:dados.bipes.length,totalProdutos:dados.totalProdutos,
    sessoes:sessoes.length,sessoesBipadas:sessoes.filter(s=>s.bipes.length).length};
  return {
    nome:lista?.nome||'Resumo geral',
    rows:dados.rows,
    totais,
    duracao:duracaoDosBipes(dados.bipes),
    ranking:rankingDosBipes(dados.bipes)
  };
}

function estatisticas(rows){
  const totais = {ok:0,problemas:0,pendentes:0,alertas:0,faltaUnidades:0};
  for(const linha of rows){
    if(linha.status==='OK')totais.ok++;
    else if(linha.status==='PENDENTE')totais.pendentes++;
    else totais.problemas++;
    if(linha.status==='ALERTA')totais.alertas++;
    if(linha.dif<0)totais.faltaUnidades -= linha.dif;
  }
  return totais;
}

function dataMs(data){
  return data?.toMillis?.() || 0;
}

function duracaoDosBipes(bipes){
  let primeiro = Infinity;
  let ultimo = 0;
  for(const bipe of bipes){
    const at = dataMs(bipe.at);
    if(at>0){
      primeiro = Math.min(primeiro,at);
      ultimo = Math.max(ultimo,at);
    }
  }
  return ultimo>0 ? ultimo-primeiro : 0;
}

function rankingDosBipes(bipes){
  const porOperador = new Map();
  for(const bipe of bipes){
    const nome = txt(bipe.operador)||'—';
    const chave = bipe.uid || nome;
    if(!porOperador.has(chave))porOperador.set(chave,{nome,cor:corSegura(bipe.cor),bipes:0});
    porOperador.get(chave).bipes++;
  }
  return [...porOperador.values()].sort((a,b)=>b.bipes-a.bipes || a.nome.localeCompare(b.nome,'pt-BR'));
}

function montarRelatorioDaLista(listaId,lista){
  const listas = {...abasBipe,[listaId]:lista};
  const relatorio = obterRelatorio(listaId,listas,montarCatalogos({[listaId]:lista},lista.baseLegada||baseMap));
  const {itens,totais} = agruparDivergencias(relatorio.rows,lista.revisoes);
  relatorio.totais.revisao = totais;
  relatorio.produtividade = agregarAtividade(lista.atividade,bipesDaLista(listaId,lista));
  for(const {linha,estado,revisao} of itens){
    linha.revisao = {estado,nota:revisao?.nota||'',autor:revisao?.autor||'',data:dataMs(revisao?.at)};
  }
  return relatorio;
}

function renderFim(lista,relatorio){
  const {totais,ranking,rows} = relatorio;
  const divergencias = rows.filter(row=>row.revisao);
  document.getElementById('fin-nome').textContent = relatorio.nome;
  document.getElementById('fin-revisao').textContent = textoDasRevisoes(totais.revisao);
  document.getElementById('fin-ver-revisao').hidden = !divergencias.length;
  document.getElementById('fin-mais').textContent = divergencias.length>50 ? '· primeiros 50' : '';
  document.getElementById('fin-grid').innerHTML = `
    <div class="fin-card fin-ok"><div class="fin-num">${totais.ok}</div><div class="fin-lab">Itens OK</div></div>
    <div class="fin-card fin-prob"><div class="fin-num">${totais.problemas}</div><div class="fin-lab">Com problema</div></div>
    <div class="fin-card fin-falta"><div class="fin-num">${totais.faltaUnidades}</div><div class="fin-lab">Exemplares faltando</div></div>
    <div class="fin-card fin-tempo"><div class="fin-num">${totais.sessoesBipadas}/${totais.sessoes}</div><div class="fin-lab">Sessões com bipes</div></div>`;
  document.getElementById('fin-ranking').innerHTML = ranking.map((op,i)=>`
    <div class="ranking-row"><span class="ranking-pos">${i+1}°</span>
      <span class="avatar-sm" style="background:${op.cor}">${esc(op.nome[0])}</span><span>${esc(op.nome)}</span>
      <div class="ranking-bar-wrap"><div class="ranking-bar" style="width:${Math.round(op.bipes*100/ranking[0].bipes)}%"></div></div>
      <strong>${op.bipes} bipes</strong>
    </div>`).join('')||'<p class="ajuda">Nenhum bipe registrado.</p>';
  document.getElementById('fin-problemas').innerHTML = divergencias.slice(0,50).map(r=>
    `<tr><td><code>${esc(r.codigo)}</code></td><td>${esc(r.titulo)}</td>
    <td>${badgeStatus(r.status)}<small class="subtabela">${estadosRevisao[r.revisao.estado].nome}</small></td><td>${formatarDif(r.dif)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Nenhuma divergência.</td></tr>';
  const vazias = Object.entries(lista.sessoes).filter(([,s])=>s.bipes.length===0)
    .sort(([,a],[,b])=>a.nome.localeCompare(b.nome,'pt-BR',{numeric:true}));
  document.getElementById('fin-limpeza').hidden = !pode('admin') || !vazias.length;
  checkboxesLimpeza('fin-limpeza-lista',vazias);
}

async function abrirFinalizar(){
  if(!exigirPermissao('supervisao'))return;
  fecharCamera();
  const listaId = ME.listaAtiva;
  if(!listaId)return;
  const botao = document.getElementById('btn-finalizar');
  if(botao.dataset.carregando)return;
  botao.dataset.carregando = '1';
  botao.disabled = true;
  try{
    await verificarFilaFechamento(listaId);
    const lista = await carregarConferencia(listaId);
    if(ME.listaAtiva!==listaId)return;
    const relatorio = montarRelatorioDaLista(listaId,lista);
    conferenciaAberta = {listaId,relatorio};
    renderFim(lista,relatorio);
    document.getElementById('modal-finalizar').style.display = 'flex';
  }catch(erro){toast('Falha ao carregar a conferência. '+mensagemErro(erro));}
  finally{
    delete botao.dataset.carregando;
    atualizarEstadoBipe();
  }
}

async function salvarConferencia(){
  if(!exigirPermissao('supervisao'))return;
  if(!conferenciaAberta)return;
  const {listaId} = conferenciaAberta;
  const remover = pode('admin')?sessoesMarcadas('fin-limpeza-lista'):[];
  const botao = document.getElementById('btn-salvar-conferencia');
  botao.disabled = true;
  let removidas = 0;
  try{
    await verificarFilaFechamento(listaId);
    let lista = await carregarConferencia(listaId);
    let relatorio = montarRelatorioDaLista(listaId,lista);
    const pendentes = pendenciasDoFechamento(relatorio);
    if(pendentes.size && !confirm(`A conferência tem ${pendentes.size} divergência(s) em aberto. Finalizar assim mesmo?`)){
      conferenciaAberta = {listaId,relatorio};
      renderFim(lista,relatorio);
      return;
    }
    if(remover.length){
      removidas = await limparSessoesNoBanco(listaId,remover);
      lista = await carregarConferencia(listaId);
      relatorio = montarRelatorioDaLista(listaId,lista);
      const novasPendencias = [...pendenciasDoFechamento(relatorio)].some(chave=>!pendentes.has(chave));
      if(novasPendencias){
        conferenciaAberta = {listaId,relatorio};
        renderFim(lista,relatorio);
        toast('As pendências mudaram. Confira o resultado atualizado antes de finalizar.');
        return;
      }
    }
    const mudou = JSON.stringify(relatorio.rows)!==JSON.stringify(conferenciaAberta.relatorio.rows);
    await guardarConferencia(listaId,{...relatorio,sessoesRemovidas:removidas},lista.revisao||0);
    botao.disabled = false;
    fecharModal('modal-finalizar');
    conferenciaAberta = null;
    registrarAuditoria('Conferência '+lista.nome+' finalizada');
    ir('conferencias');
    toast('Conferência salva.'+(remover.length?' '+removidas+' sessão(ões) excluída(s).':'')+
      (removidas<remover.length?' Sessões com novos bipes foram preservadas.':mudou&&!removidas?' O relatório inclui as últimas bipagens.':''));
  }catch(erro){
    toast((removidas?removidas+' sessão(ões) já excluída(s). ':'')+'Falha ao salvar. '+mensagemErro(erro));
    try{
      const lista = await carregarConferencia(listaId);
      conferenciaAberta = {listaId,relatorio:montarRelatorioDaLista(listaId,lista)};
      renderFim(lista,conferenciaAberta.relatorio);
    }catch(atualizacao){console.warn(atualizacao);}
  }finally{botao.disabled=false;}
}

function pendenciasDoFechamento(relatorio){
  return new Set(relatorio.rows.filter(row=>row.revisao && row.revisao.estado!=='resolvida')
    .map(row=>JSON.stringify([row.chaveRevisao,dadosOriginaisDivergencia(row),row.revisao.estado])));
}

function ouvirConferencias(){
  if(pararConferencias)return;
  pararConferencias = db.collection('conferencias').orderBy('finalizadaEm','desc').onSnapshot({includeMetadataChanges:true},snap=>{
    conferencias = snap.docs.filter(doc=>!doc.metadata.hasPendingWrites && doc.id!==idControleListas && doc.get('totais'))
      .map(doc=>({id:doc.id,...doc.data()}));
    erroConferencias = '';
    renderConferencias();
    renderSemanas();
  },erro=>{
    erroConferencias = mensagemErro(erro);
    renderConferencias();
    renderSemanas();
  });
}

function acompanharHistoricoDeConferencias(){
  const precisa = telaAtual==='conferencias' ||
    (telaAtual==='conferencia' && document.getElementById('conferencia-detalhes').open);
  if(precisa)ouvirConferencias();
  else if(pararConferencias){pararConferencias();pararConferencias=null;}
}

function acompanharDetalhesDaVisaoGeral(forcar=false){
  if(telaAtual!=='conferencia')return;
  acompanharHistoricoDeConferencias();
  acompanharListasDaTela();
  if(forcar)for(const [id,lista] of Object.entries(abasBipe))if(!lista.excluindo)pedirDetalhesDaLista(id,true);
  agendarRender();
}

function renderConferencias(){
  document.getElementById('tb-conferencias').innerHTML = conferencias.map(conf=>`
    <tr><td>${esc(conf.nome)}</td><td>${conf.finalizadaEm ? dataBr.format(conf.finalizadaEm.toDate()) : '—'}</td>
    <td>${esc(conf.finalizadaPor)}</td><td>${conf.totais.sessoesBipadas}/${conf.totais.sessoes}</td><td>${conf.totais.totalBipes}</td>
    <td><div class="row-btn">
      <button class="btn btn-sm" onclick="exportarHistorico(${arg(conf.id)},'xlsx',this)">↓ Excel</button>
      <button class="btn btn-sm sec" onclick="exportarHistorico(${arg(conf.id)},'pdf',this)">↓ PDF</button>
    </div></td></tr>`).join('') ||
    `<tr><td class="empty" colspan="6">${esc(erroConferencias||'Nenhuma conferência finalizada.')}</td></tr>`;
}

function semanaDe(data){
  const dia = new Date(diaArquivo.format(data)+'T00:00:00Z');
  dia.setUTCDate(dia.getUTCDate()-((dia.getUTCDay()+6)%7));
  return dia;
}

function renderSemanas(){
  const el = document.getElementById('dash-semanas');
  if(erroConferencias){
    el.textContent = erroConferencias;
    return;
  }
  const semana = semanaDe(new Date());
  const ultimas = Array.from({length:8},(_,i)=>{
    const inicio = new Date(semana);
    inicio.setUTCDate(inicio.getUTCDate()-(7-i)*7);
    return {inicio,bipes:0};
  });
  const indice = new Map(ultimas.map(s=>[+s.inicio,s]));
  for(const conf of conferencias){
    if(!conf.finalizadaEm)continue;
    const s = indice.get(+semanaDe(conf.finalizadaEm.toDate()));
    if(s)s.bipes += conf.totais.totalBipes;
  }
  const max = Math.max(1,...ultimas.map(s=>s.bipes));
  const diaMes = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
  el.innerHTML = ultimas.map(s=>`
    <div class="semana-coluna" aria-label="Semana de ${diaMes.format(s.inicio)}, ${s.bipes} bipes">
      <strong>${s.bipes.toLocaleString('pt-BR')}</strong>
      <div class="semana-trilho"><div class="semana-barra" style="height:${s.bipes*100/max}%"></div></div>
      ${diaMes.format(s.inicio)}
    </div>`).join('');
}
// ======= MODAL DETALHES =======
async function abrirDetalhe(listaId,sessaoId,bipeId){
  const pedido = {listaId,sessaoId,bipeId};
  modalBipeAtual = pedido;
  let consulta;
  try{consulta = await bipesRef(listaId,sessaoId).doc(bipeId).get(servidor);}
  catch(erro){toast(mensagemErro(erro));return;}
  if(modalBipeAtual!==pedido || ME.listaAtiva!==listaId || telaAtual!=='bipe')return;
  if(!consulta.exists){toast('Este bipe já foi removido.');return;}
  const bipe = consulta.data();
  const sessao = abasBipe[listaId]?.sessoes[sessaoId];
  const produtos = catalogosAtuais().porLista.get(listaId)?.get(codigoNormalizado(bipe.codigo))||[];
  const item = produtos.find(p=>p.sessaoId===sessaoId)||produtos[0];
  document.getElementById('modal-detalhe-info').innerHTML=
    `<b>${esc(bipe.codigo)}</b> — ${esc(item?.titulo||'Não encontrado na base')}<br>
     Sessão: ${esc(sessao?.nome||'—')} · Operador: ${esc(bipe.operador)} · Hora: ${bipe.at?.toDate?bipe.at.toDate().toLocaleTimeString('pt-BR',{timeZone:fusoBlulivro}):'—'}
     ${bipe.alerta?'<br><span style="color:var(--alert-txt);font-weight:700">⚠ ALERTA: ISBN DUPLICADO ENTRE SESSÕES</span>':''}`;
  document.getElementById('modal-comentario').value=bipe.comentario||'';
  modalStatusSel=bipe.statusManual||'';
  document.querySelectorAll('.status-pill').forEach(p=>{
    p.className='status-pill';
    if(p.dataset.val===modalStatusSel)p.classList.add('sel-'+modalStatusSel.toLowerCase());
  });
  const prev=document.getElementById('foto-preview');
  if(bipe.foto){prev.src=bipe.foto;prev.style.display='block';}
  else{prev.style.display='none';prev.src='';}
  ajustarEdicaoDeBipe();
  document.getElementById('modal-detalhe').style.display='flex';
}

function selecionarStatusPill(el,val){
  modalStatusSel=modalStatusSel===val?'':val;
  document.querySelectorAll('.status-pill').forEach(p=>{p.className='status-pill';});
  if(modalStatusSel)el.classList.add('sel-'+val.toLowerCase());
}

function previewFoto(input){
  const file=input.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{const prev=document.getElementById('foto-preview');prev.src=e.target.result;prev.style.display='block';};
  reader.readAsDataURL(file);
}

function ajustarEdicaoDeBipe(){
  const editar = pode('supervisao');
  document.getElementById('btn-pedir-recontagem').hidden = editar;
  document.getElementById('modal-comentario').readOnly = !editar;
  document.getElementById('inp-foto').disabled = !editar;
}

async function salvarDetalhe(solicitar=false){
  if(!solicitar && !exigirPermissao('supervisao'))return;
  if(!modalBipeAtual)return;
  const {listaId,sessaoId,bipeId}=modalBipeAtual;
  const comentario=document.getElementById('modal-comentario').value.trim();
  const foto=document.getElementById('foto-preview').src||'';
  const statusManual = solicitar?'Recontagem':modalStatusSel;

  try{
    const lista = listaRef(listaId);
    const ref = bipesRef(listaId,sessaoId).doc(bipeId);
    await db.runTransaction(async tx=>{
      const pai = await tx.get(lista);
      listaAberta(pai);
      if(sessaoId!==semSessaoId){
        const sessao = await tx.get(docSessao(listaId,sessaoId));
        if(!sessao.exists || sessao.get('excluindo'))throw new Error('A sessão está em exclusão.');
      }
      const bipe = await tx.get(ref);
      if(!bipe.exists)throw new Error('Este bipe foi removido.');
      if((bipe.get('statusManual')==='Recontagem')!==(statusManual==='Recontagem'))tx.update(lista,avancarRevisao(pai));
      tx.update(ref,solicitar?{statusManual}:{comentario,statusManual,foto:foto.startsWith('data:')?foto:''});
    });
    registrarAuditoria((solicitar?'Recontagem solicitada para o bipe ':'Detalhe salvo em bipe ')+bipeId);
    fecharModal('modal-detalhe');
    toast(solicitar?'Recontagem solicitada.':'Detalhe salvo.');
  }catch(erro){toast('Falha ao salvar o detalhe. '+mensagemErro(erro));}
}

function fecharModal(id){
  if(id==='modal-finalizar' && document.getElementById('btn-salvar-conferencia').disabled)return;
  document.getElementById(id).style.display='none';
}
function formatarTempo(ms){
  if(ms<=0)return'0min';
  const h=Math.floor(ms/3600000);const m=Math.floor((ms%3600000)/60000);
  if(h>0)return`${h}h ${m}min`;return`${m}min`;
}

// ======= CRONÔMETRO DA BIPAGEM =======
let abriuTrechoBipagem = false;
let limiteVisualCronometro;

function encerrarTrechoBipagem(){
  if(!abriuTrechoBipagem)return;
  abriuTrechoBipagem = false;
  limiteVisualCronometro = Date.now();
  return registrarParada(ME.listaAtiva);
}

function renderCronometroBipe(){
  if(telaAtual!=='bipe' || !ME.listaAtiva)return;
  const medicao = indicadorAtividade;
  const agora = limiteVisualCronometro??Date.now();
  const ativo = totalAtivo(medicao,agora);
  const segundos = Math.floor(ativo/1000);
  const valor = [Math.floor(segundos/3600),Math.floor(segundos/60)%60,segundos%60]
    .map(n=>String(n).padStart(2,'0')).join(':');
  for(const id of ['cronometro-valor','dur-sessao']){
    const el = document.getElementById(id);
    if(el.textContent!==valor)el.textContent = valor;
  }
  const ritmo = ativo?medicao.bipes*60000/ativo:0;
  document.getElementById('vel-ativo').textContent = ritmo.toLocaleString('pt-BR',{maximumFractionDigits:1});
  const rodando = medicao.ultimo!==null && agora-medicao.ultimo<toleranciaBipagem;
  document.getElementById('cronometro-estado').textContent = pausado?'Pausado':rodando?'Tempo ativo':'Aguardando bipagem';
}

function sincronizarCronometroBipe(permitir=true){
  const listaId = ME.listaAtiva;
  const visivel = telaAtual==='bipe' && modoConferencia==='bipar' && abasBipe[listaId] && !abasBipe[listaId].excluindo;
  const painel = document.getElementById('bipe-cronometro');
  painel.hidden = !visivel;
  if(!permitir || document.hidden || !visivel)encerrarTrechoBipagem();
  if(!visivel)return;
  if(listaAtividade!==listaId)limiteVisualCronometro = undefined;
  observarAtividade(listaId);
  recalcularAtividade();
  painel.dataset.pausado = String(pausado);
  document.getElementById('btn-pausa').textContent = pausado?'Retomar':'Pausar';
  document.getElementById('btn-pausa').disabled = false;
  renderCronometroBipe();
}

function togglePausa(){
  pausado = !pausado;
  if(pausado){fecharCamera();encerrarTrechoBipagem();}
  try{sessionStorage.setItem('blu_pausa_'+ME.uid,pausado?'1':'0');}catch{ /* Mantém o estado em memória. */ }
  sincronizarCronometroBipe();
  atualizarPresencaOperacional();
  renderPresencaSessao();
  const mensagem = pausado?'Conferência pausada.':'Conferência retomada.';
  toast(mensagem);
  registrarAuditoria(mensagem);
}

// ======= CHAT =======
function encerrarChat(){
  for(const id of Object.keys(chatListeners)){chatListeners[id]();delete chatListeners[id];}
  document.getElementById('chat-msgs').replaceChildren();
}

function ouvirChat(id){
  if(chatListeners[id])return;
  let recebeuDoServidor = false;
  chatListeners[id] = db.collection('chats').doc(id).collection('msgs')
    .orderBy('at','asc').onSnapshot({includeMetadataChanges:true},snap=>{
      if(telaAtual!=='chat' || id!==chatAtivoId)return;
      const alteracoes = snap.docChanges();
      if(alteracoes.length){
        const mensagens = document.createDocumentFragment();
        for(const doc of snap.docs)mensagens.append(criarMensagemChat(doc.data()));
        const painel = document.getElementById('chat-msgs');
        painel.replaceChildren(mensagens);
        painel.scrollTop = painel.scrollHeight;
      }
      if(recebeuDoServidor && !snap.metadata.fromCache){
        for(const {type,doc} of alteracoes){
          const msg = doc.data();
          if(type==='added' && msg.uid!==ME.uid && !msg.sistema)notificar(msg);
        }
      }
      recebeuDoServidor ||= !snap.metadata.fromCache;
    },erro=>{document.getElementById('chat-msgs').textContent=mensagemErro(erro);});
}

function criarMensagemChat(msg){
  const isMeu=msg.uid===ME.uid;const div=document.createElement('div');
  div.className='chat-msg'+(isMeu?' meu':'')+(msg.sistema?' sistema':'');
  if(!msg.sistema){
    div.innerHTML=`<div class="chat-autor" style="color:${corSegura(msg.cor)}">${esc(msg.nome)}</div>
      <div class="chat-texto">${esc(msg.texto)}</div>
      <div class="chat-hora">${msg.at?.toDate?msg.at.toDate().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:fusoBlulivro}):''}</div>`;
  }else div.innerHTML=`<div class="chat-texto">${esc(msg.texto)}</div>`;
  return div;
}

async function enviarChat(){
  const inp=document.getElementById('chat-inp');const txt=inp.value.trim();inp.value='';if(!txt)return;
  await db.collection('chats').doc(chatAtivoId).collection('msgs').add({
    texto:txt,nome:ME.nome,cor:ME.cor,uid:ME.uid,at:firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function enviarMsgSistema(txt,chatId){
  const data={texto:txt,sistema:true,uid:ME.uid,at:firebase.firestore.FieldValue.serverTimestamp()};
  await db.collection('chats').doc(chatId).collection('msgs').add(data);
  if(chatId!=='geral')await db.collection('chats').doc('geral').collection('msgs').add(data);
}

function abrirChat(id,nome){
  encerrarChat();
  chatAtivoId = id;
  document.getElementById('chat-titulo').textContent = nome||'Chat Geral';
  if(telaAtual==='chat')renderChatTabs();
}

async function limparChat(){
  if(!exigirPermissao('admin'))return;
  if(!confirm('Apagar histórico deste chat?'))return;
  const chat = chatAtivoId;
  try{
    await apagarColecao(db.collection('chats').doc(chat).collection('msgs'));
    if(chatAtivoId===chat)document.getElementById('chat-msgs').innerHTML='';
    registrarAuditoria(`Chat "${chat}" limpo`);
  }catch(erro){toast(mensagemErro(erro));}
}

function renderChatTabs(){
  const abas = Object.entries(abasBipe).filter(([,aba])=>!aba.excluindo);
  if(listasCarregadas && chatAtivoId!=='geral' && !abas.some(([id])=>id===chatAtivoId)){
    encerrarChat();
    chatAtivoId = 'geral';
    document.getElementById('chat-titulo').textContent = 'Chat Geral';
  }
  const tabs = document.getElementById('chat-tabs');
  const fonte = [['geral','Chat Geral','💬 Geral'],...abas.map(([id,aba])=>[id,aba.nome,'📋 '+aba.nome])].map(([id,nome,rotulo])=>
    `<button type="button" class="chat-tab ${chatAtivoId===id?'ativo':''}" onclick="abrirChat(${arg(id)},${arg(nome)})">${esc(rotulo)}</button>`
  ).join('');
  if(tabs.fonte!==fonte){tabs.fonte=fonte;tabs.innerHTML=fonte;}
  ouvirChat(chatAtivoId);
}

// ======= RESUMO E VISÃO GERAL =======
function badgeStatus(status){
  const classes = {OK:'b-ok',Base:'b-ok',FALTANDO:'b-falta',PARCIAL:'b-falta',EXCEDIDO:'b-ex',
    'NÃO ENCONTRADO':'b-na',PENDENTE:'b-pend',ALERTA:'b-alert'};
  return '<span class="badge '+(classes[status]||'')+'">'+esc(status)+'</span>';
}

function formatarDif(valor){
  return valor===null?'—':(valor>0?'+':'')+valor;
}

function inserirSecoes(select,rows,rotulo='Todas as seções'){
  if(select.fonteSecoes===rows)return;
  select.fonteSecoes = rows;
  const atual = select.value;
  const secoes = [...new Set(rows.map(row=>row.secao))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  select.innerHTML = `<option value="">${rotulo}</option>`+
    secoes.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if(secoes.includes(atual))select.value = atual;
}

function filtrosDoResumo(){
  const q = document.getElementById('f-titulo').value.trim().toLocaleLowerCase('pt-BR');
  const status = document.getElementById('f-status').value;
  const secao = document.getElementById('f-secao').value;
  return {q,status,secao};
}

function filtrarResumo(rows,{q,status,secao}=filtrosDoResumo()){
  return rows.filter(r=>(!q || [r.titulo,r.codigo,r.lista].some(s=>s.toLocaleLowerCase('pt-BR').includes(q)))
    && (!status || r.status===status) && (!secao || r.secao===secao));
}

function textoDosDetalhes(id,estado){
  if(estado?.pedido)return 'Consultando bipagens…';
  if(estado?.erro)return estado.erro;
  if(detalhesDesatualizados(id,estado))return 'A lista mudou. Atualize para consultar a última contagem.';
  return '';
}

function renderResumo(){
  if(!abasBipe[ME.listaAtiva])return;
  const detalhes = pedirDetalhesDaLista(ME.listaAtiva);
  document.getElementById('resumo-detalhes-status').textContent = textoDosDetalhes(ME.listaAtiva,detalhes);
  if(!detalhes?.lista){
    document.getElementById('triagem-isbns').hidden = true;
    document.getElementById('tb-resumo').replaceChildren();
    document.getElementById('pag-resumo').hidden = true;
    return;
  }
  const dados = resumoAtual(ME.listaAtiva);
  const filtro = document.getElementById('f-secao');
  const primeiraExibicao = filtro.listaDosDetalhes!==ME.listaAtiva || !filtro.fonteSecoes?.length;
  filtro.listaDosDetalhes = ME.listaAtiva;
  renderTriagemIsbns(dados.rows);
  inserirSecoes(filtro,dados.rows,'Todas as sessões');
  if(primeiraExibicao && ME.sessaoAtiva)filtro.value = abasBipe[ME.listaAtiva].sessoes[ME.sessaoAtiva]?.nome||'';
  atualizarBadgeSessao();
  const rows = filtrarResumo(dados.rows);
  document.getElementById('tb-resumo').innerHTML = paginar('pag-resumo',rows,100,JSON.stringify([ME.listaAtiva,...['f-titulo','f-status','f-secao'].map(id=>document.getElementById(id).value)])).map(r=>`
    <tr role="row" class="resumo-produto">
      <td role="cell" class="resumo-codigo"><code>${esc(r.codigo)}</code></td>
      <td role="cell" class="resumo-titulo">${esc(r.titulo)}</td>
      <td role="cell" class="resumo-sessao">${esc(r.secao)}</td>
      <td role="cell" class="resumo-quantidade"><small aria-hidden="true">Esperado</small>${r.esperado??'—'}</td>
      <td role="cell" class="resumo-quantidade"><small aria-hidden="true">Bipado</small>${r.bipado}</td>
      <td role="cell" class="resumo-quantidade"><small aria-hidden="true">Diferença</small>${formatarDif(r.dif)}</td>
      <td role="cell" class="resumo-status">${badgeStatus(r.status)}</td>
    </tr>`).join('')||'<tr role="row"><td role="cell" colspan="7" class="empty">Nenhum resultado.</td></tr>';
}

function renderBase(){
  const q = document.getElementById('f-base').value.trim().toLocaleLowerCase('pt-BR');
  const sel = document.getElementById('f-secao-base');
  const itens = catalogosAtuais().itens;
  inserirSecoes(sel,itens);
  const rows = itens.filter(r=>(!sel.value||r.secao===sel.value) &&
    (!q || [r.titulo,r.codigo,r.lista].some(s=>s.toLocaleLowerCase('pt-BR').includes(q))));
  document.getElementById('cnt-base').textContent = rows.length+' de '+itens.length+' produto(s)';
  document.getElementById('tb-base').innerHTML = paginar('pag-base',rows,100,JSON.stringify([q,sel.value])).map(r=>`
    <tr><td><code>${esc(r.codigo)}</code></td><td>${esc(r.titulo)}${r.duplicado||r.repetido?' '+badgeStatus('ALERTA'):''}</td>
    <td>${r.qtd??'—'}</td><td>${esc(r.secao)}${r.lista?'<small class="subtabela">'+esc(r.lista)+'</small>':''}</td></tr>`
  ).join('')||'<tr><td colspan="4" class="empty">Base vazia.</td></tr>';
}

function renderDash(){
  renderAbas();
  const ids = Object.keys(abasBipe).filter(id=>!abasBipe[id].excluindo);
  const totais = ids.map(id=>totalDaConferencia(id));
  const exibirKpis = kpis=>{
    document.getElementById('kpis').innerHTML = kpis.map(([label,total,classe])=>
      `<div class="kpi ${classe}"><div class="num">${total}</div><div class="lab">${label}</div></div>`).join('');
  };
  const basicos = [['Listas ativas',ids.length,'c-tot'],['Total bipes',totais.every(Number.isInteger)?totais.reduce((a,b)=>a+b,0):'—','c-bip']];
  if(!document.getElementById('conferencia-detalhes').open){exibirKpis(basicos);return;}
  const estados = ids.map(id=>pedirDetalhesDaLista(id));
  const avisos = [...new Set(estados.map((estado,i)=>textoDosDetalhes(ids[i],estado)).filter(Boolean))];
  document.getElementById('dash-detalhes-status').textContent = avisos.join(' ');
  if(estados.some(estado=>!estado?.lista)){
    exibirKpis(basicos);
    document.getElementById('dash-status').replaceChildren();
    document.getElementById('dash-secoes').replaceChildren();
    document.getElementById('pag-dash').hidden = true;
    return;
  }
  const {rows,totalProdutos} = resumoAtual();
  const quantidade = status=>rows.filter(r=>r.status===status).length;
  const {ok,pendentes,alertas} = estatisticas(rows);
  const falta = pendentes+quantidade('FALTANDO');
  const ex = quantidade('EXCEDIDO');
  const na = quantidade('NÃO ENCONTRADO');
  const kpis = [
    ['Produtos',totalProdutos,'c-tot'],['OK',ok,'c-ok'],['Faltando/Pendente',falta,'c-falta'],
    ['Excedidos',ex,'c-ex'],['Não encontrados',na,'c-na'],['Alertas',alertas,'c-bip'],...basicos
  ];
  exibirKpis(kpis);
  const status = [['OK',ok,'#27AE60'],['Faltando/Pendente',falta,'#F39C12'],['Excedidos',ex,'#C0392B'],
    ['Não encontrados',na,'#E67E22'],['Alertas',alertas,'#c084fc']];
  document.getElementById('dash-status').innerHTML = status.map(([label,total,cor])=>`
    <div class="prog-row"><span class="prog-label">${label}</span>
      <div class="prog-track"><div class="prog-fill" style="width:${rows.length?Math.round(total*100/rows.length):0}%;background:${cor}"></div></div>
      <span class="prog-val">${total}</span>
    </div>`).join('');
  const pendencias = new Map();
  for(const item of rows){
    if(item.dif<0)pendencias.set(item.secao,(pendencias.get(item.secao)||0)-item.dif);
  }
  const secoesVisiveis = paginar('pag-dash',[...pendencias],48);
  document.getElementById('dash-secoes').innerHTML = pendencias.size
    ? '<div class="secoes-grid">'+secoesVisiveis.map(([secao,quantidade])=>
      `<div class="secao-card secao-pend"><div class="s-nome">${esc(secao)}</div><div class="s-cnt">${quantidade} não bipado(s)</div></div>`).join('')+'</div>'
    : '<p class="empty">'+(totalProdutos?'Nenhum exemplar faltando.':'Nenhuma seção importada.')+'</p>';
}

function atualizarMetricas(){
  if(!ME.listaAtiva || !abasBipe[ME.listaAtiva] || abasBipe[ME.listaAtiva].excluindo)return;
  const total = totalDaConferencia(ME.listaAtiva);
  document.getElementById('continuidade-lista').textContent = (total??'—')+' bipes confirmados';
  if(!document.getElementById('progresso-detalhado').open)return;
  const estado = pedirDetalhesDaLista(ME.listaAtiva);
  document.getElementById('progresso-detalhes-status').textContent = textoDosDetalhes(ME.listaAtiva,estado);
  if(!estado?.lista){
    document.getElementById('prog-fill').style.width = '0%';
    for(const id of ['prog-pct','prog-ok','prog-total','tempo-val','vel-atual','vel-media'])document.getElementById(id).textContent = '—';
    return;
  }
  const {rows,bipes,totalProdutos} = resumoAtual(ME.listaAtiva);
  const {ok,faltaUnidades} = estatisticas(rows);
  let ultimo;
  for(const bipe of bipes)if(!ultimo || dataMs(bipe.at)>dataMs(ultimo.at))ultimo=bipe;
  const status = !bipes.length?'Não iniciada':pausado?'Pausada neste acesso':'Em andamento';
  const detalhes = [status,ok+' produtos conferidos'];
  if(ultimo)detalhes.push('Última bipagem '+dataBr.format(dataMs(ultimo.at))+' por '+ultimo.operador);
  if(!detalhesDesatualizados(ME.listaAtiva,estado))document.getElementById('continuidade-lista').textContent = detalhes.join(' · ');
  const pct = totalProdutos?Math.round(ok*100/totalProdutos):0;
  document.getElementById('prog-fill').style.width = pct+'%';
  document.getElementById('prog-pct').textContent = pct+'%';
  document.getElementById('prog-ok').textContent = ok+' conferidos';
  document.getElementById('prog-total').textContent = totalProdutos+' total';
  const duracao = duracaoDosBipes(bipes);
  const media = duracao>0 ? Math.round(bipes.length*3600000/duracao) : 0;
  const recentes = bipes.filter(b=>dataMs(b.at)>Date.now()-300000).length;
  document.getElementById('vel-atual').textContent = bipes.length?recentes*12+'/h':'—';
  document.getElementById('vel-media').textContent = media?media+'/h':'—';
  document.getElementById('tempo-val').textContent = media && faltaUnidades
    ? formatarTempo(faltaUnidades*3600000/media)
    : totalProdutos && ok===totalProdutos?'Concluído!':'Aguardando ritmo';
}
// ======= IMPORTAÇÃO DAUER =======
function mostrarAndamentoImportacao(etapa,detalhes='',avanco){
  document.getElementById('andamento-import').hidden = !etapa;
  document.getElementById('etapa-import').textContent = etapa;
  document.getElementById('detalhes-import').textContent = detalhes;
  const barra = document.getElementById('progresso-import');
  barra.hidden = !avanco;
  if(avanco){
    barra.max = avanco.total || 1;
    if(avanco.valor===undefined)barra.removeAttribute('value');
    else barra.value = avanco.valor;
  }
}

function mostrarAndamentoGravacao(etapa,progresso,detalhe=''){
  const {gravadas,iguais,total} = progresso;
  const saldo = Math.max(0,total-gravadas-iguais);
  const contagem = `${gravadas} salvas · ${iguais} já atualizadas · ${saldo} pendentes`;
  mostrarAndamentoImportacao(etapa,detalhe?`${contagem}. ${detalhe}`:contagem,{valor:gravadas+iguais,total});
}

function controlarBotaoPausaImportacao(permitir){
  const btn = document.getElementById('pausar-import');
  btn.hidden = !permitir;
  btn.disabled = pausaImportacaoSolicitada;
  btn.textContent = pausaImportacaoSolicitada?'Pausa solicitada':'Pausar após este lote';
}

function solicitarPausaImportacao(){
  if(!importando || document.getElementById('pausar-import').hidden)return;
  pausaImportacaoSolicitada = true;
  controlarBotaoPausaImportacao(true);
}

function criarLeitorDauer(modo){
  const lerSemWorker = async(arquivo,pendentes)=>{
    await carregarBiblioteca('xlsx');
    return (modo==='catalogo'?lerCatalogoDauer:lerArquivoDauer)(arquivo,pendentes);
  };
  let worker;
  let recusar;
  try{if(typeof Worker!=='undefined')worker = new Worker('/leitor-dauer.js');}
  catch{ /* A leitura continua disponível sem Web Worker. */ }
  return {
    ler(arquivo,pendentes){
      if(!worker)return lerSemWorker(arquivo,pendentes);
      return new Promise((resolver,rejeitar)=>{
        recusar = rejeitar;
        worker.onmessage = ({data})=>{
          recusar = null;
          if(data.erro)rejeitar(new Error(data.erro));
          else resolver(data.dados);
        };
        worker.onerror = erro=>{
          erro.preventDefault();
          worker.terminate();
          worker = null;
          lerSemWorker(arquivo,pendentes).then(resolver,rejeitar);
        };
        worker.postMessage({arquivo,pendentes,modo});
      });
    },
    fechar(){
      worker?.terminate();
      recusar?.(new Error('Leitura cancelada.'));
      recusar = null;
    }
  };
}

async function lerPlanilhaImportacao(arquivo,leitor,secoes,pendentes){
  const {sessoes,semLocalizacao} = await leitor.ler(arquivo,pendentes);
  const novas = [];
  const duplicadas = [];
  for(const secao of sessoes){
    const chave = chaveSessaoImportacao(secao);
    if(secoes.has(chave))duplicadas.push(secao.secao);
    else{
      secoes.add(chave);
      novas.push({...secao,nome:arquivo.name});
    }
  }
  return {novas,duplicadas,semLocalizacao};
}

async function importar(arquivos){
  if(!exigirPermissao('supervisao'))return;
  if(importando){toast('Aguarde a importação em andamento.');return;}
  const arquivosDaVez = Array.from(arquivos);
  if(!arquivosDaVez.length)return;
  if(rascunhoIniciado && !confirm('Substituir o rascunho desta importação pelas novas planilhas?'))return;
  const leitura = ++leituraImportacao;
  leitorDauerAtivo?.fechar();
  const leitor = leitorDauerAtivo = criarLeitorDauer();
  const log = document.getElementById('log-import');
  const btn = document.getElementById('btn-import');
  const lidas = [];
  const arquivosLidos = [];
  log.style.display = 'block';
  log.textContent = 'Lendo planilhas…\n';
  btn.disabled = true;
  btn.textContent = '↑ Confirmar Importação';
  document.getElementById('area-btn-import').style.display = 'none';
  const secoes = new Set();
  try{
    for(const [i,file] of arquivosDaVez.entries()){
      mostrarAndamentoImportacao(`Lendo arquivo ${i+1} de ${arquivosDaVez.length}`,file.name,
        arquivosDaVez.length>1?{valor:i,total:arquivosDaVez.length}:{});
      try{
        const {novas,duplicadas,semLocalizacao} = await lerPlanilhaImportacao(file,leitor,secoes);
        if(leitura!==leituraImportacao)return;
        if(novas.length){
          arquivosLidos.push(file);
          for(const secao of novas)lidas.push(secao);
        }
        const mensagens = duplicadas.map(nome=>'✕ '+nome+' · já incluída por outro arquivo neste lote.');
        for(const {secao,itens,repetidos} of novas){
          mensagens.push('✓ '+secao+' · '+itens.length+' ISBNs'+
            (repetidos?' · ALERTA em '+repetidos+' ISBN(s) repetido(s) nas linhas':''));
        }
        if(semLocalizacao)mensagens.push('⚠ '+semLocalizacao+' linha(s) sem localização foram ignoradas.');
        log.append(document.createTextNode(file.name+' · '+novas.length+' sessão(ões) para importar\n'+mensagens.join('\n')+'\n'));
      }catch(erro){
        if(leitura!==leituraImportacao)return;
        log.append(document.createTextNode('✕ '+file.name+' · '+mensagemErro(erro)+'\n'));
      }
    }
    log.append(document.createTextNode('\n'+lidas.length+' sessão(ões) pronta(s) para importar.\n'));
    if(lidas.length){
      arquivosPendentes = lidas;
      idRascunho = crypto.randomUUID();
      rascunhoIniciado = false;
      progressoGravacaoImportacao = null;
      destinoImportacao = ME.listaAtiva || document.getElementById('sel-lista-import').value || '';
      marcadasImportacao.clear();
      for(const arq of arquivosPendentes)marcadasImportacao.add(chaveSessaoImportacao(arq));
      document.getElementById('buscar-previa').value = '';
      document.getElementById('status-rascunho').textContent = '';
      await registrarAndamentoImportacao({arquivos:arquivosLidos});
      if(leitura!==leituraImportacao)return;
    }
  }finally{
    leitor.fechar();
    if(leitorDauerAtivo===leitor){
      leitorDauerAtivo = null;
      mostrarAndamentoImportacao(lidas.length?'Prévia pronta':'Leitura sem novas sessões',
        lidas.length?`${lidas.length} sessões disponíveis para revisar.`:'Confira os detalhes no registro da importação.');
      atualizarSelectImport();
      renderPreviaImportacao();
    }
  }
}

function atualizarSelectImport(){
  const sel = document.getElementById('sel-lista-import');
  const valor = destinoImportacao || (!rascunhoIniciado ? (ME.listaAtiva||sel.value) : '');
  const html = '<option value="">Selecione uma lista…</option>'+Object.entries(abasBipe)
    .filter(([,lista])=>!lista.excluindo)
    .map(([id,lista])=>`<option value="${esc(id)}">${esc(lista.nome)}</option>`).join('');
  if(sel.dataset.opcoes!==html){
    sel.innerHTML = html;
    sel.dataset.opcoes = html;
  }
  sel.value = valor && abasBipe[valor] && !abasBipe[valor].excluindo ? valor : '';
  acompanharListasDaTela();
  const lista = abasBipe[sel.value];
  const estado = JSON.stringify([sel.value,lista?.sessoesCarregadas,lista?.revisaoItensPrevia]);
  if(sel.dataset.previa!==estado){
    sel.dataset.previa = estado;
    renderPreviaImportacao();
  }
}

async function confirmarImport(){
  if(!exigirPermissao('supervisao'))return;
  if(importando || !marcadasImportacao.size || leitorDauerAtivo)return;
  const listaId = document.getElementById('sel-lista-import').value;
  if(!listaId){toast('Escolha a lista que vai receber as sessões.');return;}
  if(rascunhoIniciado && destinoImportacao!==listaId){toast('O rascunho pertence a outra lista.');return;}
  const log = document.getElementById('log-import');
  log.style.display = 'block';
  importando = true;
  pausaImportacaoSolicitada = false;
  document.getElementById('status-rascunho').textContent = '';
  renderPreviaImportacao();
  mostrarAndamentoImportacao('Validando sessões','Consultando a lista no Firebase.',{});
  let falhas = 0;
  let gravadas = 0;
  let iguais = 0;
  let pausou = false;
  const progresso = {...(progressoGravacaoImportacao || {gravadas:0,iguais:0})};
  progresso.total = progresso.gravadas+progresso.iguais+marcadasImportacao.size;
  try{
    const {lista,lote,ambiguas,protegidas} = await planejarImportacao(listaId);
    if(protegidas.length){
      const nomes = protegidas.slice(0,6).join(', ');
      const extra = protegidas.length>6?' e mais '+(protegidas.length-6):'';
      if(!confirm('A importação muda a localização ou retira ISBNs de sessões com bipes: '+nomes+extra+
        '. Os bipes existentes ficam na sessão em que foram registrados. Confirma a alteração?')){
        mostrarAndamentoImportacao('Confirmação cancelada','Confira as sessões na prévia.');
        return;
      }
    }
    if(lote.length){
      destinoImportacao = listaId;
      rascunhoIniciado = true;
      progressoGravacaoImportacao = progresso;
      // Depois de iniciada, a retomada se limita ao recorte que foi confirmado.
      arquivosPendentes = arquivosPendentes.filter(arq=>marcadasImportacao.has(chaveSessaoImportacao(arq)));
      await registrarAndamentoImportacao();
    }
    for(const arq of ambiguas){
      falhas++;
      log.append(document.createTextNode('✕ '+arq.secao+' · já existe mais de uma sessão com este nome.\n'));
    }
    let revisao = lista.revisao||0;
    const totalLotes = Math.ceil(lote.length/sessoesPorLote);
    for(let i=0;i<lote.length;i+=sessoesPorLote){
      const loteAtual = i/sessoesPorLote+1;
      const rotulo = `Lote ${loteAtual} de ${totalLotes}`;
      controlarBotaoPausaImportacao(true);
      mostrarAndamentoGravacao(`${rotulo} · preparando`,progresso);
      const aoAguardarFirebase = ()=>mostrarAndamentoGravacao(`${rotulo} · aguardando Firebase`,progresso);
      const retorno = await salvarCatalogosDaImportacao(listaId,lote.slice(i,i+sessoesPorLote),catalogosDaImportacao,revisao,aoAguardarFirebase);
      revisao = retorno.revisao;
      const mensagens = [];
      const concluidas = new Set();
      for(const {arq,alterou,erro} of retorno.resultados){
        if(erro){
          falhas++;
          mensagens.push('✕ '+arq.secao+' · '+mensagemErro(erro));
        }else{
          if(alterou){gravadas++;progresso.gravadas++;}
          else{iguais++;progresso.iguais++;}
          concluidas.add(chaveSessaoImportacao(arq));
          mensagens.push('✓ '+arq.secao+(alterou?' salva.':' já estava atualizada.'));
        }
      }
      arquivosPendentes = arquivosPendentes.filter(arq=>!concluidas.has(chaveSessaoImportacao(arq)));
      for(const chave of concluidas)marcadasImportacao.delete(chave);
      mostrarAndamentoGravacao(`${rotulo} · salvando progresso`,progresso);
      await registrarAndamentoImportacao();
      log.append(document.createTextNode(mensagens.join('\n')+'\n'));
      log.scrollTop = log.scrollHeight;
      if(retorno.interromper)break;
      if(pausaImportacaoSolicitada && loteAtual<totalLotes){pausou = true;break;}
    }
    controlarBotaoPausaImportacao(false);
    const mensagem = gravadas+' sessão(ões) gravada(s), '+iguais+' já atualizada(s), '+falhas+' com falha.';
    log.append(document.createTextNode('\n'+mensagem+'\n'));
    if(gravadas)registrarAuditoria('Importação Dauer: '+gravadas+' sessão(ões) em '+lista.nome);
    if(!arquivosPendentes.length)await limparRascunhoImportacao();
    if(pausou){
      mostrarAndamentoGravacao('Importação pausada',progresso,'Clique em Continuar importação para retomar.');
      toast('Importação pausada após o lote.');
      return;
    }
    if(gravadas || iguais){
      let alertas = 0;
      try{
        mostrarAndamentoGravacao('Verificando alertas no Firebase',progresso);
        const listaAtual = await carregarCatalogoServidor(listaId);
        const mapa = montarCatalogos({[listaId]:listaAtual},baseMap);
        for(const [codigo,itens] of mapa.porLista.get(listaId)||[]){
          if(!itens.some(item=>item.duplicado || item.repetido))continue;
          alertas++;
          if(alertas<=25){
            const nomes = itens.map(p=>p.secao).join(' / ');
            log.append(document.createTextNode('⚠ ALERTA '+codigo+' · '+nomes+'\n'));
          }
        }
      }catch(erro){log.append(document.createTextNode('A verificação de alertas será atualizada na bipagem. '+mensagemErro(erro)+'\n'));}
      if(alertas)log.append(document.createTextNode(alertas+' ISBN(s) com ALERTA nesta lista. Consulte o filtro ALERTA no Resumo.\n'));
    }
    mostrarAndamentoGravacao(falhas?'Importação com pendências':'Importação concluída',progresso,
      falhas?'Confira as falhas no registro da importação.':'');
    toast(mensagem);
  }catch(erro){
    const mensagem = 'Falha na importação. '+mensagemErro(erro);
    log.append(document.createTextNode('\n'+mensagem+'\n'));
    mostrarAndamentoGravacao('Importação interrompida',progresso,mensagemErro(erro));
    toast(mensagem);
  }finally{
    importando = false;
    controlarBotaoPausaImportacao(false);
    catalogosDaImportacao.clear();
    agendarRender();
    renderPreviaImportacao();
    log.scrollTop = log.scrollHeight;
  }
}

async function carregarCatalogoServidor(listaId,{somenteMetadados=false}={}){
  const ref = listaRef(listaId);
  const [lista,sessoes] = await Promise.all([ref.get(servidor),ref.collection('sessoes').get(servidor)]);
  listaAberta(lista);
  const estado = {...lista.data(),documentos:sessoes.docs,sessoes:Object.fromEntries(sessoes.docs.map(doc=>[doc.id,doc.data()]))};
  return somenteMetadados?estado:hidratarCatalogoServidor(listaId,estado);
}

async function hidratarCatalogoServidor(listaId,estado){
  const sessoes = await mapearEmLotes(Object.entries(estado.sessoes),6,async ([id,dados])=>{
    const {catalogoInline,...metadados} = dados;
    return [id,{...metadados,itens:dados.catalogo?await itensDaSessao(listaId,id,dados):[]}];
  });
  return {...estado,sessoes:Object.fromEntries(sessoes)};
}
// ======= LOG =======
async function logAuditoria(texto){
  await db.collection('auditoria').add({texto,uid:ME.uid,nome:ME.nome,at:firebase.firestore.FieldValue.serverTimestamp()});
}

function ouvirLog(){
  if(logListener)return;
  logListener=db.collection('auditoria').orderBy('at','desc').limit(200).onSnapshot(snap=>{
    const tb=document.getElementById('tb-log');if(!tb)return;
    tb.innerHTML=snap.docs.map(d=>{
      const data=d.data();const hora=data.at?.toDate?dataBr.format(data.at.toDate()):'—';
      const cor=corSegura(onlineUsers[data.uid]?.cor);
      return`<tr><td style="color:var(--muted);font-size:12px;white-space:nowrap">${hora}</td>
        <td><div class="avatar-sm" style="background:${cor}">${esc((data.nome||'?')[0].toUpperCase())}</div>${esc(data.nome)}</td>
        <td>${esc(data.texto)}</td></tr>`;
    }).join('')||'<tr><td colspan="3" class="empty">Sem registros.</td></tr>';
  });
}

async function limparLog(){
  if(!exigirPermissao('admin'))return;
  if(!confirm('Apagar todo o log?'))return;
  try{await apagarColecao(db.collection('auditoria'));}
  catch(erro){toast(mensagemErro(erro));}
}


function registrarAuditoria(texto){
  logAuditoria(texto).catch(erro=>console.warn('Auditoria:',mensagemErro(erro)));
}

// ======= NAVEGAÇÃO, TELA CHEIA E INSTALAÇÃO =======
const titulosTelas = {
  ferramentas:'Ferramentas',tcl:'TCL',furos:'Furos',fonte:'Fonte de dados',conferencia:'Conferência',bipe:'Conferência',base:'Produtos das listas',
  chat:'Chat',importar:'Catálogo na conferência',log:'Log de Auditoria',conferencias:'Histórico de Conferências',
  sobre:'Sobre e manual',config:'Configurações',divergencias:'Divergências',usuarios:'Gerenciar acessos'
};

function ir(tela,modo='bipar'){
  if(tela==='dash' || (tela==='bipe' && !abasBipe[ME.listaAtiva]))tela = 'conferencia';
  if(tela==='bipe')modoConferencia = modo;
  const permissao = permissoesDasTelas[tela];
  if(permissao && !exigirPermissao(permissao))return;
  if(tela!=='usuarios')pararGerenciaUsuarios();
  if(tela!=='furos')encerrarFuros();
  fecharMenuBipe();
  if(tela!=='bipe' || modoConferencia!=='bipar'){
    historicoBipes = null;
    fecharCamera();
    sairTelaCheia();
  }
  document.getElementById('app').dataset.tela = tela;
  telaAtual = tela;
  acompanharListasDaTela();
  acompanharHistoricoDeConferencias();
  if(tela!=='chat')encerrarChat();
  if(tela!=='log' && logListener){logListener();logListener=null;}
  atualizarPresencaOperacional();
  renderPresencaSessao();
  if(tela!=='bipe' || modoConferencia!=='bipar')sincronizarCronometroBipe();
  if(tela!=='divergencias')pararRevisoes();
  const telaDoMenu = tela==='conferencia'?'bipe':['log','conferencias','usuarios','fonte','base'].includes(tela)?'config':tela;
  document.querySelectorAll('.tela').forEach(el=>{el.style.display='none';});
  document.querySelectorAll('#menu-app nav [id^="nav-"]').forEach(el=>{
    const selecionado = el.id==='nav-'+telaDoMenu;
    el.classList.toggle('ativo',selecionado);
    if(selecionado)el.setAttribute('aria-current','page');
    else el.removeAttribute('aria-current');
  });
  document.getElementById('tela-'+tela).style.display = 'block';
  document.getElementById('pg-title').textContent = titulosTelas[tela];
  document.getElementById('btn-tela-cheia').hidden = tela!=='bipe' || modoConferencia!=='bipar';
  atualizarBadgeSessao();
  agendarRender();
  if(tela==='bipe'){
    atualizarEstadoBipe();
    if(modoConferencia==='bipar' && !cameraBipe && !matchMedia('(pointer: coarse)').matches)requestAnimationFrame(()=>document.getElementById('inp-bipe').focus());
  }
  if(tela==='chat'){
    renderChatTabs();
    document.getElementById('chat-inp').focus();
  }
  if(tela==='log')ouvirLog();
  if(tela==='usuarios')abrirGerenciaUsuarios();
  if(tela==='importar'){carregarUnidadesParaConferencia();restaurarRascunhoImportacao();}
  if(tela==='conferencias')renderConferencias();
  if(tela==='tcl')abrirTcl();
  if(tela==='furos'){carregarFiltrosFuros();acompanharFuros();}
  if(tela==='fonte')renderFonteDados();
  if(tela==='sobre')document.getElementById('manual-titulo').focus();
  if(tela==='config' && pode('admin'))renderArquivadas();
  if(tela==='config')document.querySelector(`input[name="tema"][value="${document.documentElement.dataset.tema}"]`).checked = true;
}

async function alternarTelaCheia(){
  const app = document.getElementById('app');
  if(app.classList.contains('modo-bipagem')){
    sairTelaCheia();
    return;
  }
  if(!ME.listaAtiva){toast('Selecione a lista que deseja bipar.');return;}
  app.classList.add('modo-bipagem');
  document.getElementById('btn-tela-cheia').textContent = 'Sair da tela cheia';
  if(document.documentElement.requestFullscreen && document.fullscreenEnabled){
    try{await document.documentElement.requestFullscreen();}
    catch(erro){console.info('Modo de bipagem em janela.',erro.message);}
  }
  if(!cameraBipe && !matchMedia('(pointer: coarse)').matches)document.getElementById('inp-bipe').focus();
}

function sairTelaCheia(){
  const app = document.getElementById('app');
  if(!app.classList.contains('modo-bipagem'))return;
  app.classList.remove('modo-bipagem');
  document.getElementById('btn-tela-cheia').textContent = 'Tela cheia';
  if(document.fullscreenElement)document.exitFullscreen().catch(console.warn);
}

document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)sairTelaCheia();});
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  pedidoInstalacao = event;
  document.getElementById('btn-instalar').hidden = false;
});
document.getElementById('btn-instalar').addEventListener('click',async ()=>{
  if(!pedidoInstalacao)return;
  try{await pedidoInstalacao.prompt();}
  catch(erro){toast('A instalação não está disponível neste navegador.');}
  pedidoInstalacao = null;
  document.getElementById('btn-instalar').hidden = true;
});
window.addEventListener('appinstalled',()=>{document.getElementById('btn-instalar').hidden=true;});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(console.warn);

// ======= SOM =======
function ativarAudioBipe(pelaCamera=false){
  if(pelaCamera && localStorage.getItem('blu_som')===null){
    somAtivo = true;
    document.getElementById('chk-som').checked = true;
  }
  if(!somAtivo)return;
  try{
    audioBipagem ||= new(window.AudioContext||window.webkitAudioContext)();
    if(audioBipagem.state==='suspended')audioBipagem.resume().catch(()=>{});
  }catch{ /* O resultado visual permanece disponível. */ }
}

function beep(tipo){
  if(!somAtivo || !audioBipagem || audioBipagem.state!=='running')return;
  try{
    const ctx=audioBipagem;
    const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);
    if(tipo==='ok'){o.frequency.value=880;g.gain.setValueAtTime(.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.18);}
    else if(tipo==='aviso'){o.frequency.value=440;g.gain.setValueAtTime(.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.25);}
    else{o.type='sawtooth';o.frequency.value=180;g.gain.setValueAtTime(.4,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.3);}
    o.start();o.stop(ctx.currentTime+.35);
  }catch(e){}
}

function notificar(msg){
  if(!notifAtivo)return;
  try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=600;g.gain.setValueAtTime(.15,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.1);o.start();o.stop(ctx.currentTime+.15);}catch(e){}
  if('Notification' in window&&Notification.permission==='granted')new Notification(`Blulivro — ${msg.nome}`,{body:msg.texto});
}

function textoDeBusca(valor){
  return txt(valor).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
}

function esc(valor){
  return String(valor??'').replace(/[&<>"']/g,caractere=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[caractere]);
}

function arg(valor){
  return esc(JSON.stringify(valor));
}

function corSegura(cor){
  return /^#[a-f0-9]{6}$/i.test(cor||'')?cor:'#9B1C1C';
}

function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('show'),4500);
}

function toggleSom(){
  somAtivo = document.getElementById('chk-som').checked;
  localStorage.setItem('blu_som',somAtivo?'1':'0');
  if(somAtivo)ativarAudioBipe();
}
function toggleNotif(){notifAtivo=document.getElementById('chk-notif').checked;localStorage.setItem('blu_notif',notifAtivo?'1':'0');if(notifAtivo&&'Notification' in window&&Notification.permission==='default')Notification.requestPermission();}
