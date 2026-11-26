const bibliografiaTcl = new Map();
let recuperacaoBibliografia;
const camposFiltroTcl = ['autor','editora','sessao','genero','assunto'];

function recuperarBibliografiaTcl(){
  recuperacaoBibliografia ||= operarCacheTcl('readonly',store=>store.getAll(),'bibliografia').then(itens=>{
    for(const item of itens)if(!bibliografiaTcl.has(item.isbn))bibliografiaTcl.set(item.isbn,item);
    renderTcl();
  }).catch(()=>{});
  return recuperacaoBibliografia;
}

function guardarBibliografiaTcl(isbn,livro){
  const registro = {isbn,autor:livro?.autor||'',editora:livro?.editora||'',genero:livro?.genero||'',
    assunto:livro?.assunto||'',at:Date.now()};
  bibliografiaTcl.set(isbn,registro);
  operarCacheTcl('readwrite',store=>store.put(registro),'bibliografia').catch(()=>{});
}

function isbnDoProdutoTcl(p){
  return isbnCanonico(p.isbn)||isbnCanonico(p.codigoBarras)||isbnCanonico(p.codigo);
}

function sessoesDoProdutoTcl(produto){
  return produto.distribuicao?.length?produto.distribuicao.map(s=>s.localizacao):txt(produto.localizacao).split(' / ').filter(Boolean);
}

function inserirSessoesTcl(indice){
  const select = document.getElementById('tcl-sessao');
  const valor = select.value;
  const opcoes = [...new Set(indice.produtos.flatMap(sessoesDoProdutoTcl))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  select.replaceChildren(new Option('Todas as sessões',''),...opcoes.map(s=>new Option(s,s)));
  if(opcoes.includes(valor))select.value = valor;
}

function filtrosAtuaisTcl(){
  return Object.fromEntries(camposFiltroTcl.map(campo=>[campo,textoDeBusca(document.getElementById('tcl-'+campo).value)]));
}

function filtrarDetalhesTcl(produtos,filtros,apenasLocal=false){
  if(!Object.values(filtros).some(Boolean))return produtos;
  return produtos.filter(p=>{
    if(filtros.sessao && !sessoesDoProdutoTcl(p).some(s=>textoDeBusca(s)===filtros.sessao))return false;
    if(apenasLocal)return true;
    const meta = bibliografiaTcl.get(isbnDoProdutoTcl(p));
    const valores = {
      autor:[p.autor,meta?.autor],editora:[p.editora,meta?.editora],
      genero:[p.genero,meta?.genero],assunto:[p.assunto,p.categoria,meta?.assunto]
    };
    return Object.entries(valores).every(([campo,opcoes])=>!filtros[campo] || opcoes.some(v=>textoDeBusca(v).includes(filtros[campo])));
  });
}

function limparFiltrosTcl(){
  for(const campo of camposFiltroTcl)document.getElementById('tcl-'+campo).value = '';
  renderTcl();
}

async function enriquecerResultadosTcl(){
  if(!indiceTcl)return;
  const botao = document.getElementById('tcl-enriquecer');
  if(botao.disabled)return;
  const indice = indiceTcl;
  const estado = document.getElementById('tcl-dados-filtros');
  botao.disabled = true;
  try{
    await recuperarBibliografiaTcl();
    if(indiceTcl!==indice || telaAtual!=='tcl')return;
    const valor = textoDeBusca(document.getElementById('tcl-busca').value);
    const itens = filtrarDetalhesTcl(filtrarProdutosTcl(indice,valor),filtrosAtuaisTcl(),true);
    const corte = Date.now()-7*86400000;
    const candidatos = new Set();
    for(const item of itens){
      const isbn = isbnDoProdutoTcl(item);
      if(isbn && !(bibliografiaTcl.get(isbn)?.at>=corte))candidatos.add(isbn);
      if(candidatos.size>=20)break;
    }
    const lote = [...candidatos];
    if(!lote.length){estado.textContent = 'Os ISBNs disponíveis neste recorte já foram consultados.';return;}
    let completos=0, falhas=0;
    for(let i=0;i<lote.length;i+=4){
      if(indiceTcl!==indice || telaAtual!=='tcl'){estado.textContent='Consulta interrompida ao mudar de catálogo.';return;}
      estado.textContent = 'Consultando ISBNs · '+i+'/'+lote.length;
      const respostas = await Promise.allSettled(lote.slice(i,i+4).map(async isbn=>{
        const livro = await consultarLivroTcl(isbn);
        if(!livro)guardarBibliografiaTcl(isbn,null);
        if(livro?.genero || livro?.assunto)completos++;
      }));
      falhas += respostas.filter(r=>r.status==='rejected').length;
      // Evita insistir em lote quando todas as fontes estão indisponíveis.
      if(falhas===i+respostas.length)break;
    }
    estado.textContent = completos+' ISBN(s) com gênero ou assunto neste lote.'+
      (falhas?' Algumas consultas falharam. Tente novamente.':' Clique novamente para consultar o próximo lote, se houver.');
    renderTcl();
  }finally{botao.disabled = false;}
}
