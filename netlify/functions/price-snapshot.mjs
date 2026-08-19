import { getStore } from "@netlify/blobs";

const TRACKED_STORE="mitosprice-tracked";
const HISTORY_STORE="mitosprice-history";
const SITE_URL=process.env.URL || "https://mitosprice-chile.netlify.app";

function norm(s=""){
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}
function slug(s=""){
  return norm(s).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120);
}
function keyFor(id){
  return [slug(id.card),slug(id.edition||"sin-edicion"),slug(id.code||"sin-codigo")].join("__");
}
function todayCL(){
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date());
}
async function fetchStore(fn,q){
  const res=await fetch(`${SITE_URL}/.netlify/functions/${fn}?q=${encodeURIComponent(q)}`,{
    headers:{"user-agent":"MitosPriceHistory/1.0"}
  });
  if(!res.ok) return [];
  const payload=await res.json();
  return Array.isArray(payload.results)?payload.results:[];
}
async function readJson(store,key,fallback){
  const raw=await store.get(key,{consistency:"strong"});
  if(!raw) return fallback;
  try{return JSON.parse(raw)}catch(_){return fallback}
}

export default async ()=>{
  const tracked=getStore({name:TRACKED_STORE,consistency:"strong"});
  const history=getStore({name:HISTORY_STORE,consistency:"strong"});

  const listing=await tracked.list();
  const keys=(listing.blobs||[])
    .map(x=>x.key)
    .slice(0,40); // protect the 30s scheduled-function limit

  let updated=0, failed=0;
  for(const key of keys){
    try{
      const item=await readJson(tracked,key,null);
      if(!item?.card) continue;

      const settled=await Promise.allSettled([
        fetchStore("gorila",item.card),
        fetchStore("pandora",item.card)
      ]);

      const offers=[];
      for(const r of settled){
        if(r.status!=="fulfilled") continue;
        for(const x of r.value){
          const price=Number(x.price);
          if(!Number.isFinite(price)||price<=0) continue;
          offers.push({
            store:x.store,
            price,
            stock:x.stock||"",
            url:x.url||""
          });
        }
      }
      if(!offers.length){ failed++; continue; }

      const series=await readJson(history,key,{identity:{
        card:item.card,edition:item.edition||"",code:item.code||""
      },snapshots:[]});

      const date=todayCL();
      const snapshots=(series.snapshots||[]).filter(s=>s.date!==date);
      snapshots.push({date,capturedAt:new Date().toISOString(),offers});
      snapshots.sort((a,b)=>a.date.localeCompare(b.date));

      await history.set(key,JSON.stringify({
        identity:series.identity,
        snapshots:snapshots.slice(-180)
      }));
      updated++;
    }catch(e){
      console.error("snapshot",key,e);
      failed++;
    }
  }

  console.log(JSON.stringify({tracked:keys.length,updated,failed}));
};

export const config = {
  schedule: "0 7 * * *"
};
