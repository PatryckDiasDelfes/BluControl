/* As consultas por ancestral evitam trazer o histórico para contar registros. */
const origemFirestoreHttp = 'https://firestore.googleapis.com';
const camposLeitura = ['codigo','operador','uid','cor','at','resultado','alerta','statusManual','eventoId'];

async function consultarBipesFirestore(listaId,sessaoId,acao,consulta){
  const usuario = auth.currentUser;
  if(!usuario || usuario.uid!==ME.uid)throw new Error('Entre novamente para consultar bipagens.');
  const token = await usuario.getIdToken();
  if(auth.currentUser?.uid!==usuario.uid)throw new Error('A sessão de acesso mudou.');
  const projeto = encodeURIComponent(firebase.app().options.projectId);
  const lista = 'abas/'+encodeURIComponent(listaId);
  const pasta = sessaoId && sessaoId!==semSessaoId?lista+'/sessoes/'+encodeURIComponent(sessaoId):lista;
  const resposta = await fetch(origemFirestoreHttp+'/v1/projects/'+projeto+'/databases/(default)/documents/'+pasta+':'+acao,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(consulta),cache:'no-store',signal:AbortSignal.timeout(30000)
  });
  if(!resposta.ok){
    const falha = await resposta.json().catch(()=>null);
    if(falha?.error?.status==='FAILED_PRECONDITION')throw new Error('A consulta ainda requer os índices de bipagem do Firestore. Confira a configuração do projeto.');
    const erro = new Error('Não foi possível consultar as bipagens.');
    erro.code = resposta.status===401?'unauthenticated':resposta.status===403?'permission-denied':'unavailable';
    throw erro;
  }
  return resposta.json();
}

function escopoDaConsulta(sessaoId){
  return [{collectionId:'bipes',allDescendants:!sessaoId}];
}

async function contarBipesNoServidor(listaId,sessaoId){
  const respostas = await consultarBipesFirestore(listaId,sessaoId,'runAggregationQuery',{
    structuredAggregationQuery:{structuredQuery:{from:escopoDaConsulta(sessaoId)},aggregations:[{alias:'total',count:{}}]}
  });
  const total = Number(respostas.find(r=>r.result)?.result.aggregateFields.total.integerValue);
  if(!Number.isSafeInteger(total) || total<0)throw new Error('A contagem retornou um resultado inválido.');
  return total;
}

function leituraDaConsulta(doc,listaId){
  const partes = doc.name.split('/documents/')[1]?.split('/')||[];
  const direta = partes.length===4 && partes[2]==='bipes';
  const emSessao = partes.length===6 && partes[2]==='sessoes' && partes[4]==='bipes';
  if(partes[0]!=='abas' || partes[1]!==listaId || (!direta && !emSessao))return null;
  const dados = {};
  for(const campo of camposLeitura){
    const valor = doc.fields?.[campo];
    if(!valor)continue;
    if(valor.timestampValue){
      const data = Date.parse(valor.timestampValue);
      if(Number.isFinite(data))dados[campo] = firebase.firestore.Timestamp.fromMillis(data);
    }else dados[campo] = valor.stringValue??valor.integerValue??valor.doubleValue??valor.booleanValue??null;
  }
  return {...dados,id:partes.at(-1),listaId,sessaoId:direta?semSessaoId:partes[3]};
}

async function consultarLeituras(listaId,{sessaoId,limite,cursor,uid}={}){
  const structuredQuery = {from:escopoDaConsulta(sessaoId),select:{fields:camposLeitura.map(fieldPath=>({fieldPath}))}};
  if(uid)structuredQuery.where = {fieldFilter:{field:{fieldPath:'uid'},op:'EQUAL',value:{stringValue:uid}}};
  if(limite){
    structuredQuery.limit = limite;
    structuredQuery.orderBy = [{field:{fieldPath:'at'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}];
    if(cursor)structuredQuery.startAt = {values:cursor,before:false};
  }
  const resposta = await consultarBipesFirestore(listaId,sessaoId,'runQuery',{structuredQuery});
  const docs = resposta.filter(r=>r.document).map(r=>r.document);
  const ultimo = docs.at(-1);
  return {
    leituras:docs.map(doc=>leituraDaConsulta(doc,listaId)).filter(Boolean),
    cursor:ultimo?.fields?.at?.timestampValue?[{timestampValue:ultimo.fields.at.timestampValue},{referenceValue:ultimo.name}]:null,
    mais:Boolean(limite && docs.length===limite)
  };
}

async function mapearEmLotes(valores,limite,tarefa){
  const resultados = [];
  for(let i=0;i<valores.length;i+=limite)resultados.push(...await Promise.all(valores.slice(i,i+limite).map(tarefa)));
  return resultados;
}

const totaisConsultados = new Map(), filaTotais = [];
let totaisEmCurso = 0;

function totalDaConferencia(listaId,sessaoId){
  const lista = abasBipe[listaId];
  if(!lista || lista.excluindo)return null;
  const sessao = sessaoId && sessaoId!==semSessaoId?lista.sessoes[sessaoId]:null;
  if(sessao?.excluindo)return null;
  if(sessao?.acompanharBipes===false && sessao.criadaNaFase2 && !acompanharVazias(lista))return 0;
  const chave = JSON.stringify([listaId,sessaoId||'']);
  const revisao = lista.revisao||0;
  let anterior = totaisConsultados.get(chave);
  if(!anterior || (!anterior.pendente && (anterior.revisao!==revisao || anterior.expira<Date.now()))){
    const espera = sessaoId?3500:650;
    const falta = anterior?espera-(Date.now()-anterior.hora):0;
    if(falta<=0){
      clearTimeout(anterior?.atualizacao);
      anterior = {listaId,revisao,total:anterior?.total??null,pendente:true,hora:Date.now(),expira:Infinity};
      totaisConsultados.set(chave,anterior);
      filaTotais.push({chave,anterior,listaId,sessaoId});
      executarFilaTotais();
    }else if(!anterior.atualizacao)anterior.atualizacao = setTimeout(()=>{anterior.atualizacao=null;agendarRender();},falta);
  }
  return anterior.total;
}

function executarFilaTotais(){
  while(totaisEmCurso<5 && filaTotais.length){
    const {chave,anterior,listaId,sessaoId} = filaTotais.shift();
    if(totaisConsultados.get(chave)!==anterior)continue;
    if(!abasBipe[listaId] || !['conferencia','bipe'].includes(telaAtual) ||
      (sessaoId && (!abasBipe[listaId].sessoes[sessaoId] || listaId!==ME.listaAtiva))){
      totaisConsultados.delete(chave);
      continue;
    }
    totaisEmCurso++;
    contarBipesNoServidor(listaId,sessaoId).then(total=>{anterior.total=total;anterior.expira=Infinity;})
      .catch(()=>{anterior.expira=Date.now()+30000;}).finally(()=>{
        totaisEmCurso--;anterior.pendente=false;
        if(totaisConsultados.get(chave)===anterior)agendarRender();
        executarFilaTotais();
      });
  }
}

function esquecerTotaisDaLista(id){
  for(const [chave,total] of totaisConsultados){
    if(total.listaId!==id)continue;
    clearTimeout(total.atualizacao);
    totaisConsultados.delete(chave);
  }
}

const detalhesListas = new Map();

function pedirDetalhesDaLista(id,forcar=false){
  if(!id)return null;
  const anterior = detalhesListas.get(id);
  if(anterior?.pedido || (anterior && !forcar))return anterior;
  const estado = {lista:anterior?.lista};
  detalhesListas.set(id,estado);
  estado.pedido = carregarConferencia(id,{incluirAtividade:false,incluirRevisoes:false}).then(lista=>{
    estado.lista = lista;
    return lista;
  }).catch(erro=>{estado.erro=mensagemErro(erro);return null;}).finally(()=>{
    estado.pedido = null;
    if(detalhesListas.get(id)===estado)agendarRender(false,true);
  });
  return estado;
}

function detalhesDesatualizados(id,estado){
  return estado?.lista && abasBipe[id] && (estado.lista.revisao||0)!==(abasBipe[id].revisao||0);
}

function atualizarDetalhesDaTela(){
  const id = telaAtual==='divergencias'?document.getElementById('revisao-lista').value:ME.listaAtiva;
  pedirDetalhesDaLista(id,true);
  agendarRender();
}
