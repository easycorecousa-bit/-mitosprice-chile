const STORE = "Gorila TCG";
const BASE_URL = "https://www.gorilatcg.cl";

function slugify(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/['’´`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function textFrom(html = "") {
  return decodeHtml(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
  );
}

function parsePrice(html) {
  const candidates = [
    /property=["']product:price:amount["'][^>]*content=["']([0-9.,]+)["']/i,
    /itemprop=["']price["'][^>]*content=["']([0-9.,]+)["']/i,
    /\$\s*([0-9]{1,3}(?:\.[0-9]{3})+)/
  ];
  for (const re of candidates) {
    const m = html.match(re);
    if (m) {
      const n = Number(String(m[1]).replace(/\./g, "").replace(/,/g, "."));
      if (Number.isFinite(n)) return Math.round(n);
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
  if (t.includes("stock por sucursal")) return "Revisar stock por sucursal";
  return "Revisar disponibilidad";
}

export default async (request) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) {
    return new Response(JSON.stringify({ error: "Falta el parámetro q" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const slug = slugify(q);
  const productUrl = `${BASE_URL}/product/${slug}`;

  try {
    const res = await fetch(productUrl, {
      headers: {
        "user-agent": "MitosPriceChile/1.0 (+https://mitosprice-chile.netlify.app)",
        "accept": "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    });

    if (!res.ok) {
      return new Response(JSON.stringify({
        store: STORE, query: q, results: [],
        message: `No se encontró un producto exacto para ${q}`
      }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=300"
        }
      });
    }

    const html = await res.text();
    const price = parsePrice(html);
    const name = parseTitle(html, q);

    if (!price) {
      return new Response(JSON.stringify({
        store: STORE, query: q, results: [],
        message: "Producto encontrado, pero no se pudo leer el precio."
      }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    return new Response(JSON.stringify({
      store: STORE,
      query: q,
      fetchedAt: new Date().toISOString(),
      results: [{
        id: `gorila-${slug}`,
        name,
        edition: "Catálogo Gorila TCG",
        rarity: "Precio real",
        store: STORE,
        price,
        stock: stockFrom(html),
        url: productUrl,
        image: parseImage(html),
        live: true
      }]
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      store: STORE, query: q, results: [], error: error.message
    }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
};
