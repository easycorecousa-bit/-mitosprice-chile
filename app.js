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
function groupRows(rows){
  const groups = {};
  rows.forEach(x=>{
    const key = normalize(`${x.name}|${x.edition||""}`);
    (groups[key]??=[]).push(x);
  });
  return Object.values(groups);
}

function render(){
  const rows=filtered(); els.cards.innerHTML="";
  els.count.textContent=`${rows.length} oferta${rows.length===1?"":"s"}`;
  els.empty.classList.toggle("hidden",rows.length!==0);

  const groups = groupRows(rows);
  const globalMin=rows.length?Math.min(...rows.map(x=>x.price)):null;
  els.summary.textContent=globalMin!==null?`Mejor precio visible: ${clp(globalMin)}.`:"Busca una carta para comparar ofertas.";

  groups.forEach(group=>{
    group.sort((a,b)=>a.price-b.price);
    const best = group[0];
    const high = group[group.length-1];
    const saving = high.price - best.price;

    // Prefer store image from the cheapest listing; fallback to any available listing image.
    const image = best.image || group.find(x=>x.image)?.image || "";
    const wrap=document.createElement("article");
    wrap.className="compare-card"+(best.price===globalMin?" best":"");

    const offers = group.map((x,i)=>`
      <div class="offer-row ${i===0?"winner":""}">
        <div class="offer-rank">${i===0?"🥇":i===1?"🥈":"•"}</div>
        <div class="offer-main">
          <strong>${x.store}</strong>
          <span>${x.stock||"Revisar disponibilidad"}</span>
        </div>
        <div class="offer-price">${clp(x.price)}</div>
        <a class="offer-link" href="${x.url}" target="_blank" rel="noopener">Ver tienda</a>
      </div>`).join("");

    wrap.innerHTML=`
      <div class="compare-visual">
        ${image ? `<img src="${image}" alt="${best.name}" loading="lazy" onerror="this.parentElement.classList.add('no-image');this.remove()">`
                 : `<div class="image-fallback">MyL</div>`}
      </div>
      <div class="compare-body">
        <div class="compare-head">
          <div>
            <span class="badge">COMPARACIÓN REAL</span>
            <h3>${best.name}</h3>
            <div class="meta">${best.edition||"Edición por confirmar"} · ${best.rarity||"Carta"}</div>
          </div>
          <button class="fav" data-fav="${best.id}" aria-label="Favorito">${favorites.has(best.id)?"★":"☆"}</button>
        </div>
        <div class="best-price-box">
          <span>Mejor precio</span>
          <strong>${clp(best.price)}</strong>
          <small>${best.store}</small>
        </div>
        <div class="offers-list">${offers}</div>
        ${group.length>1 && saving>0 ? `<div class="saving">Ahorro entre tiendas: <strong>${clp(saving)}</strong></div>` : ""}
      </div>`;

    els.cards.appendChild(wrap);
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
    const selected = window.MITOS_SELECTED_CARD || null;
    liveResults = liveResults.map(x=>({
      ...x,
      edition: (x.edition && !x.edition.startsWith("Catálogo")) ? x.edition : (selected?.edition || x.edition),
      rarity: (x.rarity && x.rarity!=="Precio real") ? x.rarity : (selected?.rarity || x.rarity),
      image: x.image || selected?.image || selected?.thumbnail || null
    }));
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
          try{
            const detailRes = await fetch(`/.netlify/functions/catalog?q=${encodeURIComponent(picked.name)}&mode=card`);
            if(detailRes.ok){
              const detailPayload = await detailRes.json();
              window.MITOS_SELECTED_CARD = detailPayload.result || null;
            }
          }catch(e){ console.error("Detalle catálogo:", e); }
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



const compareStyle = document.createElement("style");
compareStyle.textContent = `
  .compare-card{display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:22px;padding:18px;border:1px solid rgba(255,255,255,.10);border-radius:18px;background:rgba(9,20,33,.82);margin-bottom:18px}
  .compare-card.best{border-color:rgba(255,255,255,.24)}
  .compare-visual{min-height:280px;border-radius:14px;background:#091421;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .compare-visual img{width:100%;height:100%;object-fit:contain;max-height:360px}
  .image-fallback{font-size:40px;font-weight:800;opacity:.25}
  .compare-body{display:flex;flex-direction:column;gap:14px}
  .compare-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
  .compare-head h3{margin:8px 0 4px;font-size:24px}
  .best-price-box{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:end;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.05)}
  .best-price-box strong{font-size:28px}
  .offers-list{display:flex;flex-direction:column;gap:8px}
  .offer-row{display:grid;grid-template-columns:32px minmax(120px,1fr) auto auto;gap:12px;align-items:center;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.035)}
  .offer-row.winner{background:rgba(255,255,255,.075)}
  .offer-main{display:flex;flex-direction:column}
  .offer-main span{font-size:12px;opacity:.72}
  .offer-price{font-weight:800;font-size:18px}
  .offer-link{text-decoration:none;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.08);color:inherit}
  .saving{font-size:13px;opacity:.9}
  @media (max-width:760px){
    .compare-card{grid-template-columns:1fr}
    .compare-visual{min-height:220px;max-height:320px}
    .offer-row{grid-template-columns:28px 1fr auto}
    .offer-link{grid-column:2/4;text-align:center}
    .best-price-box{grid-template-columns:1fr}
  }
`;
document.head.appendChild(compareStyle);

