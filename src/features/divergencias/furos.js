const estadosFuro = ['Pendente','Aguardando primeira conferência','Aguardando segunda conferência','Divergência confirmada','Resolvido','Arquivado'];
const furosAtuais = new Map();
let pararFuros;
let estadoFuros = 'carregando';
let erroFuros = '';
let furoEmEdicao;
let versaoFuro;

function carregarFiltrosFuros(){
  const opcoes = estadosFuro.map(estado=>`<option>${estado}</option>`).join('');
  const filtro = document.getElementById('furos-filtro');
  if(!filtro.options.length)filtro.innerHTML = '<option value="">Sem arquivados</option><option value="todos">Todos os status</option>'+opcoes;
  document.getElementById('furo-status').innerHTML = opcoes;
}

function acompanharFuros(){
  if(pararFuros)return;
  estadoFuros = 'carregando';
  erroFuros = '';
  renderFuros();
  // Ordenar no Firestore excluiria os registros antigos sem criadoEm.
  pararFuros = db.collection('furos').onSnapshot({includeMetadataChanges:true},snap=>{
    for(const {type,doc} of snap.docChanges({includeMetadataChanges:true})){
      if(doc.metadata.hasPendingWrites)continue;
      if(type==='removed' && !snap.metadata.fromCache)furosAtuais.delete(doc.id);
      else if(type!=='removed')guardarFuroExibido(doc.id,doc.data());
    }
    estadoFuros = snap.metadata.fromCache?'cache':'confirmado';
    renderFuros();
  },erro=>{
    pararFuros = null;
    estadoFuros = 'erro';
    erroFuros = mensagemErro(erro);
    renderFuros();
  });
}

function guardarFuroExibido(id,dados){
  const atual = furosAtuais.get(id);
  if(!atual || (dados.versao||0)>=(atual.versao||0))furosAtuais.set(id,{...dados,id});
}

function encerrarFuros(){
  pararFuros?.();
  pararFuros = null;
  furosAtuais.clear();
}

function atualizarFuros(){
  encerrarFuros();
  acompanharFuros();
}

function dataDoFuro(furo){
  return dataMs(furo.criadoEm)||dataMs(furo.atualizadoEm);
}

function renderFuros(){
  const status = document.getElementById('furos-filtro').value;
  const q = textoDeBusca(document.getElementById('furos-busca').value);
  const data = document.getElementById('furos-data').value;
  const linhas = [...furosAtuais.values()].filter(f=>{
    if(status!=='todos' && (status?f.status!==status:f.status==='Arquivado'))return false;
    if(data && (!dataDoFuro(f) || diaArquivo.format(dataDoFuro(f))!==data))return false;
    return !q || [f.produto,f.codigo,f.codigoInterno,f.loja,f.autor,f.responsavel1,f.responsavel2].some(v=>textoDeBusca(v).includes(q));
  }).sort((a,b)=>dataDoFuro(b)-dataDoFuro(a)||a.id.localeCompare(b.id));
  const contagem = linhas.length===1?'1 registro':linhas.length+' registros';
  const estados = {
    carregando:'Carregando registros…',cache:'Sincronizando registros com o servidor…',
    erro:'Falha ao sincronizar. '+erroFuros,confirmado:''
  };
  const aviso = estados[estadoFuros];
  document.getElementById('furos-status').textContent = [linhas.length || !aviso?contagem:'',aviso].filter(Boolean).join(' · ');
  const vazio = aviso || (q || status || data ? 'Nenhum furo corresponde aos filtros.' : 'Nenhum furo registrado.');
  document.getElementById('furos-resultados').innerHTML = paginar('pag-furos',linhas,50,JSON.stringify([q,status,data])).map(f=>{
    const diferenca = f.estoqueFisico==null || f.estoqueSistema==null?null:f.estoqueFisico-f.estoqueSistema;
    const classe = {Pendente:'pendente',Resolvido:'ok',Arquivado:'arquivado','Divergência confirmada':'divergente'}[f.status]||'andamento';
    return `<tr role="row" class="furo-registro">
      <td role="cell" class="furo-produto"><strong>${esc(f.produto||'Produto sem título')}</strong><small class="subtabela">${esc(f.codigo)}</small></td>
      <td role="cell" class="furo-loja">${esc(f.loja||'—')}</td>
      <td role="cell" class="furo-situacao"><span class="furo-etiqueta ${classe}">${esc(f.status||'Sem status')}</span></td>
      <td role="cell" class="furo-dif"><small aria-hidden="true">Diferença</small>${formatarDif(diferenca)}</td>
      <td role="cell" class="furo-autor">${esc(f.autor||'—')}</td>
      <td role="cell" class="furo-acao"><button type="button" class="btn sec btn-sm" onclick="abrirFuro(${arg(f.id)})">Abrir</button></td></tr>`;
  }).join('')||`<tr role="row"><td role="cell" colspan="6" class="empty">${esc(vazio)}</td></tr>`;
}

const camposFuro = ['produto','codigo','codigoInterno','loja','localizacao','observacoes','estoqueSistema','estoqueFisico'];

async function abrirFuro(id=''){
  clearTimeout(consultaFuro);
  rodadaFuro++;
  camposPreenchidosFuro.clear();
  codigoPreenchidoFuro = '';
  const furo = furosAtuais.get(id);
  if(id && !furo)return;
  furoEmEdicao = furo || null;
  furoEmEdicao &&= {...furoEmEdicao};
  versaoFuro = furo?.versao||0;
  const dialog = document.getElementById('furo-modal');
  const permiteEditar = !furo || pode('supervisao');
  for(const campo of camposFuro){
    const el = document.getElementById('furo-'+campo);
    el.value = furo?.[campo]??'';
    el.readOnly = !permiteEditar;
  }
  document.getElementById('furo-etapa').value = '0';
  document.getElementById('furo-status').value = furo?.status||'Pendente';
  document.getElementById('furo-supervisao').hidden = !(furo && pode('supervisao'));
  document.getElementById('furo-conferencias').textContent = furo?
    [1,2].filter(n=>furo['data'+n]).map(n=>`${n}ª conferência · ${furo['responsavel'+n]} · ${dataBr.format(dataMs(furo['data'+n]))}`).join(' | '):'';
  document.getElementById('furo-salvar').hidden = !permiteEditar;
  document.getElementById('furo-consultar').hidden = !permiteEditar;
  document.getElementById('furo-informacao').textContent = '';
  const historico = document.getElementById('furo-historico');
  historico.replaceChildren();
  dialog.showModal();
  if(!furo)return;
  try{
    const snap = await db.collection('furos').doc(id).collection('alteracoes').orderBy('at','desc').get(servidor);
    if(furoEmEdicao?.id!==id)return;
    for(const doc of snap.docs){
      const v = doc.data();
      const mudancas = camposFuro.concat('status').filter(k=>v.antes?.[k]!==v.depois?.[k])
        .map(k=>`${k} de ${v.antes?.[k]??'—'} para ${v.depois?.[k]??'—'}`);
      const li = document.createElement('li');
      li.textContent = [v.autor,v.at?dataBr.format(dataMs(v.at)):'',v.tipo,...mudancas].filter(Boolean).join(' · ');
      historico.append(li);
    }
  }catch(erro){document.getElementById('furo-informacao').textContent = mensagemErro(erro);}
}

let consultaFuro;
let rodadaFuro = 0;
let codigoPreenchidoFuro = '';
const camposPreenchidosFuro = new Map();

function programarConsultaFuro(){
  clearTimeout(consultaFuro);
  rodadaFuro++;
  const codigo = codigoNormalizado(document.getElementById('furo-codigo').value);
  limparPreenchimentoAnteriorFuro(codigo);
  document.getElementById('furo-informacao').textContent = '';
  if(codigo.length>=8)consultaFuro = setTimeout(consultarCatalogoNoFuro,350);
}

function limparPreenchimentoAnteriorFuro(codigo){
  if(codigo===codigoPreenchidoFuro)return;
  for(const [campo,valor] of camposPreenchidosFuro){
    const el = document.getElementById('furo-'+campo);
    if(el.value===valor)el.value = '';
  }
  camposPreenchidosFuro.clear();
  codigoPreenchidoFuro = codigo;
}

function buscarBipeNoFuro(event){
  if(event.key!=='Enter')return;
  event.preventDefault();
  consultarCatalogoNoFuro();
}

async function consultarCatalogoNoFuro(){
  if(furoEmEdicao && !pode('supervisao'))return;
  clearTimeout(consultaFuro);
  const rodada = ++rodadaFuro;
  const codigo = codigoNormalizado(document.getElementById('furo-codigo').value);
  const loja = document.getElementById('furo-loja');
  const estado = document.getElementById('furo-informacao');
  if(!codigo){estado.textContent = 'Informe o ISBN ou código.';return;}
  limparPreenchimentoAnteriorFuro(codigo);
  estado.textContent = 'Buscando no catálogo Dauer…';
  const nomeLoja = textoDeBusca(loja.value);
  // Quantidades e localização dependem da unidade que estava selecionada.
  const atual = ()=>rodada===rodadaFuro && document.getElementById('furo-modal').open &&
    codigoNormalizado(document.getElementById('furo-codigo').value)===codigo && textoDeBusca(loja.value)===nomeLoja;
  try{
    const unidades = await repositorioProdutos.unidades();
    if(!atual())return;
    document.getElementById('furo-unidades').innerHTML = unidades.map(u=>`<option value="${esc(u.nome)}"></option>`).join('');
    const unidade = unidades.find(u=>textoDeBusca(u.nome)===nomeLoja);
    if(nomeLoja && !unidade){
      estado.textContent = 'Escolha uma unidade publicada para preencher os dados do catálogo.';
      return;
    }
    const achados = [];
    const candidatas = unidade?[unidade]:unidades;
    for(let i=0;i<candidatas.length;i+=3){
      const bloco = await Promise.all(candidatas.slice(i,i+3).map(async u=>{
        const produtos = await repositorioProdutos.indice(u);
        return produtoPorCodigo(produtos,codigo).map(produto=>({u,produto}));
      }));
      if(!atual())return;
      achados.push(...bloco.flat());
    }
    if(!achados.length){estado.textContent = 'Código ausente no catálogo consultado. Preencha os dados disponíveis.';return;}
    const preencher = (campo,valor)=>{
      const el = document.getElementById('furo-'+campo);
      if(valor==null || valor==='' || (el.value && el.value!==camposPreenchidosFuro.get(campo)))return false;
      el.value = el.maxLength>0?String(valor).slice(0,el.maxLength):String(valor);
      camposPreenchidosFuro.set(campo,el.value);
      return true;
    };
    const valoresComuns = campo=>{
      const primeiro = achados[0].produto[campo];
      return achados.every(({produto})=>produto[campo]===primeiro)?primeiro:undefined;
    };
    preencher('produto',valoresComuns('titulo'));
    preencher('codigoInterno',valoresComuns('codigoInterno'));
    const distribuicao = new Set(achados.map(({u})=>u.id));
    if(achados.length===1){
      const {u,produto} = achados[0];
      preencher('loja',u.nome);
      preencher('localizacao',produto.localizacao);
      preencher('estoqueSistema',produto.estoque);
      estado.textContent = 'Produto encontrado. Confira os dados e informe o estoque físico.';
    }else{
      estado.textContent = distribuicao.size>1?'Código encontrado em mais de uma unidade. Escolha a loja para trazer o saldo e a localização.'
        :'Mais de um produto usa este código na unidade. Confirme os dados antes de salvar.';
    }
  }catch(erro){if(atual())estado.textContent = mensagemErro(erro);}
}

function alterarLojaNoFuro(){
  rodadaFuro++;
  for(const campo of ['localizacao','estoqueSistema']){
    const el = document.getElementById('furo-'+campo);
    if(el.value===camposPreenchidosFuro.get(campo))el.value='';
    camposPreenchidosFuro.delete(campo);
  }
  camposPreenchidosFuro.delete('loja');
  if(document.getElementById('furo-codigo').value)consultarCatalogoNoFuro();
}

async function salvarFuro(event){
  event.preventDefault();
  const formulario = event.currentTarget;
  const btn = document.getElementById('furo-salvar');
  if(btn.disabled)return;
  const editado = furoEmEdicao;
  if(editado && !exigirPermissao('supervisao'))return;
  const referencia = editado?db.collection('furos').doc(editado.id):db.collection('furos').doc();
  const historico = referencia.collection('alteracoes').doc();
  const valores = Object.fromEntries(camposFuro.map(k=>{
    const el = document.getElementById('furo-'+k);
    return [k,el.type==='number'?(Number.isNaN(el.valueAsNumber)?null:el.valueAsNumber):txt(el.value)];
  }));
  valores.codigo = codigoNormalizado(valores.codigo);
  const etapa = Number(document.getElementById('furo-etapa').value);
  const status = editado?document.getElementById('furo-status').value:'Pendente';
  const esperado = versaoFuro;
  if(!valores.produto || !valores.codigo || !valores.loja){document.getElementById('furo-informacao').textContent = 'Informe produto, código e loja.';return;}
  btn.disabled = true;
  try{
    const dadosGravados = await db.runTransaction(async tx=>{
      const doc = await tx.get(referencia);
      const anterior = doc.data();
      if(editado && !doc.exists)throw new Error('Este furo não está mais disponível. Atualize os registros.');
      if((anterior?.versao||0)!==esperado)throw new Error('Este furo foi alterado. Feche e abra o registro novamente.');
      if((etapa===1 && anterior?.data1) || (etapa===2 && (!anterior?.data1 || anterior.data2))){
        throw new Error('Registre a primeira conferência antes da segunda. Cada conferência é registrada uma vez.');
      }
      const conferencias = editado && etapa?{['data'+etapa]:timestamp(),['responsavel'+etapa]:ME.nome}:{};
      const versao = esperado+1;
      const dados = {...valores,...conferencias,status,versao,ultimoHistorico:historico.id,atualizadoEm:timestamp(),
        ...(!editado?{criadoEm:timestamp(),autor:ME.nome,uid:ME.uid}:{})};
      tx.set(referencia,dados,{merge:true});
      const antes = anterior?Object.fromEntries([...camposFuro,'status'].map(k=>[k,anterior[k]??null])):{};
      tx.set(historico,{antes,depois:{...valores,status},versao,uid:ME.uid,autor:ME.nome,at:timestamp(),
        tipo:!editado?'Inclusão':etapa===1?'Primeira conferência':etapa===2?'Segunda conferência':'Alteração'});
      const agora = firebase.firestore.Timestamp.now();
      return {...anterior,...dados,criadoEm:editado?anterior.criadoEm:agora,atualizadoEm:agora,
        ...(editado && etapa?{['data'+etapa]:agora}:{})};
    });
    if(telaAtual==='furos'){
      const exibido = furosAtuais.get(referencia.id);
      if(!exibido || (exibido.versao||0)<dadosGravados.versao)guardarFuroExibido(referencia.id,dadosGravados);
      if(!editado){
        for(const id of ['furos-busca','furos-filtro','furos-data'])document.getElementById(id).value = '';
        paginas.delete('pag-furos');
      }
      renderFuros();
    }
    formulario.reset();
    document.getElementById('furo-modal').close();
    toast(editado?'Furo atualizado.':'Furo registrado.');
    registrarAuditoria((editado?'Furo atualizado · ':'Furo registrado · ')+referencia.id);
  }catch(erro){document.getElementById('furo-informacao').textContent = mensagemErro(erro);}
  finally{btn.disabled = false;}
}
