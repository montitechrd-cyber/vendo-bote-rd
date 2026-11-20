// SEO: robots.txt, sitemap.xml, metadatos por página (title, description, canonical,
// Open Graph, Twitter) y datos estructurados JSON-LD inyectados desde el servidor,
// para que Google los vea sin tener que ejecutar el JavaScript del sitio.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDB } = require('../database');

const router = express.Router();
const PUBLIC = path.join(__dirname, '..', 'public');

const SITE_NAME = 'VENDO BOTE RD';
function ogDefault() { return siteUrl() + OG_DEFAULT_PATH; }
const PHONE = '+14073614042';
const EMAIL = 'info@vendoboterd.com';
const INSTAGRAM = 'https://www.instagram.com/vendobote_rd/';

// Imagen 1200x630 (proporción 1.91:1) para vistas previas en WhatsApp, Facebook, X y Google
const OG_DEFAULT_PATH = '/assets/img/og-default.jpg?v=3';
function siteUrl() {
  const u = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  // El .env.example trae un marcador; no lo usamos como URL canónica real.
  return u && !/tudominio/i.test(u) ? u : 'https://vendoboterd.com';
}

// Páginas de destino por ciudad: la URL, el título y el texto apuntan a las
// búsquedas reales ("renta de botes en Boca Chica", "alquiler de yates Punta Cana"...).
const LOCATIONS = {
  'boca-chica': {
    name: 'Boca Chica',
    title: 'Renta de Botes y Yates en Boca Chica | VENDO BOTE RD',
    description: 'Renta de botes, lanchas y yates en Boca Chica, República Dominicana. Reserva en línea, elige fecha y horario y paga por transferencia. Cerca de Santo Domingo.',
    h1: 'Renta de botes y yates en <em>Boca Chica</em>',
    subtitle: 'Lanchas y yates para pasar el día en el mar, a minutos de Santo Domingo. Elige tu embarcación y reserva en línea.',
    intro: 'Boca Chica es uno de los destinos más buscados para rentar un bote en República Dominicana: aguas tranquilas, playas a pocos minutos y fácil acceso desde Santo Domingo y el aeropuerto. En VENDO BOTE RD encuentras lanchas y yates con calendario de disponibilidad en tiempo real y reserva por transferencia bancaria.',
  },
  'punta-cana': {
    name: 'Punta Cana',
    title: 'Alquiler de Yates y Catamaranes en Punta Cana | VENDO BOTE RD',
    description: 'Alquila yates, catamaranes y lanchas en Punta Cana, República Dominicana. Reserva en línea tu día de mar con VENDO BOTE RD.',
    h1: 'Alquiler de yates y botes en <em>Punta Cana</em>',
    subtitle: 'Yates, catamaranes y lanchas para recorrer la costa caribeña de Punta Cana. Reserva tu día de mar en línea.',
    intro: 'Punta Cana es sinónimo de playas y mar turquesa. Aquí puedes alquilar un bote para celebrar un cumpleaños, una salida en pareja o un día en familia. Revisa las embarcaciones disponibles, compara capacidad y precio, y reserva directamente en VENDO BOTE RD.',
  },
  'la-romana': {
    name: 'La Romana',
    title: 'Renta de Yates y Lanchas en La Romana y Casa de Campo | VENDO BOTE RD',
    description: 'Renta de yates y lanchas en La Romana y Casa de Campo, República Dominicana. Embarcaciones de lujo, reserva en línea con VENDO BOTE RD.',
    h1: 'Renta de yates y lanchas en <em>La Romana</em>',
    subtitle: 'Embarcaciones de lujo para navegar por La Romana y la zona de Casa de Campo. Reserva en línea.',
    intro: 'La Romana y Casa de Campo reúnen algunas de las mejores aguas del este dominicano, con salidas hacia Isla Saona y Catalina. Renta un yate o una lancha con VENDO BOTE RD: consulta disponibilidad por fecha y reserva sin intermediarios.',
  },
};

const FAQ = [
  ['¿Dónde puedo rentar un bote en República Dominicana?',
   'En VENDO BOTE RD rentas yates, lanchas y catamaranes en Boca Chica, Punta Cana y La Romana (Casa de Campo).'],
  ['¿Cómo reservo una embarcación?',
   'Elige la embarcación en el catálogo, selecciona la fecha y el horario en el calendario de disponibilidad, realiza el pago por transferencia bancaria y sube el comprobante en la plataforma. Nuestro equipo verifica el pago y confirma tu reserva.'],
  ['¿Cómo se paga la renta?',
   'Aceptamos pagos exclusivamente por transferencia bancaria. Una vez verificado tu comprobante, la reserva queda confirmada.'],
  ['¿Venden e importan embarcaciones?',
   'Sí. Además de la renta, tenemos embarcaciones en venta y traemos tu próxima embarcación desde Estados Unidos y las islas del Caribe.'],
  ['¿Qué tipos de embarcaciones tienen?',
   'Contamos con yates, lanchas y catamaranes de distintas capacidades y precios, para grupos pequeños o celebraciones grandes.'],
  ['¿Cómo los contacto?',
   'Por WhatsApp al +1 407 361 4042 o por correo a info@vendoboterd.com.'],
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const jsonLd = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const absUrl = (p) => (/^https?:\/\//i.test(p) ? p : siteUrl() + encodeURI(p));
const isVideo = (src) => /\.(mp4|webm|mov)$/i.test(src || '');

function parseImages(boat) {
  try { return JSON.parse(boat.images || '[]'); } catch { return []; }
}
function firstPhoto(boat) {
  return parseImages(boat).find((s) => s && !isVideo(s)) || null;
}

function readPage(file) {
  return fs.readFileSync(path.join(PUBLIC, file), 'utf8');
}

// Reemplaza <title>/description y agrega canonical, Open Graph, Twitter y JSON-LD.
function withHead(html, { title, description, canonical, image, type = 'website', robots, ld = [] }) {
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`)
    .replace(/\s*<meta name="description"[^>]*>/i, '');
  const tags = [
    `<meta name="description" content="${esc(description)}" />`,
    robots ? `<meta name="robots" content="${robots}" />` : '<meta name="robots" content="index, follow, max-image-preview:large" />',
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="es_DO" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : '',
    image ? `<meta property="og:image:alt" content="${esc(title)}" />` : '',
    image === ogDefault() ? '<meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />' : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : '',
    ...ld.map(jsonLd),
  ].filter(Boolean).join('\n  ');
  return html.replace('</head>', () => `  ${tags}\n</head>`);
}

// Rellena el contenido de un elemento por id (ej. <h1 id="boat-name"></h1>) para que Google
// lo lea en el HTML inicial, sin depender de que se ejecute el JavaScript de la página.
function fill(html, tag, id, inner) {
  return html.replace(new RegExp(`(<${tag} id="${id}"[^>]*>)(</${tag}>)`), (m, a, b) => a + inner + b);
}

const linkStyle = 'color:var(--navy);font-weight:600;';
const mutedStyle = 'color:var(--text-muted);line-height:1.85;font-size:0.95rem;';

function send(res, html, status = 200) {
  res.status(status).type('html').send(html);
}

const organizationLd = () => ({
  '@context': 'https://schema.org',
  '@type': ['LocalBusiness', 'Organization'],
  '@id': siteUrl() + '/#organization',
  name: SITE_NAME,
  alternateName: ['Vendo Bote', 'VendoBote RD'],
  url: siteUrl() + '/',
  logo: siteUrl() + '/assets/img/logo.png',
  image: siteUrl() + '/assets/img/logo.png',
  description: 'Renta, venta e importación de botes, yates, lanchas y catamaranes en República Dominicana.',
  telephone: PHONE,
  email: EMAIL,
  address: { '@type': 'PostalAddress', addressCountry: 'DO' },
  areaServed: Object.values(LOCATIONS).map((l) => ({ '@type': 'City', name: l.name })),
  sameAs: [INSTAGRAM],
});

const websiteLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': siteUrl() + '/#website',
  url: siteUrl() + '/',
  name: SITE_NAME,
  inLanguage: 'es-DO',
  publisher: { '@id': siteUrl() + '/#organization' },
});

const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, url], i) => ({
    '@type': 'ListItem', position: i + 1, name, item: url,
  })),
});

/* ───────────── robots.txt y sitemap.xml ───────────── */

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin.html',
    'Disallow: /auth.html',
    'Disallow: /dashboard.html',
    'Disallow: /complete-profile.html',
    '',
    `Sitemap: ${siteUrl()}/sitemap.xml`,
    '',
  ].join('\n'));
});

router.get('/sitemap.xml', async (req, res) => {
  try {
    const base = siteUrl();
    const urls = [
      { loc: base + '/', priority: '1.0' },
      { loc: base + '/embarcaciones.html', priority: '0.9' },
      ...Object.keys(LOCATIONS).map((k) => ({ loc: `${base}/renta-de-botes-en-${k}`, priority: '0.9' })),
      { loc: base + '/ventas.html', priority: '0.8' },
      ...Object.keys(LEGAL_PAGES).map((f) => ({ loc: `${base}/${f}`, priority: '0.3' })),
    ];
    const boats = await getDB().query('SELECT slug, name, images FROM boats WHERE available = true OR for_sale = true ORDER BY id');
    for (const b of boats) {
      const photo = firstPhoto(b);
      urls.push({ loc: `${base}/embarcacion/${encodeURIComponent(b.slug)}`, priority: '0.7', image: photo ? absUrl(photo) : null, title: b.name });
    }
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      ...urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><priority>${u.priority}</priority>${
        u.image ? `<image:image><image:loc>${esc(u.image)}</image:loc><image:title>${esc(u.title)}</image:title></image:image>` : ''
      }</url>`),
      '</urlset>',
    ].join('\n');
    res.type('application/xml').send(xml);
  } catch (e) {
    console.error(e);
    res.status(500).type('text/plain').send('Error generando sitemap');
  }
});

/* ───────────── Home ───────────── */

function faqHtml() {
  return FAQ.map(([q, a]) =>
    `<details class="seo-faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n');
}

router.get(['/', '/index.html'], async (req, res) => {
  let featured = [];
  try {
    featured = await getDB().query('SELECT name, slug FROM boats WHERE featured = true AND available = true ORDER BY price_per_day DESC LIMIT 6');
  } catch (e) { console.error(e); }
  let html = readPage('index.html').replace('<!--SEO_FAQ-->', faqHtml());
  html = withHead(html, {
    title: 'Renta de Botes, Yates y Lanchas en República Dominicana | VENDO BOTE RD',
    description: 'Renta de botes, yates, lanchas y catamaranes en Boca Chica, Punta Cana y La Romana. También venta e importación de embarcaciones en República Dominicana. Reserva en línea.',
    canonical: siteUrl() + '/',
    image: ogDefault(),
    ld: [
      organizationLd(),
      websiteLd(),
      ...(featured.length ? [{
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Embarcaciones destacadas en renta',
        itemListElement: featured.map((b, i) => ({
          '@type': 'ListItem', position: i + 1, name: b.name,
          url: `${siteUrl()}/embarcacion/${encodeURIComponent(b.slug)}`,
        })),
      }] : []),
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ.map(([q, a]) => ({
          '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
    ],
  });
  send(res, html);
});

/* ───────────── Catálogo de renta y páginas por ciudad ───────────── */

// Enlaces antiguos /embarcaciones.html?location=Boca Chica → URL limpia por ciudad (301)
router.get('/embarcaciones.html', async (req, res, next) => {
  try {
    const loc = String(req.query.location || '');
    const key = Object.keys(LOCATIONS).find((k) => LOCATIONS[k].name.toLowerCase() === loc.toLowerCase());
    if (key) return res.redirect(301, `/renta-de-botes-en-${key}`);

    const html = withHead(readPage('embarcaciones.html'), {
      title: 'Catálogo de Botes, Yates y Lanchas en Renta | VENDO BOTE RD',
      description: 'Explora el catálogo de embarcaciones en renta en República Dominicana: yates, lanchas y catamaranes en Boca Chica, Punta Cana y La Romana. Reserva en línea.',
      canonical: siteUrl() + '/embarcaciones.html',
      image: ogDefault(),
      ld: [breadcrumbLd([['Inicio', siteUrl() + '/'], ['Catálogo', siteUrl() + '/embarcaciones.html']])],
    });
    send(res, html);
  } catch (e) { next(e); }
});

// Texto de la página por ciudad: usa solo datos reales de la base (cantidad, capacidad, precio)
function cityText(key, loc, boats) {
  const caps = boats.map((b) => b.capacity).filter(Boolean);
  const prices = boats.map((b) => Number(b.price_per_day)).filter(Boolean);
  const stats = boats.length
    ? `Hoy tenemos ${boats.length} ${boats.length === 1 ? 'embarcación disponible' : 'embarcaciones disponibles'} en ${esc(loc.name)}${caps.length ? `, para grupos de hasta ${Math.max(...caps)} personas` : ''}${prices.length ? ` y con precios desde US$${Math.min(...prices).toLocaleString('en-US')} por día` : ''}.`
    : '';
  const others = Object.keys(LOCATIONS).filter((k) => k !== key).map((k) =>
    `<a href="/renta-de-botes-en-${k}" style="${linkStyle}">Botes en ${esc(LOCATIONS[k].name)}</a>`).join(' · ');
  return `
<section class="section" aria-labelledby="seo-loc-title">
  <div class="section-inner" style="max-width:860px;">
    <h2 id="seo-loc-title" class="section-title" style="text-align:left;">Botes en renta en <em class="accent">${esc(loc.name)}</em></h2>
    <p style="${mutedStyle}margin-bottom:1rem;">${esc(loc.intro)}</p>
    ${stats ? `<p style="${mutedStyle}margin-bottom:1.5rem;">${stats}</p>` : ''}
    ${boats.length ? `<h3 style="font-family:var(--serif);color:var(--navy);margin-bottom:0.5rem;">Embarcaciones disponibles en ${esc(loc.name)}</h3>
    <ul style="${mutedStyle}line-height:2;padding-left:1.1rem;margin-bottom:1.5rem;">${boats.map((b) =>
      `<li><a href="/embarcacion/${encodeURIComponent(b.slug)}" style="${linkStyle}">${esc(b.name)}</a>${b.capacity ? ` · hasta ${b.capacity} personas` : ''}</li>`).join('')}</ul>` : ''}
    <h3 style="font-family:var(--serif);color:var(--navy);margin-bottom:0.5rem;">Cómo reservar tu bote en ${esc(loc.name)}</h3>
    <ol style="${mutedStyle}padding-left:1.2rem;margin-bottom:1.5rem;">
      <li>Elige la embarcación que mejor se ajuste a tu grupo.</li>
      <li>Selecciona la fecha y el horario en el calendario de disponibilidad.</li>
      <li>Paga por transferencia bancaria y sube tu comprobante en la plataforma.</li>
      <li>Nuestro equipo verifica el pago y confirma tu reserva.</li>
    </ol>
    <p style="${mutedStyle}">También puedes ver ${others}, o escribirnos por <a href="https://wa.me/14073614042" rel="noopener" style="${linkStyle}">WhatsApp</a> si tienes dudas. ¿Quieres comprar en lugar de rentar? Mira las <a href="/ventas.html" style="${linkStyle}">embarcaciones en venta</a>.</p>
  </div>
</section>`;
}

router.get('/renta-de-botes-en-:city', async (req, res, next) => {
  try {
    const loc = LOCATIONS[req.params.city];
    if (!loc) return next();

    const boats = await getDB().query(
      'SELECT name, slug, short_description, capacity, price_per_day, images FROM boats WHERE available = true AND location = $1 ORDER BY featured DESC, created_at DESC',
      [loc.name]
    );
    const url = `${siteUrl()}/renta-de-botes-en-${req.params.city}`;
    const photo = boats.map(firstPhoto).find(Boolean);

    let html = readPage('embarcaciones.html')
      .replace(/<h1 class="cx-title">[\s\S]*?<\/h1>/, `<h1 class="cx-title">${loc.h1}</h1>`)
      .replace(/<p class="cx-sub">[\s\S]*?<\/p>/, `<p class="cx-sub">${esc(loc.subtitle)}</p>`)
      .replace('<span class="cx-kicker">Todas las embarcaciones</span>', `<span class="cx-kicker">${esc(loc.name)}, República Dominicana</span>`)
      .replace('<!--SEO_LOCATION-->', `<meta name="vbr-location" content="${esc(loc.name)}" />`)
      .replace('<!--SEO_TEXT-->', cityText(req.params.city, loc, boats));

    html = withHead(html, {
      title: loc.title,
      description: loc.description,
      canonical: url,
      image: photo ? absUrl(photo) : ogDefault(),
      ld: [
        breadcrumbLd([['Inicio', siteUrl() + '/'], ['Catálogo', siteUrl() + '/embarcaciones.html'], [loc.name, url]]),
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `Botes y yates en renta en ${loc.name}`,
          itemListElement: boats.map((b, i) => ({
            '@type': 'ListItem', position: i + 1, name: b.name,
            url: `${siteUrl()}/embarcacion/${encodeURIComponent(b.slug)}`,
          })),
        },
      ],
    });
    send(res, html);
  } catch (e) { next(e); }
});

/* ───────────── Ventas ───────────── */

router.get('/ventas.html', (req, res) => {
  const html = withHead(readPage('ventas.html'), {
    title: 'Botes, Yates y Lanchas en Venta en República Dominicana | VENDO BOTE RD',
    description: 'Compra botes, yates, lanchas y catamaranes en República Dominicana. Embarcaciones en venta e importación desde Estados Unidos y el Caribe con VENDO BOTE RD.',
    canonical: siteUrl() + '/ventas.html',
    image: ogDefault(),
    ld: [breadcrumbLd([['Inicio', siteUrl() + '/'], ['En venta', siteUrl() + '/ventas.html']])],
  });
  send(res, html);
});

/* ───────────── Páginas legales (exigidas por AZUL) ───────────── */

const LEGAL_PAGES = {
  'terminos.html': {
    title: 'Términos y Condiciones | VENDO BOTE RD',
    description: 'Términos y condiciones de VENDO BOTE RD: renta y venta de embarcaciones, reservas, precios en RD$, pagos con tarjeta y entrega del servicio.',
  },
  'reembolsos.html': {
    title: 'Política de Reembolsos, Devoluciones y Cancelaciones | VENDO BOTE RD',
    description: 'Política de reembolsos, devoluciones y cancelaciones de VENDO BOTE RD: no se devuelve dinero: se cambia la fecha. Plazos de cambio, mal tiempo y errores de cobro.',
  },
  'privacidad.html': {
    title: 'Política de Privacidad | VENDO BOTE RD',
    description: 'Política de privacidad de VENDO BOTE RD: qué datos recopilamos, para qué los usamos y cómo protegemos tu información.',
  },
  'seguridad-pagos.html': {
    title: 'Seguridad en los Pagos con Tarjeta | VENDO BOTE RD',
    description: 'Cómo protegemos tus pagos con tarjeta: procesamiento por AZUL, HTTPS, 3D Secure (Verified by Visa y Mastercard ID Check) y sin almacenar datos de tarjeta.',
  },
};

router.get(Object.keys(LEGAL_PAGES).map((f) => '/' + f), (req, res) => {
  const f = req.path.slice(1);
  const meta = LEGAL_PAGES[f];
  const html = withHead(readPage(f), {
    title: meta.title,
    description: meta.description,
    canonical: `${siteUrl()}/${f}`,
    image: ogDefault(),
    ld: [breadcrumbLd([['Inicio', siteUrl() + '/'], [meta.title.split(' | ')[0], `${siteUrl()}/${f}`]])],
  });
  send(res, html);
});

/* ───────────── Ficha de cada embarcación ───────────── */

// Enlace antiguo /boat.html?slug=x → /embarcacion/x (301)
router.get('/boat.html', (req, res, next) => {
  const slug = String(req.query.slug || '');
  if (!slug) return next();
  res.redirect(301, `/embarcacion/${encodeURIComponent(slug)}`);
});

router.get('/embarcacion/:slug', async (req, res, next) => {
  try {
    const db = getDB();
    const boat = await db.queryOne('SELECT * FROM boats WHERE slug = $1', [req.params.slug]);
    if (!boat) {
      return send(res, withHead(readPage('boat.html'), {
        title: 'Embarcación no encontrada | VENDO BOTE RD',
        description: 'Esta embarcación no está disponible.',
        canonical: siteUrl() + '/embarcaciones.html',
        robots: 'noindex, follow',
      }), 404);
    }

    const url = `${siteUrl()}/embarcacion/${encodeURIComponent(boat.slug)}`;
    const forSale = Boolean(boat.for_sale);
    const photos = parseImages(boat).filter((s) => s && !isVideo(s)).map(absUrl);
    const base = (boat.short_description || boat.description || '').replace(/\s+/g, ' ').trim();
    const where = boat.location ? ` en ${boat.location}` : '';
    const title = forSale
      ? `${boat.name} en Venta${where} | ${SITE_NAME}`
      : `${boat.name} — Renta de Embarcación${where} | ${SITE_NAME}`;
    const lead = forSale ? 'En venta' : 'Renta';
    let description = `${lead}: ${boat.name}${where}, República Dominicana.${boat.capacity ? ` Capacidad ${boat.capacity} personas.` : ''} ${base}`.trim();
    if (description.length > 158) description = description.slice(0, 155).replace(/\s+\S*$/, '') + '…';

    const price = forSale ? boat.sale_price : boat.price_per_day;
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: boat.name,
      description: base || description,
      url,
      ...(photos.length && { image: photos }),
      ...(boat.brand && { brand: { '@type': 'Brand', name: boat.brand } }),
      category: forSale ? 'Embarcaciones en venta' : 'Renta de embarcaciones',
      ...(price && {
        offers: {
          '@type': 'Offer',
          url,
          priceCurrency: 'USD',
          price: Number(price),
          availability: boat.available || forSale ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          seller: { '@id': siteUrl() + '/#organization' },
        },
      }),
    };

    const parseList = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
    const amenities = parseList(boat.amenities);
    const related = forSale
      ? await db.query('SELECT name, slug, location FROM boats WHERE for_sale = true AND id <> $1 ORDER BY sale_price ASC LIMIT 6', [boat.id])
      : await db.query('SELECT name, slug, location FROM boats WHERE available = true AND location = $2 AND id <> $1 ORDER BY featured DESC, created_at DESC LIMIT 6', [boat.id, boat.location]);
    const relatedHtml = related.length ? `
<section class="section" aria-labelledby="seo-related-title">
  <div class="section-inner" style="max-width:860px;">
    <h2 id="seo-related-title" class="section-title" style="text-align:left;font-size:1.4rem;">${forSale ? 'Otras embarcaciones en venta' : `Otros botes en renta en ${esc(boat.location)}`}</h2>
    <ul style="${mutedStyle}line-height:2;padding-left:1.1rem;">${related.map((b) =>
      `<li><a href="/embarcacion/${encodeURIComponent(b.slug)}" style="${linkStyle}">${esc(b.name)}</a>${!forSale && b.location ? ` · ${esc(b.location)}` : ''}</li>`).join('')}</ul>
  </div>
</section>` : '';

    let page = readPage('boat.html').replace('<!--SEO_RELATED-->', relatedHtml);
    page = fill(page, 'h1', 'boat-name', esc(boat.name));
    page = fill(page, 'span', 'breadcrumb-name', esc(boat.name));
    page = fill(page, 'span', 'boat-location-tag', boat.location ? `📍 ${esc(boat.location)}` : '');
    page = fill(page, 'p', 'boat-description', esc(boat.description || ''));
    page = fill(page, 'div', 'boat-amenities', amenities.map((a) => `<span class="feature-tag">${esc(a)}</span>`).join(''));

    const html = withHead(page, {
      title, description, canonical: url, type: 'product', image: photos[0],
      ld: [
        product,
        breadcrumbLd([
          ['Inicio', siteUrl() + '/'],
          [forSale ? 'En venta' : 'Catálogo', siteUrl() + (forSale ? '/ventas.html' : '/embarcaciones.html')],
          [boat.name, url],
        ]),
      ],
    });
    send(res, html);
  } catch (e) { next(e); }
});

// Páginas privadas: fuera del índice de Google (robots.txt solo evita rastrear; esto evita indexar)
router.use(['/admin.html', '/auth.html', '/dashboard.html', '/complete-profile.html'], (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

module.exports = router;
