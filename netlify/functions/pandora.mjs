const STORE = "Pandora Store";
const BASE_URL = "https://www.pandorastore.cl";

function decodeHtml(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function textFrom(html = "") {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalize(s = "") {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseMoney(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[^\d.,]/g, "");
  if (!s) return null;

  if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  if (/^\d{1,3}(?:,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^\d+\.\d{1,2}$/.test(s)) return Math.round(Number(s));
  if (/^\d+,\d{1,2}$/.test(s)) return Math.round(Number(s.replace(",", ".")));

  if (s.includes(".") && s.includes(",")) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parsePrice(html) {
  const candidates = [
    /property=["']product:price:amount["'][^>]*content=["']([0-9.,]+)["']/i,
    /content=["']([0-9.,]+)["'][^>]*property=["']product:price:amount["']/i,
    /itemprop=["']price["'][^>]*content=["']([0-9.,]+)["']/i,
    /content=["']([0-9.,]+)["'][^>]*itemprop=["']price["']/i,
    /"price"\s*:\s*"?(?:CLP\s*)?([0-9.,]+)"?/i,
    /\$\s*([0-9]{1,3}(?:\.[0-9]{3})+|\d+)/
  ];
  for (const re of candidates) {
    const m = html.match(re);
    if (m) {
      const n = parseMoney(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function parseTitle(html, fallback) {
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og) return decodeHtml(og[1]).replace(/\s*\|.*$/, "").trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? textFrom(h1[1]) : fallback;
}

function parseImage(html) {
  const m = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  return m ? decodeHtml(m[1]) : null;
}

function stockFrom(html) {
  const t = textFrom(html).toLowerCase();
  if (t.includes("agotado") || t.includes("sin stock")) return "Sin stock";
  if (t.includes("agregar al carro") || t.includes("add to cart")) return "Disponible";
  return "Revisar disponibilidad";
}

function extractProductLinks(html, q) {
  const links = new Set();
  const re = /href=["'](\/[^"'#?]+)["']/gi;
  const nq = normalize(q), qDash = nq.replace(/\s+/g, "-"), qNoSpace = nq.replace(/\s+/g, "");
  let m;
  while ((m = re.exec(html))) {
    const path = m[1];
    if (path.startsWith("/collections/") || path.startsWith("/categories/") || path.startsWith("/pages/")) continue;
    const np = normalize(path);
    if (np.includes(qDash) || np.includes(qNoSpace)) links.add(path);
  }
  return [...links].slice(0, 8);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {"user-agent":"MitosPriceChile/1.1 (+https://mitosprice-chile.netlify.app)","accept":"text/html,application/xhtml+xml"},
    redirect: "follow"
  });
  if (!res.ok) return null;
  return await res.text();
}

export default async (request) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return new Response(JSON.stringify({error:"Falta el parámetro q"}), {status:400,headers:{"content-type":"application/json; charset=utf-8"}});

  try {
    const searchHtml = await fetchHtml(`${BASE_URL}/search?q=${encodeURIComponent(q)}`);
    if (!searchHtml) throw new Error("No se pudo consultar Pandora Store");

    const links = extractProductLinks(searchHtml, q);
    const slug = normalize(q).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const results = [];

    for (const path of links.slice(0, 6)) {
      const productUrl = path.startsWith("http") ? path : `${BASE_URL}${path}`;
      const html = await fetchHtml(productUrl);
      if (!html) continue;
      const name = parseTitle(html, q);
      if (!normalize(name).includes(normalize(q))) continue;
      const price = parsePrice(html);
      if (!price) continue;
      results.push({
        id:`pandora-${slug}-${results.length+1}`, name, edition:"Catálogo Pandora Store",
        rarity:"Precio real", store:STORE, price, stock:stockFrom(html), url:productUrl,
        image:parseImage(html), live:true
      });
    }

    return new Response(JSON.stringify({store:STORE,query:q,fetchedAt:new Date().toISOString(),results:results.sort((a,b)=>a.price-b.price)}), {
      status:200,
      headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=180"}
    });
  } catch (error) {
    return new Response(JSON.stringify({store:STORE,query:q,results:[],error:error.message}), {status:502,headers:{"content-type":"application/json; charset=utf-8"}});
  }
};
