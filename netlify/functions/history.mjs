import { getStore } from "@netlify/blobs";

const HISTORY_STORE = "mitosprice-history";
const TRACKED_STORE = "mitosprice-tracked";

function norm(s=""){
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}
function slug(s=""){
  return norm(s).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120);
}
function identity(card="",edition="",code=""){
  return {
    card: String(card||"").trim(),
    edition: String(edition||"").trim(),
    code: String(code||"").trim()
  };
}
function keyFor(id){
  return [slug(id.card),slug(id.edition||"sin-edicion"),slug(id.code||"sin-codigo")].join("__");
}
function todayCL(){
  // snapshots are grouped by Chilean calendar day
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date());
}
function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

async function readSeries(store,key){
  const raw=await store.get(key,{consistency:"strong"});
  if(!raw) return { identity:null, snapshots:[] };
  try{return JSON.parse(raw)}catch(_){return { identity:null, snapshots:[] }}
}

function computeMetrics(points){
  const best=points.map(p=>{
    const vals=Object.values(p.stores||{}).filter(Number.isFinite);
    return vals.length?Math.min(...vals):null;
  }).filter(Number.isFinite);

  if(!best.length) return {};
  const current=best[best.length-1];
  const first=best[0];
  return {
    current,
    average:Math.round(best.reduce((a,b)=>a+b,0)/best.length),
    min:Math.min(...best),
    max:Math.max(...best),
    changePct:first ? ((current-first)/first)*100 : null
  };
}

export default async (request)=>{
  const url=new URL(request.url);
  const history=getStore({name:HISTORY_STORE,consistency:"strong"});
  const tracked=getStore({name:TRACKED_STORE,consistency:"strong"});

  if(request.method==="POST"){
    let body;
    try{ body=await request.json(); }catch(_){ return json({error:"JSON inválido"},400); }

    const id=identity(body.card,body.edition,body.code);
    if(!id.card) return json({error:"Falta card"},400);

    const offers=Array.isArray(body.offers)?body.offers:[];
    const cleanOffers=offers
      .map(o=>({
        store:String(o.store||"").trim(),
        price:Number(o.price),
        stock:String(o.stock||""),
        url:String(o.url||"")
      }))
      .filter(o=>o.store && Number.isFinite(o.price) && o.price>0);

    if(!cleanOffers.length) return json({error:"Sin ofertas válidas"},400);

    const key=keyFor(id);
    const series=await readSeries(history,key);
    const date=todayCL();

    // Replace same-day snapshots per store so repeated searches don't inflate data.
    const snapshots=(series.snapshots||[]).filter(s=>s.date!==date);
    snapshots.push({
      date,
      capturedAt:new Date().toISOString(),
      offers:cleanOffers
    });

    // Keep up to 180 daily snapshots.
    snapshots.sort((a,b)=>a.date.localeCompare(b.date));
    const trimmed=snapshots.slice(-180);

    await history.set(key,JSON.stringify({identity:id,snapshots:trimmed}));

    // Track cards for scheduled daily refresh.
    await tracked.set(key,JSON.stringify({
      key,
      ...id,
      lastSeen:new Date().toISOString()
    }));

    return json({ok:true,key,date,offers:cleanOffers.length});
  }

  if(request.method!=="GET") return json({error:"Método no permitido"},405);

  const q=(url.searchParams.get("q")||"").trim();
  const edition=(url.searchParams.get("edition")||"").trim();
  const code=(url.searchParams.get("code")||"").trim();
  const days=Math.min(Math.max(Number(url.searchParams.get("days"))||30,1),180);
  if(!q) return json({error:"Falta q"},400);

  const id=identity(q,edition,code);
  const key=keyFor(id);
  const series=await readSeries(history,key);

  const cutoff=new Date();
  cutoff.setUTCDate(cutoff.getUTCDate()-days+1);
  const cutoffDate=cutoff.toISOString().slice(0,10);

  const selected=(series.snapshots||[]).filter(s=>s.date>=cutoffDate);
  const points=selected.map(s=>{
    const stores={};
    for(const offer of (s.offers||[])){
      if(Number.isFinite(offer.price)){
        stores[offer.store]=stores[offer.store]==null?offer.price:Math.min(stores[offer.store],offer.price);
      }
    }
    return {date:s.date,stores};
  });

  return json({
    identity:series.identity||id,
    days,
    points,
    metrics:computeMetrics(points)
  });
};
