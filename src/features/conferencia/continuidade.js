/* A fila local é separada por UID. O Firestore confirma cada evento uma única vez. */
let bancoFilaBipes;
let sincronizacaoBipes;
let erroFilaBipes = '';
let pararAtividade;
let listaAtividade;
let atividadeConfirmada = [];
const toleranciaBipagem = 40000;
let indicadorAtividade = medirAtividade([]);
let criadoUltimoEvento = 0;
const gravacoesLocaisAtivas = new Set();
let eventosMedidos;
let bipesMedidos;
let leiturasAntigasOperador = [];
let carregamentoAntigos;
const diretosAntigos = new Map();

function abrirFilaLocal(){
  if(!bancoFilaBipes){
    bancoFilaBipes = new Promise((resolve,reject)=>{
      const pedido = indexedDB.open('blulivro-fila-bipes',1);
      pedido.onupgradeneeded = ()=>{
        pedido.result.createObjectStore('eventos',{keyPath:'id'}).createIndex('uid','uid');
      };
      pedido.onsuccess = ()=>resolve(pedido.result);
      pedido.onerror = ()=>reject(pedido.error);
    }).catch(erro=>{bancoFilaBipes=null;throw erro;});
  }
  return bancoFilaBipes;
}

async function operarFilaLocal(modo,operar){
  const banco = await abrirFilaLocal();
  return new Promise((resolve,reject)=>{
    const tx = banco.transaction('eventos',modo);
    const pedido = operar(tx.objectStore('eventos'));
    tx.oncomplete = ()=>resolve(pedido.result);
    tx.onabort = ()=>reject(tx.error || new Error('Não foi possível acessar os bipes locais.'));
  });
}

async function pendenciasLocais(uid){
  const eventos = await operarFilaLocal('readonly',store=>store.index('uid').getAll(uid));
  const projeto = firebase.app().options.projectId;
  return eventos.filter(e=>(!e.projeto || e.projeto===projeto) &&
    typeof e.id==='string' && /^[a-zA-Z0-9_-]{1,160}$/.test(e.id) &&
    typeof e.listaId==='string' && /^[^/]{1,160}$/.test(e.listaId) &&
    (e.tipo==='pausa' || (e.tipo==='bipe' && typeof e.codigo==='string' && e.codigo.length>0 && e.codigo.length<=160))).sort((a,b)=>a.criado-b.criado || a.id.localeCompare(b.id));
}

async function guardarEventoLocal(listaId,tipo,codigo=''){
  criadoUltimoEvento = Math.max(Date.now(),criadoUltimoEvento+1);
  const evento = {id:crypto.randomUUID(),uid:ME.uid,projeto:firebase.app().options.projectId,listaId,tipo,codigo,criado:criadoUltimoEvento};
  const gravacao = operarFilaLocal('readwrite',store=>store.add(evento));
  gravacoesLocaisAtivas.add(gravacao);
  try{await gravacao;return evento;}
  finally{gravacoesLocaisAtivas.delete(gravacao);}
}

async function atualizarFilaVisivel(){
  const el = document.getElementById('fila-bipes-status');
  const pendentes = await pendenciasLocais(ME.uid);
  const bipes = pendentes.filter(evento=>evento.tipo==='bipe').length;
  el.textContent = (bipes?bipes+' bipagem(ns) pendente(s) neste navegador. ':'')+erroFilaBipes;
  document.getElementById('fila-bipes-retry').hidden = !bipes;
}

function referenciaAtividade(listaId){
  return listaRef(listaId).collection('atividadeBipagem');
}

async function carregarContextoDaFila(id){
  const local = abasBipe[id];
  if(catalogoPronto(local))return {lista:local,mapa:catalogosAtuais()};
  const pai = await listaRef(id).get(servidor);
  if(!pai.exists || pai.get('finalizadaEm') || pai.get('arquivadaEm') || pai.get('excluindo'))return null;
  const lista = await carregarCatalogoServidor(id);
  const legada = Object.values(lista.sessoes).some(s=>!s.excluindo && !s.catalogo);
  return {lista,mapa:montarCatalogos({[id]:lista},legada?await lerBaseLegadaNoServidor():new Map())};
}

async function quantidadeDiretaAntiga(listaId,lista,codigo){
  if(lista.semBipesDiretosAntigos)return null;
  const revisao = lista.revisaoLegados||0;
  let cache = diretosAntigos.get(listaId);
  if(cache?.revisao!==revisao){
    const quantidades = new Map();
    const {leituras} = await consultarLeituras(listaId,{sessaoId:semSessaoId});
    for(const bipe of leituras){
      if(bipe.resultado || bipe.alerta)continue;
      const chave = codigoNormalizado(bipe.codigo);
      quantidades.set(chave,(quantidades.get(chave)||0)+1);
    }
    if(diretosAntigos.size>=6)diretosAntigos.delete(diretosAntigos.keys().next().value);
    cache = {revisao,quantidades};
    diretosAntigos.set(listaId,cache);
  }
  return {qtd:cache.quantidades.get(codigo)||0,revisao};
}

async function sincronizarBipesPendentes(){
  if(sincronizacaoBipes)return sincronizacaoBipes;
  if(!ME.uid || !navigator.onLine)return;
  const uid = ME.uid;
  sincronizacaoBipes = (async ()=>{
    erroFilaBipes = '';
    let falhou = 0;
    const bloqueadas = new Set(), contextos = new Map();
    for(const evento of await pendenciasLocais(uid)){
      if(ME.uid!==uid || auth.currentUser?.uid!==uid || !navigator.onLine)break;
      if(bloqueadas.has(evento.listaId))continue;
      try{
        if(evento.tipo==='pausa'){
          const ref = referenciaAtividade(evento.listaId).doc(evento.id);
          await db.runTransaction(async tx=>{
            const atual = await tx.get(ref);
            if(!atual.exists)tx.set(ref,{tipo:'pausa',uid,at:timestamp()});
          });
        }else{
          if(!contextos.has(evento.listaId))contextos.set(evento.listaId,await carregarContextoDaFila(evento.listaId));
          const contexto = contextos.get(evento.listaId);
          if(contexto)await enviarBipePendente(evento,contexto.lista,contexto.mapa);
          else{
            const recibo = await referenciaAtividade(evento.listaId).doc(evento.id).get(servidor);
            if(!recibo.exists || recibo.get('uid')!==uid || recibo.get('codigo')!==evento.codigo || recibo.get('tipo')!=='bipe'){
              throw new Error('A lista está fechada ou indisponível. O bipe continua guardado neste navegador.');
            }
          }
        }
        await operarFilaLocal('readwrite',store=>store.delete(evento.id));
      }catch(erro){
        if(erro.code==='unavailable' || erro.code==='deadline-exceeded'){
          erroFilaBipes = 'Sem confirmação do servidor. O sistema tentará sincronizar novamente.';
          break;
        }
        if(evento.tipo==='pausa'){
          // Uma pausa depois do fechamento já não altera o relatório arquivado.
          const pai = erro.code==='permission-denied'?await listaRef(evento.listaId).get(servidor).catch(()=>null):null;
          if(pai && (!pai.exists || pai.get('finalizadaEm') || pai.get('arquivadaEm') || pai.get('excluindo'))){
            await operarFilaLocal('readwrite',store=>store.delete(evento.id));
            continue;
          }
          falhou++;
          continue;
        }
        bloqueadas.add(evento.listaId);
        falhou++;
      }
    }
    if(falhou)erroFilaBipes = falhou+' evento(s) ainda sem confirmação. Confira se a lista está aberta e se seu perfil tem acesso.';
  })().catch(()=>{
    erroFilaBipes = 'O navegador não conseguiu acessar a fila de bipagens. Confira o armazenamento local.';
  }).finally(()=>{
    sincronizacaoBipes = null;
    atualizarFilaVisivel().catch(()=>{});
  });
  return sincronizacaoBipes;
}

function iniciarContinuidade(){
  window.addEventListener('online',sincronizarBipesPendentes);
  window.addEventListener('offline',()=>{
    erroFilaBipes = 'Sem conexão. As novas leituras desta lista ficam pendentes neste navegador.';
    atualizarFilaVisivel().catch(()=>{});
  });
  setInterval(()=>{if(document.visibilityState==='visible')sincronizarBipesPendentes();},5000);
  sincronizarBipesPendentes();
  atualizarFilaVisivel().catch(()=>{});
}

async function verificarFilaFechamento(listaId){
  await Promise.all([...gravacoesLocaisAtivas]);
  await sincronizarBipesPendentes();
  if((await pendenciasLocais(ME.uid)).some(evento=>evento.listaId===listaId && evento.tipo==='bipe')){
    throw new Error('Esta lista ainda tem bipagens pendentes neste navegador. Sincronize antes de finalizar.');
  }
}

function medirAtividade(eventos){
  const ordenados = [...eventos].filter(evento=>Number.isFinite(evento.ms)).sort((a,b)=>a.ms-b.ms);
  let acumulado = 0, inicio = null, ultimo = null, fim = null;
  let bipes = 0;
  for(const evento of ordenados){
    if(evento.tipo==='pausa'){
      if(ultimo!==null){
        fim = evento.ms;
        acumulado += Math.max(0,Math.min(fim-ultimo,toleranciaBipagem));
      }
      ultimo = null;
      continue;
    }
    inicio ??= evento.ms;
    if(ultimo!==null)acumulado += Math.min(evento.ms-ultimo,toleranciaBipagem);
    ultimo = fim = evento.ms;
    bipes++;
  }
  return {acumulado,inicio,ultimo,fim,bipes};
}

function totalAtivo(medicao,agora){
  return medicao.acumulado+(medicao.ultimo===null?0:Math.max(0,Math.min(agora-medicao.ultimo,toleranciaBipagem)));
}

function eventosDaConferencia(atividade,bipes){
  return [
    ...atividade.filter(evento=>!evento.desfeitoEm).map(evento=>({uid:evento.uid,tipo:evento.tipo,ms:dataMs(evento.at)||NaN})),
    ...bipes.filter(bipe=>!bipe.eventoId).map(bipe=>({uid:bipe.uid||bipe.operador,tipo:'bipe',ms:dataMs(bipe.at)||NaN}))
  ];
}

function agregarAtividade(atividade,bipes,agora=Date.now()){
  const grupos = new Map();
  for(const evento of eventosDaConferencia(atividade,bipes)){
    if(!grupos.has(evento.uid))grupos.set(evento.uid,[]);
    grupos.get(evento.uid).push(evento);
  }
  let ativo = 0, decorrido = 0;
  for(const eventos of grupos.values()){
    const medicao = medirAtividade(eventos);
    ativo += totalAtivo(medicao,agora);
    const fim = medicao.ultimo===null?medicao.fim:Math.max(medicao.ultimo,agora);
    if(medicao.inicio!==null)decorrido += Math.max(0,fim-medicao.inicio);
  }
  return {ativo,decorrido,inativo:Math.max(0,decorrido-ativo),media:ativo?bipes.length*60000/ativo:0};
}

function observarAtividade(id){
  if(listaAtividade===id)return;
  pararAtividade?.();
  listaAtividade = id;
  atividadeConfirmada = [];
  leiturasAntigasOperador = [];
  carregamentoAntigos = null;
  if(id && !abasBipe[id]?.semBipesDiretosAntigos){
    const consulta = consultarLeituras(id,{uid:ME.uid});
    carregamentoAntigos = consulta;
    consulta.then(({leituras})=>{
      if(carregamentoAntigos!==consulta)return;
      leiturasAntigasOperador = leituras.filter(bipe=>!bipe.eventoId);
      recalcularAtividade();
    }).catch(()=>{});
  }
  bipesMedidos = null;
  indicadorAtividade = medirAtividade([]);
  pararAtividade = id?referenciaAtividade(id).where('uid','==',ME.uid).onSnapshot(snap=>{
    atividadeConfirmada = snap.docs.filter(doc=>!doc.metadata.hasPendingWrites).map(doc=>doc.data());
    recalcularAtividade();
  },()=>{}):null;
}

function recalcularAtividade(){
  if(!listaAtividade)return;
  if(eventosMedidos===atividadeConfirmada && bipesMedidos===leiturasAntigasOperador)return;
  eventosMedidos = atividadeConfirmada;
  bipesMedidos = leiturasAntigasOperador;
  indicadorAtividade = medirAtividade(eventosDaConferencia(atividadeConfirmada,leiturasAntigasOperador));
}

function registrarParada(listaId){
  if(!listaId || !ME.uid)return Promise.resolve();
  return guardarEventoLocal(listaId,'pausa').then(()=>{
    sincronizarBipesPendentes();
  }).catch(()=>{});
}
