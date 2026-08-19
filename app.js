const $ = (id) => document.getElementById(id);
let data = window.MITOS_DATA || [];
const favorites = new Set(JSON.parse(localStorage.getItem("mitosprice:favorites") || "[]"));

const els = {
  heroSearch:$("heroSearch"), heroSearchBtn:$("heroSearchBtn"), search:$("searchInput"),
  edition:$("editionFilter"), rarity:$("rarityFilter"), store:$("storeFilter"),
  sort:$("sortFilter"), cards:$("cardsGrid"), empty:$("emptyState"),
  count:$("resultCount"), summary:$("bestSummary"), deals:$("dealGrid"),
  favCount:$("favCount"), clear:$("clearFilters"), toast:$("toast")
};
const clp = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n);
const uniq = key => [...new Set(data.map(x=>x[key]))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"es"));

function fillSelect(el, values){
  const current = el.value;
  el.innerHTML = '<option value="">Todas</option>';
  values.forEach(v=>{ const o=document.createElement("option"); o.value=v;o.textContent=v;el.appendChild(o); });
  if ([...el.options].some(o=>o.value===current)) el.value=current;
}
function refreshSelects(){
  fillSelect(els.edition,uniq("edition"));
  fillSelect(els.rarity,uniq("rarity"));
  fillSelect(els.store,uniq("store"));
}
refreshSelects();

function normalize(s){return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function filtered(){
  const q=normalize(els.search.value);
  let rows=data.filter(x =>
    (!q || [x.name,x.edition,x.rarity,x.store].some(v=>normalize(v).includes(q))) &&
    (!els.edition.value || x.edition===els.edition.value) &&
    (!els.rarity.value || x.rarity===els.rarity.value) &&
    (!els.store.value || x.store===els.store.value)
  );
  const s=els.sort.value;
  rows.sort((a,b)=>s==="priceDesc"?b.price-a.price:s==="name"?a.name.localeCompare(b.name):s==="store"?a.store.localeCompare(b.store):a.price-b.price);
  return rows;
}
function saveFavs(){localStorage.setItem("mitosprice:favorites",JSON.stringify([...favorites])); els.favCount.textContent=favorites.size}
function toast(msg){els.toast.textContent=msg;els.toast.classList.add("show");setTimeout(()=>els.toast.classList.remove("show"),2200)}
function render(){
  const rows=filtered(); els.cards.innerHTML="";
  els.count.textContent=`${rows.length} resultado${rows.length===1?"":"s"}`;
  els.empty.classList.toggle("hidden",rows.length!==0);
  const min=rows.length?Math.min(...rows.map(x=>x.price)):null;
  els.summary.textContent=min!==null?`Mejor precio visible: ${clp(min)}.`:"Busca una carta para comparar ofertas.";
  rows.forEach(x=>{
    const d=document.createElement("article"); d.className="card"+(x.price===min?" best":"");
    const liveBadge = x.live ? '<span class="badge">PRECIO REAL</span>' : (x.price===min?'<span class="badge">MEJOR PRECIO</span>':"");
    d.innerHTML=`${liveBadge}
      <div class="card-top"><div><h3>${x.name}</h3><div class="meta">${x.edition} · ${x.rarity}</div></div></div>
      <div class="price">${clp(x.price)}</div><div class="store">${x.store}</div><div class="stock">${x.stock}</div>
      <div class="card-actions"><a href="${x.url}" target="_blank" rel="noopener">Ver tienda</a>
      <button class="fav" data-fav="${x.id}" aria-label="Favorito">${favorites.has(x.id)?"★":"☆"}</button></div>`;
    els.cards.appendChild(d);
  });
  document.querySelectorAll("[data-fav]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.fav; favorites.has(id)?favorites.delete(id):favorites.add(id); saveFavs(); render();
  });
}
function renderDeals(){
  const demo = data.filter(x=>!x.live);
  const groups={};
  demo.forEach(x=>(groups[x.name]??=[]).push(x));
  const deals=Object.entries(groups).map(([name,arr])=>{
    arr.sort((a,b)=>a.price-b.price); const low=arr[0], high=arr[arr.length-1];
    return {name,low,save:high.price-low.price};
  }).sort((a,b)=>b.save-a.save).slice(0,3);
  els.deals.innerHTML=deals.map(d=>`<article class="deal"><span>Oportunidad demo</span><h3>${d.name}</h3><strong>${clp(d.low.price)}</strong><span>${d.low.store} · ahorro potencial ${clp(d.save)}</span></article>`).join("");
}

async function fetchStore(fn, q) {
  const res = await fetch(`/.netlify/functions/${fn}?q=${encodeURIComponent(q)}`);
  if(!res.ok) throw new Error(`${fn}: HTTP ${res.status}`);
  return await res.json();
}

async function fetchLiveStores(q){
  data = data.filter(x=>!x.live);
  const stores = [
    { fn:"gorila", name:"Gorila TCG" },
    { fn:"pandora", name:"Pandora Store" }
  ];

  const settled = await Promise.allSettled(stores.map(s=>fetchStore(s.fn,q)));
  let liveResults = [];

  settled.forEach((result, i)=>{
    if(result.status==="fulfilled" && result.value?.results?.length){
      liveResults.push(...result.value.results);
    } else if(result.status==="rejected"){
      console.error(stores[i].name, result.reason);
    }
  });

  if(liveResults.length){
    data = [...liveResults, ...data];
    refreshSelects();
    $("metricCards").textContent=data.length;
    $("metricStores").textContent=uniq("store").length;
    const best = [...liveResults].sort((a,b)=>a.price-b.price)[0];
    toast(`Mejor precio real: ${best.store} ${clp(best.price)}`);
  } else {
    toast("No hubo resultados reales; se mantienen datos demo");
  }
}

async function search(q){
  els.search.value=q;
  document.querySelector("#comparador").scrollIntoView({behavior:"smooth"});
  els.summary.textContent="Consultando Gorila TCG y Pandora Store…";
  await fetchLiveStores(q);
  render();
}
els.heroSearchBtn.onclick=()=>search(els.heroSearch.value);
els.heroSearch.addEventListener("keydown",e=>{if(e.key==="Enter") search(els.heroSearch.value)});
document.querySelectorAll("[data-search]").forEach(b=>b.onclick=()=>search(b.dataset.search));
document.querySelectorAll("[data-card-search]").forEach(b=>b.onclick=()=>search(b.dataset.cardSearch));
[els.search,els.edition,els.rarity,els.store,els.sort].forEach(el=>el.addEventListener("input",render));
els.clear.onclick=()=>{els.search.value="";els.edition.value="";els.rarity.value="";els.store.value="";els.sort.value="price";data=data.filter(x=>!x.live);refreshSelects();render();toast("Filtros limpiados")};
$("favoritesBtn").onclick=()=>{ if(!favorites.size){toast("Aún no tienes favoritos");return;} els.search.value=""; render(); toast(`${favorites.size} favorito(s) guardado(s)`); };
$("metricCards").textContent=data.length;
$("metricStores").textContent=uniq("store").length;
saveFavs(); render(); renderDeals();

// ===== Catálogo Wiki MyL / Fandom: autocompletado =====
(function setupCatalogAutocomplete(){
  const style = document.createElement("style");
  style.textContent = `
    .mp-autocomplete{position:relative}
    .mp-suggestions{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:80;
      background:#0d1a2b;border:1px solid rgba(255,255,255,.12);border-radius:12px;
      box-shadow:0 18px 45px rgba(0,0,0,.35);overflow:hidden;display:none;max-height:330px;overflow-y:auto}
    .mp-suggestions.show{display:block}
    .mp-suggestion{width:100%;text-align:left;padding:11px 13px;border:0;border-bottom:1px solid rgba(255,255,255,.06);
      background:transparent;color:#fff;display:flex;justify-content:space-between;gap:12px}
    .mp-suggestion:hover,.mp-suggestion:focus{background:#17283e;outline:0}
    .mp-suggestion small{color:#9ba9bd}
    .mp-source{padding:8px 12px;color:#8291a5;font-size:10px;background:#0a1523}
  `;
  document.head.appendChild(style);

  const input = $("searchInput");
  if (!input) return;
  const parent = input.parentElement;
  parent.classList.add("mp-autocomplete");

  const box = document.createElement("div");
  box.className = "mp-suggestions";
  parent.appendChild(box);

  let timer = null;
  let controller = null;

  async function suggest(q){
    if (controller) controller.abort();
    controller = new AbortController();
    try{
      const res = await fetch(`/.netlify/functions/catalog?q=${encodeURIComponent(q)}&mode=suggest&limit=12`, {signal:controller.signal});
      if(!res.ok) return [];
      const payload = await res.json();
      return payload.results || [];
    }catch(e){
      if(e.name !== "AbortError") console.error("Catálogo:", e);
      return [];
    }
  }

  function close(){ box.classList.remove("show"); }

  input.addEventListener("input", ()=>{
    clearTimeout(timer);
    const q = input.value.trim();
    if(q.length < 2){ close(); return; }
    timer = setTimeout(async ()=>{
      const rows = await suggest(q);
      if(!rows.length){ close(); return; }
      box.innerHTML = rows.map((r,i)=>`
        <button class="mp-suggestion" type="button" data-catalog-index="${i}">
          <span>${r.name}</span><small>Wiki MyL</small>
        </button>`).join("") +
        `<div class="mp-source">Referencia: Wiki Mitos y Leyendas · Fandom · CC BY-SA</div>`;
      box.classList.add("show");
      box.querySelectorAll("[data-catalog-index]").forEach(btn=>{
        btn.onclick = async ()=>{
          const picked = rows[Number(btn.dataset.catalogIndex)];
          input.value = picked.name;
          close();
          // Search the exact catalog name in all connected stores.
          await search(picked.name);
        };
      });
    }, 220);
  });

  input.addEventListener("keydown", e=>{
    if(e.key === "Escape") close();
  });
  document.addEventListener("click", e=>{
    if(!parent.contains(e.target)) close();
  });
})();
