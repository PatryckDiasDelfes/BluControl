const bibliotecas = {
  xlsx:{arquivo:'xlsx.full.min.js',pronta:()=>globalThis.XLSX},
  excel:{arquivo:'exceljs.min.js',pronta:()=>globalThis.ExcelJS},
  pdf:{arquivo:'jspdf.umd.min.js',pronta:()=>globalThis.jspdf?.jsPDF},
  tabelaPdf:{arquivo:'jspdf.plugin.autotable.min.js',pronta:()=>globalThis.jspdf?.jsPDF?.API?.autoTable}
};
const carregamentosBibliotecas = new Map();

function carregarBiblioteca(nome){
  const biblioteca = bibliotecas[nome];
  if(biblioteca.pronta())return Promise.resolve();
  if(carregamentosBibliotecas.has(nome))return carregamentosBibliotecas.get(nome);
  const carregamento = new Promise((resolver,rejeitar)=>{
    const script=document.createElement('script');
    script.src='/vendor/'+biblioteca.arquivo;
    const falha=()=>{script.remove();rejeitar(new Error('Não foi possível carregar a biblioteca. Confira a conexão e tente de novo.'));};
    script.onerror=falha;
    script.onload=()=>biblioteca.pronta()?resolver():falha();
    document.head.append(script);
  }).catch(erro=>{carregamentosBibliotecas.delete(nome);throw erro;});
  carregamentosBibliotecas.set(nome,carregamento);
  return carregamento;
}
