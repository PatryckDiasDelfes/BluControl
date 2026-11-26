let unidadesCatalogo = [];
let previaCatalogo;
let indiceTcl;
let versaoTcl;
let tokenTcl = 0;
let tokenUnidadesTcl = 0;
let timerBuscaTcl;
let codigoPendenteTcl;
let carregandoTcl = false;
let bancoCacheTcl;
const indicesTcl = new WeakMap();
const cacheCatalogos = new Map();
const cachePartesTcl = new Map();
const colunasIndiceTcl = ['codigo','titulo','preco','estoque','localizacao','autor','editora','categoria','genero','assunto',
  'isbn','codigoBarras','codigoInterno'];

function* registrosDoIndiceTcl(produtos,partes){
  let posicao = 0;
  for(const [indice,{quantidade}] of partes.entries()){
    for(let i=0;i<quantidade;i++){
      const produto = produtos[posicao++];
      const locais = produto.distribuicao?.map(s=>s.localizacao);
      const sessoes = locais?.length===1 && locais[0]===produto.localizacao?true:locais?.length?locais:null;
      const campos = colunasIndiceTcl.map(campo=>produto[campo]??null);
      for(let j=10;j<campos.length;j++)if(campos[j]===campos[0])campos[j]=true;
      while(campos.at(-1)===null)campos.pop();
      yield [indice,sessoes,...campos];
    }
  }
}

function produtoDoIndiceTcl([parteDetalhes,sessoes,...campos]){
  const produto = Object.fromEntries(campos.map((valor,i)=>[colunasIndiceTcl[i],i>=10 && valor===true?campos[0]:valor]));
  produto.parteDetalhes = parteDetalhes;
  if(sessoes===true)produto.distribuicao = [{localizacao:produto.localizacao}];
  else if(Array.isArray(sessoes))produto.distribuicao = sessoes.map(localizacao=>({localizacao}));
  return produto;
}
let unidadesParaConferencia = [];

function operarCacheTcl(modo,operar,colecao='catalogos'){
  bancoCacheTcl ||= new Promise((resolver,rejeitar)=>{
    const pedido = indexedDB.open('blulivro-tcl',2);
    pedido.onupgradeneeded = ()=>{
      if(!pedido.result.objectStoreNames.contains('catalogos'))pedido.result.createObjectStore('catalogos');
      pedido.result.createObjectStore('bibliografia',{keyPath:'isbn'});
    };
    pedido.onblocked = ()=>rejeitar(new Error('Outra aba está usando uma versão antiga do catálogo.'));
    pedido.onsuccess = ()=>resolver(pedido.result);
    pedido.onerror = ()=>rejeitar(pedido.error);
  });
  return bancoCacheTcl.then(banco=>new Promise((resolver,rejeitar)=>{
    const tx = banco.transaction(colecao,modo);
    const pedido = operar(tx.objectStore(colecao));
    tx.oncomplete = ()=>resolver(pedido.result);
    tx.onabort = ()=>rejeitar(tx.error);
  }));
}

const repositorioDauer = {
  colecao(){return db.collection('catalogosDauer');},
  async unidades(){
    const snap = await this.colecao().get(servidor);
    return snap.docs.map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  },
  async produtos(unidade,guardarNoNavegador=false){
    if(!unidade?.versao)return [];
    const chave = JSON.stringify([firebase.app().options.projectId,ME.uid,unidade.id,unidade.versao]);
    if(!cacheCatalogos.has(chave)){
      const ref = this.colecao().doc(unidade.id).collection('versoes').doc(unidade.versao);
      const leitura = (async()=>{
        // A versão vem do manifesto autorizado. Catálogos publicados são imutáveis.
        const chaveLocal = JSON.stringify([firebase.app().options.projectId,ME.uid,unidade.id]);
        if(guardarNoNavegador){
          const salvo = await operarCacheTcl('readonly',store=>store.get(chaveLocal)).catch(()=>null);
          if(salvo?.versao===unidade.versao && Array.isArray(salvo.produtos) && salvo.produtos.length===unidade.total)return salvo.produtos;
        }
        const produtos = await lerPartes(ref.collection('partes'),unidade.versao,unidade.partes);
        if(guardarNoNavegador)operarCacheTcl('readwrite',store=>store.put({versao:unidade.versao,produtos},chaveLocal)).catch(()=>{});
        return produtos;
      })().catch(erro=>{
        if(cacheCatalogos.get(chave)===leitura)cacheCatalogos.delete(chave);
        throw erro;
      });
      cacheCatalogos.set(chave,leitura);
      if(cacheCatalogos.size>6)cacheCatalogos.delete(cacheCatalogos.keys().next().value);
    }
    return cacheCatalogos.get(chave);
  },
  async indice(unidade){
    if(!unidade?.versao)return [];
    if(!unidade.partesIndice)return this.produtos(unidade,true);
    const chaveLocal = JSON.stringify(['indice',firebase.app().options.projectId,ME.uid,unidade.id]);
    const chave = chaveLocal+'/'+unidade.versao;
    if(!cacheCatalogos.has(chave)){
      const leitura = (async()=>{
        const salvo = await operarCacheTcl('readonly',store=>store.get(chaveLocal)).catch(()=>null);
        if(salvo?.versao===unidade.versao && Array.isArray(salvo.registros) && salvo.registros.length===unidade.total){
          return salvo.registros.map(produtoDoIndiceTcl);
        }
        const ref = this.colecao().doc(unidade.id).collection('versoes').doc(unidade.versao).collection('indiceTcl');
        const registros = await lerPartes(ref,unidade.versao,unidade.partesIndice);
        if(registros.length!==unidade.total)throw new Error('O índice de busca está incompleto.');
        operarCacheTcl('readwrite',store=>store.put({versao:unidade.versao,registros},chaveLocal)).catch(()=>{});
        return registros.map(produtoDoIndiceTcl);
      })().catch(erro=>{if(cacheCatalogos.get(chave)===leitura)cacheCatalogos.delete(chave);throw erro;});
      cacheCatalogos.set(chave,leitura);
      if(cacheCatalogos.size>6)cacheCatalogos.delete(cacheCatalogos.keys().next().value);
    }
    return cacheCatalogos.get(chave);
  },
  async detalhes(unidade,produto){
    const indice = produto?.parteDetalhes;
    if(!Number.isInteger(indice) || indice<0 || indice>=unidade?.partes)return produto;
    const chave = JSON.stringify([firebase.app().options.projectId,ME.uid,unidade.id,unidade.versao,indice]);
    if(!cachePartesTcl.has(chave)){
      const ref = this.colecao().doc(unidade.id).collection('versoes').doc(unidade.versao)
        .collection('partes').doc(unidade.versao+'_'+indice);
      const leitura = ref.get(servidor).then(doc=>{
        if(!doc.exists || doc.get('versao')!==unidade.versao || doc.get('indice')!==indice){
          throw new Error('A ficha do catálogo não está disponível.');
        }
        return JSON.parse(doc.get('dados'));
      }).catch(erro=>{if(cachePartesTcl.get(chave)===leitura)cachePartesTcl.delete(chave);throw erro;});
      cachePartesTcl.set(chave,leitura);
      if(cachePartesTcl.size>6)cachePartesTcl.delete(cachePartesTcl.keys().next().value);
    }
    return (await cachePartesTcl.get(chave)).find(p=>p.codigo===produto.codigo)||produto;
  },
  async publicar(previa){
    const {id,nome,anterior,produtos,resumo,arquivo} = previa;
    const versao = crypto.randomUUID();
    const ref = this.colecao().doc(id);
    const nova = ref.collection('versoes').doc(versao);
    const partes = Array.from(separarDocumentos(produtos));
    const indice = Array.from(separarDocumentos(registrosDoIndiceTcl(produtos,partes)),parte=>parte.dados);
    await Promise.all([gravarPartes(nova.collection('partes'),versao,partes.map(parte=>parte.dados)),
      gravarPartes(nova.collection('indiceTcl'),versao,indice)]);
    await db.runTransaction(async tx=>{
      const atual = await tx.get(ref);
      if((atual.data()?.versao||null)!==anterior)throw new Error('Outro administrador publicou esta unidade. Gere uma nova prévia.');
      const publicacao = {nome,versao,partes:partes.length,partesIndice:indice.length,total:produtos.length,at:timestamp(),uid:ME.uid,autor:ME.nome};
      tx.set(nova,{...publicacao,arquivo,resumo});
      tx.set(ref,publicacao);
    });
  }
};
const repositorioProdutos = repositorioDauer;

function prepararCatalogo(anterior,leitura){
  const novos = new Map();
  const precosConflitantes = new Set();
  let duplicados = 0;
  for(const produto of leitura.itens){
    const atual = novos.get(produto.codigo);
    if(atual || produto.repetido)duplicados++;
    if(atual){
      if(leitura.porLocalizacao){
        atual.estoque += produto.estoque;
        const local = atual.locais.get(produto.localizacao)||{estoque:0,repetido:false};
        local.estoque += produto.estoque;
        local.repetido ||= Boolean(produto.repetido);
        atual.locais.set(produto.localizacao,local);
      }else{
        if(atual.preco!=null && produto.preco!=null && atual.preco!==produto.preco)precosConflitantes.add(produto.codigo);
        for(const [campo,valor] of Object.entries(produto))atual[campo] ??= valor;
      }
      continue;
    }
    const {repetido,...campos} = produto;
    const locais = new Map();
    if(produto.localizacao && Number.isInteger(produto.estoque)){
      locais.set(produto.localizacao,{estoque:produto.estoque,repetido:Boolean(produto.repetido)});
    }
    novos.set(produto.codigo,{...campos,locais});
  }
  const porCodigo = new Map(anterior.map(produto=>[produto.codigo,produto]));
  const aliases = new Map();
  const chaves = produto=>[...new Set([produto.codigo,produto.isbn,produto.codigoBarras,produto.codigoInterno,
    /^\d{9}[\dX]$/.test(codigoNormalizado(produto.isbn))?isbnCanonico(produto.isbn):''].map(codigoNormalizado).filter(Boolean))];
  function indexar(produto){
    for(const alias of chaves(produto)){
      if(!aliases.has(alias))aliases.set(alias,new Set());
      aliases.get(alias).add(produto.codigo);
    }
  }
  for(const produto of anterior)indexar(produto);
  const processados = new Set();
  const resumo = {encontrados:novos.size,novos:0,atualizados:0,iguais:0,erros:leitura.erros+precosConflitantes.size,duplicados};
  for(const [codigo,{locais,...importado}] of novos){
    if(precosConflitantes.has(codigo))delete importado.preco;
    if(!importado.titulo && importado.preco==null && !importado.capa)continue;
    if(locais.size){
      importado.localizacao = [...locais.keys()].join(' / ');
      importado.distribuicao = [...locais].map(([localizacao,local])=>({localizacao,...local}));
    }
    const encontrados = new Set(chaves(importado).flatMap(alias=>[...(aliases.get(alias)||[])]));
    if(encontrados.size>1){resumo.erros++;continue;}
    const chave = encontrados.values().next().value||codigo;
    if(processados.has(chave)){resumo.duplicados++;continue;}
    processados.add(chave);
    const antigo = porCodigo.get(chave);
    if(!antigo && !importado.titulo){resumo.erros++;continue;}
    const atualizado = importado.titulo?{...antigo,...importado,codigo:chave}:{...antigo,
      ...(importado.preco!=null?{preco:importado.preco}:{}),...(importado.capa?{capa:importado.capa}:{})};
    if(!importado.distribuicao && (Number.isInteger(importado.estoque) || importado.localizacao) && atualizado.localizacao){
      atualizado.distribuicao = atualizado.localizacao.includes(' / ') || !Number.isInteger(atualizado.estoque)?[]:
        [{localizacao:atualizado.localizacao,estoque:atualizado.estoque,repetido:false}];
    }
    if(!antigo)resumo.novos++;
    else if(Object.entries(atualizado).some(([k,v])=>k==='distribuicao'?JSON.stringify(antigo[k])!==JSON.stringify(v):antigo[k]!==v))resumo.atualizados++;
    else resumo.iguais++;
    porCodigo.set(chave,atualizado);
    indexar(atualizado);
  }
  return {produtos:[...porCodigo.values()],resumo};
}

async function gerarPreviaCatalogo(event){
  event.preventDefault();
  if(!exigirPermissao('admin'))return;
  const estado = document.getElementById('catalogo-estado');
  const arquivo = document.getElementById('catalogo-arquivo').files[0];
  const nome = txt(document.getElementById('catalogo-unidade').value);
  if(!arquivo || !nome)return;
  const btn = document.getElementById('catalogo-prever');
  const publicar = document.getElementById('catalogo-publicar');
  btn.disabled = publicar.disabled = true;
  previaCatalogo = null;
  document.getElementById('catalogo-amostra').hidden = true;
  estado.textContent = 'Lendo arquivo e comparando com a última versão da unidade…';
  const leitor = criarLeitorDauer('catalogo');
  try{
    const id = await assinatura(nomeNormalizado(nome));
    const ref = await repositorioDauer.colecao().doc(id).get(servidor);
    const anterior = ref.exists?{id,...ref.data()}:null;
    const [atuais,leitura] = await Promise.all([repositorioProdutos.produtos(anterior),leitor.ler(arquivo)]);
    if(document.getElementById('catalogo-arquivo').files[0]!==arquivo ||
      txt(document.getElementById('catalogo-unidade').value)!==nome)throw new Error('Arquivo ou unidade alterados. Gere uma nova prévia.');
    if(!leitura.itens.length)throw new Error('Nenhum produto válido encontrado.');
    const {produtos,resumo} = prepararCatalogo(atuais,leitura);
    if(!resumo.novos && !resumo.atualizados && !resumo.iguais)throw new Error('Nenhuma linha corresponde ao catálogo da unidade. Confira os ISBNs ou os códigos.');
    previaCatalogo = {id,nome,origem:arquivo,anterior:anterior?.versao||null,produtos,resumo,arquivo:arquivo.name};
    const {novos,atualizados,iguais,erros,duplicados,encontrados} = resumo;
    const precificados = produtos.filter(p=>precoDeVendaDauer(p.preco)!==null).length;
    const precosNoArquivo = leitura.itens.some(p=>p.preco!=null);
    estado.textContent = `${nome} · ${encontrados} produtos únicos · ${novos} novos · ${atualizados} atualizados · ${iguais} iguais · ${erros} inconsistência(s) · ${duplicados} repetição(ões) · ${precificados} com preço de venda no catálogo.`+
      (precosNoArquivo?'':' Nenhum preço de venda encontrado neste arquivo.');
    renderAmostraCatalogo(atuais,produtos);
    publicar.disabled = false;
  }catch(erro){estado.textContent = mensagemErro(erro);}
  finally{btn.disabled = false;leitor.fechar();}
}

function invalidarPreviaCatalogo(){
  previaCatalogo = null;
  document.getElementById('catalogo-publicar').disabled = true;
  document.getElementById('catalogo-amostra').hidden = true;
}

function renderAmostraCatalogo(anteriores,produtos){
  const base = new Map(anteriores.map(p=>[p.codigo,p]));
  const destaques = [], mudancas = [];
  let totalDestaques = 0;
  for(const p of produtos){
    const anterior = base.get(p.codigo);
    const preco = precoDeVendaDauer(p.preco), precoAnterior = precoDeVendaDauer(anterior?.preco);
    const precoMudou = preco!==precoAnterior;
    const alerta = anterior && ((precoAnterior>0 && preco!=null && Math.abs(preco-precoAnterior)/precoAnterior>=.3) ||
      (anterior.estoque>0 && p.estoque===0));
    if(alerta){totalDestaques++;if(destaques.length<8)destaques.push(p);}
    else if(mudancas.length<8 && (!anterior || precoMudou || p.estoque!==anterior.estoque || p.localizacao!==anterior.localizacao))mudancas.push(p);
  }
  const amostra = [...destaques,...mudancas].slice(0,8);
  const celula = (novo,antigo)=>esc(novo)+(antigo!=null && novo!==antigo?'<small class="subtabela">Antes: '+esc(antigo)+'</small>':'');
  const painel = document.getElementById('catalogo-amostra');
  painel.hidden = false;
  painel.innerHTML = `<h3>Amostra da publicação</h3><p class="ajuda">${totalDestaques?esc(totalDestaques)+' mudanças para conferir, com preço variando 30% ou mais ou estoque passando para zero.':'Confira os dados que serão publicados.'}</p>`+
    `<div class="tbl-wrap"><table><thead><tr><th>ISBN / código</th><th>Produto</th><th>Preço de venda</th><th>Estoque</th><th>Localização</th></tr></thead><tbody>${(amostra.length?amostra:produtos.slice(0,8)).map(p=>{
      const a = base.get(p.codigo);
      return '<tr><td>'+esc(p.isbn||p.codigo)+'</td><td>'+esc(p.titulo)+'</td><td>'+celula(formatarPrecoTcl(p.preco),a&&formatarPrecoTcl(a.preco))+'</td><td>'+celula(p.estoque??'—',a?.estoque)+'</td><td>'+celula(p.localizacao||'—',a?.localizacao)+'</td></tr>';
    }).join('')}</tbody></table></div>`;
}

async function publicarCatalogo(){
  if(!exigirPermissao('admin') || !previaCatalogo)return;
  const atual = previaCatalogo;
  if(document.getElementById('catalogo-arquivo').files[0]!==atual.origem ||
    txt(document.getElementById('catalogo-unidade').value)!==atual.nome){toast('Gere uma nova prévia antes de publicar.');return;}
  const estado = document.getElementById('catalogo-estado');
  const btn = document.getElementById('catalogo-publicar');
  if(btn.disabled)return;
  btn.disabled = document.getElementById('catalogo-prever').disabled = true;
  estado.textContent = 'Gravando versão e publicando catálogo…';
  try{
    await repositorioDauer.publicar(atual);
    previaCatalogo = null;
    document.getElementById('catalogo-amostra').hidden = true;
    estado.textContent = 'Catálogo atualizado para '+atual.nome+'.';
    registrarAuditoria('Catálogo Dauer atualizado · '+atual.nome+' · '+atual.resumo.encontrados+' produtos.');
    renderFonteDados();
  }catch(erro){estado.textContent = mensagemErro(erro);btn.disabled=false;}
  finally{document.getElementById('catalogo-prever').disabled = false;}
}

async function renderFonteDados(){
  if(!pode('admin'))return;
  const corpo = document.getElementById('historico-catalogo');
  try{
    const unidades = await repositorioDauer.unidades();
    const versoes = await Promise.all(unidades.map(async u=>{
      const snap = await repositorioDauer.colecao().doc(u.id).collection('versoes').orderBy('at','desc').limit(20).get(servidor);
      return snap.docs.map(d=>({...d.data(),unidadeId:u.id,ativa:u.versao===d.id,versao:d.id}));
    }));
    corpo.innerHTML = versoes.flat().sort((a,b)=>dataMs(b.at)-dataMs(a.at)).map(v=>`<tr><td>${esc(v.nome)}</td><td>${esc(v.arquivo)}</td><td>${esc(v.autor)}</td><td>${v.at?dataBr.format(dataMs(v.at)):'—'}</td><td>${v.total}</td><td>${v.ativa?'Ativa':`<button type="button" class="btn sec btn-sm" onclick="restaurarVersaoDauer(${arg(v.unidadeId)},${arg(v.versao)},this)">Restaurar</button>`}</td></tr>`).join('')||'<tr><td colspan="6">Nenhuma publicação.</td></tr>';
  }catch(erro){corpo.innerHTML = `<tr><td colspan="6">${esc(mensagemErro(erro))}</td></tr>`;}
}

async function restaurarVersaoDauer(id,versao,botao){
  if(!exigirPermissao('admin') || botao.disabled || !confirm('Publicar uma cópia desta versão como catálogo ativo da unidade?'))return;
  botao.disabled = true;
  const estado = document.getElementById('catalogo-estado');
  estado.textContent = 'Restaurando versão…';
  const ref = repositorioDauer.colecao().doc(id);
  try{
    const [atual,alvo] = await Promise.all([ref.get(servidor),ref.collection('versoes').doc(versao).get(servidor)]);
    if(!atual.exists || !alvo.exists)throw new Error('Esta versão não está mais disponível.');
    if(atual.get('versao')===versao){estado.textContent='Esta versão já está ativa.';return;}
    const produtos = await repositorioDauer.produtos({id,...alvo.data(),versao});
    if(!produtos.length || produtos.length!==alvo.get('total'))throw new Error('A versão selecionada está incompleta.');
    await repositorioDauer.publicar({id,nome:atual.get('nome'),anterior:atual.get('versao'),produtos,
      resumo:{restauradaDe:versao},arquivo:'Restauração · '+alvo.get('arquivo')});
    previaCatalogo = null;
    document.getElementById('catalogo-publicar').disabled = true;
    document.getElementById('catalogo-amostra').hidden = true;
    estado.textContent = 'Versão restaurada para '+atual.get('nome')+'.';
    registrarAuditoria('Versão do Dauer restaurada · '+atual.get('nome')+' · '+versao);
    await renderFonteDados();
  }catch(erro){estado.textContent = mensagemErro(erro);}
  finally{botao.disabled = false;}
}

async function abrirTcl(){
  const lista = document.getElementById('tcl-unidade');
  const rodada = ++tokenUnidadesTcl;
  recuperarBibliografiaTcl();
  if(!indiceTcl){
    carregandoTcl = true;
    document.getElementById('tcl-status').textContent = 'Carregando unidades…';
  }
  try{
    const unidades = await repositorioProdutos.unidades();
    if(rodada!==tokenUnidadesTcl || telaAtual!=='tcl')return;
    unidadesCatalogo = unidades;
    const atual = lista.value;
    lista.innerHTML = unidadesCatalogo.map(u=>`<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('')||'<option value="">Nenhuma unidade cadastrada</option>';
    if(unidadesCatalogo.some(u=>u.id===atual))lista.value = atual;
    carregarTcl();
  }catch(erro){
    if(rodada!==tokenUnidadesTcl || telaAtual!=='tcl')return;
    tokenTcl++;
    indiceTcl = versaoTcl = null;
    carregandoTcl = false;
    document.getElementById('tcl-resultados').replaceChildren();
    document.getElementById('pag-tcl').hidden = true;
    document.getElementById('tcl-status').textContent = 'Falha ao consultar as unidades. '+mensagemErro(erro);
    resolverCodigoPendenteTcl(document.getElementById('tcl-unidade').value);
  }
}

async function carregarTcl(){
  const rodada = ++tokenTcl;
  const unidade = unidadesCatalogo.find(u=>u.id===document.getElementById('tcl-unidade').value);
  const estado = document.getElementById('tcl-status');
  const chave = unidade && unidade.id+'/'+unidade.versao;
  if(chave && chave===versaoTcl && indiceTcl){renderTcl();return;}
  indiceTcl = versaoTcl = null;
  document.getElementById('tcl-resultados').replaceChildren();
  document.getElementById('pag-tcl').hidden = true;
  carregandoTcl = Boolean(unidade?.versao);
  if(!carregandoTcl){
    estado.textContent = 'Nenhum catálogo publicado para consulta.';
    resolverCodigoPendenteTcl(unidade?.id);
    return;
  }
  estado.textContent = 'Carregando produtos…';
  try{
    const itens = await repositorioProdutos.indice(unidade);
    if(rodada!==tokenTcl)return;
    indiceTcl = prepararBuscaTcl(itens);
    inserirSessoesTcl(indiceTcl);
    versaoTcl = chave;
    carregandoTcl = false;
    if(telaAtual!=='tcl'){codigoPendenteTcl=null;return;}
    renderTcl();
    resolverCodigoPendenteTcl(unidade.id);
  }catch(erro){
    if(rodada!==tokenTcl)return;
    carregandoTcl = false;
    estado.textContent = 'Falha ao carregar os produtos. '+mensagemErro(erro);
    resolverCodigoPendenteTcl(unidade.id);
  }
}

function resolverCodigoPendenteTcl(unidade){
  const pendente = codigoPendenteTcl;
  codigoPendenteTcl = null;
  if(telaAtual==='tcl' && pendente && (!pendente.unidade || pendente.unidade===unidade))abrirCodigoTcl(pendente.codigo);
}

function prepararBuscaTcl(produtos){
  if(indicesTcl.has(produtos))return indicesTcl.get(produtos);
  const porCodigo = new Map(), porId = new Map();
  const textos = produtos.map(produto=>{
    porId.set(produto.codigo,produto);
    for(const campo of ['codigo','isbn','codigoBarras','codigoInterno']){
      const codigo = codigoNormalizado(produto[campo]);
      if(codigo && !porCodigo.has(codigo))porCodigo.set(codigo,produto);
      const isbn = campo!=='codigoInterno' && /^\d{9}[\dX]$/.test(codigo)?isbnCanonico(codigo):'';
      if(isbn && !porCodigo.has(isbn))porCodigo.set(isbn,produto);
    }
    return textoDeBusca([produto.titulo,produto.autor,produto.editora,produto.categoria,
      produto.codigo,produto.isbn,produto.codigoBarras,produto.codigoInterno].join('\u0000'));
  });
  const indice = {produtos,textos,porId,porCodigo,consulta:null,resultados:produtos};
  indicesTcl.set(produtos,indice);
  return indice;
}

function filtrarProdutosTcl(indice,consulta){
  if(indice.consulta!==consulta){
    indice.resultados = consulta?indice.produtos.filter((_,i)=>indice.textos[i].includes(consulta)):indice.produtos;
    indice.consulta = consulta;
  }
  return indice.resultados;
}

function programarBuscaTcl(){
  codigoPendenteTcl = null;
  document.getElementById('tcl-consultar-isbn').disabled = !isbnCanonico(document.getElementById('tcl-busca').value);
  clearTimeout(timerBuscaTcl);
  timerBuscaTcl = setTimeout(renderTcl,110);
}

function renderTcl(){
  clearTimeout(timerBuscaTcl);
  if(!indiceTcl || telaAtual!=='tcl')return;
  const valor = document.getElementById('tcl-busca').value;
  const q = textoDeBusca(valor);
  const exato = indiceTcl.porCodigo.get(codigoNormalizado(valor))||indiceTcl.porCodigo.get(isbnCanonico(valor));
  const filtrados = filtrarProdutosTcl(indiceTcl,q);
  const itensBase = !filtrados.length && exato?[exato]:filtrados;
  const filtros = filtrosAtuaisTcl();
  const itens = filtrarDetalhesTcl(itensBase,filtros);
  document.getElementById('tcl-status').textContent = itens.length?(itens.length===1?'1 produto encontrado.':itens.length.toLocaleString('pt-BR')+' produtos encontrados.'):'Nenhum produto encontrado.';
  document.getElementById('tcl-resultados').innerHTML = paginar('pag-tcl',itens,50,JSON.stringify([versaoTcl,q,filtros]))
    .map(p=>`<tr><td><button class="btn sec btn-sm" type="button" onclick="mostrarProdutoTcl(${arg(p.codigo)})">${esc(p.titulo)}</button></td><td>${formatarPrecoTcl(p.preco)}</td><td>${esc(p.estoque??'—')}</td><td>${esc(p.localizacao||'—')}</td><td>${esc(p.isbn||'—')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nenhum produto para esta busca.</td></tr>';
}

function localizarBipeTcl(event){
  if(event.key!=='Enter')return;
  event.preventDefault();
  if(!event.repeat)solicitarCodigoTcl(event.currentTarget.value);
}

function solicitarCodigoTcl(valor){
  const codigo = codigoNormalizado(valor);
  if(!codigo)return;
  if(carregandoTcl){
    codigoPendenteTcl = {codigo,unidade:document.getElementById('tcl-unidade').value};
    document.getElementById('tcl-status').textContent = 'Carregando catálogo para consultar este código…';
    return;
  }
  renderTcl();
  abrirCodigoTcl(codigo);
}

function abrirCodigoTcl(codigo){
  const isbn = isbnCanonico(codigo);
  const exato = indiceTcl?.porCodigo.get(codigo)||indiceTcl?.porCodigo.get(isbn);
  if(exato || isbn)abrirFichaTcl(exato,isbn);
}

function mostrarProdutoTcl(codigo){
  const p = indiceTcl?.porId.get(codigo);
  if(p)abrirFichaTcl(p);
}

function produtoPorCodigo(produtos,codigo){
  return produtos.filter(p=>[p.codigo,p.isbn,p.codigoBarras,p.codigoInterno].some(v=>codigoNormalizado(v)===codigo));
}

async function carregarUnidadesParaConferencia(){
  const select = document.getElementById('catalogo-lista-unidade');
  const estado = document.getElementById('catalogo-lista-status');
  const atual = select.value;
  select.disabled = true;
  document.getElementById('catalogo-lista-prever').disabled = true;
  try{
    unidadesParaConferencia = await repositorioProdutos.unidades();
    select.innerHTML = '<option value="">Selecione uma unidade</option>'+unidadesParaConferencia.map(u=>
      `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('');
    if(unidadesParaConferencia.some(u=>u.id===atual))select.value = atual;
    estado.textContent = unidadesParaConferencia.length?'':'Nenhum catálogo publicado. Um administrador pode publicar em Configurações → Fonte de dados.';
    select.disabled = !unidadesParaConferencia.length;
  }catch(erro){
    estado.textContent = mensagemErro(erro);
  }finally{atualizarBotaoPreviaDaBase();}
}

function atualizarBotaoPreviaDaBase(){
  const select = document.getElementById('catalogo-lista-unidade');
  document.getElementById('catalogo-lista-prever').disabled = select.disabled || !select.value;
}

async function lerSessoesDaBase(unidade,pendentes){
  const produtos = await repositorioProdutos.produtos(unidade);
  const sessoes = new Map();
  let semSaldo = 0, localIndefinido = 0;
  for(const produto of produtos){
    if(!Number.isSafeInteger(produto.estoque) || produto.estoque<0){semSaldo++;continue;}
    let distribuicao = produto.distribuicao||[];
    if(!distribuicao.length){
      const indefinido = !produto.localizacao || produto.localizacao.includes(' / ');
      if(indefinido)localIndefinido++;
      distribuicao = [{localizacao:indefinido?'Localização a revisar':produto.localizacao,estoque:produto.estoque}];
    }
    for(const posicao of distribuicao){
      if(!Number.isSafeInteger(posicao.estoque) || posicao.estoque<0){semSaldo++;continue;}
      const secao = posicao.localizacao||'Localização a revisar';
      const chave = nomeNormalizado(secao);
      if(pendentes && !pendentes.has(chave))continue;
      if(!sessoes.has(chave))sessoes.set(chave,{secao,chave,porCodigo:new Map(),nome:'Catálogo Dauer · '+unidade.nome,exemplares:0,repetidos:0});
      const destino = sessoes.get(chave);
      const codigo = codigoNormalizado(produto.isbn || produto.codigoBarras || produto.codigoInterno || produto.codigo);
      const repetido = Boolean(posicao.repetido);
      const encontrado = destino.porCodigo.get(codigo);
      if(encontrado){
        if(!encontrado.repetido)destino.repetidos++;
        encontrado.qtd += posicao.estoque;
        encontrado.repetido = true;
      }else{
        destino.porCodigo.set(codigo,{codigo,titulo:produto.titulo,qtd:posicao.estoque,repetido});
        destino.repetidos += Number(repetido);
      }
      destino.exemplares += posicao.estoque;
    }
  }
  const ordenacao = new Intl.Collator('pt-BR').compare;
  const lidas = [...sessoes.values()].map(({porCodigo,...secao})=>({...secao,itens:[...porCodigo.values()]}));
  for(let i=0;i<lidas.length;i+=24){
    await Promise.all(lidas.slice(i,i+24).map(async secao=>{
      secao.itens.sort((a,b)=>ordenacao(a.codigo,b.codigo));
      secao.versao = await assinatura(JSON.stringify(secao.itens));
    }));
  }
  return {lidas,semSaldo,localIndefinido};
}

async function carregarPreviaDaBase(event){
  event.preventDefault();
  if(!exigirPermissao('supervisao') || importando || leitorDauerAtivo)return;
  const unidade = unidadesParaConferencia.find(u=>u.id===document.getElementById('catalogo-lista-unidade').value);
  if(!unidade)return;
  if(arquivosPendentes.length && !confirm('Substituir a prévia atual pelo catálogo selecionado?'))return;
  const select = document.getElementById('catalogo-lista-unidade');
  const log = document.getElementById('log-import');
  select.disabled = true;
  atualizarBotaoPreviaDaBase();
  const leitura = ++leituraImportacao;
  const tarefa = {fechar(){}};
  leitorDauerAtivo = tarefa;
  renderPreviaImportacao();
  mostrarAndamentoImportacao('Preparando catálogo',unidade.nome,{});
  try{
    const {lidas,semSaldo,localIndefinido} = await lerSessoesDaBase(unidade);
    if(leitura!==leituraImportacao)return;
    if(!lidas.length)throw new Error('O catálogo desta unidade não tem sessões com saldo utilizável.');
    arquivosPendentes = lidas;
    idRascunho = crypto.randomUUID();
    rascunhoIniciado = false;
    progressoGravacaoImportacao = null;
    destinoImportacao = ME.listaAtiva || document.getElementById('sel-lista-import').value || '';
    marcadasImportacao.clear();
    for(const secao of lidas)marcadasImportacao.add(secao.chave);
    document.getElementById('buscar-previa').value = '';
    document.getElementById('status-rascunho').textContent = '';
    log.style.display = 'block';
    log.textContent = unidade.nome+' · '+lidas.length+' sessão(ões)\n';
    if(semSaldo)log.append(document.createTextNode(semSaldo+' registro(s) com saldo ausente ou inválido foram deixados fora da lista.\n'));
    if(localIndefinido)log.append(document.createTextNode(localIndefinido+' produto(s) ficaram em “Localização a revisar” porque o saldo por seção não estava disponível.'));
    await registrarAndamentoImportacao({catalogo:{id:unidade.id,nome:unidade.nome,versao:unidade.versao,partes:unidade.partes}});
    if(leitura===leituraImportacao)mostrarAndamentoImportacao('Prévia pronta','Revise o destino e selecione as sessões para aplicar à lista.');
  }catch(erro){
    if(leitura===leituraImportacao)mostrarAndamentoImportacao('Falha ao preparar catálogo',mensagemErro(erro));
  }finally{
    if(leitorDauerAtivo===tarefa)leitorDauerAtivo = null;
    select.disabled = false;
    atualizarBotaoPreviaDaBase();
    atualizarSelectImport();
    renderPreviaImportacao();
  }
}
