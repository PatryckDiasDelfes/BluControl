const coresDosTemas = {vermelho:'#1A0A0A',branco:'#F4F4F5',preto:'#131418'};

function aplicarTema(tema,salvar=false){
  if(!Object.hasOwn(coresDosTemas,tema))tema = 'vermelho';
  document.documentElement.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]').content = coresDosTemas[tema];
  if(salvar){
    try{localStorage.setItem('blu_tema',tema);}catch{ /* O tema continua ativo na página. */ }
  }
}

try{aplicarTema(localStorage.getItem('blu_tema'));}
catch{aplicarTema('vermelho');}
