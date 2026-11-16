// VÉNDELO: SEO de productos con Cloudflare Workers Static Assets.
// No usa claves secretas de Supabase; respeta las políticas RLS de productos públicos.
const SITE = 'https://vendelo.tiendavendeloo.workers.dev';
const SUPABASE = 'https://vgskaqxnrgiuyfxbbnwu.supabase.co';
const PUBLIC_KEY = 'sb_publishable_Ga8WwhMa3c2jwQgoRMHCJg_edBOIqKE';
const headers = { apikey: PUBLIC_KEY, Accept: 'application/json' };
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanText = v => String(v ?? '').replace(/\s+/g,' ').trim();
const absoluteImage = v => { if (typeof v === 'string' && /^https:\/\//i.test(v)) return v; if(Array.isArray(v)) return absoluteImage(v[0]); return ''; };
const productUrl = id => `${SITE}/?producto=${encodeURIComponent(String(id))}`;
async function getProducts(params) {
  const url = new URL(`${SUPABASE}/rest/v1/products`);
  url.searchParams.set('select','id,name,description,category,price,image,images,is_active');
  url.searchParams.set('is_active','eq.true');
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  const r = await fetch(url, {headers, cf:{cacheTtl:180,cacheEverything:true}});
  if (!r.ok) throw new Error(`Supabase products: ${r.status}`);
  return r.json();
}
function meta(name, value, property=false){return `<meta ${property?'property':'name'}="${escapeHTML(name)}" content="${escapeHTML(value)}">`;}
function replaceTag(html, re, replacement) {return re.test(html) ? html.replace(re,replacement) : html.replace('</head>',replacement+'\n</head>');}
function productSeo(html, product) {
  const url = productUrl(product.id);
  const name = cleanText(product.name) || `Producto ${product.id}`;
  const title = `${name} | Tienda VÉNDELO Colombia`;
  const description = (cleanText(product.description) || `Compra ${name} en VÉNDELO Colombia. Consulta precio, disponibilidad y detalles.`).slice(0,300);
  const image = absoluteImage(product.image) || absoluteImage(product.images);
  html = replaceTag(html, /<title>[\s\S]*?<\/title>/i,`<title>${escapeHTML(title)}</title>`);
  html = replaceTag(html, /<meta\s+name="description"[^>]*>/i,meta('description',description));
  html = replaceTag(html, /<link\s+rel="canonical"[^>]*>/i,`<link rel="canonical" href="${escapeHTML(url)}">`);
  html = replaceTag(html, /<meta\s+property="og:type"[^>]*>/i,meta('og:type','product',true));
  for(const [key,value] of [['og:title',title],['og:description',description],['og:url',url],['twitter:title',title],['twitter:description',description]]) {
    html = replaceTag(html,new RegExp(`<meta\\s+(?:property|name)="${key}"[^>]*>`,'i'),meta(key,value,key.startsWith('og:')));
  }
  if(image) html=html.replace('</head>',meta('og:image',image,true)+'\n'+meta('twitter:image',image)+'\n</head>');
  const schema = {'@context':'https://schema.org','@type':'Product',name,description,url,sku:String(product.id),...(image?{image:[image]}:{}),offers:{'@type':'Offer',url,priceCurrency:'COP',price:Number(product.price)||0,availability:'https://schema.org/InStock',seller:{'@type':'Organization',name:'VÉNDELO'}}};
  // JSON seguro dentro de HTML, sin alterar scripts existentes.
  const json = JSON.stringify(schema).replace(/</g,'\\u003c');
  html=html.replace('</head>',`<script type="application/ld+json">${json}</script>\n</head>`);
  return html;
}
export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if(u.pathname === '/sitemap.xml') {
      try {
        const products=await getProducts({limit:'1000',order:'created_at.desc'});
        const entries=[SITE+'/',...products.filter(p=>p.id!=null).map(p=>productUrl(p.id))];
        const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+entries.map(x=>`<url><loc>${escapeHTML(x)}</loc></url>`).join('\n')+'\n</urlset>';
        return new Response(xml,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=180'}});
      } catch(e){console.error(e);return new Response('Sitemap temporalmente no disponible',{status:503});}
    }
    if(u.pathname === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`,{headers:{'content-type':'text/plain; charset=utf-8'}});
    if(u.pathname === '/' && u.searchParams.has('producto')) {
      const id=u.searchParams.get('producto');
      if(!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return env.ASSETS.fetch(request);
      try {
        const items=await getProducts({id:`eq.${id}`,limit:'1'});
        if(!items.length) return env.ASSETS.fetch(request);
        const original=await env.ASSETS.fetch(new Request(new URL('/',request.url),request));
        if(!original.ok) return original;
        const html=productSeo(await original.text(),items[0]);
        const outHeaders=new Headers(original.headers);
        outHeaders.set('content-type','text/html; charset=utf-8');
        outHeaders.set('cache-control','public, max-age=120');
        outHeaders.delete('content-length');
        outHeaders.delete('content-encoding');
        return new Response(html,{status:200,headers:outHeaders});
      } catch(e){console.error('SEO product error',e);return env.ASSETS.fetch(request);}
    }
    return env.ASSETS.fetch(request);
  }
};
