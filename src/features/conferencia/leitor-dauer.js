function txt(v){return(v==null)?'':String(v).trim();}
function codigoTxt(v){if(v==null||v==='')return'';if(typeof v==='number'&&isFinite(v))return String(Math.trunc(v));return String(v).trim().replace(/\.0+$/,'');}
function num(v,pad=null){if(v==null||v==='')return pad;if(typeof v==='number'&&isFinite(v))return v;let s=String(v).trim().replace(/\s/g,'');if(s.indexOf(',')>=0&&s.indexOf('.')>=0)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(',','.');const n=Number(s);return Number.isFinite(n)?n:pad;}

function codigoNormalizado(valor){
  const codigo = codigoTxt(valor).toUpperCase();
  const isbn = codigo.replace(/[\s-]/g,'');
  return /^(?:\d{9}[\dX]|\d{13})$/.test(isbn) ? isbn : codigo;
}

function nomeNormalizado(nome){
  return txt(nome).normalize('NFC').replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');
}

const encoder = new TextEncoder();
const marcadorLocalizacaoDauer = /^localiza[cç][aã]o\s*:\s*(.*)$/i;

async function assinatura(texto){
  const buffer = await crypto.subtle.digest('SHA-256',encoder.encode(texto));
  return Array.from(new Uint8Array(buffer),n=>n.toString(16).padStart(2,'0')).join('');
}

function linhasDauer(planilha){
  if(planilha['!data'])return planilha['!data'];
  const linhas = new Map();
  for(const endereco of Object.keys(planilha)){
    const celula = /^([ABGK])([1-9]\d*)$/.exec(endereco);
    if(!celula)continue;
    const numero = Number(celula[2])-1;
    if(!linhas.has(numero))linhas.set(numero,[]);
    linhas.get(numero)[celula[1].charCodeAt(0)-65] = planilha[endereco];
  }
  return [...linhas.keys()].sort((a,b)=>a-b).map(numero=>linhas.get(numero));
}

function codigoDaCelula(celula){
  if(!celula)return '';
  const valor = celula.v;
  // Preserva ISBNs numéricos formatados com zeros à esquerda.
  if(typeof valor==='number' && /^00/.test(celula.z||'')){
    try{
      const formatado = XLSX.SSF.format(celula.z,valor);
      if(/^0\d+$/.test(formatado))return codigoNormalizado(formatado);
    }catch{ /* Usa o valor original quando o formato é desconhecido. */ }
  }
  return codigoNormalizado(valor);
}

function lerDauer(wb,comPrecos=false){
  const sessoes = new Map();
  const precos = new Map();
  const detalhes = new Map();
  let secaoDoArquivo = '';
  let semLocalizacao = 0;
  for(const aba of wb.SheetNames){
    const planilha = wb.Sheets[aba];
    const linhas = linhasDauer(planilha);
    const colunaPreco = comPrecos?colunaDeVendaDoRelatorio(linhas):-1;
    const colunasDetalhes = comPrecos?colunasDetalhesDoRelatorio(linhas):[];
    const b5 = txt(planilha['!data']?.[4]?.[1]?.v ?? planilha.B5?.v);
    secaoDoArquivo ||= b5;
    const agrupada = linhas.some(linha=>marcadorLocalizacaoDauer.test(txt(linha?.[0]?.v)));
    let secao = agrupada?'':b5||secaoDoArquivo;
    let itens;
    for(const linha of linhas){
      if(!linha)continue;
      const titulo = txt(linha[0]?.v);
      if(!titulo)continue;
      const local = marcadorLocalizacaoDauer.exec(titulo);
      if(local){
        secao = txt(linha[1]?.v) || txt(local[1]);
        itens = undefined;
        continue;
      }
      if(!linha[6] || !linha[10])continue;
      const codigo = codigoDaCelula(linha[6]);
      const valor = linha[10].v;
      const qtd = num(typeof valor==='string' && /^\d{1,3}(\.\d{3})+$/.test(valor.trim())
        ? valor.trim().replace(/\./g,'') : valor);
      if(!codigo || !Number.isInteger(qtd) || qtd<0)continue;
      const preco = colunaPreco<0?null:precoDeVendaDauer(linha[colunaPreco]?.v);
      if(preco!==null){
        if(!precos.has(codigo))precos.set(codigo,preco);
        else if(precos.get(codigo)!==preco)precos.set(codigo,null);
      }
      if(colunasDetalhes.length && !detalhes.has(codigo)){
        const campos = Object.fromEntries(colunasDetalhes.map(([nome,j])=>[nome,txt(linha[j]?.v)]).filter(([,v])=>v));
        if(Object.keys(campos).length)detalhes.set(codigo,campos);
      }
      if(!secao){
        semLocalizacao++;
        continue;
      }
      if(!itens){
        const chave = nomeNormalizado(secao);
        if(!sessoes.has(chave))sessoes.set(chave,{secao,itens:new Map()});
        itens = sessoes.get(chave).itens;
      }
      const existente = itens.get(codigo);
      if(existente){
        existente.qtd += qtd;
        existente.repetido = true;
      }else itens.set(codigo,{codigo,titulo,qtd,repetido:false});
    }
  }
  if(!sessoes.size){
    if(semLocalizacao)throw new Error('Os produtos estão sem localização. Confira os cabeçalhos “Localização:” ou a célula B5.');
    throw new Error('Nenhum produto válido nas colunas A, G e K.');
  }
  const ordenar = new Intl.Collator('pt-BR').compare;
  return {sessoes:[...sessoes.values()].map(({secao,itens})=>({
    secao,itens:[...itens.values()].sort((a,b)=>ordenar(a.codigo,b.codigo))
  })),semLocalizacao,precos,detalhes};
}

async function lerArquivoDauer(arquivo,pendentes){
  const buffer = await arquivo.arrayBuffer();
  const dados = lerDauer(XLSX.read(buffer,{
    type:'array',dense:true,cellDates:false,cellFormula:false,cellHTML:false,cellText:false,cellNF:true
  }));
  if(pendentes)dados.sessoes = dados.sessoes.filter(secao=>pendentes.has(nomeNormalizado(secao.secao)));
  for(let i=0;i<dados.sessoes.length;i+=24){
    await Promise.all(dados.sessoes.slice(i,i+24).map(async secao=>{
      secao.chave = nomeNormalizado(secao.secao);
      secao.exemplares = 0;
      secao.repetidos = 0;
      for(const item of secao.itens){
        secao.exemplares += item.qtd;
        if(item.repetido)secao.repetidos++;
      }
      secao.versao = await assinatura(JSON.stringify(secao.itens));
    }));
  }
  return dados;
}

const colunasCatalogoDauer = {
  titulo:['titulo','produto','descricao do produto','nome do produto'],
  isbn:['isbn','isbn 13'],codigoBarras:['ean','codigo de barras','cod barras','barcode'],
  codigoInterno:['codigo','codigo interno','sku','cod produto'],
  autor:['autor','autores'],editora:['editora'],categoria:['categoria'],genero:['genero'],assunto:['assunto','assuntos'],
  edicao:['edicao'],ano:['ano','ano de publicacao'],preco:['preco de venda','preco venda','valor de venda','valor venda','vlr venda',
    'preco varejo','preco de varejo','preco ao consumidor','p venda','preco'],
  estoque:['estoque','saldo','quantidade','qtd'],localizacao:['localizacao','secao'],
  paginas:['paginas','numero de paginas'],acabamento:['acabamento'],dimensoes:['dimensoes'],
  peso:['peso'],sinopse:['sinopse','descricao'],capa:['url da capa','url capa','link da capa','imagem da capa','imagem','capa']
};

function cabecalhoDauer(v){
  return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function indiceCabecalhoDauer(cab,campo){
  const nomes = campo==='preco'?cab.map(n=>n.replace(/ (?:r|rs|brl)$/,'')):cab;
  const nome = colunasCatalogoDauer[campo].find(n=>nomes.includes(n));
  return nome?nomes.indexOf(nome):-1;
}

function colunaDeVendaDoRelatorio(linhas){
  for(const linha of linhas.slice(0,20)){
    if(!linha)continue;
    const cab = linha.map(c=>cabecalhoDauer(c?.v));
    const venda = indiceCabecalhoDauer(cab,'preco');
    if(venda<0)continue;
    const estoque = cab.findIndex(c=>['est atual','estoque atual'].includes(c));
    // O cabeçalho de saldo e valores pode começar uma coluna antes dos dados do relatório.
    return estoque===9 && venda>estoque?venda+1:venda;
  }
  return -1;
}

function colunasDetalhesDoRelatorio(linhas){
  for(const linha of linhas.slice(0,20)){
    if(!linha)continue;
    const cab = linha.map(c=>cabecalhoDauer(c?.v));
    if(indiceCabecalhoDauer(cab,'titulo')!==0)continue;
    return ['autor','editora','assunto','genero'].map(campo=>[campo,indiceCabecalhoDauer(cab,campo)]).filter(([,j])=>j>=0);
  }
  return [];
}

function precoDeVendaDauer(valor){
  if(typeof valor==='number')return Number.isFinite(valor) && valor>=0?valor:null;
  const bruto = txt(valor).replace(/^R\$\s*/i,'').replace(/\s/g,'');
  if(/^\d+(?:[.,]\d{1,2})?$/.test(bruto))return Number(bruto.replace(',','.'));
  if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(bruto))return num(bruto.replace(/\./g,''));
  if(/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(bruto))return Number(bruto.replace(/,/g,''));
  return null;
}

async function lerCatalogoDauer(arquivo){
  const wb = XLSX.read(await arquivo.arrayBuffer(),{type:'array',dense:true,cellNF:true,cellHTML:false,cellFormula:false});
  // Os relatórios de localização também têm cabeçalhos de produto e ISBN.
  // Prioriza os blocos do relatório para conservar o saldo de cada seção.
  if(wb.SheetNames.some(nome=>linhasDauer(wb.Sheets[nome]).some(linha=>marcadorLocalizacaoDauer.test(txt(linha?.[0]?.v))))){
    return catalogoPorLocalizacao(wb);
  }
  const itens = [];
  let erros = 0, tabelas = 0;
  for(const nome of wb.SheetNames){
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome],{header:1,raw:false,defval:''});
    for(let i=0;i<Math.min(linhas.length,20);i++){
      const cab = linhas[i].map(cabecalhoDauer);
      const campos = Object.keys(colunasCatalogoDauer).map(campo=>[campo,indiceCabecalhoDauer(cab,campo)])
        .filter(([,index])=>index!==-1);
      const usados = new Set(campos.map(([campo])=>campo));
      if(!['titulo','preco','capa'].some(campo=>usados.has(campo)) || !['isbn','codigoBarras','codigoInterno'].some(campo=>usados.has(campo)))continue;
      tabelas++;
      for(const linha of linhas.slice(i+1)){
        if(!linha.some(v=>txt(v)))continue;
        const item = Object.fromEntries(campos.map(([campo,j])=>[campo,txt(linha[j])]).filter(([,v])=>v));
        const codigo = codigoNormalizado(item.isbn||item.codigoBarras||item.codigoInterno);
        if(!codigo || codigo.length>160){erros++;continue;}
        for(const campo of ['estoque','preco','ano','paginas']){
          if(!(campo in item))continue;
          const bruto = item[campo].replace(/^R\$\s*/i,'').trim();
          const valor = campo==='preco'?precoDeVendaDauer(bruto):num(/^-?\d{1,3}(\.\d{3})+$/.test(bruto)?bruto.replace(/\./g,''):bruto);
          if(valor===null || (campo!=='preco' && !Number.isInteger(valor))){delete item[campo];erros++;}else item[campo] = valor;
        }
        if(item.titulo){itens.push({...item,codigo});continue;}
        if(item.preco==null && !item.capa){erros++;continue;}
        const {isbn,codigoBarras,codigoInterno,preco,capa} = item;
        itens.push({codigo,...Object.fromEntries(Object.entries({isbn,codigoBarras,codigoInterno,preco,capa}).filter(([,v])=>v!=null))});
      }
      break;
    }
  }
  if(tabelas)return {itens,erros,porLocalizacao:false};
  return catalogoPorLocalizacao(wb);
}

function catalogoPorLocalizacao(wb){
  const itens = [];
  const {sessoes,semLocalizacao,precos,detalhes} = lerDauer(wb,true);
  for(const {secao,itens:produtos} of sessoes){
    for(const item of produtos)itens.push({codigo:item.codigo,titulo:item.titulo,codigoBarras:item.codigo,
      estoque:item.qtd,localizacao:secao,repetido:item.repetido,...(/^97[89]\d{10}$/.test(item.codigo)?{isbn:item.codigo}:{}),
      ...detalhes.get(item.codigo),...(precos.get(item.codigo)!=null?{preco:precos.get(item.codigo)}:{})});
  }
  return {itens,erros:semLocalizacao+[...precos.values()].filter(v=>v===null).length,porLocalizacao:true};
}

if(typeof importScripts==='function' && typeof document==='undefined'){
  importScripts('/vendor/xlsx.full.min.js');
  self.onmessage = async ({data:{arquivo,pendentes,modo}})=>{
    try{self.postMessage({dados:await (modo==='catalogo'?lerCatalogoDauer(arquivo):lerArquivoDauer(arquivo,pendentes))});}
    catch(erro){self.postMessage({erro:erro.message});}
  };
}
