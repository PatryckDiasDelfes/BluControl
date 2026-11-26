const estadosRevisao = {
  pendente:{nome:'Pendente',classe:'b-pend'},
  recontagem:{nome:'Em recontagem',classe:'b-falta'},
  resolvida:{nome:'Resolvida',classe:'b-ok'}
};
let listaEmRevisao = '';
let acompanhamentoRevisoes;
let edicaoRevisao;

function mapearRevisoes(snap){
  const revisoes = snap.docs.map(doc=>doc.data());
  return new Map(revisoes.map(revisao=>[revisao.chave,revisao]));
}

function dadosOriginaisDivergencia(linha){
  return JSON.stringify([linha.esperado,linha.bipado,linha.status,Boolean(linha.recontagemSolicitada)]);
}

function revisaoDaLinha(linha,revisoes){
  const revisao = revisoes.get(linha.chaveRevisao);
  return revisao && Object.hasOwn(estadosRevisao,revisao.estado) &&
    revisao.origem===dadosOriginaisDivergencia(linha)?revisao:undefined;
}

function agruparDivergencias(rows,revisoes){
  const totais = {pendente:0,recontagem:0,resolvida:0};
  const itens = [];
  for(const linha of rows){
    if(linha.status==='OK' && !linha.recontagemSolicitada)continue;
    const revisao = revisaoDaLinha(linha,revisoes);
    const estado = revisao?.estado || (linha.recontagemSolicitada && !revisoes.has(linha.chaveRevisao)?'recontagem':'pendente');
    totais[estado]++;
    itens.push({linha,revisao,estado});
  }
  return {itens,totais};
}

function textoDasRevisoes(totais){
  return `${totais.pendente} pendente(s), ${totais.recontagem} em recontagem e ${totais.resolvida} resolvida(s).`;
}

function pararRevisoes(){
  acompanhamentoRevisoes?.parar();
  acompanhamentoRevisoes = null;
}

function acompanharRevisoes(id){
  if(acompanhamentoRevisoes?.id===id)return;
  pararRevisoes();
  if(!id)return;
  const atual = {id,pronto:false};
  acompanhamentoRevisoes = atual;
  atual.parar = listaRef(id).collection('revisoes').onSnapshot({includeMetadataChanges:true},snap=>{
    atual.pronto = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
    atual.revisoes = mapearRevisoes(snap);
    agendarRender();
  },erro=>{
    atual.pronto = false;
    atual.erro = mensagemErro(erro);
    agendarRender();
  });
}

function renderDivergencias(){
  const select = document.getElementById('revisao-lista');
  const listas = Object.entries(abasBipe).filter(([,lista])=>!lista.excluindo);
  const idAnterior = select.value;
  const opcoes = listas.map(([id,lista])=>`<option value="${esc(id)}">${esc(lista.nome)}</option>`).join('');
  if(select.dataset.opcoes!==opcoes){
    select.innerHTML = opcoes||'<option value="">Nenhuma lista ativa</option>';
    select.dataset.opcoes = opcoes;
  }
  const disponiveis = new Set(listas.map(([id])=>id));
  const id = [listaEmRevisao,idAnterior,ME.listaAtiva,listas[0]?.[0]].find(valor=>disponiveis.has(valor))||'';
  listaEmRevisao = '';
  select.value = id;
  acompanharListasDaTela();
  acompanharRevisoes(id);
  const corpo = document.getElementById('tb-divergencias');
  const contador = document.getElementById('revisao-contagem');
  const detalhes = pedirDetalhesDaLista(id);
  const pronto = detalhes?.lista && acompanhamentoRevisoes?.pronto;
  const avisoDetalhes = textoDosDetalhes(id,detalhes);
  if(!pronto){
    const aviso = avisoDetalhes || acompanhamentoRevisoes?.erro || (id || !listasCarregadas?'Carregando a revisão da lista…':'Crie ou importe uma lista para revisar divergências.');
    contador.textContent = aviso;
    corpo.innerHTML = '';
    document.getElementById('pag-divergencias').hidden = true;
    return;
  }
  const {itens,totais} = agruparDivergencias(resumoAtual(id).rows,acompanhamentoRevisoes.revisoes);
  const filtro = document.getElementById('revisao-filtro').value;
  const busca = textoDeBusca(document.getElementById('revisao-busca').value);
  const filtradas = itens.filter(({linha,estado})=>
    (!filtro || (filtro==='abertas'?estado!=='resolvida':estado===filtro)) &&
    (!busca || [linha.codigo,linha.titulo,linha.secao].some(valor=>textoDeBusca(valor).includes(busca))));
  contador.textContent = [avisoDetalhes,textoDasRevisoes(totais)].filter(Boolean).join(' ');
  corpo.innerHTML = paginar('pag-divergencias',filtradas,40,JSON.stringify([id,filtro,busca])).map(({linha,revisao,estado})=>`
    <tr class="revisao-linha"><td><strong>${esc(linha.titulo)}</strong><small class="subtabela">${esc(linha.codigo)}</small></td>
      <td>${esc(linha.secao)}</td><td data-rotulo="Esperado">${linha.esperado??'—'}</td><td data-rotulo="Bipado">${linha.bipado}</td>
      <td>${badgeStatus(linha.status)}</td>
      <td><span class="badge ${estadosRevisao[estado].classe}">${estadosRevisao[estado].nome}</span>
        ${revisao?.autor?`<small class="subtabela">${esc(revisao.autor)}${revisao.at?' · '+dataBr.format(dataMs(revisao.at)):''}</small>`:''}
        ${revisao?.nota?`<p class="nota-revisao">${esc(revisao.nota)}</p>`:''}</td>
      <td>${pode('supervisao')?`<button type="button" class="btn sec btn-sm" onclick="editarRevisaoDivergencia(${arg(linha.chaveRevisao)})">Revisar</button>`:'—'}</td></tr>`
  ).join('')||'<tr><td colspan="7" class="empty">Nenhuma divergência neste filtro.</td></tr>';
}

function editarRevisaoDivergencia(chave){
  if(!exigirPermissao('supervisao'))return;
  if(!acompanhamentoRevisoes?.pronto)return;
  const {id,revisoes} = acompanhamentoRevisoes;
  if(detalhesDesatualizados(id,detalhesListas.get(id))){toast('Atualize as divergências antes de revisar.');return;}
  const linha = resumoAtual(id).rows.find(row=>row.chaveRevisao===chave && (row.status!=='OK' || row.recontagemSolicitada));
  if(!linha)return;
  const atual = revisaoDaLinha(linha,revisoes);
  edicaoRevisao = {id,chave,origem:dadosOriginaisDivergencia(linha),revisao:abasBipe[id].revisao||0,codigo:linha.codigo};
  document.getElementById('revisao-item').textContent = [linha.titulo,linha.codigo,linha.secao,linha.status].join(' · ');
  document.getElementById('revisao-estado-edicao').value = atual?.estado || 'recontagem';
  document.getElementById('revisao-nota').value = atual?.nota || '';
  document.getElementById('revisao-erro').textContent = '';
  atualizarCampoNotaRevisao();
  document.getElementById('modal-revisao').showModal();
}

function atualizarCampoNotaRevisao(){
  const requer = document.getElementById('revisao-estado-edicao').value==='resolvida';
  document.getElementById('revisao-nota').required = requer;
  document.getElementById('revisao-nota-label').textContent = requer?'Decisão tomada (obrigatória)':'Observação';
}

async function salvarRevisaoDivergencia(event){
  event.preventDefault();
  if(!exigirPermissao('supervisao'))return;
  const dialog = document.getElementById('modal-revisao');
  const btn = document.getElementById('revisao-salvar');
  if(btn.disabled || !edicaoRevisao)return;
  const {id,chave,origem,revisao,codigo} = edicaoRevisao;
  const estado = document.getElementById('revisao-estado-edicao').value;
  if(!Object.hasOwn(estadosRevisao,estado))return;
  const nota = document.getElementById('revisao-nota').value.trim();
  const erro = document.getElementById('revisao-erro');
  erro.textContent = '';
  if(estado==='resolvida' && !nota){erro.textContent = 'Registre a decisão antes de salvar.';return;}
  btn.disabled = true;
  try{
    const lista = listaRef(id);
    const ref = lista.collection('revisoes').doc(await assinatura(chave));
    await db.runTransaction(async tx=>{
      const pai = await tx.get(lista);
      listaAberta(pai);
      if((pai.get('revisao')||0)!==revisao)throw new Error('A lista mudou. Feche a revisão e abra o item novamente.');
      tx.set(ref,{chave,origem,estado,nota,autor:ME.nome,uid:ME.uid,at:timestamp()},{merge:true});
      tx.update(lista,avancarRevisao(pai));
    });
    avancarRevisaoDaVisualizacao(id,revisao);
    if(dialog.open && edicaoRevisao?.id===id && edicaoRevisao.chave===chave)dialog.close();
    registrarAuditoria('Divergência '+codigo+' · '+estadosRevisao[estado].nome+' · '+abasBipe[id]?.nome);
    toast('Revisão salva.');
  }catch(falha){erro.textContent = mensagemErro(falha);}
  finally{btn.disabled = false;}
}

function verRevisaoDoFechamento(){
  if(!conferenciaAberta)return;
  listaEmRevisao = conferenciaAberta.listaId;
  document.getElementById('revisao-filtro').value = 'abertas';
  document.getElementById('revisao-busca').value = '';
  fecharModal('modal-finalizar');
  ir('divergencias');
}

let selecaoTriagem = new Set();
let listaTriagem = '';

function renderTriagemIsbns(linhas){
  const painel = document.getElementById('triagem-isbns');
  if(!pode('supervisao')){painel.hidden=true;return;}
  const id = ME.listaAtiva;
  if(listaTriagem!==id){listaTriagem=id;selecaoTriagem.clear();painel.open=false;}
  const desconhecidos = linhas.filter(linha=>linha.status==='NÃO ENCONTRADO');
  painel.hidden = !desconhecidos.length;
  if(!desconhecidos.length)return;
  acompanharRevisoes(id);
  if(!painel.open)return;
  const atual = acompanhamentoRevisoes;
  const revisoes = atual?.id===id && atual.revisoes;
  const porCodigo = new Map();
  for(const linha of desconhecidos){
    if(!porCodigo.has(linha.codigo))porCodigo.set(linha.codigo,[]);
    porCodigo.get(linha.codigo).push(linha);
  }
  const pai = document.getElementById('triagem-itens');
  const busca = document.getElementById('busca-triagem').value.trim().toUpperCase();
  const grupos = [...porCodigo].filter(([codigo])=>codigo.includes(busca));
  pai.innerHTML = grupos.slice(0,100).map(([codigo,grupo])=>{
    const nota = revisoes && grupo.map(l=>{
      const vinculo = revisoes.get(l.chaveRevisao)?.vinculo;
      return vinculo?'Vinculado a '+vinculo.codigo+' · '+vinculo.titulo+' · '+vinculo.secao:revisaoDaLinha(l,revisoes)?.nota;
    }).find(Boolean);
    const bipes = grupo.reduce((total,linha)=>total+linha.bipado,0);
    return `<label class="triagem-codigo"><input type="checkbox" value="${esc(codigo)}" ${selecaoTriagem.has(codigo)?'checked':''} onchange="marcarCodigoTriagem(this.value,this.checked)"><span><strong>${esc(codigo)}</strong> · ${bipes} bipe(s)${nota?'<small class="subtabela">'+esc(nota)+'</small>':''}</span></label>`;
  }).join('')||'<p class="ajuda">Nenhum código neste filtro.</p>';
  document.getElementById('triagem-total').textContent = selecaoTriagem.size+' marcado(s)'+
    (grupos.length>100?' · Mostrando os primeiros 100. Busque um ISBN para localizar os demais.':'');
}

function marcarCodigoTriagem(codigo,marcado){
  if(marcado)selecaoTriagem.add(codigo);
  else selecaoTriagem.delete(codigo);
  const total = document.getElementById('triagem-total');
  total.textContent = total.textContent.replace(/^\d+/,String(selecaoTriagem.size));
}

function buscarAlvosTriagem(){
  const codigo = codigoNormalizado(document.getElementById('vinculo-codigo').value);
  const itens = catalogosAtuais().porLista.get(ME.listaAtiva)?.get(codigo)||[];
  document.getElementById('vinculo-alvo').replaceChildren(new Option('Selecione o produto e a sessão',''),
    ...itens.map(i=>new Option(i.titulo+' · '+i.secao,JSON.stringify([i.codigo,i.sessaoId]))));
}

function abrirVinculoIsbns(){
  if(!exigirPermissao('supervisao'))return;
  if(!selecaoTriagem.size){toast('Marque os códigos que deseja vincular.');return;}
  document.getElementById('vinculo-codigo').value = '';
  document.getElementById('vinculo-isbn-estado').textContent = '';
  buscarAlvosTriagem();
  document.getElementById('modal-vinculo-isbn').showModal();
}

async function confirmarVinculoIsbns(event){
  event.preventDefault();
  const alvo = document.getElementById('vinculo-alvo').value;
  if(!alvo)return;
  const [codigo,sessaoId] = JSON.parse(alvo);
  const produto = catalogosAtuais().porLista.get(ME.listaAtiva)?.get(codigo)?.find(i=>i.sessaoId===sessaoId);
  if(!produto)return;
  const btn = event.submitter;
  if(btn)btn.disabled=true;
  try{
    if(await salvarTriagemIsbns(produto))document.getElementById('modal-vinculo-isbn').close();
  }finally{if(btn)btn.disabled=false;}
}

let salvandoTriagem = false;

function avancarRevisaoDaVisualizacao(id,anterior){
  const detalhes = detalhesListas.get(id)?.lista;
  if(detalhes && (detalhes.revisao||0)===anterior)detalhes.revisao = anterior+1;
}

async function salvarTriagemIsbns(produto){
  if(!exigirPermissao('supervisao') || salvandoTriagem)return false;
  const id = ME.listaAtiva;
  if(detalhesDesatualizados(id,detalhesListas.get(id))){toast('Atualize o resumo antes de revisar.');return false;}
  const escolhidos = new Set(selecaoTriagem);
  const linhas = resumoAtual(id).rows.filter(linha=>linha.status==='NÃO ENCONTRADO' && escolhidos.has(linha.codigo));
  if(!linhas.length){toast('Marque pelo menos um código ainda não encontrado.');return false;}
  if(linhas.length>20){toast('Selecione até 20 códigos por vez.');return false;}
  const estado = document.getElementById('vinculo-isbn-estado');
  estado.textContent = '';
  salvandoTriagem = true;
  try{
    const lista = listaRef(id);
    const esperada = abasBipe[id].revisao||0;
    const registros = await Promise.all(linhas.map(async l=>({linha:l,ref:lista.collection('revisoes').doc(await assinatura(l.chaveRevisao))})));
    await db.runTransaction(async tx=>{
      const pai = await tx.get(lista);
      listaAberta(pai);
      if((pai.get('revisao')||0)!==esperada)throw new Error('A lista mudou. Confira as bipagens e tente novamente.');
      const anteriores = await Promise.all(registros.map(({ref})=>tx.get(ref)));
      registros.forEach(({linha,ref},i)=>{
        const anterior = anteriores[i].data();
        const nota = produto?`Vinculado a ${produto.codigo} · ${produto.titulo} · ${produto.secao}`.slice(0,300):
          anterior?.nota||'ISBN marcado para revisão no Resumo.';
        const vinculo = produto?{codigo:produto.codigo,sessaoId:produto.sessaoId,secao:produto.secao.slice(0,180),titulo:produto.titulo.slice(0,240)}:anterior?.vinculo;
        tx.set(ref,{chave:linha.chaveRevisao,origem:dadosOriginaisDivergencia(linha),estado:'recontagem',nota,autor:ME.nome,uid:ME.uid,at:timestamp(),
          ...(vinculo?{vinculo}:{})});
      });
      tx.update(lista,avancarRevisao(pai));
    });
    avancarRevisaoDaVisualizacao(id,esperada);
    if(listaTriagem===id)for(const codigo of escolhidos)selecaoTriagem.delete(codigo);
    renderResumo();
    toast(produto?'Vínculo salvo para revisão.':'Códigos marcados para revisão.');
    return true;
  }catch(erro){
    if(produto)estado.textContent = mensagemErro(erro);
    else toast(mensagemErro(erro));
    return false;
  }finally{salvandoTriagem=false;}
}
