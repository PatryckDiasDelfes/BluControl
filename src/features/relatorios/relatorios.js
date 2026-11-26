/* Exportação dos relatórios atuais e das conferências finalizadas. */
const colunasRelatorio = ['Código','Título','Seção','Lista','Esperado','Bipado','Diferença','Status'];
const colunasRevisao = ['Código','Título','Seção','Revisão','Observação ou decisão','Responsável','Atualizado em'];
const mimeXlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const coresStatus = {
  OK:'17613A',FALTANDO:'855300',PENDENTE:'694096',EXCEDIDO:'9B1C1C',
  'NÃO ENCONTRADO':'8C4519',ALERTA:'7127A8'
};

function informacoesDoRelatorio(relatorio){
  const t = relatorio.totais;
  const info = [
    ['Conferência',relatorio.nome],
    ['Data',dataBr.format(relatorio.data||Date.now())],
    ['Duração da bipagem',formatarTempo(relatorio.duracao)],
    ['Produtos',t.totalProdutos],['Bipagens',t.totalBipes],['Itens OK',t.ok],
    ['Com problema',t.problemas],['Pendentes',t.pendentes],['Alertas',t.alertas],['Exemplares faltando',t.faltaUnidades]
  ];
  const produtividade = relatorio.produtividade;
  if(produtividade)info.push(['Tempo ativo dos operadores',formatarTempo(produtividade.ativo)],
    ['Tempo decorrido dos operadores',formatarTempo(produtividade.decorrido)],['Tempo inativo dos operadores',formatarTempo(produtividade.inativo)],
    ['Bipes por minuto ativo',produtividade.media.toLocaleString('pt-BR',{maximumFractionDigits:1})]);
  if(t.sessoes)info.push(['Sessões bipadas',t.sessoesBipadas+' de '+t.sessoes]);
  if(relatorio.sessoesRemovidas)info.push(['Sessões vazias excluídas',relatorio.sessoesRemovidas]);
  if(relatorio.finalizadaPor)info.push(['Finalizada por',relatorio.finalizadaPor]);
  if(t.revisao)info.push(['Revisão de divergências',textoDasRevisoes(t.revisao)]);
  if(relatorio.filtrado)info.push(['Linhas após os filtros',relatorio.rows.length]);
  return info;
}

function linhasDoRelatorio(rows){
  return rows.map(r=>[String(r.codigo),r.titulo,r.secao,r.lista,r.esperado,r.bipado,r.dif,r.status]);
}

function linhasDeRevisao(rows){
  return rows.filter(row=>row.revisao?.autor).map(row=>{
    const {estado,nota,autor,data} = row.revisao;
    return [String(row.codigo),row.titulo,row.secao,estadosRevisao[estado]?.nome||estado,nota,autor,data?dataBr.format(data):'—'];
  });
}

async function relatorioAtual(finalizar){
  if(finalizar && conferenciaAberta)return conferenciaAberta.relatorio;
  const id = ME.listaAtiva;
  if(!id)throw new Error('Selecione uma lista para exportar.');
  const filtros = filtrosDoResumo();
  const lista = await carregarConferencia(id,{incluirAtividade:false,incluirRevisoes:false});
  const listas = {[id]:lista};
  const relatorio = obterRelatorio(id,listas,montarCatalogos(listas,lista.baseLegada||new Map()));
  const rows = filtrarResumo(relatorio.rows,filtros);
  if(rows.length!==relatorio.rows.length){
    relatorio.rows = rows;
    relatorio.filtrado = true;
  }
  return relatorio;
}

function registrarDownload(blob,arquivo){
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = arquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function nomeDoArquivo(relatorio,ext){
  const data = new Date(relatorio.data||Date.now());
  const dia = diaArquivo.format(data);
  const nome = relatorio.nome.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase().slice(0,70);
  return 'blulivro_'+(nome||'conferencia')+'_'+dia+'.'+ext;
}

function preencherTabela(planilha,nome,cabecalho,rows,larguras){
  if(rows.length){
    planilha.addTable({
      name:nome,ref:'A1',headerRow:true,totalsRow:false,
      style:{theme:'TableStyleMedium3',showRowStripes:true},
      columns:cabecalho.map(titulo=>({name:titulo,filterButton:true})),
      rows
    });
  }else{
    planilha.addRow(cabecalho);
  }
  planilha.views = [{state:'frozen',ySplit:1}];
  larguras.forEach((largura,i)=>{planilha.getColumn(i+1).width=largura;});
  planilha.getRow(1).height = 22;
  planilha.getRow(1).eachCell(cel=>{
    cel.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF9B1C1C'}};
    cel.font={bold:true,color:{argb:'FFFFFFFF'}};
  });
}

async function montarXlsx(relatorio){
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Blulivro';
  wb.created = new Date();
  const capa = wb.addWorksheet('Capa');
  capa.mergeCells('A1:B1');
  capa.getCell('A1').value = 'BLULIVRO · CONFERÊNCIA DE ESTOQUE';
  capa.getCell('A1').font = {bold:true,color:{argb:'FF9B1C1C'},size:14};
  capa.getCell('A1').fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFEEEE'}};
  capa.getRow(1).height = 27;
  capa.getColumn(1).width = 30;
  capa.getColumn(2).width = 54;
  capa.addRow([]);
  for(const item of informacoesDoRelatorio(relatorio)){
    const linha = capa.addRow(item);
    linha.getCell(1).font = {bold:true,color:{argb:'FF7B1111'}};
  }

  const resumo = wb.addWorksheet('Resumo');
  preencherTabela(resumo,'ResumoConferencia',colunasRelatorio,linhasDoRelatorio(relatorio.rows),[20,50,25,25,13,12,13,20]);
  resumo.getColumn(1).numFmt = '@';
  for(let i=0;i<relatorio.rows.length;i++){
    const cor = coresStatus[relatorio.rows[i].status];
    if(cor)resumo.getCell('H'+(i+2)).font = {bold:true,color:{argb:'FF'+cor}};
  }
  const ranking = wb.addWorksheet('Ranking');
  preencherTabela(ranking,'RankingOperadores',['Operador','Bipes'],
    relatorio.ranking.map(op=>[op.nome,op.bipes]),[36,16]);
  const revisoes = linhasDeRevisao(relatorio.rows);
  if(revisoes.length)preencherTabela(wb.addWorksheet('Revisão'),'RevisaoDivergencias',colunasRevisao,revisoes,[20,44,25,20,52,24,24]);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer],{type:mimeXlsx});
}

function montarXlsxBasico(relatorio){
  const wb = XLSX.utils.book_new();
  const capa = XLSX.utils.aoa_to_sheet([['BLULIVRO · CONFERÊNCIA DE ESTOQUE'],...informacoesDoRelatorio(relatorio)]);
  const resumo = XLSX.utils.aoa_to_sheet([colunasRelatorio,...linhasDoRelatorio(relatorio.rows)]);
  resumo['!autofilter'] = {ref:resumo['!ref']};
  const ranking = XLSX.utils.aoa_to_sheet([['Operador','Bipes'],...relatorio.ranking.map(op=>[op.nome,op.bipes])]);
  for(const [nome,planilha] of [['Capa',capa],['Resumo',resumo],['Ranking',ranking]]){
    XLSX.utils.book_append_sheet(wb,planilha,nome);
  }
  const revisoes = linhasDeRevisao(relatorio.rows);
  if(revisoes.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([colunasRevisao,...revisoes]),'Revisão');
  return new Blob([XLSX.write(wb,{type:'array',bookType:'xlsx',compression:true})],{type:mimeXlsx});
}

function montarPdf(relatorio){
  const JsPDF = window.jspdf?.jsPDF;
  if(!JsPDF)throw new Error('O gerador de PDF não carregou.');
  const doc = new JsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function')throw new Error('O componente de tabelas do PDF não carregou.');
  const largura = doc.internal.pageSize.getWidth();
  doc.setFillColor(255,238,238);
  doc.rect(0,0,largura,24,'F');
  doc.setFont('helvetica','bold');
  doc.setTextColor(155,28,28);
  doc.setFontSize(19);
  doc.text('BLULIVRO',12,11);
  doc.setTextColor(75,64,64);
  doc.setFont('helvetica','normal');
  doc.setFontSize(11);
  doc.text('Relatório de conferência de estoque',12,18);
  const estilos = {
    theme:'striped',margin:{left:12,right:12,top:12,bottom:16},
    styles:{font:'helvetica',fontSize:9,textColor:[36,25,25],cellPadding:2,overflow:'linebreak'},
    headStyles:{fillColor:[155,28,28],textColor:[255,255,255]},
    alternateRowStyles:{fillColor:[250,244,244]},
    rowPageBreak:'avoid'
  };
  doc.autoTable({...estilos,startY:29,head:[['Conferência','Valor']],
    body:informacoesDoRelatorio(relatorio).map(([k,v])=>[k,String(v)]),
    tableWidth:145,columnStyles:{0:{cellWidth:56,fontStyle:'bold'}}});
  if(relatorio.ranking.length){
    doc.autoTable({...estilos,startY:doc.lastAutoTable.finalY+6,head:[['Operador','Bipes']],
      body:relatorio.ranking.map(op=>[op.nome,op.bipes]),tableWidth:145,columnStyles:{1:{halign:'right'}}});
  }
  const linhas = linhasDoRelatorio(relatorio.rows).map(linha=>linha.map(v=>v??'—'));
  doc.autoTable({...estilos,startY:doc.lastAutoTable.finalY+8,
    head:[colunasRelatorio],
    body:linhas.length ? linhas : [[{content:'Nenhum item neste relatório.',colSpan:8}]],
    columnStyles:{0:{cellWidth:30},2:{cellWidth:48},3:{cellWidth:38},4:{cellWidth:20,halign:'right'},
      5:{cellWidth:19,halign:'right'},6:{cellWidth:22,halign:'right'},7:{cellWidth:32,fontStyle:'bold'}},
    didParseCell:({row,column,cell,section})=>{
      if(section==='body' && column.index===7 && coresStatus[row.raw[7]])cell.styles.textColor='#'+coresStatus[row.raw[7]];
    }
  });
  const revisoes = linhasDeRevisao(relatorio.rows);
  if(revisoes.length){
    doc.addPage();
    doc.setFontSize(14);
    doc.text('Revisão de divergências',12,15);
    doc.autoTable({...estilos,startY:20,head:[colunasRevisao],body:revisoes,
      columnStyles:{0:{cellWidth:29},2:{cellWidth:33},3:{cellWidth:30},4:{cellWidth:60},6:{cellWidth:34}}});
  }
  const paginas = doc.getNumberOfPages();
  for(let pagina=1;pagina<=paginas;pagina++){
    doc.setPage(pagina);
    doc.setFontSize(9);
    doc.setTextColor(75,64,64);
    doc.text(pagina+' / '+paginas,largura-12,doc.internal.pageSize.getHeight()-7,{align:'right'});
  }
  return doc.output('blob');
}

async function exportarRelatorio(formato,botao,carregar){
  if(botao?.disabled)return;
  if(botao)botao.disabled = true;
  try{
    const [relatorio] = await Promise.all([carregar(),
      formato==='pdf'?carregarBiblioteca('pdf').then(()=>carregarBiblioteca('tabelaPdf')):null]);
    let blob, basico = false;
    if(formato==='pdf')blob = montarPdf(relatorio);
    else{
      try{await carregarBiblioteca('excel');blob = await montarXlsx(relatorio);}
      catch(erro){
        console.warn('Exportação XLSX formatada:',erro);
        await carregarBiblioteca('xlsx');
        blob = montarXlsxBasico(relatorio);
        basico = true;
      }
    }
    registrarDownload(blob,nomeDoArquivo(relatorio,formato));
    toast(basico?'Excel básico exportado.':'Arquivo '+formato.toUpperCase()+' gerado.');
  }catch(erro){toast('Falha ao exportar. '+mensagemErro(erro));}
  finally{if(botao)botao.disabled=false;}
}

function exportarXLSX(finalizar=false,botao){
  return exportarRelatorio('xlsx',botao,()=>relatorioAtual(finalizar));
}

function exportarPDF(finalizar=false,botao){
  return exportarRelatorio('pdf',botao,()=>relatorioAtual(finalizar));
}

function exportarHistorico(id,formato,botao){
  return exportarRelatorio(formato,botao,async ()=>{
    const relatorio = conferencias.find(c=>c.id===id);
    if(!relatorio)throw new Error('A conferência não está mais disponível.');
    const partes = db.collection('conferencias').doc(id).collection('partes');
    const rows = await lerPartes(partes,relatorio.versao,relatorio.partes);
    return {...relatorio,rows,data:dataMs(relatorio.finalizadaEm)};
  });
}
