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
const PHONE = '+14073614042';
const EMAIL = 'info@vendoboterd.com';
const INSTAGRAM = 'https://www.instagram.com/vendobote_rd/';

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
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : '',
    ...ld.map(jsonLd),
  ].filter(Boolean).join('\n  ');
  return html.replace('</head>', `  ${tags}\n</head>`);
}

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

router.get(['/', '/index.html'], (req, res) => {
  let html = readPage('index.html').replace('<!--SEO_FAQ-->', faqHtml());
  html = withHead(html, {
    title: 'Renta de Botes, Yates y Lanchas en República Dominicana | VENDO BOTE RD',
    description: 'Renta de botes, yates, lanchas y catamaranes en Boca Chica, Punta Cana y La Romana. También venta e importación de embarcaciones en República Dominicana. Reserva en línea.',
    canonical: siteUrl() + '/',
    image: siteUrl() + '/assets/img/logo.png',
    ld: [
      organizationLd(),
      websiteLd(),
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
      image: siteUrl() + '/assets/img/logo.png',
      ld: [breadcrumbLd([['Inicio', siteUrl() + '/'], ['Catálogo', siteUrl() + '/embarcaciones.html']])],
    });
    send(res, html);
  } catch (e) { next(e); }
});

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
      .replace(/<h1 class="page-title">[\s\S]*?<\/h1>/, `<h1 class="page-title">${loc.h1}</h1>`)
      .replace(/<p class="page-subtitle">[\s\S]*?<\/p>/, `<p class="page-subtitle">${esc(loc.subtitle)}</p>`)
      .replace('<div class="section-kicker">Todas las Embarcaciones</div>', `<div class="section-kicker">${esc(loc.name)}, República Dominicana</div>`)
      .replace('<!--SEO_LOCATION-->', `<script>window.__VBR_LOCATION=${JSON.stringify(loc.name)};</script>`)
      .replace('<!--SEO_TEXT-->', `
<section class="section" aria-labelledby="seo-loc-title">
  <div class="section-inner" style="max-width:860px;">
    <h2 id="seo-loc-title" class="section-title" style="text-align:left;">Botes en renta en <em class="accent">${esc(loc.name)}</em></h2>
    <p style="color:var(--text-muted);line-height:1.85;font-size:0.95rem;margin-bottom:1.25rem;">${esc(loc.intro)}</p>
    ${boats.length ? `<ul style="color:var(--text-muted);line-height:2;font-size:0.95rem;padding-left:1.1rem;">${boats.map((b) =>
      `<li><a href="/embarcacion/${encodeURIComponent(b.slug)}" style="color:var(--navy);font-weight:600;">${esc(b.name)}</a>${b.capacity ? ` · hasta ${b.capacity} personas` : ''}</li>`).join('')}</ul>` : ''}
  </div>
</section>`);

    html = withHead(html, {
      title: loc.title,
      description: loc.description,
      canonical: url,
      image: photo ? absUrl(photo) : siteUrl() + '/assets/img/logo.png',
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
    image: siteUrl() + '/assets/img/logo.png',
    ld: [breadcrumbLd([['Inicio', siteUrl() + '/'], ['En venta', siteUrl() + '/ventas.html']])],
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
    const reviews = await db.query('SELECT rating FROM reviews WHERE boat_id = $1', [boat.id]);

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
      ...(reviews.length && {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1),
          reviewCount: reviews.length,
        },
      }),
    };

    const html = withHead(readPage('boat.html'), {
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
