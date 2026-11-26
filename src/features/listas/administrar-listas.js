let listaEmEdicaoAdmin;
let alterandoListaAdmin = false;

function administrarLista(id){
  if(!exigirPermissao('admin') || !abasBipe[id])return;
  listaEmEdicaoAdmin = id;
  document.getElementById('editar-lista-nome').value = abasBipe[id].nome;
  document.getElementById('editar-lista-status').textContent = '';
  document.getElementById('editar-lista-sec').value = '';
  document.getElementById('editar-lista-codigo').value = '';
  document.getElementById('editar-lista-produto').value = '';
  document.getElementById('editar-lista-qtd').value = '';
  document.getElementById('modal-editar-lista').showModal();
}

async function renomearLista(event){
  event.preventDefault();
  if(!exigirPermissao('admin') || alterandoListaAdmin)return;
  const id = listaEmEdicaoAdmin;
  const nome = txt(document.getElementById('editar-lista-nome').value);
  if(!nome)return;
  alterandoListaAdmin = true;
  try{
    await db.runTransaction(async tx=>{
      const ref = listaRef(id);
      const snap = await tx.get(ref);
      listaAberta(snap);
      tx.update(ref,{nome,...avancarRevisao(snap)});
    });
    registrarAuditoria('Lista renomeada · '+id+' · '+nome);
    document.getElementById('modal-editar-lista').close();
    toast('Nome atualizado.');
  }catch(erro){document.getElementById('editar-lista-status').textContent = mensagemErro(erro);}
  finally{alterandoListaAdmin = false;}
}

async function arquivarLista(){
  if(!exigirPermissao('admin') || alterandoListaAdmin)return;
  const id = listaEmEdicaoAdmin;
  if(!confirm('Arquivar esta lista? Os registros poderão ser retomados restaurando a lista.'))return;
  alterandoListaAdmin = true;
  try{
    await verificarFilaFechamento(id);
    const observadas = await idsAtivasObservadas();
    await db.runTransaction(async tx=>{
      const ref = listaRef(id);
      const controle = controleListasRef();
      const [lista,ctrl] = await Promise.all([tx.get(ref),tx.get(controle)]);
      listaAberta(lista);
      tx.update(ref,{arquivadaEm:timestamp(),arquivadaPor:ME.uid,...avancarRevisao(lista)});
      tx.set(controle,{ids:(ctrl.exists?idsDoControle(ctrl):observadas).filter(atual=>atual!==id)});
    });
    registrarAuditoria('Lista arquivada · '+id);
    document.getElementById('modal-editar-lista').close();
    toast('Lista arquivada.');
  }catch(erro){document.getElementById('editar-lista-status').textContent = mensagemErro(erro);}
  finally{alterandoListaAdmin = false;}
}

async function renderArquivadas(){
  if(!pode('admin'))return;
  const el = document.getElementById('listas-arquivadas');
  try{
    const snap = await db.collection('abas').orderBy('arquivadaEm','desc').get(servidor);
    el.innerHTML = snap.docs.filter(doc=>doc.get('arquivadaEm')).map(doc=>
      `<div class="row-btn"><span>${esc(doc.get('nome'))}</span><button type="button" class="btn sec btn-sm" onclick="restaurarListaArquivada(${arg(doc.id)})">Restaurar</button></div>`).join('')||'<p class="ajuda">Nenhuma lista arquivada.</p>';
  }catch(erro){el.textContent = mensagemErro(erro);}
}

async function restaurarListaArquivada(id){
  if(!exigirPermissao('admin') || alterandoListaAdmin)return;
  alterandoListaAdmin = true;
  try{
    const observadas = await idsAtivasObservadas();
    await db.runTransaction(async tx=>{
      const ref = listaRef(id);
      const controle = controleListasRef();
      const [lista,ctrl] = await Promise.all([tx.get(ref),tx.get(controle)]);
      if(!lista.get('arquivadaEm') || lista.get('finalizadaEm') || lista.get('excluindo'))throw new Error('A lista não está disponível para restauração.');
      const candidatos = [...new Set([...observadas,...idsDoControle(ctrl)])].filter(atual=>atual!==id);
      const docs = await Promise.all(candidatos.map(atual=>tx.get(listaRef(atual))));
      const ids = docs.filter(doc=>doc.exists && !doc.get('arquivadaEm') && !doc.get('finalizadaEm') && !doc.get('excluindo')).map(doc=>doc.id);
      if(ids.length>=4)throw new Error('As quatro vagas estão ocupadas. Libere uma vaga antes de restaurar.');
      tx.update(ref,{arquivadaEm:null,arquivadaPor:null,...avancarRevisao(lista)});
      tx.set(controle,{ids:[...ids,id]});
    });
    registrarAuditoria('Lista restaurada · '+id);
    renderArquivadas();
    toast('Lista restaurada.');
  }catch(erro){toast(mensagemErro(erro));}
  finally{alterandoListaAdmin = false;}
}



async function alterarProdutoDaLista(remover){
  if(!exigirPermissao('admin') || alterandoListaAdmin)return;
  const id = listaEmEdicaoAdmin;
  const secao = txt(document.getElementById('editar-lista-sec').value);
  const codigo = codigoNormalizado(document.getElementById('editar-lista-codigo').value);
  const titulo = txt(document.getElementById('editar-lista-produto').value);
  const qtd = document.getElementById('editar-lista-qtd').valueAsNumber;
  const resultado = document.getElementById('editar-lista-status');
  if(!secao || !codigo || (!remover && (!titulo || !Number.isInteger(qtd) || qtd<0))){
    resultado.textContent = 'Informe a seção e o código. Para adicionar ou atualizar, informe também o título e a quantidade.';
    return;
  }
  alterandoListaAdmin = true;
  try{
    const atual = await carregarCatalogoServidor(id,{somenteMetadados:true});
    const encontradas = atual.documentos.filter(doc=>nomeNormalizado(doc.get('nome'))===nomeNormalizado(secao));
    if(encontradas.length>1)throw new Error('Há mais de uma seção com este nome.');
    const anterior = encontradas[0];
    if(anterior?.get('excluindo'))throw new Error('A seção está em exclusão.');
    if(anterior && !anterior.get('catalogo'))throw new Error('Importe o catálogo desta seção antiga pelo Dauer antes de editar produtos.');
    const itens = anterior?await itensDaSessao(id,anterior.id,anterior.data()):[];
    const antigos = new Map(itens.map(item=>[item.codigo,item]));
    if(remover){
      if(!antigos.has(codigo))throw new Error('Produto ausente nesta seção.');
      if(!confirm('Remover o produto do catálogo desta lista? As bipagens já gravadas continuam no histórico.'))return;
      antigos.delete(codigo);
    }else{
      antigos.set(codigo,{...antigos.get(codigo),codigo,titulo,qtd,repetido:false});
    }
    const novosItens = [...antigos.values()].sort((a,b)=>a.codigo.localeCompare(b.codigo,'pt-BR'));
    const arq = {secao:anterior?.get('nome')||secao,nome:'Ajuste manual',itens:novosItens,
      versao:await assinatura(JSON.stringify(novosItens))};
    const retorno = await salvarCatalogosDaImportacao(id,[{arq,anterior}],new Map(),atual.revisao||0);
    if(retorno.resultados[0]?.erro)throw retorno.resultados[0].erro;
    registrarAuditoria('Produto '+(remover?'removido do catálogo':'atualizado no catálogo')+' · '+id+' · '+secao+' · '+codigo);
    resultado.textContent = remover?'Produto removido do catálogo.':'Produto atualizado no catálogo.';
  }catch(erro){resultado.textContent = mensagemErro(erro);}
  finally{alterandoListaAdmin = false;}
}
