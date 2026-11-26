/* Dados de estoque e persistência no Firestore. */
const servidor = {source:'server'};
const sessoesPorLote = 60;
const bytesPorGravacaoImportacao = 1500000;
const fusoBlulivro = 'America/Sao_Paulo';
const dataBr = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:fusoBlulivro});
const diaArquivo = new Intl.DateTimeFormat('sv-SE',{timeZone:fusoBlulivro});
const idControleListas = '_controle_listas';
const semSessaoId = 'legado';

function avancarRevisao(snap){
  const r = snap.get('revisao')||0;
  return {revisao:r+1,revisaoAcompanhamento:(snap.get('revisaoAcompanhamento')??r)+1};
}

function lerCatalogoSessao(ref,dados){
  if(dados.catalogoInline?.versao===dados.catalogo){
    try{
      const itens = JSON.parse(dados.catalogoInline.dados);
      if(Array.isArray(itens))return itens;
    }catch{ /* Catálogos anteriores permanecem disponíveis em partes. */ }
  }
  return lerPartes(ref.collection('catalogos'),dados.catalogo,dados.partes);
}

function timestamp(){
  return firebase.firestore.FieldValue.serverTimestamp();
}

function listaRef(listaId){
  return db.collection('abas').doc(listaId);
}

function controleListasRef(){
  return db.collection('conferencias').doc(idControleListas);
}

function docSessao(listaId,sessaoId){
  return listaRef(listaId).collection('sessoes').doc(sessaoId);
}

function bipesRef(listaId,sessaoId){
  return (sessaoId === semSessaoId ? listaRef(listaId) : docSessao(listaId,sessaoId)).collection('bipes');
}

function listaAberta(snap){
  if(!snap.exists || snap.get('finalizadaEm') || snap.get('arquivadaEm') || snap.get('excluindo')){
    throw new Error('Esta lista foi finalizada, arquivada, excluída ou está em exclusão.');
  }
}

function mensagemErro(erro){
  const codigo = (erro?.code || '').split('/').pop();
  if(codigo === 'permission-denied' || codigo === 'unauthenticated'){
    return 'O Firebase negou o acesso. Confira o perfil da conta e as regras do Firestore.';
  }
  if(codigo === 'operation-not-allowed' || codigo === 'configuration-not-found'){
    return 'Confira se o método E-mail/senha está ativado no Firebase Authentication.';
  }
  if(codigo === 'unavailable' || codigo === 'network-request-failed' || codigo === 'deadline-exceeded'){
    return 'A conexão com o Firebase falhou. Confira a internet e tente novamente.';
  }
  return erro?.message || 'Ocorreu um erro inesperado.';
}

function idsDoControle(snap){
  const ids = snap.exists?snap.get('ids'):null;
  return Array.isArray(ids)?ids.filter(id=>typeof id==='string' && id && !id.includes('/')):[];
}

async function idsAtivasObservadas(){
  const listas = await db.collection('abas').get(servidor);
  return listas.docs.filter(doc=>!doc.get('finalizadaEm') && !doc.get('arquivadaEm') && !doc.get('excluindo')).map(doc=>doc.id);
}

async function criarListaNoBanco(nome){
  const controle = controleListasRef();
  const ref = db.collection('abas').doc();
  const observadas = await idsAtivasObservadas();
  await db.runTransaction(async tx=>{
    const snap = await tx.get(controle);
    // Confere as vagas com os documentos reais, inclusive os de versões antigas.
    const candidatas = [...new Set([...idsDoControle(snap),...observadas])];
    const listas = await Promise.all(candidatas.map(id=>tx.get(listaRef(id))));
    const ids = listas.filter(doc=>doc.exists && !doc.get('finalizadaEm') && !doc.get('arquivadaEm') && !doc.get('excluindo')).map(doc=>doc.id);
    if(ids.length >= 4)throw new Error('Já existem quatro listas. Finalize ou exclua uma para liberar uma vaga.');
    tx.set(controle,{ids:[...ids,ref.id]},{merge:true});
    tx.set(ref,{nome,criadoPor:ME.nome,criadoPorUid:ME.uid,criadoEm:timestamp(),revisao:0,revisaoAcompanhamento:0,revisaoCatalogo:0,versoes:{},semBipesDiretosAntigos:true});
  });
  return ref;
}

function* separarDocumentos(linhas){
  let parte = [];
  let bytes = 2;
  for(const linha of linhas){
    const dado = JSON.stringify(linha);
    const tamanho = encoder.encode(dado).length + 1;
    if(tamanho > 300000)throw new Error('Há um item grande demais para armazenar no Firebase.');
    if(bytes + tamanho > 300000 && parte.length){
      yield {dados:'['+parte.join(',')+']',tamanho:bytes-1,quantidade:parte.length};
      parte = [];
      bytes = 2;
    }
    parte.push(dado);
    bytes += tamanho;
  }
  if(parte.length)yield {dados:'['+parte.join(',')+']',tamanho:bytes-1,quantidade:parte.length};
}

async function gravarPartes(ref,versao,partes){
  // O tamanho das partes mantém cada requisição abaixo do limite do Firestore.
  for(let inicio=0;inicio<partes.length;inicio+=20){
    const batch = db.batch();
    for(let i=inicio;i<Math.min(inicio+20,partes.length);i++){
      batch.set(ref.doc(versao+'_'+i),{versao,indice:i,dados:partes[i]});
    }
    await batch.commit();
  }
}

async function lerPartes(ref,versao,esperadas){
  const snap = await ref.where('versao','==',versao).get(servidor);
  const partes = snap.docs.map(doc=>doc.data()).sort((a,b)=>a.indice-b.indice);
  if(partes.length!==esperadas || partes.some((p,i)=>p.indice!==i)){
    throw new Error('Os dados salvos estão incompletos. Atualize a página e tente novamente.');
  }
  return partes.flatMap(parte=>JSON.parse(parte.dados));
}

async function gravarPartesDaImportacao(lista,preparados,revisaoEsperada){
  let lote = [];
  let bytes = 0;
  async function gravar(){
    await db.runTransaction(async tx=>{
      const pai = await tx.get(lista);
      listaAberta(pai);
      if((pai.get('revisao')||0)!==revisaoEsperada){
        throw new Error('A lista recebeu alterações durante a importação. Revise as sessões pendentes.');
      }
      const ids = [...new Set(lote.map(parte=>parte.sessaoId))];
      tx.update(lista,{catalogosPendentes:firebase.firestore.FieldValue.arrayUnion(...ids)});
      for(const {ref,parte} of lote)tx.set(ref,parte);
    });
    lote = [];
    bytes = 0;
  }
  for(const {ref,versao,partes} of preparados){
    const colecao = ref.collection('catalogos');
    for(let indice=0;indice<partes.length;indice++){
      const {dados,tamanho:bytesParte} = partes[indice];
      const tamanho = bytesParte + 300;
      if(lote.length===300 || bytes+tamanho>bytesPorGravacaoImportacao)await gravar();
      lote.push({ref:colecao.doc(versao+'_'+indice),sessaoId:ref.id,parte:{versao,indice,dados}});
      bytes += tamanho;
    }
  }
  if(lote.length)await gravar();
}

async function salvarCatalogosDaImportacao(listaId,lote,catalogosEmMemoria,revisaoEsperada,aoAguardarFirebase){
  const lista = listaRef(listaId);
  const resultados = [];
  const preparados = [];
  const preparacao = await Promise.allSettled(lote.map(async ({arq,anterior})=>{
    if(anterior?.get('excluindo'))throw new Error('A sessão está em exclusão.');
    const versao = arq.versao || await assinatura(JSON.stringify(arq.itens));
    const sid = anterior?.id || 's_'+await assinatura(nomeNormalizado(arq.secao));
    const igual = anterior?.get('catalogo')===versao;
    return {arq,anterior,ref:docSessao(listaId,sid),versao,igual};
  }));
  let limiteDaVez = performance.now()+8;
  for(const [i,r] of preparacao.entries()){
    const arq = lote[i].arq;
    if(r.status==='rejected'){resultados.push({arq,erro:r.reason});continue;}
    const preparado = r.value;
    try{
      if(preparado.igual)resultados.push({arq,alterou:false});
      else{
        preparado.partes = [];
        for(const parte of separarDocumentos(arq.itens)){
          preparado.partes.push(parte);
          // Permite que a tela atualize entre partes de um catálogo grande.
          if(performance.now()>=limiteDaVez){
            await new Promise(resolver=>setTimeout(resolver,0));
            limiteDaVez = performance.now()+8;
          }
        }
        preparados.push(preparado);
      }
      catalogosEmMemoria.set(preparado.versao,arq.itens);
    }catch(erro){resultados.push({arq,erro});}
  }
  if(!preparados.length)return {resultados,revisao:revisaoEsperada};

  try{
    // As partes ficam invisíveis para a bipagem até a transação publicar a versão.
    let bytes = 0;
    let escritas = preparados.length+1;
    for(const p of preparados){
      const tamanho = p.partes.length===1?p.partes[0].tamanho:0;
      p.inline = tamanho && tamanho<=65536?p.partes[0].dados:null;
      bytes += (p.inline?tamanho:0)+1000;
      for(const parte of p.partes)bytes += parte.tamanho+300;
      escritas += p.partes.length;
    }
    const atomica = bytes <= bytesPorGravacaoImportacao && escritas <= 300;
    aoAguardarFirebase?.();
    if(!atomica)await gravarPartesDaImportacao(lista,preparados,revisaoEsperada);
    const gravados = await db.runTransaction(async tx=>{
      const pai = await tx.get(lista);
      listaAberta(pai);
      const revisao = pai.get('revisao')||0;
      if(revisao!==revisaoEsperada){
        throw new Error('A lista recebeu alterações depois da prévia. Revise as sessões pendentes para continuar.');
      }
      const estados = await Promise.all(preparados.map(({anterior,ref})=>{
        if(anterior?.get('catalogo') && pai.get('versoes')?.[ref.id]===anterior.get('catalogo'))return anterior;
        return tx.get(ref);
      }));
      const versoes = {...pai.get('versoes')};
      let mudou = false;
      const rsp = preparados.map(({arq,anterior,ref,versao,partes,inline},i)=>{
        const atual = estados[i];
        if(atual.get('excluindo') || (anterior && !atual.exists)){
          return {arq,erro:new Error('A sessão mudou durante a importação. Selecione os arquivos novamente.')};
        }
        if(atual.get('catalogo')===versao)return {arq,alterou:false};
        if(atual.get('catalogo')!==anterior?.get('catalogo') || (!anterior && atual.exists)){
          return {arq,erro:new Error('Outra operação alterou esta sessão. Recarregue os dados e tente novamente.')};
        }
        const dados = {nome:arq.secao,arquivoOrigem:arq.nome,catalogo:versao,partes:partes.length,
          catalogoInline:inline?{versao,dados:inline}:null};
        if(atomica)partes.forEach(({dados},indice)=>{
          tx.set(ref.collection('catalogos').doc(versao+'_'+indice),{versao,indice,dados});
        });
        if(!atual.exists)Object.assign(dados,{criadoPor:ME.nome,criadoEm:timestamp(),criadaNaFase2:true,acompanharBipes:false});
        tx.set(ref,dados,{merge:true});
        versoes[ref.id] = versao;
        mudou = true;
        return {arq,alterou:true};
      });
      const atualizacao = mudou?{versoes,revisaoCatalogo:(pai.get('revisaoCatalogo')||0)+1,...avancarRevisao(pai)}:{};
      if(!atomica){
        const concluidas = preparados.filter((_,i)=>!rsp[i].erro).map(({ref})=>ref.id);
        if(concluidas.length)atualizacao.catalogosPendentes = firebase.firestore.FieldValue.arrayRemove(...concluidas);
      }
      if(Object.keys(atualizacao).length)tx.update(lista,atualizacao);
      return {resultados:rsp,revisao:revisao+(mudou?1:0)};
    });
    return {resultados:[...resultados,...gravados.resultados],revisao:gravados.revisao};
  }catch(erro){
    for(const {arq} of preparados)resultados.push({arq,erro});
    return {resultados,revisao:revisaoEsperada,interromper:true};
  }
}

async function registrarBipeNoBanco(listaId,rota,codigo,revisaoCatalogo,eventoId){
  const lista = listaRef(listaId);
  const sessao = rota.item ? docSessao(listaId,rota.item.sessaoId) : null;
  const scans = bipesRef(listaId,rota.item?.sessaoId || semSessaoId);
  const scan = eventoId?scans.doc(eventoId):scans.doc();
  const recibo = eventoId?lista.collection('atividadeBipagem').doc(eventoId):null;
  const contador = sessao ? sessao.collection('contagens').doc(await assinatura(codigo)) : null;
  let baseLegada;
  if(contador && !rota.sessaoNova && !(await contador.get(servidor)).exists){
    const anterior = await lista.get(servidor);
    const bipes = await scan.parent.get(servidor);
    const qtd = bipes.docs.filter(doc=>codigoNormalizado(doc.get('codigo'))===codigo).length;
    baseLegada = {qtd,revisao:anterior.get('revisao')||0};
  }
  const diretosLegados = rota.diretosLegados;
  return db.runTransaction(async tx=>{
    const pai = await tx.get(lista);
    if(recibo){
      const confirmado = await tx.get(recibo);
      if(confirmado.exists){
        if(confirmado.get('uid')!==ME.uid || confirmado.get('codigo')!==codigo)throw new Error('O identificador pertence a outro evento.');
        return {duplicado:true};
      }
    }
    listaAberta(pai);
    if((pai.get('revisaoCatalogo')||0)!==revisaoCatalogo){
      throw new Error('O catálogo mudou. Aguarde a atualização e registre o código novamente.');
    }
    let quantidade = null;
    if(sessao){
      const [estado,cnt] = await Promise.all([tx.get(sessao),tx.get(contador)]);
      if(!estado.exists || estado.get('excluindo'))throw new Error('A sessão foi removida ou está em exclusão.');
      if(!cnt.exists && !estado.get('criadaNaFase2') && baseLegada?.revisao!==(pai.get('revisao')||0)){
        throw new Error('As bipagens mudaram durante a contagem. Registre este código novamente.');
      }
      if(diretosLegados && diretosLegados.revisao!==(pai.get('revisaoLegados')||0)){
        throw new Error('Uma bipagem antiga foi removida. Registre este código novamente.');
      }
      const qtdSessao = (cnt.exists ? cnt.get('quantidade') : baseLegada?.qtd || 0) + 1;
      quantidade = qtdSessao + (diretosLegados?.qtd||0);
      tx.set(contador,{codigo,quantidade:qtdSessao,ultimoBipeId:scan.id});
      if(estado.get('acompanharBipes')===false)tx.update(sessao,{acompanharBipes:true});
    }
    const status = rota.status || (quantidade>rota.item.qtd?'EXCEDIDO':quantidade===rota.item.qtd?'OK':'PARCIAL');
    const dados = {
      codigo,operador:ME.nome,uid:ME.uid,contadorId:contador?.id||'',cor:ME.cor,at:timestamp(),comentario:'',statusManual:'',foto:'',
      resultado:status,alerta:status==='ALERTA',alertaTipo:rota.motivo||''
    };
    if(recibo){
      dados.eventoId = eventoId;
      tx.set(recibo,{tipo:'bipe',uid:ME.uid,codigo,sessaoId:rota.item?.sessaoId||semSessaoId,at:timestamp()});
    }
    tx.set(scan,dados);
    tx.update(pai.ref,{...avancarRevisao(pai)});
    return {status,quantidade};
  });
}

async function removerBipeNoBanco(listaId,sessaoId,bipeId,desfazer=false){
  const lista = listaRef(listaId);
  const ref = bipesRef(listaId,sessaoId).doc(bipeId);
  return db.runTransaction(async tx=>{
    const [pai,bipe] = await Promise.all([tx.get(lista),tx.get(ref)]);
    listaAberta(pai);
    if(!bipe.exists)return false;
    let recibo;
    if(desfazer){
      if(bipe.get('uid')!==ME.uid || bipe.get('eventoId')!==bipeId)throw new Error('Só é possível desfazer uma leitura que você registrou.');
      recibo = lista.collection('atividadeBipagem').doc(bipeId);
      const confirmado = await tx.get(recibo);
      if(!confirmado.exists || confirmado.get('desfeitoEm'))throw new Error('O bipe já foi desfeito ou está indisponível.');
    }
    let contador, cnt;
    if(sessaoId!==semSessaoId){
      const sessao = docSessao(listaId,sessaoId);
      contador = sessao.collection('contagens').doc(await assinatura(codigoNormalizado(bipe.get('codigo'))));
      const estado = await tx.get(sessao);
      cnt = await tx.get(contador);
      if(!estado.exists || estado.get('excluindo'))throw new Error('A sessão está em exclusão.');
    }
    tx.delete(ref);
    if(cnt?.exists && cnt.get('quantidade')>0)tx.update(contador,{quantidade:cnt.get('quantidade')-1,ultimoBipeRemovidoId:bipeId});
    if(recibo)tx.update(recibo,{desfeitoEm:timestamp()});
    const revisoes = {...avancarRevisao(pai)};
    if(sessaoId===semSessaoId && !bipe.get('resultado')){
      revisoes.revisaoLegados = (pai.get('revisaoLegados')||0)+1;
    }
    tx.update(lista,revisoes);
    return true;
  });
}

async function apagarColecao(ref){
  for(;;){
    const snap = await ref.limit(400).get(servidor);
    if(snap.empty)return;
    const batch = db.batch();
    snap.docs.forEach(doc=>batch.delete(doc.ref));
    await batch.commit();
  }
}

async function apagarDadosSessao(sessao){
  await Promise.all(['bipes','catalogos','contagens'].map(nome=>apagarColecao(sessao.collection(nome))));
}

function sinalizarExclusoes(tx,lista,sessoes){
  const versoes = {...lista.get('versoes')};
  for(const sessao of sessoes){
    delete versoes[sessao.id];
    tx.update(sessao.ref,{excluindo:true});
  }
  tx.update(lista.ref,{versoes,...avancarRevisao(lista),
    revisaoCatalogo:(lista.get('revisaoCatalogo')||0)+1,
    secoesExcluidas:firebase.firestore.FieldValue.arrayUnion(...sessoes.map(s=>nomeNormalizado(s.get('nome'))))});
}

async function excluirSessaoNoBanco(listaId,sessaoId){
  const lista = listaRef(listaId);
  const sessao = docSessao(listaId,sessaoId);
  const bloqueada = await db.runTransaction(async tx=>{
    const [pai,estado] = await Promise.all([tx.get(lista),tx.get(sessao)]);
    listaAberta(pai);
    if(!estado.exists)return false;
    if(!estado.get('excluindo'))sinalizarExclusoes(tx,pai,[estado]);
    return true;
  });
  if(!bloqueada)return false;
  await apagarDadosSessao(sessao);
  await sessao.delete();
  return true;
}

async function excluirListaNoBanco(listaId,informarProgresso){
  const lista = listaRef(listaId);
  const controle = controleListasRef();
  const observadas = await idsAtivasObservadas();
  const pendentes = await db.runTransaction(async tx=>{
    const [atual,ctrl] = await Promise.all([tx.get(lista),tx.get(controle)]);
    if(!atual.exists)return null;
    if(atual.get('finalizadaEm'))throw new Error('A lista não pode ser excluída.');
    if(!atual.get('excluindo'))tx.update(lista,{excluindo:true,...avancarRevisao(atual)});
    const ids = ctrl.exists?idsDoControle(ctrl):observadas;
    tx.set(controle,{ids:ids.filter(id=>id!==listaId)},{merge:true});
    return atual.get('catalogosPendentes')||[];
  });
  if(pendentes===null)return false;

  const sessoes = await lista.collection('sessoes').get(servidor);
  const ids = [...new Set([...sessoes.docs.map(doc=>doc.id),...pendentes])];
  informarProgresso?.(0,ids.length);
  for(let i=0;i<ids.length;i+=6){
    const lote = ids.slice(i,i+6);
    const excluidas = await Promise.allSettled(lote.map(async id=>{
      const ref = docSessao(listaId,id);
      await apagarDadosSessao(ref);
      await ref.delete();
    }));
    const falha = excluidas.find(resultado=>resultado.status==='rejected');
    if(falha)throw falha.reason;
    informarProgresso?.(i+lote.length,ids.length);
  }
  await apagarColecao(lista.collection('bipes'));
  await apagarColecao(lista.collection('revisoes'));
  await apagarColecao(lista.collection('atividadeBipagem'));
  await lista.delete();
  return true;
}

async function lerBaseLegadaNoServidor(){
  const snap = await db.collection('base').get(servidor);
  return new Map(snap.docs.map(doc=>[doc.id,doc.data()]));
}

async function carregarConferencia(listaId,{incluirAtividade=true,incluirRevisoes=true}={}){
  const lista = listaRef(listaId);
  const lerBipes = async ref=>(await ref.collection('bipes').get(servidor)).docs.map(doc=>({id:doc.id,...doc.data()}));
  for(let tentativa=0;tentativa<3;tentativa++){
    const pai = await lista.get(servidor);
    listaAberta(pai);
    const [snapSessoes,consulta,revisoes,atividade] = await Promise.all([
      lista.collection('sessoes').get(servidor),
      consultarLeituras(listaId).catch(erro=>{if(erro.code==='permission-denied')return null;throw erro;}),
      incluirRevisoes?lista.collection('revisoes').get(servidor):null,
      incluirAtividade?lista.collection('atividadeBipagem').get(servidor):null
    ]);
    const leituras = new Map();
    for(const bipe of consulta?.leituras||[]){
      if(!leituras.has(bipe.sessaoId))leituras.set(bipe.sessaoId,[]);
      leituras.get(bipe.sessaoId).push(bipe);
    }
    const [entradas,bipes,baseLegada] = await Promise.all([
      mapearEmLotes(snapSessoes.docs,6,async doc=>{
        const dados = doc.data();
        if(dados.excluindo)throw new Error('Aguarde o término da exclusão da sessão e atualize.');
        const [bipes,itens] = await Promise.all([
          consulta?leituras.get(doc.id)||[]:lerBipes(doc.ref),
          dados.catalogo?itensDaSessao(listaId,doc.id,dados):[]
        ]);
        return [doc.id,{...dados,itens,bipes}];
      }),
      consulta?leituras.get(semSessaoId)||[]:lerBipes(lista),
      snapSessoes.docs.some(doc=>!doc.get('catalogo'))?lerBaseLegadaNoServidor():null
    ]);
    const atual = await lista.get(servidor);
    listaAberta(atual);
    if(['revisao','revisaoCatalogo'].some(c=>(atual.get(c)||0)!==(pai.get(c)||0)))continue;
    return {...atual.data(),sessoes:Object.fromEntries(entradas),bipes,baseLegada,
      atividade:atividade?.docs.map(doc=>doc.data())||[],revisoes:revisoes?mapearRevisoes(revisoes):new Map()};
  }
  throw new Error('A lista mudou durante a consulta. Atualize para tentar novamente.');
}

async function guardarConferencia(listaId,relatorio,revisao){
  const lista = listaRef(listaId);
  const controle = controleListasRef();
  const ref = db.collection('conferencias').doc(listaId);
  const partes = Array.from(separarDocumentos(relatorio.rows),parte=>parte.dados);
  const versao = await assinatura(JSON.stringify(relatorio.rows));
  await gravarPartes(ref.collection('partes'),versao,partes);
  const {rows,...dados} = relatorio;
  const antigas = await idsAtivasObservadas();
  await db.runTransaction(async tx=>{
    const [pai,ctrl] = await Promise.all([tx.get(lista),tx.get(controle)]);
    listaAberta(pai);
    if((pai.get('revisao')||0)!==revisao){
      throw new Error('A lista mudou durante o fechamento. Confira o resultado atualizado e tente novamente.');
    }
    tx.set(ref,{...dados,versao,partes:partes.length,finalizadaEm:timestamp(),finalizadaPor:ME.nome,finalizadaPorUid:ME.uid});
    tx.update(lista,{finalizadaEm:timestamp()});
    const ids = ctrl.exists ? idsDoControle(ctrl) : antigas;
    tx.set(controle,{ids:ids.filter(id=>id!==listaId)});
  });
}

function montarCatalogos(listas,legado){
  const porLista = new Map();
  const porCodigo = new Map();
  const itens = [];
  const nomesLegados = new Map();
  const secoesTratadas = new Set();
  const alertas = new Set();

  function incluir(item){
    itens.push(item);
    if(!porCodigo.has(item.codigo))porCodigo.set(item.codigo,[]);
    porCodigo.get(item.codigo).push(item);
    if(!item.listaId)return;
    const daLista = porLista.get(item.listaId);
    if(!daLista.has(item.codigo))daLista.set(item.codigo,[]);
    daLista.get(item.codigo).push(item);
  }

  for(const [listaId,lista] of Object.entries(listas)){
    if(lista.excluindo || lista.finalizadaEm)continue;
    porLista.set(listaId,new Map());
    for(const secao of lista.secoesExcluidas||[])secoesTratadas.add(secao);
    for(const [sessaoId,sessao] of Object.entries(lista.sessoes||{})){
      const chave = nomeNormalizado(sessao.nome);
      secoesTratadas.add(chave);
      if(sessao.excluindo)continue;
      const origem = {listaId,sessaoId,lista:lista.nome,secao:sessao.nome};
      if(sessao.catalogo){
        for(const item of sessao.itens||[])incluir({...item,...origem});
      }else{
        if(!nomesLegados.has(chave))nomesLegados.set(chave,[]);
        nomesLegados.get(chave).push(origem);
      }
    }
  }

  for(const dado of legado.values()){
    const codigo = codigoNormalizado(dado.codigo);
    if(!codigo)continue;
    const nomes = [...new Set(txt(dado.secao).split(' / ').map(nomeNormalizado))];
    const encontrados = nomes.flatMap(nome=>nomesLegados.get(nome)||[]);
    const item = {codigo,titulo:txt(dado.titulo)||'—',qtd:num(dado.qtd,0)};
    const porListaLegada = new Map();
    for(const origem of encontrados)porListaLegada.set(origem.listaId,(porListaLegada.get(origem.listaId)||0)+1);
    for(const origem of encontrados)incluir({...item,...origem,qtd:porListaLegada.get(origem.listaId)===1?item.qtd:null});
    if(!encontrados.length && !nomes.some(nome=>secoesTratadas.has(nome))){
      incluir({...item,listaId:'',sessaoId:'',lista:'',secao:txt(dado.secao)||'—'});
    }
  }

  for(const catalogo of porLista.values()){
    for(const entradas of catalogo.values()){
      const duplicado = entradas.length>1 && new Set(entradas.map(item=>item.sessaoId)).size>1;
      for(const item of entradas){
        item.duplicado = duplicado;
        if(item.duplicado || item.repetido)alertas.add(item.listaId+'/'+item.sessaoId);
      }
    }
  }
  return {porLista,porCodigo,itens,alertas};
}

function identificarSessao(catalogos,listaId,codigo){
  const locais = catalogos.porLista.get(listaId)?.get(codigo)||[];
  if(locais.length && locais.some(item=>item.duplicado)){
    const sessoes = locais;
    return {status:'ALERTA',motivo:'ISBN_DUPLICADO',sessoes};
  }
  if(locais.length){
    const item = locais[0];
    return {item,status:item.repetido?'ALERTA':'',motivo:item.repetido?'ISBN_REPETIDO_NO_ARQUIVO':''};
  }
  return {status:'NÃO ENCONTRADO',motivo:'SEM_SESSAO',sessoes:[]};
}

function bipesDaLista(listaId,lista){
  const todos = (lista.bipes||[]).map(bipe=>({
    ...bipe,listaId,sessaoId:semSessaoId,
    secao:bipe.resultado?'Sem sessão identificada':'Bipagens antigas'
  }));
  for(const [sessaoId,sessao] of Object.entries(lista.sessoes||{})){
    if(sessao.excluindo)continue;
    for(const bipe of sessao.bipes||[])todos.push({...bipe,listaId,sessaoId,secao:sessao.nome});
  }
  return todos;
}

function dadosDoResumo(catalogos,listas,listaId){
  const itens = listaId ? catalogos.itens.filter(item=>item.listaId===listaId) : catalogos.itens;
  const bipes = listaId
    ? (listas[listaId] ? bipesDaLista(listaId,listas[listaId]) : [])
    : Object.entries(listas).flatMap(([id,lista])=>lista.excluindo||lista.finalizadaEm?[]:bipesDaLista(id,lista));
  const chave = (id,sid,codigo)=>JSON.stringify([id,sid,codigo]);
  const catalogo = new Map(itens.map(item=>[chave(item.listaId,item.sessaoId,item.codigo),item]));
  const contagem = new Map();
  const semCatalogo = new Map();
  for(const bipe of bipes){
    const codigo = codigoNormalizado(bipe.codigo);
    let k = chave(bipe.listaId,bipe.sessaoId,codigo);
    if(bipe.sessaoId===semSessaoId && !bipe.resultado && !bipe.alerta){
      // Leituras da versão anterior podem estar gravadas diretamente na lista.
      const atribuiveis = catalogos.porLista.get(bipe.listaId)?.get(codigo)||[];
      if(atribuiveis.length===1 && !atribuiveis[0].duplicado){
        k = chave(bipe.listaId,atribuiveis[0].sessaoId,codigo);
      }else if(!atribuiveis.length && !listaId){
        k = chave('','',codigo);
      }
    }
    if(catalogo.has(k)){
      const atual = contagem.get(k)||{qtd:0,alerta:false};
      atual.qtd++;
      atual.alerta ||= Boolean(bipe.alerta);
      atual.recontagem ||= bipe.statusManual==='Recontagem';
      contagem.set(k,atual);
      continue;
    }
    const status = bipe.alerta ? 'ALERTA' : 'NÃO ENCONTRADO';
    const key = chave(bipe.listaId,bipe.sessaoId,codigo)+'/'+status;
    if(!semCatalogo.has(key)){
      const titulo = catalogos.porCodigo.get(codigo)?.[0]?.titulo||'—';
      semCatalogo.set(key,{chaveRevisao:key,codigo,titulo,secao:bipe.secao,lista:listas[bipe.listaId]?.nome||'',esperado:0,bipado:0,dif:0,status});
    }
    const row = semCatalogo.get(key);
    row.bipado++;
    row.dif++;
    if(bipe.statusManual==='Recontagem')row.recontagemSolicitada = true;
  }

  const rows = [...catalogo].map(([k,item])=>{
    const contada = contagem.get(k);
    const bipado = contada?.qtd||0;
    const dif = item.qtd===null ? null : bipado-item.qtd;
    const status = item.duplicado || item.repetido || contada?.alerta ? 'ALERTA'
      : dif===0?'OK':bipado===0?'PENDENTE':dif>0?'EXCEDIDO':'FALTANDO';
    return {chaveRevisao:k,codigo:item.codigo,titulo:item.titulo,secao:item.secao,lista:item.lista,
      esperado:item.qtd,bipado,dif,status,...(contada?.recontagem?{recontagemSolicitada:true}:{})};
  });
  return {rows:[...rows,...semCatalogo.values()],bipes,totalProdutos:rows.length};
}

async function limparSessoesNoBanco(listaId,ids){
  const lista = listaRef(listaId);
  let removidas = 0;
  for(let i=0;i<ids.length;i+=60){
    const antes = await lista.get(servidor);
    listaAberta(antes);
    const possiveis = await Promise.all(ids.slice(i,i+60).map(async id=>{
      const doc = docSessao(listaId,id);
      return (await doc.collection('bipes').limit(1).get(servidor)).empty ? doc : null;
    }));
    const candidatas = possiveis.filter(Boolean);
    if(!candidatas.length)continue;
    const bloqueadas = await db.runTransaction(async tx=>{
      const pai = await tx.get(lista);
      listaAberta(pai);
      if((pai.get('revisao')||0)!==(antes.get('revisao')||0))return [];
      const sessoes = (await Promise.all(candidatas.map(doc=>tx.get(doc)))).filter(s=>s.exists);
      if(!sessoes.length)return [];
      sinalizarExclusoes(tx,pai,sessoes);
      return sessoes.map(s=>s.ref);
    });
    for(let j=0;j<bloqueadas.length;j+=8){
      const grupo = bloqueadas.slice(j,j+8);
      await Promise.all(grupo.map(apagarDadosSessao));
      const batch = db.batch();
      grupo.forEach(ref=>batch.delete(ref));
      await batch.commit();
      removidas += grupo.length;
    }
  }
  return removidas;
}
