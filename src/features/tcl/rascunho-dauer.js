/* Guarda a prévia e o avanço da importação neste navegador. */
let bancoRascunhos;

function abrirBancoRascunhos(){
  if(!bancoRascunhos){
    bancoRascunhos = new Promise((resolver,rejeitar)=>{
      const pedido = indexedDB.open('blulivro-dauer',1);
      pedido.onupgradeneeded = ()=>pedido.result.createObjectStore('rascunhos');
      pedido.onsuccess = ()=>resolver(pedido.result);
      pedido.onerror = ()=>rejeitar(pedido.error);
    });
  }
  return bancoRascunhos;
}

async function operarRascunhoDauer(modo,operar){
  const banco = await abrirBancoRascunhos();
  return new Promise((resolver,rejeitar)=>{
    const tx = banco.transaction('rascunhos',modo);
    const pedidos = operar(tx.objectStore('rascunhos'));
    tx.oncomplete = ()=>resolver(pedidos?.map(pedido=>pedido.result));
    tx.onabort = ()=>rejeitar(tx.error || new Error('Falha ao salvar o rascunho.'));
  });
}

function lerRascunhoDauer(uid){
  return operarRascunhoDauer('readonly',store=>[
    store.get(uid+'/planilha'),store.get(uid+'/andamento')
  ]);
}

function salvarRascunhoDauer(uid,andamento,planilha){
  return operarRascunhoDauer('readwrite',store=>{
    if(planilha)store.put(planilha,uid+'/planilha');
    store.put(andamento,uid+'/andamento');
  });
}

function apagarRascunhoDauer(uid){
  return operarRascunhoDauer('readwrite',store=>{
    store.delete(uid+'/planilha');
    store.delete(uid+'/andamento');
  });
}

const marcadasImportacao = new Set();
let idRascunho;
let destinoImportacao = '';
let rascunhoIniciado = false;
let restaurouRascunho = false;
let filaRascunho = Promise.resolve();
let progressoGravacaoImportacao;
let previaCalculada;
let revisaoSelecaoImportacao = 0;

function chaveSessaoImportacao(arq){
  return arq.chave ?? nomeNormalizado(arq.secao);
}

function enfileirarRascunho(operar){
  filaRascunho = filaRascunho.catch(()=>{}).then(operar).catch(()=>{
    document.getElementById('status-rascunho').textContent =
      'Este navegador não salvou o progresso. Mantenha esta página aberta para continuar.';
  });
  return filaRascunho;
}

function registrarAndamentoImportacao(planilha){
  if(!idRascunho || !ME.uid)return Promise.resolve();
  const uid = ME.uid;
  const andamento = {
    id:idRascunho,
    listaId:destinoImportacao,
    iniciado:rascunhoIniciado,
    pendentes:arquivosPendentes.map(chaveSessaoImportacao),
    marcadas:[...marcadasImportacao],
    progresso:progressoGravacaoImportacao && {...progressoGravacaoImportacao}
  };
  return enfileirarRascunho(()=>salvarRascunhoDauer(uid,andamento,planilha));
}

async function restaurarRascunhoImportacao(){
  if(restaurouRascunho || !ME.uid)return;
  restaurouRascunho = true;
  try{
    const [planilha,andamento] = await lerRascunhoDauer(ME.uid);
    if(!planilha || !andamento || idRascunho || leitorDauerAtivo)return;
    const pendentes = new Set(andamento.pendentes);
    if(Array.isArray(planilha))arquivosPendentes = planilha.filter(arq=>pendentes.has(chaveSessaoImportacao(arq)));
    else if(planilha.catalogo){
      const {lidas} = await lerSessoesDaBase(planilha.catalogo,pendentes);
      if(idRascunho || leitorDauerAtivo)return;
      if(lidas.length!==pendentes.size)throw new Error('Catálogo incompleto.');
      arquivosPendentes = lidas;
    }else{
      const leitor = leitorDauerAtivo = criarLeitorDauer();
      const secoes = new Set();
      const recuperadas = [];
      mostrarAndamentoImportacao('Recuperando rascunho','Lendo os arquivos guardados neste navegador.',{});
      try{
        for(const arquivo of planilha.arquivos){
          const {novas} = await lerPlanilhaImportacao(arquivo,leitor,secoes,pendentes);
          if(leitorDauerAtivo!==leitor)return;
          for(const secao of novas)recuperadas.push(secao);
        }
        if(recuperadas.length!==pendentes.size)throw new Error('Rascunho incompleto.');
        arquivosPendentes = recuperadas;
      }catch(erro){
        if(leitorDauerAtivo!==leitor)return;
        throw erro;
      }finally{
        leitor.fechar();
        if(leitorDauerAtivo===leitor)leitorDauerAtivo = null;
      }
    }
    if(!arquivosPendentes.length)return;
    idRascunho = andamento.id;
    destinoImportacao = andamento.listaId;
    rascunhoIniciado = andamento.iniciado;
    progressoGravacaoImportacao = andamento.progresso || null;
    for(const chave of andamento.marcadas)if(pendentes.has(chave))marcadasImportacao.add(chave);
    document.getElementById('log-import').style.display = 'none';
    if(rascunhoIniciado && progressoGravacaoImportacao){
      mostrarAndamentoGravacao('Importação pronta para continuar',progressoGravacaoImportacao);
    }else if(rascunhoIniciado){
      mostrarAndamentoImportacao('Importação pronta para continuar',`${arquivosPendentes.length} sessões pendentes.`);
    }else mostrarAndamentoImportacao('Prévia recuperada',`${arquivosPendentes.length} sessões disponíveis para revisar.`);
    atualizarSelectImport();
    renderPreviaImportacao();
  }catch{
    mostrarAndamentoImportacao('Falha ao recuperar o rascunho','Selecione novamente as planilhas para importar.');
  }
}

function limparRascunhoImportacao(){
  const uid = ME.uid;
  idRascunho = null;
  destinoImportacao = '';
  rascunhoIniciado = false;
  progressoGravacaoImportacao = null;
  arquivosPendentes = [];
  previaCalculada = null;
  marcadasImportacao.clear();
  document.getElementById('status-rascunho').textContent = '';
  if(uid)return enfileirarRascunho(()=>apagarRascunhoDauer(uid));
  return Promise.resolve();
}

async function descartarRascunhoImportacao(){
  if(importando || !arquivosPendentes.length ||
    !confirm('Descartar a prévia e as sessões pendentes neste navegador? As sessões gravadas continuam na lista.'))return;
  await limparRascunhoImportacao();
  mostrarAndamentoImportacao('');
  document.getElementById('log-import').style.display = 'none';
  renderPreviaImportacao();
}

function atualizarDestinoImportacao(){
  if(rascunhoIniciado || importando)return;
  destinoImportacao = document.getElementById('sel-lista-import').value;
  registrarAndamentoImportacao();
  renderPreviaImportacao();
}

function marcarSessaoImportacao(chave,marcar){
  if(importando)return;
  if(marcar)marcadasImportacao.add(chave);
  else marcadasImportacao.delete(chave);
  revisaoSelecaoImportacao++;
  registrarAndamentoImportacao();
  renderPreviaImportacao(chave);
}

function marcarTodasImportacao(marcar){
  if(importando)return;
  marcadasImportacao.clear();
  if(marcar)for(const arq of arquivosPendentes)marcadasImportacao.add(chaveSessaoImportacao(arq));
  revisaoSelecaoImportacao++;
  registrarAndamentoImportacao();
  renderPreviaImportacao();
}

const numeroImportacao = new Intl.NumberFormat('pt-BR');

function calcularPreviaImportacao(lista){
  const revisao = lista?.revisaoItensPrevia;
  if(previaCalculada?.arquivos===arquivosPendentes && previaCalculada.lista===lista &&
    previaCalculada.revisao===revisao && previaCalculada.selecao===revisaoSelecaoImportacao)return previaCalculada;
  const existentes = new Map();
  const codigos = new Map();
  const locaisDeAlerta = new Map();

  function incluirAlerta(codigo,primeira,chave){
    const locais = locaisDeAlerta.get(codigo);
    if(locais)locais.add(chave);
    else locaisDeAlerta.set(codigo,new Set([primeira,chave]));
  }
  let produtos = 0;
  let exemplares = 0;
  const totais = new Map();
  for(const arq of arquivosPendentes){
    const chave = chaveSessaoImportacao(arq);
    const qtd = arq.exemplares ?? arq.itens.reduce((soma,item)=>soma+item.qtd,0);
    totais.set(chave,qtd);
    if(!marcadasImportacao.has(chave))continue;
    produtos += arq.itens.length;
    exemplares += qtd;
    for(const item of arq.itens){
      const primeira = codigos.get(item.codigo);
      if(primeira===undefined)codigos.set(item.codigo,chave);
      if(item.repetido || (primeira!==undefined && primeira!==chave))incluirAlerta(item.codigo,primeira??chave,chave);
    }
  }
  for(const sessao of Object.values(lista?.sessoes||{})){
    const chave = nomeNormalizado(sessao.nome);
    if(!existentes.has(chave))existentes.set(chave,[]);
    existentes.get(chave).push(sessao);
    if(!codigos.size || marcadasImportacao.has(chave))continue;
    for(const item of sessao.itens||[]){
      const primeira = codigos.get(item.codigo);
      if(primeira!==undefined && primeira!==chave)incluirAlerta(item.codigo,primeira,chave);
    }
  }
  const porSessao = new Map();
  for(const locais of locaisDeAlerta.values()){
    for(const chave of locais)porSessao.set(chave,(porSessao.get(chave)||0)+1);
  }
  previaCalculada = {arquivos:arquivosPendentes,lista,revisao,selecao:revisaoSelecaoImportacao,
    existentes,totais,porSessao,produtos,exemplares,alertas:locaisDeAlerta.size};
  return previaCalculada;
}

function renderPreviaImportacao(foco){
  const area = document.getElementById('area-btn-import');
  area.style.display = arquivosPendentes.length && !leitorDauerAtivo?'block':'none';
  if(!arquivosPendentes.length || leitorDauerAtivo)return;
  const sel = document.getElementById('sel-lista-import');
  sel.disabled = rascunhoIniciado || importando;
  const lista = abasBipe[sel.value];
  const {existentes,totais,porSessao,produtos,exemplares,alertas} = calcularPreviaImportacao(lista);
  document.getElementById('previa-totais').textContent = marcadasImportacao.size+' de '+arquivosPendentes.length+
    ' sessões selecionadas · '+numeroImportacao.format(produtos)+' produtos · '+numeroImportacao.format(exemplares)+
    ' exemplares · '+numeroImportacao.format(alertas)+' ISBNs com divergência';
  const busca = textoDeBusca(document.getElementById('buscar-previa').value);
  const body = document.getElementById('previa-sessoes');
  const filtradas = arquivosPendentes.filter(arq=>!busca || textoDeBusca(arq.secao).includes(busca));
  body.innerHTML = paginar('pag-previa',filtradas,40,JSON.stringify([idRascunho,busca])).map(arq=>{
    const chave = chaveSessaoImportacao(arq);
    const anteriores = existentes.get(chave)||[];
    const acao = !lista?'Escolha a lista':!lista.sessoesCarregadas?'Carregando…':anteriores.length>1?'Nome duplicado na lista':
      !anteriores.length?'Criar':anteriores[0].catalogo===arq.versao?'Já atualizada':'Atualizar';
    return `<tr><td><input type="checkbox" aria-label="Incluir ${esc(arq.secao)}" data-chave="${esc(chave)}"
      ${marcadasImportacao.has(chave)?'checked':''} ${importando?'disabled':''}
      onchange="marcarSessaoImportacao(this.dataset.chave,this.checked)"></td>
      <td>${esc(arq.secao)}</td><td>${numeroImportacao.format(arq.itens.length)}</td>
      <td>${numeroImportacao.format(totais.get(chave))}</td><td>${acao}</td><td>${porSessao.get(chave)||'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="6">Nenhuma sessão encontrada.</td></tr>';
  if(foco && !importando)Array.from(body.querySelectorAll('input')).find(el=>el.dataset.chave===foco)?.focus({preventScroll:true});
  const btn = document.getElementById('btn-import');
  btn.disabled = importando || !marcadasImportacao.size || !lista;
  if(!importando)btn.textContent = rascunhoIniciado?'Continuar importação':'Confirmar importação';
  document.getElementById('btn-descartar-import').disabled = importando;
  for(const controle of area.querySelectorAll('.previa-acoes button'))controle.disabled = importando;
}

async function planejarImportacao(listaId){
  const lista = await carregarCatalogoServidor(listaId,{somenteMetadados:true});
  const porNome = new Map();
  for(const doc of lista.documentos){
    const nome = nomeNormalizado(doc.get('nome'));
    if(!porNome.has(nome))porNome.set(nome,[]);
    porNome.get(nome).push(doc);
  }
  const lote = [];
  const ambiguas = [];
  for(const arq of arquivosPendentes){
    const chave = chaveSessaoImportacao(arq);
    if(!marcadasImportacao.has(chave))continue;
    const encontradas = porNome.get(chave)||[];
    if(encontradas.length>1)ambiguas.push(arq);
    else lote.push({arq,anterior:encontradas[0]});
  }
  const alteradas = new Map(lote.filter(({arq,anterior})=>arq.versao!==anterior?.get('catalogo'))
    .map(({arq,anterior})=>[anterior?.id || chaveSessaoImportacao(arq),arq]));
  if(!alteradas.size || !lista.documentos.length)return {lista,lote,ambiguas,protegidas:[]};

  lista.sessoes = (await hidratarCatalogoServidor(listaId,lista)).sessoes;
  let legado = baseMap;
  if(!baseCarregada && Object.values(lista.sessoes).some(s=>!s.catalogo)){
    const snap = await db.collection('base').get(servidor);
    legado = new Map(snap.docs.map(doc=>[doc.id,doc.data()]));
  }
  const {itens} = montarCatalogos({[listaId]:lista},legado);
  const antes = new Map();
  const depois = new Map();

  function alocar(mapa,codigo,sid){
    if(!mapa.has(codigo))mapa.set(codigo,new Set());
    mapa.get(codigo).add(sid);
  }
  for(const item of itens){
    if(item.listaId!==listaId)continue;
    alocar(antes,item.codigo,item.sessaoId);
    if(!alteradas.has(item.sessaoId))alocar(depois,item.codigo,item.sessaoId);
  }
  for(const [sid,arq] of alteradas){
    for(const item of arq.itens)alocar(depois,item.codigo,sid);
  }
  const afetadas = new Set();
  const codigosAlterados = new Set();
  for(const [codigo,locais] of antes){
    const novos = depois.get(codigo);
    if(novos && novos.size===locais.size && [...locais].every(sid=>novos.has(sid)))continue;
    codigosAlterados.add(codigo);
    for(const sid of locais)afetadas.add(sid);
    for(const sid of novos||[])if(lista.sessoes[sid])afetadas.add(sid);
  }
  const protegidas = [];
  const candidatas = [...afetadas];
  for(let i=0;i<candidatas.length;i+=20){
    const ids = candidatas.slice(i,i+20);
    const leituras = await Promise.all(ids.map(sid=>bipesRef(listaId,sid).limit(1).get(servidor)));
    leituras.forEach((snap,j)=>{if(!snap.empty)protegidas.push(lista.sessoes[ids[j]].nome);});
  }
  if(afetadas.size && !protegidas.length){
    const bipesDiretos = await listaRef(listaId).collection('bipes').get(servidor);
    if(bipesDiretos.docs.some(doc=>!doc.get('resultado') && codigosAlterados.has(codigoNormalizado(doc.get('codigo'))))){
      protegidas.push('Bipagens antigas sem sessão');
    }
  }
  return {lista,lote,ambiguas,protegidas};
}
