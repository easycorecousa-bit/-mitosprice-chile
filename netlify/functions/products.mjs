const STORES = [
  { name: "Pandora Store", base: "https://www.pandorastore.cl" },
  { name: "Gorila TCG", base: "https://www.gorilatcg.cl" }
];

function decodeHtml(v=""){
  return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
}
function textFrom(html=""){
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
}
function normalize(s=""){
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}
function parseMoney(raw){
  if(raw==null) return null;
  let s=String(raw).trim().replace(/[^\d.,]/g,"");
  if(!s) return null;
  if(/^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/\./g,""));
  if(/^\d{1,3}(?:,\d{3})+$/.test(s)) return Number(s.replace(/,/g,""));
  if(/^\d+\.\d{1,2}$/.test(s)) return Math.round(Number(s));
  if(/^\d+,\d{1,2}$/.test(s)) return Math.round(Number(s.replace(",",".")));
  const n=Number(s.replace(/,/g,""));
  return Number.isFinite(n)?Math.round(n):null;
}
function parsePrice(html){
  const candidates=[
    /property=["']product:price:amount["'][^>]*content=["']([0-9.,]+)["']/i,
    /content=["']([0-9.,]+)["'][^>]*property=["']product:price:amount["']/i,
    /itemprop=["']price["'][^>]*content=["']([0-9.,]+)["']/i,
    /"price"\s*:\s*"?(?:CLP\s*)?([0-9.,]+)"?/i,
    /\$\s*([0-9]{1,3}(?:\.[0-9]{3})+|\d+)/
  ];
  for(const re of candidates){
    const m=html.match(re);
    if(m){ const n=parseMoney(m[1]); if(n&&n>0) return n; }
  }
  return null;
}
function parseTitle(html,fallback){
  const og=html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if(og) return decodeHtml(og[1]).replace(/\s*\|.*$/,"").trim();
  const h1=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1?textFrom(h1[1]):fallback;
}
function parseImage(html){
  const m=html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  return m?decodeHtml(m[1]):null;
}
function stockFrom(html){
  const t=textFrom(html).toLowerCase();
  if(t.includes("agotado")||t.includes("sin stock")) return "Sin stock";
  if(t.includes("agregar al carro")||t.includes("add to cart")||t.includes("comprar")) return "Disponible";
  return "Revisar disponibilidad";
}
function categoryFrom(title,text=""){
  const s=normalize(`${title} ${text}`);
  if(/\b(sobre|booster|pack)\b/.test(s)) return "Sobres";
  if(/\b(display|caja|box)\b/.test(s)) return "Displays / Cajas";
  if(/\bkit\b/.test(s)) return "Kits";
  if(/\b(starter|mazo|deck)\b/.test(s)) return "Starter / Mazos";
  if(/\b(playmat|sleeve|carpeta|binder|protector|dado|dados|accesorio)\b/.test(s)) return "Accesorios";
  if(/\b(bundle|coleccion|edicion especial|producto especial)\b/.test(s)) return "Productos especiales";
  return "Otros";
}
function unitsFrom(title,text=""){
  const s=`${title} ${text}`;
  const pats=[
    /(\d+)\s*(?:sobres|boosters|packs)/i,
    /contiene\s*(\d+)\s*(?:sobres|boosters|packs)/i,
    /(\d+)\s*(?:unidades|units)/i
  ];
  for(const re of pats){ const m=s.match(re); if(m) return Number(m[1]); }
  return null;
}
function queryTokens(q){
  return normalize(q).split(/\s+/).filter(x=>x.length>1);
}
function extractLinks(html,q){
  const tokens=queryTokens(q);
  const out=new Set();
  const re=/href=["'](\/[^"'#?]+)["']/gi;
  let m;
  while((m=re.exec(html))){
    const path=m[1];
    const np=normalize(path);
    if(path.startsWith("/pages/")||path.startsWith("/blogs/")||path.startsWith("/account")) continue;
    if(tokens.length===0 || tokens.some(t=>np.includes(t))) out.add(path);
  }
  return [...out].slice(0,12);
}
async function fetchHtml(url){
  const res=await fetch(url,{
    headers:{"user-agent":"MitosPriceChile/1.2 (+https://mitosprice-chile.netlify.app)","accept":"text/html,application/xhtml+xml"},
    redirect:"follow"
  });
  if(!res.ok) return null;
  return await res.text();
}
async function storeSearch(store,q){
  const searchUrls=[
    `${store.base}/search?q=${encodeURIComponent(q)}`,
    `${store.base}/search?type=product&q=${encodeURIComponent(q)}`
  ];
  let searchHtml=null;
  for(const u of searchUrls){
    try{ searchHtml=await fetchHtml(u); if(searchHtml) break; }catch(_){}
  }
  if(!searchHtml) return [];

  const links=extractLinks(searchHtml,q);
  const results=[];
  const nq=normalize(q);

  for(const path of links.slice(0,8)){
    const url=path.startsWith("http")?path:`${store.base}${path}`;
    let html;
    try{ html=await fetchHtml(url); }catch(_){ continue; }
    if(!html) continue;

    const title=parseTitle(html,q);
    const nt=normalize(title);
    if(nq && !queryTokens(q).some(t=>nt.includes(t))) continue;

    const price=parsePrice(html);
    if(!price) continue;

    const txt=textFrom(html).slice(0,3000);
    const units=unitsFrom(title,txt);
    results.push({
      id:`product-${normalize(store.name).replace(/\s+/g,"-")}-${results.length+1}`,
      name:title,
      store:store.name,
      price,
      category:categoryFrom(title,txt),
      stock:stockFrom(html),
      image:parseImage(html),
      url,
      units,
      unitPrice: units ? Math.round(price/units) : null,
      live:true
    });
  }
  return results;
}

export default async (request)=>{
  const url=new URL(request.url);
  const q=(url.searchParams.get("q")||"").trim();
  if(!q) return new Response(JSON.stringify({results:[]}),{status:200,headers:{"content-type":"application/json; charset=utf-8"}});

  try{
    const settled=await Promise.allSettled(STORES.map(s=>storeSearch(s,q)));
    const results=[];
    settled.forEach(x=>{ if(x.status==="fulfilled") results.push(...x.value); });
    const seen=new Set();
    const dedup=results.filter(r=>{
      const k=`${normalize(r.store)}|${normalize(r.name)}|${r.price}`;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    }).sort((a,b)=>a.price-b.price);

    return new Response(JSON.stringify({
      query:q,
      fetchedAt:new Date().toISOString(),
      stores:STORES.map(s=>s.name),
      results:dedup
    }),{
      status:200,
      headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=180"}
    });
  }catch(error){
    return new Response(JSON.stringify({query:q,results:[],error:error.message}),{
      status:502,
      headers:{"content-type":"application/json; charset=utf-8"}
    });
  }
};
