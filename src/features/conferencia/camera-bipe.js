/* A câmera lê ISBNs no aparelho. O registro usa a fila normal da bipagem. */
let cameraBipe;
let carregandoDecodificador;
const intervaloCameraRapido = 95;
const intervaloCameraCodigoParado = 175;
const intervaloCameraOciosa = 300;
const intervaloParaLiberar = 850;
const orientacaoCamera = 'Centralize o código de barras na faixa.';

function carregarDecodificador(){
  if(window.ZXingBrowser?.BrowserMultiFormatOneDReader)return Promise.resolve(window.ZXingBrowser);
  if(!carregandoDecodificador){
    carregandoDecodificador = new Promise((resolver,rejeitar)=>{
      const script = document.createElement('script');
      script.src = '/vendor/zxing-browser.min.js';
      script.onload = ()=>{
        if(window.ZXingBrowser?.BrowserMultiFormatOneDReader)resolver(window.ZXingBrowser);
        else rejeitar(new Error('O leitor de códigos não está disponível.'));
      };
      script.onerror = ()=>{
        script.remove();
        rejeitar(new Error('Não foi possível carregar o leitor de códigos. Tente novamente.'));
      };
      document.head.append(script);
    }).catch(erro=>{
      carregandoDecodificador = null;
      throw erro;
    });
  }
  return carregandoDecodificador;
}

function isbnDaCamera(valor){
  const codigo = String(valor||'').trim();
  if(!/^97[89]\d{10}$/.test(codigo))return '';
  let soma = 0;
  for(let i=0;i<12;i++)soma += Number(codigo[i])*(i%2?3:1);
  return (10-soma%10)%10===Number(codigo[12]) ? codigo : '';
}

function mensagemCamera(texto){
  const estado = document.getElementById('camera-orientacao');
  if(estado.textContent!==texto)estado.textContent = texto;
}

function mostrarLeituraCamera(codigo,situacao){
  const leitura = document.getElementById('camera-leitura');
  leitura.dataset.situacao = situacao;
  const rotulos = {lido:'ISBN lido',confirmado:'Bipe confirmado',pendente:'Aguardando sincronização',falhou:'Bipe não confirmado'};
  leitura.textContent = codigo ? `${rotulos[situacao]} · ${codigo}` : '';
}

function erroCamera(texto){
  const saida = document.getElementById('camera-erro');
  saida.textContent = texto;
  saida.hidden = !texto;
}

function fecharCamera(){
  const estado = cameraBipe;
  if(!estado)return;
  cameraBipe = null;
  clearTimeout(estado.timer);
  estado.stream?.getTracks().forEach(track=>track.stop());
  estado.video.pause();
  estado.video.srcObject = null;
  const btn = document.getElementById('btn-camera');
  btn.textContent = 'Usar câmera';
  btn.setAttribute('aria-expanded','false');
  btn.disabled = document.getElementById('inp-bipe').disabled;
  document.getElementById('camera-painel').hidden = true;
  document.getElementById('camera-lanterna').hidden = true;
  document.getElementById('app').classList.remove('camera-ativa');
}

function descreverFalhaCamera(erro){
  switch(erro.name){
    case 'NotAllowedError':
    case 'SecurityError':
      return 'O navegador bloqueou a câmera. Autorize a câmera nas permissões do site ou digite o ISBN.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhuma câmera foi encontrada. Digite o ISBN ou conecte um leitor.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'A câmera pode estar em uso. Feche o outro aplicativo e tente novamente.';
    default:
      return erro.message || 'Não foi possível abrir a câmera. Você pode digitar o ISBN.';
  }
}

async function alternarCamera(){
  if(cameraBipe){fecharCamera();return;}
  if(telaAtual!=='bipe' || modoConferencia!=='bipar' || !ME.listaAtiva || document.getElementById('inp-bipe').disabled)return;
  if(pausado){toast('Retome a conferência antes de bipar.');return;}
  erroCamera('');
  if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
    erroCamera('Abra o site em HTTPS em um navegador com acesso à câmera.');
    return;
  }

  document.getElementById('inp-bipe').blur();
  ativarAudioBipe(true);
  const video = document.getElementById('camera-video');
  const quadro = document.createElement('canvas');
  const amostra = document.createElement('canvas');
  amostra.width = 20;
  amostra.height = 8;
  const estado = cameraBipe = {
    listaId:ME.listaAtiva,video,quadro,contexto:quadro.getContext('2d',{willReadFrequently:true}),
    amostra,ctxAmostra:amostra.getContext('2d',{willReadFrequently:true}),lanterna:false,lidosNaFaixa:new Set()
  };
  const btn = document.getElementById('btn-camera');
  btn.textContent = 'Fechar câmera';
  btn.setAttribute('aria-expanded','true');
  document.getElementById('camera-painel').hidden = false;
  document.getElementById('app').classList.add('camera-ativa');
  mostrarLeituraCamera('','');
  mensagemCamera('Abrindo câmera…');

  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}
    });
    if(cameraBipe!==estado){
      stream.getTracks().forEach(track=>track.stop());
      return;
    }
    estado.stream = stream;
    estado.track = stream.getVideoTracks()[0];
    estado.track.addEventListener('ended',()=>{
      if(cameraBipe!==estado)return;
      fecharCamera();
      erroCamera('A câmera foi desconectada. Abra-a novamente ou digite o ISBN.');
    },{once:true});
    video.srcObject = stream;
    await video.play();
    if(cameraBipe!==estado)return;
    const capacidades = estado.track.getCapabilities?.() || {};
    estado.restricoes = estado.track.getConstraints?.() || {};
    const [zxing] = await Promise.all([carregarDecodificador(),ativarFocoContinuo(estado,capacidades)]);
    if(cameraBipe!==estado)return;
    estado.leitor = new zxing.BrowserMultiFormatOneDReader();
    const lanterna = document.getElementById('camera-lanterna');
    const torch = capacidades.torch;
    lanterna.hidden = Array.isArray(torch) ? !torch.includes(true) : torch!==true;
    lanterna.setAttribute('aria-pressed','false');
    lanterna.disabled = false;
    mensagemCamera(orientacaoCamera);
    agendarQuadroCamera(estado,0);
  }catch(erro){
    if(cameraBipe!==estado)return;
    fecharCamera();
    erroCamera(descreverFalhaCamera(erro));
  }
}

async function ativarFocoContinuo(estado,capacidades){
  if(!capacidades.focusMode?.includes('continuous'))return;
  const restricoes = {...estado.restricoes,advanced:[...(estado.restricoes.advanced||[]),{focusMode:'continuous'}]};
  try{
    await estado.track.applyConstraints(restricoes);
    estado.restricoes = restricoes;
  }catch{ /* Usa o foco padrão do aparelho quando o ajuste não é aceito. */ }
}

async function alternarLanterna(){
  const estado = cameraBipe;
  const btn = document.getElementById('camera-lanterna');
  if(!estado?.track || btn.hidden || btn.disabled)return;
  btn.disabled = true;
  try{
    const ligar = !estado.lanterna;
    await estado.track.applyConstraints({
      ...estado.restricoes,advanced:[...(estado.restricoes.advanced||[]),{torch:ligar}]
    });
    if(cameraBipe!==estado)return;
    estado.lanterna = ligar;
    erroCamera('');
    btn.setAttribute('aria-pressed',String(ligar));
  }catch{
    if(cameraBipe===estado)erroCamera('Não foi possível acionar a lanterna deste aparelho.');
  }finally{
    if(cameraBipe===estado)btn.disabled = false;
  }
}

function recortarQuadroCamera(estado){
  const {video,quadro,contexto} = estado;
  const proporcao = video.clientWidth/video.clientHeight;
  const larguraVisivel = Math.min(video.videoWidth,video.videoHeight*proporcao);
  const alturaVisivel = Math.min(video.videoHeight,video.videoWidth/proporcao);
  const largura = larguraVisivel*.86;
  const altura = alturaVisivel*.42;
  const escala = Math.min(1,960/largura);
  const larguraQuadro = Math.max(1,Math.floor(largura*escala));
  const alturaQuadro = Math.max(1,Math.floor(altura*escala));
  if(quadro.width!==larguraQuadro)quadro.width = larguraQuadro;
  if(quadro.height!==alturaQuadro)quadro.height = alturaQuadro;
  // A faixa central continua alinhada com o recorte do vídeo em modo cover.
  contexto.drawImage(video,(video.videoWidth-largura)/2,(video.videoHeight-altura)/2,
    largura,altura,0,0,quadro.width,quadro.height);
}

function amostrarFaixaCamera(estado){
  const {ctxAmostra,amostra,quadro} = estado;
  ctxAmostra.drawImage(quadro,0,0,amostra.width,amostra.height);
  return ctxAmostra.getImageData(0,0,amostra.width,amostra.height).data;
}

function faixaMudou(antes,depois){
  let soma = 0;
  for(let i=0;i<antes.length;i+=4){
    soma += Math.abs(antes[i]-depois[i])+Math.abs(antes[i+1]-depois[i+1])+Math.abs(antes[i+2]-depois[i+2]);
  }
  return soma/(antes.length*.75)>10;
}

function agendarQuadroCamera(estado,espera){
  if(cameraBipe===estado)estado.timer = setTimeout(()=>lerQuadroCamera(estado),espera);
}

async function lerQuadroCamera(estado){
  if(cameraBipe!==estado)return;
  let espera = intervaloCameraOciosa;
  try{
    if(telaAtual!=='bipe' || modoConferencia!=='bipar' || ME.listaAtiva!==estado.listaId || document.hidden || pausado){
      fecharCamera();
      return;
    }
    if(document.getElementById('inp-bipe').disabled){
      mensagemCamera('Aguardando as sessões da lista…');
      return;
    }
    if(estado.video.readyState<2 || !estado.video.videoWidth || !estado.video.clientWidth || !estado.video.clientHeight)return;
    recortarQuadroCamera(estado);
    let resultado;
    try{resultado = estado.leitor.decodeFromCanvas(estado.quadro);}
    catch{ /* É normal o quadro não conter um código legível. */ }
    const codigo = isbnDaCamera(resultado?.getText());
    const amostra = amostrarFaixaCamera(estado);
    const quadroMudou = estado.ultimaAmostra && faixaMudou(estado.ultimaAmostra,amostra);
    estado.ultimaAmostra = amostra;
    if(!codigo){
      estado.quadrosSemIsbn = quadroMudou?0:(estado.quadrosSemIsbn||0)+1;
      if(estado.quadrosSemIsbn<=3)espera = intervaloCameraRapido;
      if(estado.lidosNaFaixa.size){
        const quadroLivre = faixaMudou(estado.referencia,amostra);
        const agora = performance.now();
        estado.livreDesde = quadroLivre?(estado.livreDesde??agora):null;
        if(estado.livreDesde!==null && agora-estado.livreDesde>=intervaloParaLiberar){
          estado.lidosNaFaixa.clear();
          estado.livreDesde = null;
          estado.pronta = true;
          espera = intervaloCameraRapido;
        }
      }
      if(!estado.lidosNaFaixa.size)mensagemCamera(resultado?'Aponte para um ISBN de 13 dígitos.':
        estado.pronta?'Pronto para o próximo exemplar.':orientacaoCamera);
      return;
    }

    estado.quadrosSemIsbn = 0;
    estado.livreDesde = null;
    estado.referencia = amostra;
    if(estado.lidosNaFaixa.has(codigo)){
      espera = intervaloCameraCodigoParado;
      mensagemCamera('Afaste o código da faixa antes de ler de novo.');
      return;
    }
    estado.lidosNaFaixa.add(codigo);
    estado.pronta = false;
    mostrarLeituraCamera(codigo,'lido');
    mensagemCamera('Aguardando confirmação…');
    const registrado = await bipar(codigo);
    if(cameraBipe===estado){
      if(!registrado)mostrarLeituraCamera(codigo,'falhou');
      mensagemCamera(registrado?'Afaste o mesmo código para ler outro exemplar.':'Afaste o código antes de tentar novamente.');
    }
    espera = intervaloCameraRapido;
  }catch{
    if(cameraBipe===estado){
      fecharCamera();
      erroCamera('A leitura pela câmera foi interrompida. Abra-a novamente ou digite o ISBN.');
    }
  }finally{
    agendarQuadroCamera(estado,espera);
  }
}

function fecharMenuBipe(){
  document.getElementById('app').classList.remove('menu-mobile-aberto');
  document.getElementById('btn-menu-bipe').setAttribute('aria-expanded','false');
  document.getElementById('sombra-menu-bipe').hidden = true;
}

function alternarMenuBipe(){
  const app = document.getElementById('app');
  if(app.classList.contains('menu-mobile-aberto')){fecharMenuBipe();return;}
  fecharCamera();
  app.classList.add('menu-mobile-aberto');
  document.getElementById('btn-menu-bipe').setAttribute('aria-expanded','true');
  document.getElementById('sombra-menu-bipe').hidden = false;
}

document.addEventListener('visibilitychange',()=>{if(document.hidden)fecharCamera();});
window.addEventListener('pagehide',fecharCamera);
