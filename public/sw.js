const CACHE = 'blulivro-v20-desempenho';
const ARQUIVOS = [
  '/index.html','/app.css','/tema.js','/recursos.js','/consultas-conferencia.js','/leitor-dauer.js','/rascunho-dauer.js','/dados.js','/continuidade.js','/isbn.js','/ficha-tcl.js','/tcl-filtros.js','/catalogo-dauer.js','/furos.js','/administrar-listas.js','/revisao.js','/acesso.js','/relatorios.js','/app.js','/camera-bipe.js','/vendor/zxing-browser.min.js','/manifest.webmanifest',
  '/icon-192.png','/icon-512.png',
  '/vendor/firebase-app-compat.js','/vendor/firebase-firestore-compat.js','/vendor/firebase-auth-compat.js'
];
const locais = new Set(ARQUIVOS);
const opcionais = new Set([
  '/vendor/xlsx.full.min.js','/vendor/exceljs.min.js','/vendor/jspdf.umd.min.js','/vendor/jspdf.plugin.autotable.min.js'
]);

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ARQUIVOS)));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async ()=>{
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n=>n.startsWith('blulivro-') && n!==CACHE).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url = new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html',{cacheName:CACHE})));
    return;
  }
  if(opcionais.has(url.pathname)){
    event.respondWith((async()=>{
      const cache = await caches.open(CACHE);
      const guardado = await cache.match(url.pathname);
      if(guardado)return guardado;
      const resposta = await fetch(event.request);
      if(resposta.ok)await cache.put(url.pathname,resposta.clone());
      return resposta;
    })());
    return;
  }
  if(!locais.has(url.pathname))return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(url.pathname,{cacheName:CACHE})));
});
