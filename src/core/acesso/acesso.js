const nomesDosPerfis = {operador:'Operador',supervisor:'Supervisor',administrador:'Administrador'};
const permissoesDasTelas = {importar:'supervisao',log:'supervisao',usuarios:'admin',fonte:'admin'};
let pararPerfilAtual;
let pararListaDePerfis;
let usuariosCadastrados = [];
let mensagemDeSaida = '';
let loginSolicitado = false;
const diaEmMs = 86400000;
let autenticacaoEm;
let pararPoliticaDeSessao;
const inatividadeSessao = 30*60*1000;
let ultimaInteracao = Date.now();
let vencimentoSessao;


function acompanharInatividade(){
  const marcar = ()=>{if(!verificarPrazoSessao())ultimaInteracao = Date.now();};
  for(const tipo of ['pointerdown','keydown'])document.addEventListener(tipo,marcar,{passive:true});
  window.addEventListener('pageshow',()=>{
    if(!auth.currentUser){document.getElementById('app').style.display = 'none';return;}
    verificarPrazoSessao();
  });
  setInterval(verificarPrazoSessao,15000);
}

function verificarPrazoSessao(){
  if(!auth.currentUser || !sessaoIniciada)return false;
  if(Date.now()-ultimaInteracao<inatividadeSessao && !(vencimentoSessao && Date.now()>=vencimentoSessao))return false;
  if(!mensagemDeSaida){
    mensagemDeSaida = 'Sua sessão expirou. Entre novamente.';
    sairDaConta();
  }
  return true;
}

function pode(permissao){
  if(permissao==='admin')return ME.perfil==='administrador';
  return ME.perfil==='supervisor' || ME.perfil==='administrador';
}

function exigirPermissao(permissao){
  if(pode(permissao))return true;
  toast('Seu perfil não pode realizar esta ação.');
  return false;
}

function mostrarEstadoLogin(mensagem='',ocupado=false){
  document.getElementById('login-erro').textContent = mensagem;
  document.getElementById('btn-login').disabled = ocupado;
  document.getElementById('btn-recuperar-senha').disabled = ocupado;
}

function observarAcesso(){
  auth.onAuthStateChanged(user=>{
    pararPerfilAtual?.();
    pararPerfilAtual = null;
    if(!user){
      if(sessaoIniciada){
        document.getElementById('app').style.display = 'none';
        try{if(mensagemDeSaida)sessionStorage.setItem('blu_login_aviso',mensagemDeSaida);}catch{}
        location.reload();
        return;
      }
      let mensagem = mensagemDeSaida;
      try{
        mensagem ||= sessionStorage.getItem('blu_login_aviso')||'';
        sessionStorage.removeItem('blu_login_aviso');
      }catch{}
      mostrarEstadoLogin(mensagem);
      return;
    }
    if(user.isAnonymous || !user.email){auth.signOut().catch(erro=>mostrarEstadoLogin(mensagemErro(erro)));return;}
    if(sessaoIniciada && ME.uid!==user.uid){
      document.getElementById('app').style.display = 'none';
      location.reload();
      return;
    }
    mostrarEstadoLogin('Verificando o perfil de acesso…',true);
    pararPerfilAtual = db.collection('perfis').doc(user.uid).onSnapshot({includeMetadataChanges:true},async snap=>{
      if(snap.metadata.fromCache || snap.metadata.hasPendingWrites)return;
      const perfil = snap.data();
      const email = user.email.toLowerCase();
      if(!perfil?.ativo || perfil.email!==email || !Object.hasOwn(nomesDosPerfis,perfil.perfil) || !txt(perfil.nome)){
        mensagemDeSaida = 'Sua conta precisa de um perfil ativo. Fale com o administrador.';
        if(sessaoIniciada)document.getElementById('app').style.display = 'none';
        auth.signOut().catch(erro=>mostrarEstadoLogin(mensagemErro(erro)));
        return;
      }
      try{
        if(!sessaoIniciada){
          const [token,politica] = await Promise.all([user.getIdTokenResult(),db.collection('configuracao').doc('sessao').get(servidor)]);
          if(auth.currentUser?.uid!==user.uid)return;
          autenticacaoEm = Date.parse(token.authTime);
          vencimentoSessao = autenticacaoEm+(politica.data()?.dias||7)*diaEmMs;
          if(Date.now()>=vencimentoSessao){
            mensagemDeSaida = 'Sua sessão expirou. Entre novamente.';
            await auth.signOut();
            return;
          }
        }
      }catch(erro){
        mostrarEstadoLogin(mensagemErro(erro));
        return;
      }
      Object.assign(ME,{uid:user.uid,email,nome:perfil.nome,perfil:perfil.perfil});
      try{ME.cor = corSegura(localStorage.getItem('blu_cor_'+ME.uid) || localStorage.getItem('blu_cor'));}catch{}
      mensagemDeSaida = '';
      document.getElementById('login-senha').value = '';
      atualizarControlesAcesso();
      iniciar();
      if(loginSolicitado){loginSolicitado=false;registrarAuditoria('Login');}
      observarPoliticaDeSessao();
    },erro=>{
      mensagemDeSaida = 'Não foi possível carregar seu perfil. '+mensagemErro(erro);
      if(sessaoIniciada)document.getElementById('app').style.display = 'none';
      auth.signOut().catch(()=>mostrarEstadoLogin(mensagemDeSaida));
    });
  });
}

async function fazerLogin(event){
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const senha = document.getElementById('login-senha').value;
  if(!email || !senha)return;
  mensagemDeSaida = '';
  mostrarEstadoLogin('Entrando…',true);
  loginSolicitado = true;
  const lembrar = document.getElementById('login-lembrar').checked;
  try{
    const persistencia = firebase.auth.Auth.Persistence;
    await auth.setPersistence(lembrar?persistencia.LOCAL:persistencia.SESSION);
    await auth.signInWithEmailAndPassword(email,senha);
  }
  catch(erro){
    loginSolicitado = false;
    const credencial = ['auth/invalid-credential','auth/invalid-login-credentials','auth/wrong-password','auth/user-not-found','auth/invalid-email','auth/user-disabled'];
    mostrarEstadoLogin(credencial.includes(erro.code)?'Confira o e-mail e a senha ou fale com o administrador.':mensagemErro(erro));
  }
}

async function recuperarSenha(){
  const campo = document.getElementById('login-email');
  if(!campo.reportValidity())return;
  mostrarEstadoLogin('Solicitando recuperação de senha…',true);
  const enviado = 'Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.';
  try{await auth.sendPasswordResetEmail(campo.value.trim().toLowerCase());mostrarEstadoLogin(enviado);}
  catch(erro){mostrarEstadoLogin(erro.code==='auth/user-not-found'?enviado:mensagemErro(erro));}
}

async function sairDaConta(){
  try{
    fecharCamera();
    await encerrarTrechoBipagem();
    if(navigator.onLine)await Promise.race([logAuditoria('Logout').catch(()=>{}),new Promise(resolve=>setTimeout(resolve,800))]);
    document.getElementById('app').style.display = 'none';
    await auth.signOut();
  }catch(erro){
    document.getElementById('app').style.display = 'flex';
    mensagemDeSaida = '';
    toast(mensagemErro(erro));
  }
}

function atualizarControlesAcesso(){
  document.getElementById('user-nome').textContent = ME.nome;
  document.getElementById('user-perfil').textContent = nomesDosPerfis[ME.perfil];
  document.getElementById('conta-identidade').textContent = `${ME.email} · ${nomesDosPerfis[ME.perfil]}`;
  document.getElementById('conta-cor').value = ME.cor;
  document.getElementById('user-avatar').textContent = ME.nome[0].toUpperCase();
  document.getElementById('user-avatar').style.backgroundColor = ME.cor;
  document.querySelectorAll('[data-permissao]').forEach(el=>el.hidden = !pode(el.dataset.permissao));
  if(!pode('supervisao')){logListener?.();logListener = null;}
  if(!pode('admin'))pararGerenciaUsuarios();
  if(sessaoIniciada){
    const permissao = permissoesDasTelas[telaAtual];
    if(permissao && !pode(permissao))ir('config');
    if(!pode('supervisao')){
      fecharModal('modal-finalizar');
      document.getElementById('modal-revisao').close();
      fecharModal('modal-nova-lista');
    }
    if(!pode('admin'))fecharModal('modal-limpeza');
    ajustarEdicaoDeBipe();
    agendarRender();
  }
}

function alterarCorDeAvatar(cor){
  ME.cor = corSegura(cor);
  document.getElementById('user-avatar').style.backgroundColor = ME.cor;
  try{localStorage.setItem('blu_cor_'+ME.uid,ME.cor);}catch{}
}

function pararGerenciaUsuarios(){
  pararListaDePerfis?.();
  pararListaDePerfis = null;
  usuariosCadastrados = [];
}

function abrirGerenciaUsuarios(){
  if(!pode('admin') || pararListaDePerfis)return;
  limparFormularioUsuario();
  const corpo = document.getElementById('tb-usuarios');
  corpo.innerHTML = '<tr><td colspan="5" class="empty">Carregando usuários…</td></tr>';
  pararListaDePerfis = db.collection('perfis').orderBy('nome').onSnapshot(snap=>{
    usuariosCadastrados = snap.docs.map(doc=>({uid:doc.id,...doc.data()}));
    corpo.innerHTML = usuariosCadastrados.map(usuario=>`<tr><td>${esc(usuario.nome)}</td><td>${esc(usuario.email)}</td>
      <td>${esc(nomesDosPerfis[usuario.perfil]||'—')}</td><td>${usuario.ativo?'Ativo':'Inativo'}</td>
      <td>${usuario.uid===ME.uid?'Sua conta':`<button type="button" class="btn sec btn-sm" onclick="editarPerfilUsuario(${arg(usuario.uid)})">Editar</button>`}</td></tr>`
    ).join('')||'<tr><td colspan="5" class="empty">Nenhum perfil cadastrado.</td></tr>';
  },erro=>{corpo.innerHTML = `<tr><td colspan="5" class="empty">${esc(mensagemErro(erro))}</td></tr>`;});
}

function limparFormularioUsuario(){
  document.getElementById('form-usuario').reset();
  document.getElementById('usuario-uid').readOnly = false;
  document.getElementById('usuario-status').textContent = '';
}

function editarPerfilUsuario(uid){
  if(!exigirPermissao('admin') || uid===ME.uid)return;
  const usuario = usuariosCadastrados.find(item=>item.uid===uid);
  if(!usuario)return;
  document.getElementById('usuario-uid').value = usuario.uid;
  document.getElementById('usuario-uid').readOnly = true;
  document.getElementById('usuario-nome').value = usuario.nome;
  document.getElementById('usuario-email').value = usuario.email;
  document.getElementById('usuario-perfil').value = usuario.perfil;
  document.getElementById('usuario-ativo').checked = usuario.ativo;
  document.getElementById('usuario-status').textContent = '';
  document.getElementById('usuario-nome').focus();
}

async function salvarPerfilUsuario(event){
  event.preventDefault();
  if(!exigirPermissao('admin'))return;
  const uid = document.getElementById('usuario-uid').value.trim();
  const nome = document.getElementById('usuario-nome').value.trim();
  const email = document.getElementById('usuario-email').value.trim().toLowerCase();
  const perfil = document.getElementById('usuario-perfil').value;
  const ativo = document.getElementById('usuario-ativo').checked;
  const mensagem = document.getElementById('usuario-status');
  const btn = document.getElementById('btn-salvar-usuario');
  if(btn.disabled)return;
  if(!uid || uid.includes('/') || uid==='.' || uid==='..' || uid===ME.uid || !nome || !Object.hasOwn(nomesDosPerfis,perfil)){
    mensagem.textContent = 'Confira o UID, o nome e o perfil. A sua própria conta é editada por outro administrador.';
    return;
  }
  btn.disabled = true;
  try{
    const ref = db.collection('perfis').doc(uid);
    const editando = document.getElementById('usuario-uid').readOnly;
    await db.runTransaction(async tx=>{
      const atual = await tx.get(ref);
      if(atual.exists!==editando)throw new Error('Este UID já está cadastrado ou mudou. Selecione o perfil na lista.');
      tx.set(ref,{nome,email,perfil,ativo,atualizadoPor:ME.uid,atualizadoEm:timestamp()});
    });
    limparFormularioUsuario();
    mensagem.textContent = 'Perfil salvo.';
    registrarAuditoria('Acesso de '+nome+' atualizado · '+nomesDosPerfis[perfil]+(ativo?'':' · Inativo'));
  }catch(erro){mensagem.textContent = mensagemErro(erro);}
  finally{btn.disabled = false;}
}



function observarPoliticaDeSessao(){
  if(pararPoliticaDeSessao)return;
  pararPoliticaDeSessao = db.collection('configuracao').doc('sessao').onSnapshot({includeMetadataChanges:true},snap=>{
    if(snap.metadata.fromCache || snap.metadata.hasPendingWrites)return;
    const dias = snap.data()?.dias||7;
    vencimentoSessao = autenticacaoEm+dias*diaEmMs;
    const el = document.getElementById('sessao-dias');
    if(document.activeElement!==el)el.value = dias;
    verificarPrazoSessao();
  },()=>{});
}

async function salvarPoliticaDeSessao(event){
  event.preventDefault();
  if(!exigirPermissao('admin'))return;
  const dias = document.getElementById('sessao-dias').valueAsNumber;
  if(!Number.isInteger(dias) || dias<1 || dias>30)return;
  try{
    await db.collection('configuracao').doc('sessao').set({dias});
    registrarAuditoria('Validade de sessão atualizada para '+dias+' dia(s).');
    toast('Prazo atualizado.');
  }catch(erro){toast(mensagemErro(erro));}
}
