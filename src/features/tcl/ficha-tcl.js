const cacheFichasTcl = new Map();
const moedaTcl = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
let fichaTclAtual;

function consultarLivroTcl(isbn){
  const salvo = cacheFichasTcl.get(isbn);
  if(salvo && salvo.expira>Date.now())return salvo.pedido;
  const item = {expira:Infinity,pedido:null};
  const usuario = auth.currentUser;
  if(!usuario || usuario.uid!==ME.uid)return Promise.reject(new Error('Entre novamente para consultar a ficha.'));
  item.pedido = usuario.getIdToken().then(token=>{
    if(auth.currentUser?.uid!==usuario.uid)throw new Error('A sessão de acesso mudou.');
    return fetch('/api/livro?isbn='+isbn+'&v=4',{
      signal:AbortSignal.timeout(11000),headers:{Authorization:'Bearer '+token},cache:'no-store'
    });
  })
    .then(async resposta=>{
      if(resposta.status===404){item.expira=Date.now()+300000;return null;}
      if(!resposta.ok)throw new Error('Consulta bibliográfica indisponível');
      const livro = await resposta.json();
      if(livro.isbn!==isbn || !livro.titulo)throw new Error('Ficha inválida');
      guardarBibliografiaTcl(isbn,livro);
      item.expira = Date.now()+(livro.capa?3600000:300000);
      return livro;
    }).catch(erro=>{
      if(cacheFichasTcl.get(isbn)===item)cacheFichasTcl.delete(isbn);
      throw erro;
    });
  cacheFichasTcl.set(isbn,item);
  if(cacheFichasTcl.size>80)cacheFichasTcl.delete(cacheFichasTcl.keys().next().value);
  return item.pedido;
}

function temDadoTcl(valor){
  return valor!=null && (typeof valor!=='string' || Boolean(valor.trim()));
}

function enderecoFichaTcl(valor){
  if(!valor)return '';
  try{
    const url = new URL(String(valor).replace(/^http:\/\//i,'https://'));
    return url.protocol==='https:' && !url.username && !url.password?url.href:'';
  }catch{return '';}
}

function definirCapaTcl(ficha,enderecos){
  const imagem = document.getElementById('tcl-capa');
  const vazia = document.getElementById('tcl-capa-vazia');
  const modal = document.getElementById('tcl-modal');
  ficha.capas = [...new Set(enderecos.map(enderecoFichaTcl).filter(Boolean))];
  if(ficha.capaAtiva && ficha.capas.includes(ficha.capaAtiva))return;
  function tentarCapa(){
    const url = ficha.capas.find(capa=>!ficha.capasFalhas.has(capa));
    ficha.capaAtiva = url;
    imagem.hidden = true;
    vazia.hidden = false;
    vazia.textContent = url?'Buscando capa…':'Capa indisponível';
    if(!url){imagem.removeAttribute('src');return;}
    const atual = ()=>modal.open && fichaTclAtual===ficha && ficha.capaAtiva===url;
    const falhar = ()=>{
      clearTimeout(timer);
      if(!atual())return;
      ficha.capasFalhas.add(url);
      tentarCapa();
    };
    const timer = setTimeout(falhar,2800);
    imagem.onload = ()=>{
      clearTimeout(timer);
      if(!atual())return;
      if(imagem.naturalWidth<32 || imagem.naturalHeight<32){falhar();return;}
      imagem.hidden = false;
      vazia.hidden = true;
    };
    imagem.onerror = falhar;
    imagem.src = url;
  }
  tentarCapa();
}

function formatarPrecoTcl(valor){
  const preco = precoDeVendaDauer(valor);
  return preco===null?'Não cadastrado':moedaTcl.format(preco);
}

function parDeFichaTcl(rotulo,valor){
  return '<div><dt>'+esc(rotulo)+'</dt><dd>'+esc(valor)+'</dd></div>';
}

function textoOpcionalTcl(id,valor){
  const el = document.getElementById(id);
  el.textContent = valor||'';
  el.hidden = !valor;
}

function renderFichaTcl(ficha,externo=null){
  const {produto,isbn,unidade} = ficha;
  const dados = campo=>temDadoTcl(produto?.[campo])?produto[campo]:externo?.[campo];
  document.getElementById('tcl-titulo-ficha').textContent = dados('titulo')||ficha.tituloEspera;
  textoOpcionalTcl('tcl-isbn-ficha',isbn?'ISBN '+isbn:'');
  textoOpcionalTcl('tcl-autor-ficha',dados('autor'));
  textoOpcionalTcl('tcl-edicao-ficha',[dados('editora'),dados('ano')].filter(temDadoTcl).join(' · '));
  const capaIsbn = ficha.isbnValidado?'https://covers.openlibrary.org/b/isbn/'+ficha.isbnValidado+'-M.jpg?default=false':'';
  definirCapaTcl(ficha,[produto?.capa,...(externo?.capas||[]),externo?.capa,capaIsbn]);

  document.getElementById('tcl-unidade-ficha-titulo').textContent = unidade?.nome||'Dados da unidade';
  textoOpcionalTcl('tcl-disponibilidade-ficha',produto?'':ficha.disponibilidade);
  const operacao = document.getElementById('tcl-dados-unidade');
  operacao.hidden = !produto;
  operacao.innerHTML = produto?
    parDeFichaTcl('Preço de venda',formatarPrecoTcl(produto.preco))+
    parDeFichaTcl('Estoque no Dauer',produto.estoque??'—')+
    parDeFichaTcl('Localização',produto.localizacao||'—'):'';

  const campos = {codigoInterno:'Código interno',codigoBarras:'Código de barras',genero:'Gênero',assunto:'Assunto',categoria:'Categoria',edicao:'Edição',
    paginas:'Páginas',acabamento:'Acabamento',dimensoes:'Dimensões',peso:'Peso'};
  const detalhes = document.getElementById('tcl-ficha');
  detalhes.innerHTML = Object.entries(campos).filter(([campo])=>temDadoTcl(dados(campo)))
    .map(([campo,rotulo])=>parDeFichaTcl(rotulo,dados(campo))).join('');
  const sinopse = dados('sinopse');
  const painel = document.getElementById('tcl-sinopse');
  painel.hidden = !sinopse;
  document.getElementById('tcl-sinopse-texto').textContent = sinopse||'';
  document.getElementById('tcl-edicao-detalhes').hidden = !detalhes.children.length && !sinopse;
}

function statusFichaTcl(texto,fonte){
  document.getElementById('tcl-fonte-ficha').hidden = !texto && !fonte;
  document.getElementById('tcl-status-ficha').textContent = texto;
  const link = document.getElementById('tcl-link-fonte');
  const endereco = enderecoFichaTcl(fonte?.link);
  link.hidden = !endereco;
  link.textContent = fonte?.fonte||'';
  if(endereco)link.href = endereco;
  else link.removeAttribute('href');
}

async function abrirFichaTcl(produto,codigoDigitado=''){
  const modal = document.getElementById('tcl-modal');
  const unidade = unidadesCatalogo.find(u=>u.id===document.getElementById('tcl-unidade').value);
  const isbn = [produto?.isbn,produto?.codigoBarras,produto?.codigo,codigoDigitado].map(isbnCanonico).find(Boolean);
  const ficha = fichaTclAtual = {
    produto,isbn:isbn||produto?.isbn,isbnValidado:isbn,unidade,tituloEspera:'Consultando ISBN',capasFalhas:new Set(),
    disponibilidade:indiceTcl?'Este ISBN não consta no catálogo da unidade.':'Catálogo da unidade indisponível.'
  };
  document.getElementById('tcl-sinopse').open = true;
  const outras = document.getElementById('tcl-outras');
  outras.hidden = !isbn && !produto?.codigo || !unidadesCatalogo.some(u=>u.id!==unidade?.id);
  outras.disabled = false;
  document.getElementById('tcl-outras-resultado').hidden = true;
  renderFichaTcl(ficha);
  statusFichaTcl('');
  if(!modal.open)modal.showModal();
  modal.scrollTop = 0;
  if(produto && Number.isInteger(produto.parteDetalhes)){
    repositorioProdutos.detalhes(unidade,produto).then(completo=>{
      if(!modal.open || fichaTclAtual!==ficha)return;
      ficha.produto = completo;
      renderFichaTcl(ficha,ficha.bibliografia);
    }).catch(()=>{});
  }
  if(!isbn)return;
  statusFichaTcl('Consultando fontes bibliográficas…');
  try{
    const livro = await consultarLivroTcl(isbn);
    if(!modal.open || fichaTclAtual!==ficha)return;
    if(!livro){
      ficha.tituloEspera = 'ISBN sem ficha bibliográfica';
      renderFichaTcl(ficha);
      statusFichaTcl('As fontes consultadas não têm uma ficha para este ISBN.');
      return;
    }
    ficha.bibliografia = livro;
    renderFichaTcl(ficha,livro);
    const fontes = livro.fontes||[livro.fonte];
    statusFichaTcl(fontes.length>1?'Dados bibliográficos de '+fontes.join(', '):
      enderecoFichaTcl(livro.link)?'Dados bibliográficos de':'Dados bibliográficos de '+livro.fonte,fontes.length===1?livro:null);
    renderTcl();
  }catch{
    if(!modal.open || fichaTclAtual!==ficha)return;
    ficha.tituloEspera = 'Consulta indisponível';
    renderFichaTcl(ficha);
    statusFichaTcl('A consulta bibliográfica está indisponível. Tente novamente mais tarde.');
  }
}

async function verOutrasUnidadesTcl(){
  const ficha = fichaTclAtual;
  const botao = document.getElementById('tcl-outras');
  const painel = document.getElementById('tcl-outras-resultado');
  if(!ficha || botao.disabled)return;
  botao.disabled = true;
  painel.hidden = false;
  painel.textContent = 'Consultando outras unidades…';
  const unidades = unidadesCatalogo.filter(u=>u.id!==ficha.unidade?.id);
  const resultados = [];
  let falhas = 0;
  try{
    for(let i=0;i<unidades.length;i+=4){
      const respostas = await Promise.allSettled(unidades.slice(i,i+4).map(async u=>{
        const itens = await repositorioProdutos.indice(u);
        const produtos = ficha.isbnValidado?itens.filter(p=>isbnDoProdutoTcl(p)===ficha.isbnValidado):produtoPorCodigo(itens,ficha.produto.codigo);
        return produtos.map(p=>({u,p}));
      }));
      if(fichaTclAtual!==ficha || !document.getElementById('tcl-modal').open)return;
      for(const resposta of respostas){if(resposta.status==='fulfilled')resultados.push(...resposta.value);else falhas++;}
    }
    painel.innerHTML = (resultados.length?resultados.map(({u,p})=>'<article class="tcl-loja-consultada"><h4>'+esc(u.nome)+'</h4><dl class="tcl-operacao">'+
      parDeFichaTcl('Preço de venda',formatarPrecoTcl(p.preco))+parDeFichaTcl('Estoque',p.estoque??'—')+
      parDeFichaTcl('Localização',p.localizacao||'—')+'</dl></article>').join(''):
      '<p>Nenhum cadastro encontrado nas outras unidades consultadas.</p>')+(falhas?'<p class="ajuda">'+falhas+' unidade(s) não responderam.</p>':'');
  }finally{if(fichaTclAtual===ficha)botao.disabled = false;}
}
