const $ = (id) => document.getElementById(id);
const data = window.MITOS_DATA || [];
const favorites = new Set(JSON.parse(localStorage.getItem("mitosprice:favorites") || "[]"));

const els = {
  heroSearch:$("heroSearch"), heroSearchBtn:$("heroSearchBtn"), search:$("searchInput"),
  edition:$("editionFilter"), rarity:$("rarityFilter"), store:$("storeFilter"),
  sort:$("sortFilter"), cards:$("cardsGrid"), empty:$("emptyState"),
  count:$("resultCount"), summary:$("bestSummary"), deals:$("dealGrid"),
  favCount:$("favCount"), clear:$("clearFilters"), toast:$("toast")
};
const clp = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n);
const uniq = key => [...new Set(data.map(x=>x[key]))].sort((a,b)=>a.localeCompare(b,"es"));

function fillSelect(el, values){
  values.forEach(v=>{ const o=document.createElement("option"); o.value=v;o.textContent=v;el.appendChild(o); });
}
fillSelect(els.edition,uniq("edition")); fillSelect(els.rarity,uniq("rarity")); fillSelect(els.store,uniq("store"));

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
function toast(msg){els.toast.textContent=msg;els.toast.classList.add("show");setTimeout(()=>els.toast.classList.remove("show"),1800)}
function render(){
  const rows=filtered(); els.cards.innerHTML="";
  els.count.textContent=`${rows.length} resultado${rows.length===1?"":"s"}`;
  els.empty.classList.toggle("hidden",rows.length!==0);
  const min=rows.length?Math.min(...rows.map(x=>x.price)):null;
  els.summary.textContent=min!==null?`Mejor precio visible: ${clp(min)}.`:"Busca una carta para comparar ofertas.";
  rows.forEach(x=>{
    const d=document.createElement("article"); d.className="card"+(x.price===min?" best":"");
    d.innerHTML=`${x.price===min?'<span class="badge">MEJOR PRECIO</span>':""}
      <div class="card-top"><div><h3>${x.name}</h3><div class="meta">${x.edition} · ${x.rarity}</div></div></div>
      <div class="price">${clp(x.price)}</div><div class="store">${x.store}</div><div class="stock">${x.stock}</div>
      <div class="card-actions"><a href="${x.url}" target="_blank" rel="noopener">Ver tienda</a>
      <button class="fav" data-fav="${x.id}" aria-label="Favorito">${favorites.has(x.id)?"★":"☆"}</button></div>`;
    els.cards.appendChild(d);
  });
  document.querySelectorAll("[data-fav]").forEach(b=>b.onclick=()=>{
    const id=Number(b.dataset.fav); favorites.has(id)?favorites.delete(id):favorites.add(id); saveFavs(); render();
  });
}
function renderDeals(){
  const groups={};
  data.forEach(x=>(groups[x.name]??=[]).push(x));
  const deals=Object.entries(groups).map(([name,arr])=>{
    arr.sort((a,b)=>a.price-b.price); const low=arr[0], high=arr[arr.length-1];
    return {name,low,save:high.price-low.price};
  }).sort((a,b)=>b.save-a.save).slice(0,3);
  els.deals.innerHTML=deals.map(d=>`<article class="deal"><span>Oportunidad</span><h3>${d.name}</h3><strong>${clp(d.low.price)}</strong><span>${d.low.store} · ahorro potencial ${clp(d.save)}</span></article>`).join("");
}
function search(q){els.search.value=q;document.querySelector("#comparador").scrollIntoView({behavior:"smooth"});render()}
els.heroSearchBtn.onclick=()=>search(els.heroSearch.value);
els.heroSearch.addEventListener("keydown",e=>{if(e.key==="Enter") search(els.heroSearch.value)});
document.querySelectorAll("[data-search]").forEach(b=>b.onclick=()=>search(b.dataset.search));
document.querySelectorAll("[data-card-search]").forEach(b=>b.onclick=()=>search(b.dataset.cardSearch));
[els.search,els.edition,els.rarity,els.store,els.sort].forEach(el=>el.addEventListener("input",render));
els.clear.onclick=()=>{els.search.value="";els.edition.value="";els.rarity.value="";els.store.value="";els.sort.value="price";render();toast("Filtros limpiados")};
$("favoritesBtn").onclick=()=>{ if(!favorites.size){toast("Aún no tienes favoritos");return;} els.search.value=""; render(); toast(`${favorites.size} favorito(s) guardado(s)`); };
$("metricCards").textContent=data.length;
$("metricStores").textContent=uniq("store").length;
saveFavs(); render(); renderDeals();
