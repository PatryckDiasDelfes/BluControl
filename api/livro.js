const {isbnCanonico} = require('../isbn.js');

function texto(valor,limite=400){
  return typeof valor==='string'?valor.replace(/<br\s*\/?\s*>|<\/p>/gi,'\n')
    .replace(/<[^>]*>/g,'').trim().slice(0,limite):'';
}

function urlPublica(valor){
  if(typeof valor!=='string')return '';
  try{
    const url = new URL(valor.replace(/^http:\/\//i,'https://'));
    return url.protocol==='https:' && !url.username && !url.password?url.href:'';
  }catch{return '';}
}

function listaDeNomes(items){
  const nomes = (Array.isArray(items)?items:[]).slice(0,30).map(item=>texto(typeof item==='string'?item:item?.name,100)).filter(Boolean);
  return [...new Set(nomes)].slice(0,8).join(', ');
}

function generoDeAssuntos(assuntos){
  const termos = (Array.isArray(assuntos)?assuntos:[]).map(item=>typeof item==='string'?item:item?.name);
  return listaDeNomes(termos.filter(termo=>typeof termo==='string' && /^(?:ficção|fiction|fantasia|fantasy|romance|literatura|literature|poesia|poetry|biografia|biography|distopia|dystopia|terror|horror)(?:$|[\s;,])/i.test(termo)));
}

function anoPublicacao(valor){
  return Number(texto(valor).match(/\b\d{4}\b/)?.[0])||null;
}

async function buscarJson(url,prazo,headers={}){
  const resposta = await fetch(url,{signal:AbortSignal.timeout(prazo),headers:{Accept:'application/json','User-Agent':'Blulivro-TCL/1.0',...headers}});
  if(resposta.status===404)return {};
  if(!resposta.ok)throw new Error('Provedor indisponível');
  return resposta.json();
}

async function googleBooks(isbn){
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q','isbn:'+isbn);
  url.searchParams.set('maxResults','8');
  if(process.env.GOOGLE_BOOKS_API_KEY)url.searchParams.set('key',process.env.GOOGLE_BOOKS_API_KEY);
  const resposta = await buscarJson(url,2600);
  const edicoes = (resposta.items||[]).map(item=>item.volumeInfo).filter(item=>
    item?.title && item.industryIdentifiers?.some(id=>isbnCanonico(id.identifier)===isbn));
  const livro = edicoes.find(item=>urlPublica(item.imageLinks?.thumbnail||item.imageLinks?.smallThumbnail))||edicoes[0];
  if(!livro)return null;
  return {
    titulo:texto(livro.title),autor:listaDeNomes(livro.authors),editora:texto(livro.publisher),
    ano:anoPublicacao(livro.publishedDate),paginas:livro.pageCount||null,genero:listaDeNomes(livro.categories),
    sinopse:texto(livro.description,5000),capa:urlPublica(livro.imageLinks?.thumbnail||livro.imageLinks?.smallThumbnail),
    fonte:'Google Books',link:urlPublica(livro.infoLink)
  };
}

async function brasilApi(isbn){
  const livro = await buscarJson('https://brasilapi.com.br/api/isbn/v1/'+isbn,4500);
  if(!livro?.title || isbnCanonico(livro.isbn)!==isbn)return null;
  return {
    titulo:texto(livro.title),autor:listaDeNomes(livro.authors),editora:texto(livro.publisher),
    ano:Number(livro.year)||null,paginas:Number(livro.page_count)||null,assunto:listaDeNomes(livro.subjects),genero:generoDeAssuntos(livro.subjects),
    sinopse:texto(livro.synopsis,5000),capa:urlPublica(livro.cover_url),fonte:'BrasilAPI'
  };
}

async function isbnDb(isbn){
  const {book:livro} = await buscarJson('https://api2.isbndb.com/book/'+isbn,4500,{Authorization:process.env.ISBNDB_API_KEY});
  if(!livro?.title || ![livro.isbn13,livro.isbn].some(id=>isbnCanonico(id)===isbn))return null;
  return {
    titulo:texto(livro.title),autor:listaDeNomes(livro.authors),editora:texto(livro.publisher),
    ano:anoPublicacao(livro.date_published),paginas:Number(livro.pages)||null,assunto:listaDeNomes(livro.subjects),genero:generoDeAssuntos(livro.subjects),
    sinopse:texto(livro.synopsis,5000),capa:urlPublica(livro.image),fonte:'ISBNdb'
  };
}

async function openLibrary(isbn){
  const chave = 'ISBN:'+isbn;
  const url = new URL('https://openlibrary.org/api/books');
  url.search = new URLSearchParams({bibkeys:chave,format:'json',jscmd:'data'});
  const livro = (await buscarJson(url,4500))[chave];
  if(!livro?.title)return null;
  const identificadores = [...(livro.identifiers?.isbn_13||[]),...(livro.identifiers?.isbn_10||[])];
  if(identificadores.length && !identificadores.some(id=>isbnCanonico(id)===isbn))return null;
  return {
    titulo:texto(livro.title),autor:listaDeNomes(livro.authors),editora:listaDeNomes(livro.publishers),
    ano:anoPublicacao(livro.publish_date),paginas:livro.number_of_pages||null,
    assunto:listaDeNomes(livro.subjects),genero:generoDeAssuntos(livro.subjects),sinopse:texto(typeof livro.description==='object'?livro.description?.value:livro.description,5000),
    capa:urlPublica(livro.cover?.medium||livro.cover?.large),
    fonte:'Open Library',link:urlPublica(livro.url)
  };
}

const {createHash} = require('node:crypto');
const projetoFirebase = process.env.BLULIVRO_FIREBASE_PROJECT_ID||'conferencia-blu';
const dadosFirebase = 'projects/'+projetoFirebase+'/databases/(default)/documents';
const validacoesAtivas = new Map();
const fichasPorIsbn = new Map();

function lerToken(authorization){
  if(typeof authorization!=='string' || authorization.length>8192)return null;
  const partes = /^Bearer ([\w-]+\.([\w-]+)\.[\w-]+)$/i.exec(authorization);
  if(!partes)return null;
  try{
    const payload = JSON.parse(Buffer.from(partes[2],'base64url').toString('utf8'));
    const agora = Math.floor(Date.now()/1000);
    if(payload.aud!==projetoFirebase || payload.iss!=='https://securetoken.google.com/'+projetoFirebase ||
      typeof payload.sub!=='string' || !/^[^/]{1,128}$/.test(payload.sub) ||
      typeof payload.email!=='string' || !Number.isInteger(payload.exp) || payload.exp<=agora ||
      !Number.isInteger(payload.auth_time) || payload.auth_time>agora)return null;
    return {token:partes[1],uid:payload.sub,email:payload.email.toLowerCase(),inicio:payload.auth_time};
  }catch{return null;}
}

async function verificarPerfil({token,uid,email,inicio}){
  const perfil = dadosFirebase+'/perfis/'+uid;
  const sessao = dadosFirebase+'/configuracao/sessao';
  try{
    // O Firestore valida a assinatura e aplica as regras aos dois documentos.
    const resposta = await fetch('https://firestore.googleapis.com/v1/'+dadosFirebase+':batchGet',{
      method:'POST',body:JSON.stringify({documents:[perfil,sessao]}),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(4000),redirect:'error'
    });
    if([401,403].includes(resposta.status))return resposta.status;
    if(!resposta.ok)return 503;
    const documentos = await resposta.json();
    const campos = documentos.find(d=>d.found?.name===perfil)?.found.fields;
    const prazo = documentos.find(d=>d.found?.name===sessao)?.found.fields?.dias?.integerValue;
    const dias = prazo==null?7:Number(prazo);
    const ativo = campos?.ativo?.booleanValue===true && campos?.email?.stringValue===email &&
      ['operador','supervisor','administrador'].includes(campos?.perfil?.stringValue);
    return ativo && Number.isInteger(dias) && dias>=1 && dias<=30 && Date.now()-inicio*1000<dias*86400000?200:403;
  }catch{return 503;}
}

function autorizar(token){
  const chave = createHash('sha256').update(token.token).digest('hex');
  if(validacoesAtivas.has(chave))return validacoesAtivas.get(chave);
  if(validacoesAtivas.size>=256)return 503;
  const pedido = verificarPerfil(token).finally(()=>validacoesAtivas.delete(chave));
  validacoesAtivas.set(chave,pedido);
  return pedido;
}

module.exports = async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({erro:'Método não permitido'});
  }
  const token = lerToken(req.headers?.authorization);
  if(!token)return res.status(401).json({erro:'Entre para consultar o catálogo.'});
  const status = await autorizar(token);
  if(status!==200)return res.status(status).json({erro:status===503?'Validação de acesso indisponível.':'Acesso à consulta indisponível. Use um perfil ativo.'});
  const isbn = isbnCanonico(req.query.isbn);
  if(!isbn)return res.status(400).json({erro:'ISBN inválido'});
  const salvo = fichasPorIsbn.get(isbn);
  if(salvo?.expira>Date.now())return res.status(salvo.status).json(salvo.body);
  const salvarFicha = (status,body,duracao)=>{
    fichasPorIsbn.delete(isbn);
    if(fichasPorIsbn.size>=256)fichasPorIsbn.delete(fichasPorIsbn.keys().next().value);
    fichasPorIsbn.set(isbn,{status,body,expira:Date.now()+duracao});
    return res.status(status).json(body);
  };
  const fontes = [googleBooks,openLibrary,brasilApi];
  if(process.env.ISBNDB_API_KEY)fontes.push(isbnDb);
  const respostas = await Promise.allSettled(fontes.map(buscar=>buscar(isbn)));
  const livros = respostas.map(r=>r.value).filter(Boolean);
  if(livros.length){
    const capas = [...new Set(livros.map(livro=>livro.capa).filter(Boolean))];
    const ficha = {...livros[0]};
    const fontesUsadas = new Set([ficha.fonte]);
    for(const campo of ['autor','editora','ano','paginas','genero','assunto','sinopse']){
      if(ficha[campo])continue;
      const origem = livros.find(livro=>livro[campo]);
      if(origem){ficha[campo]=origem[campo];fontesUsadas.add(origem.fonte);}
    }
    return salvarFicha(200,{isbn,...ficha,fontes:[...fontesUsadas],capa:capas[0]||'',capas},capas.length?3600000:300000);
  }
  if(respostas.some(r=>r.status==='rejected'))return res.status(503).json({erro:'Consulta bibliográfica indisponível'});
  return salvarFicha(404,{erro:'ISBN sem ficha bibliográfica'},300000);
};
