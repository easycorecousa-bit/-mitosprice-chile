const WIKI = "https://myl.fandom.com";
const API = `${WIKI}/api.php`;

const BAD_PREFIXES = [
  "Lista de cartas", "Listas de Cartas", "Categoría:", "Category:",
  "Archivo:", "File:", "Plantilla:", "Template:", "Usuario:", "User:",
  "Discusión:", "Talk:", "Wiki ", "Mitos y Leyendas"
];

function cleanTitle(title = "") {
  return title.replace(/\s+/g, " ").trim();
}

function looksLikeCard(title = "") {
  const t = cleanTitle(title);
  if (!t || t.length < 2) return false;
  return !BAD_PREFIXES.some(p => t.toLowerCase().startsWith(p.toLowerCase()));
}

function wikiUrl(title) {
  return `${WIKI}/es/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function jsonFetch(url) {
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "MitosPriceChile/1.0 (+https://mitosprice-chile.netlify.app)"
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function apiSuggest(q, limit) {
  // OpenSearch is fast and ideal for autocomplete.
  const url = `${API}?action=opensearch&search=${encodeURIComponent(q)}&namespace=0&limit=${limit}&format=json`;
  const data = await jsonFetch(url);
  const titles = Array.isArray(data?.[1]) ? data[1] : [];
  return titles
    .map(cleanTitle)
    .filter(looksLikeCard)
    .map(title => ({ name: title, wikiUrl: wikiUrl(title), source: "Wiki MyL / Fandom" }));
}

async function apiSearch(q, limit) {
  // Fallback: full-text search when OpenSearch is insufficient.
  const url = `${API}?action=query&list=search&srnamespace=0&srlimit=${limit}&srsearch=${encodeURIComponent(q)}&format=json`;
  const data = await jsonFetch(url);
  const rows = data?.query?.search || [];
  return rows
    .map(x => cleanTitle(x.title))
    .filter(looksLikeCard)
    .map(title => ({ name: title, wikiUrl: wikiUrl(title), source: "Wiki MyL / Fandom" }));
}

async function getCardDetails(name) {
  // Pull parsed wikitext and extract the most useful infobox labels.
  const url = `${API}?action=parse&page=${encodeURIComponent(name)}&prop=wikitext|displaytitle&format=json`;
  const data = await jsonFetch(url);
  const wt = data?.parse?.wikitext?.["*"] || "";
  const display = cleanTitle((data?.parse?.displaytitle || name).replace(/<[^>]+>/g, ""));

  const field = (labels) => {
    for (const label of labels) {
      const re = new RegExp(`\\|\\s*${label}\\s*=\\s*([^\\n\\r|}]+)`, "i");
      const m = wt.match(re);
      if (m) return cleanTitle(m[1].replace(/\[\[|\]\]/g, "").replace(/<[^>]+>/g, ""));
    }
    return "";
  };

  return {
    name: display,
    edition: field(["edición", "edicion", "set"]),
    type: field(["tipo", "type"]),
    rarity: field(["frecuencia", "rareza", "rarity"]),
    race: field(["raza", "race"]),
    code: field(["código", "codigo", "code"]),
    wikiUrl: wikiUrl(name),
    source: "Wiki MyL / Fandom"
  };
}

export default async (request) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const mode = (url.searchParams.get("mode") || "suggest").toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 30);

  if (!q) {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  try {
    if (mode === "card") {
      const card = await getCardDetails(q);
      return new Response(JSON.stringify({ result: card }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=86400"
        }
      });
    }

    let results = [];
    try { results = await apiSuggest(q, limit); } catch (_) {}
    if (results.length < Math.min(5, limit)) {
      try {
        const more = await apiSearch(q, limit);
        const seen = new Set(results.map(x => x.name.toLowerCase()));
        for (const r of more) {
          if (!seen.has(r.name.toLowerCase())) {
            results.push(r);
            seen.add(r.name.toLowerCase());
          }
        }
      } catch (_) {}
    }

    return new Response(JSON.stringify({
      query: q,
      results: results.slice(0, limit),
      attribution: "Datos de referencia: Wiki Mitos y Leyendas en Fandom (CC BY-SA)"
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ query: q, results: [], error: error.message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
};
