function isbnCanonico(valor){
  const isbn = typeof valor==='string'?valor.trim().toUpperCase().replace(/[\s-]/g,''):'';
  const digito13 = corpo=>(10-[...corpo].reduce((s,d,i)=>s+Number(d)*(i%2?3:1),0)%10)%10;
  if(/^(978|979)\d{10}$/.test(isbn))return digito13(isbn.slice(0,-1))===Number(isbn[12])?isbn:'';
  if(!/^\d{9}[\dX]$/.test(isbn))return '';
  const soma = [...isbn].reduce((s,d,i)=>s+(d==='X'?10:Number(d))*(10-i),0);
  if(soma%11)return '';
  const corpo = '978'+isbn.slice(0,9);
  return corpo+digito13(corpo);
}

if(typeof module!=='undefined')module.exports = {isbnCanonico};
