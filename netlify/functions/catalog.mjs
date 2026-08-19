const WIKI = "https://myl.fandom.com";
const API = `${WIKI}/api.php`;

function cleanTitle(title = "") { return title.replace(/\s+/g, " ").trim(); }
function wikiUrl(title) { return `${WIKI}/es/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`; }

async function jsonFetch(url) {
  const res = await fetch(url, {
    headers: {"accept":"application/json","user-agent":"MitosPriceChile/1.1 (+https://mitosprice-chile.netlify.app)"},
    redirect:"follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function pageLooksLikeCard(wikitext = "") {
  const wt = wikitext.toLowerCase();
  const hasType = /\|\s*tipo\s*=/.test(wt);
  const hasEdition = /\|\s*edici[oó]n\s*=/.test(wt);
  const hasFrequency = /\|\s*(frecuencia|rareza)\s*=/.test(wt);
  const hasCode = /\|\s*c[oó]digo\s*=/.test(wt);
  return hasType && (hasEdition || hasFrequency || hasCode);
}

function extractField(wt, labels) {
  for (const label of labels) {
    const re = new RegExp(`\\|\\s*${label}\\s*=\\s*([^\\n\\r|}]+)`, "i");
    const m = wt.match(re);
    if (m) return cleanTitle(m[1].replace(/\[\[|\]\]/g, "").replace(/<[^>]+>/g, "").replace(/'''?/g, ""));
  }
  return "";
}

async function candidateTitles(q, limit = 20) {
  const titles = [], seen = new Set();
  try {
    const data = await jsonFetch(`${API}?action=opensearch&search=${encodeURIComponent(q)}&namespace=0&limit=${Math.min(limit,20)}&format=json`);
    for (const t of (data?.[1] || [])) {
      const title = cleanTitle(t);
      if (title && !seen.has(title.toLowerCase())) { seen.add(title.toLowerCase()); titles.push(title); }
    }
  } catch (_) {}

  if (titles.length < 10) {
    try {
      const data = await jsonFetch(`${API}?action=query&list=search&srnamespace=0&srlimit=${Math.min(limit,20)}&srsearch=${encodeURIComponent(q)}&format=json`);
      for (const row of (data?.query?.search || [])) {
        const title = cleanTitle(row.title);
        if (title && !seen.has(title.toLowerCase())) { seen.add(title.toLowerCase()); titles.push(title); }
      }
    } catch (_) {}
  }
  return titles.slice(0, limit);
}

async function fetchCardPages(titles) {
  if (!titles.length) return [];
  const data = await jsonFetch(`${API}?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles.join("|"))}&format=json&formatversion=2`);
  const pages = data?.query?.pages || [];
  const cards = [];

  for (const page of pages) {
    if (page.missing) continue;
    const slot = page?.revisions?.[0]?.slots?.main;
    const wt = slot?.content || slot?.["*"] || "";
    if (!pageLooksLikeCard(wt)) continue;
    cards.push({
      name: cleanTitle(page.title),
      edition: extractField(wt, ["edición","edicion"]),
      type: extractField(wt, ["tipo"]),
      rarity: extractField(wt, ["frecuencia","rareza"]),
      code: extractField(wt, ["código","codigo"]),
      wikiUrl: wikiUrl(page.title),
      source: "Wiki MyL / Fandom"
    });
  }
  return cards;
}

function scoreCard(card, q) {
  const n = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const name = n(card.name), query = n(q);
  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (name.includes(query)) return 60;
  return 10;
}

export default async (request) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const mode = (url.searchParams.get("mode") || "suggest").toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 20);

  if (!q) return new Response(JSON.stringify({results:[]}), {status:200,headers:{"content-type":"application/json; charset=utf-8"}});

  try {
    if (mode === "card") {
      const cards = await fetchCardPages([q]);
      const card = cards[0] || null;
      return new Response(JSON.stringify({result:card}), {
        status: card ? 200 : 404,
        headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=86400"}
      });
    }

    const titles = await candidateTitles(q, 20);
    const cards = await fetchCardPages(titles);
    cards.sort((a,b)=>scoreCard(b,q)-scoreCard(a,q) || a.name.localeCompare(b.name,"es"));

    return new Response(JSON.stringify({
      query:q,
      results:cards.slice(0,limit),
      attribution:"Referencia: Wiki Mitos y Leyendas / Fandom"
    }), {
      status:200,
      headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=1800"}
    });
  } catch (error) {
    return new Response(JSON.stringify({query:q,results:[],error:error.message}), {status:502,headers:{"content-type":"application/json; charset=utf-8"}});
  }
};
