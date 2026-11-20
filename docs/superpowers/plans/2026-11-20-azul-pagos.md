# Pagos con tarjeta AZUL — Plan de implementación

> **Para quien ejecute:** usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan casillas `- [ ]`.

**Meta:** aceptar pagos con tarjeta mediante la Página de Pago de AZUL, junto a la transferencia existente, cumpliendo el manual AZUL 2023-08 y PCI DSS (SAQ A: el servidor nunca toca datos de tarjeta).

**Arquitectura:** el servidor crea la reserva en `payment_status='card_pending'` (retiene el turno 15 min), calcula el monto en DOP con la tasa del día y devuelve los campos firmados (`AuthHash` HMAC-SHA512). El navegador hace POST a AZUL. AZUL redirige a `/api/payments/azul/{approved|declined|cancelled}/:orderNumber`; el servidor verifica el hash de la respuesta y el monto contra su propio registro antes de confirmar.

**Tecnología:** Node 18+/Express 4, PostgreSQL (`pg`), `node:crypto`, pruebas con `node:test` (sin dependencias nuevas), JS externo sin scripts en línea (CSP).

**Diseño:** `docs/superpowers/specs/2026-11-20-azul-pagos-design.md`

## Restricciones globales
- Nunca recibir, guardar ni registrar PAN, CVV ni vencimiento. Nunca registrar `AuthKey` ni `AuthHash` de la clave.
- El monto lo calcula el servidor; el navegador solo elige reserva y método.
- Reserva con tarjeta se confirma **solo** con hash de respuesta válido, `IsoCode==='00'`, `OrderNumber` y `Amount` iguales a los guardados.
- `Amount`/`ITBIS`: entero en centavos como texto (`1000`=10.00); ITBIS exento = `"000"`.
- URLs AZUL: prueba `https://pruebas.azul.com.do/PaymentPage/`; producción `https://pagos.azul.com.do/PaymentPage/Default.aspx`, alterna `https://contpagos.azul.com.do/PaymentPage/Default.aspx`.
- Hash de envío (UTF-16LE, HMAC-SHA512, clave=AuthKey, hex minúscula): MerchantId, MerchantName, MerchantType, CurrencyCode, OrderNumber, Amount, ITBIS, ApprovedUrl, DeclinedUrl, CancelUrl, UseCustomField1, CustomField1Label, CustomField1Value, UseCustomField2, CustomField2Label, CustomField2Value, AuthKey.
- Hash de respuesta: OrderNumber, Amount, AuthorizationCode, DateTime, ResponseCode, IsoCode, ResponseMessage, ErrorDescription, RRN, AuthKey.
- `AltMerchantName` ≤25 caracteres, sin `"` `\` `'`. `MerchantType='ECommerce'`, `CurrencyCode='$'`.
- Todo texto visible en español. Orden obligatorio: local → GitHub → Railway.
- Variables nuevas (documentar en `.env.example`): `AZUL_MERCHANT_ID`, `AZUL_MERCHANT_NAME`, `AZUL_AUTH_KEY`, `AZUL_ENV` (`test`|`prod`), `AZUL_ITBIS_RATE` (por defecto `0`), `AZUL_PAYMENT_URL` (solo desarrollo, se ignora con `NODE_ENV=production`).

## Review Focus
1. Respuesta con hash válido pero `Amount` distinto al guardado → no confirmar (test en Tarea 3).
2. La misma respuesta aprobada llegando dos veces → una sola confirmación, sin segundo correo (Tarea 3).
3. Pago aprobado cuando el turno ya expiró/lo tomó otro → no perderlo en silencio: marcar `needs_review` y avisar al admin (Tarea 3).
4. Tasa USD→DOP no disponible → no iniciar pago con tarjeta, mostrar error claro (Tarea 2).
5. Monto con decimales (p. ej. 17483.21) o muy pequeño → centavos exactos, sin flotantes imprecisos (Tarea 1).

---

### Tarea 1: Núcleo AZUL (`utils/azul.js`)

**Files:** Create `utils/azul.js`, `tests/azul.test.js`; Modify `package.json` (script `"test": "node --test tests/"`).

**Interfaces — Produces:**
- `AZUL_URLS: { test, prod, prodAlt }`
- `toAzulAmount(value: number): string` — redondea a 2 decimales y devuelve centavos (`17483.21`→`"1748321"`, `0`→`"000"`); lanza `Error` si es negativo, NaN o infinito.
- `buildRequestHash(fields: Record<string,string>, authKey: string): string`
- `buildResponseHash(params: Record<string,string>, authKey: string): string` — campos ausentes cuentan como `''`.
- `verifyResponseHash(params, authKey): boolean` — compara `params.AuthHash` en tiempo constante, sin distinguir mayúsculas.
- `buildPaymentFields(o: {merchantId, merchantName, orderNumber, amountDop:number, itbisDop:number, approvedUrl, declinedUrl, cancelUrl, authKey, bookingRef, locale?:'ES'|'EN', altMerchantName?}): Record<string,string>` — incluye `UseCustomField1:'1'`, `CustomField1Label:'Reserva'`, `CustomField1Value:bookingRef`, `UseCustomField2:'0'`, y `AuthHash`.
- `isApproved(params): boolean` — `IsoCode === '00'`.

- [ ] **Paso 1: pruebas que fallan** en `tests/azul.test.js`: `toAzulAmount(17483.21)==='1748321'`, `toAzulAmount(10)==='1000'`, `toAzulAmount(0)==='000'`, `toAzulAmount(0.1+0.2)==='030'`, `toAzulAmount(-1)` lanza; vector de hash: calcular con `crypto.createHmac('sha512','k').update(Buffer.from('a'+'b','utf16le'))` y comprobar que `buildRequestHash` produce el mismo hex en minúscula con los campos del orden indicado; `verifyResponseHash` true con hash correcto en mayúsculas, false si cambia un solo campo o falta `AuthHash`; `buildPaymentFields` rechaza `altMerchantName` con `"`, `\` o `'` y de más de 25 caracteres; `isApproved({IsoCode:'05'})===false`.
- [ ] **Paso 2:** ejecutar `npm test` — Esperado: FALLA (módulo inexistente).
- [ ] **Paso 3:** implementar `utils/azul.js` con `node:crypto`; aritmética de centavos con `Math.round(value*100)` tras `Number(value.toFixed(2))`.
- [ ] **Paso 4:** `npm test` — Esperado: todo PASA.
- [ ] **Paso 5:** commit `feat: núcleo AZUL (montos y AuthHash)`.

### Tarea 2: Base de datos, retención de turno, cotización y tasa

**Files:** Modify `database.js` (tabla e índice), `routes/bookings.js` (usar cotización compartida y estados), `routes/boats.js:181`, `routes/rates.js`; Create `utils/booking-quote.js`, `utils/card-holds.js`, `utils/rates.js`, `tests/booking-quote.test.js`.

**Interfaces — Produces:**
- `utils/rates.js`: `getUsdDopRate(): Promise<{rate:number,date:string,source:string}>` (extraída de `routes/rates.js`, misma caché de 1 h y `USD_DOP_RATE` manual; lanza si no hay tasa). `routes/rates.js` la usa.
- `utils/booking-quote.js`: `computeQuote(boatRow, body, now?: Date): {ok:true, total:number, additionals:string[], additionalsPrice:number, meta:string|null, guests:number} | {ok:false, status:number, error:string}` — pura, con **las mismas reglas y mensajes** que hoy tiene `POST /api/bookings` (turnos válidos, capacidad, combo solo Boca Chica, `isSlotClosed`, esquema `day_based`/paquetes/extras/comidas).
- `utils/card-holds.js`: `HOLD_MINUTES=15`; `SLOT_HOLDING_PAYMENT_STATUSES=['card_pending','submitted','verified']`; `expireCardHolds(db): Promise<number>` — pasa a `status='cancelled', payment_status='expired'` las `card_pending` con más de 15 min.
- Tabla `card_payments(id SERIAL PK, booking_id INT FK, order_number TEXT UNIQUE NOT NULL, amount_dop_cents BIGINT NOT NULL, itbis_dop_cents BIGINT NOT NULL, usd_total REAL NOT NULL, usd_dop_rate REAL NOT NULL, status TEXT DEFAULT 'created' /* created|approved|declined|cancelled|needs_review */, iso_code TEXT, response_message TEXT, authorization_code TEXT, rrn TEXT, azul_datetime TEXT, created_at, completed_at)`. Sin columnas de tarjeta.
- Columna `bookings.payment_method TEXT DEFAULT 'transfer'`. Índice `bookings_slot_active_idx` recreado con `payment_status IN ('card_pending','submitted','verified')`.

- [ ] **Paso 1: pruebas que fallan** (`tests/booking-quote.test.js`): para una embarcación `day_based` (precios entre semana/fin de semana y combo), una de paquetes (extras, personas extra, comidas) y una de precio fijo, `computeQuote` devuelve los totales actuales; turno inválido → `{status:400,error:'Turno inválido'}`; más personas que la capacidad → `Máximo N personas`; combo fuera de Boca Chica → 400; turno pasado → 400 con el mensaje actual. Copiar los casos de los valores que hoy da `routes/bookings.js:84-155`.
- [ ] **Paso 2:** `npm test` — Esperado: FALLA.
- [ ] **Paso 3:** extraer la lógica de precio y validación de `POST /` a `computeQuote` sin cambiar comportamiento; `POST /` la usa. Reemplazar las listas `('submitted','verified')` por `SLOT_HOLDING_PAYMENT_STATUSES` en `routes/boats.js:181` y `routes/bookings.js:90`, y llamar `expireCardHolds` al inicio de ambos. Las vistas de calendario admin (`231`, `246`) solo muestran `submitted`/`verified`: no cambian.
- [ ] **Paso 4:** migraciones en `database.js` (tabla, columna, índice) con el estilo `pool.query(...).catch(()=>{})` existente; `payment_status='card_pending'` cuenta para el tope de 3 pendientes por usuario.
- [ ] **Paso 5:** `npm test` PASA; arrancar `npm run dev` y crear una reserva por transferencia con el flujo actual (comprobante) — Esperado: sigue funcionando igual.
- [ ] **Paso 6:** commit `refactor: cotización compartida, retención de turno y tabla card_payments`.

### Tarea 3: Rutas AZUL (`routes/azul.js`) y endurecimiento del servidor

**Files:** Create `routes/azul.js`, `tests/azul-routes.test.js`; Modify `server.js` (montaje, CSP `form-action`, limitadores), `utils/email.js` (recibo al cliente y aviso admin).

**Interfaces — Consumes:** Tareas 1 y 2. **Produces (contrato HTTP para el front):**
- `GET /api/payments/azul/config` → `{enabled:boolean}` (`false` si falta `AZUL_MERCHANT_ID`/`AZUL_AUTH_KEY`).
- `POST /api/payments/azul/start` (`authRequired`, JSON con los mismos campos que `POST /api/bookings` menos `receipt`, más `accept_terms:true` obligatorio, `email_verified` obligatorio) → `{action:string, fields:Record<string,string>}`. Crea la reserva `card_pending` + fila `card_payments`; `OrderNumber` = `crypto.randomBytes` de 12 dígitos únicos (≤15 caracteres, solo dígitos). `action` = URL de producción principal si responde en ≤2 s (comprobación cacheada 60 s), si no la alterna; en `test` la URL de pruebas; `AZUL_PAYMENT_URL` solo si `NODE_ENV!=='production'`. Errores: tasa no disponible → 503 `No pudimos obtener la tasa del día; intenta de nuevo o paga por transferencia`.
- `GET /api/payments/azul/approved/:orderNumber`, `/declined/:orderNumber`, `/cancelled/:orderNumber` (sin sesión: la autenticidad la da el hash) → redirigen a `/pago-resultado.html?estado=aprobado|declinado|cancelado|revision&ref=VB-xxxx`.
- Reglas de `approved`: buscar por `orderNumber`; si no existe → resultado `revision` sin cambiar nada; `verifyResponseHash` falso o `Amount` ≠ `amount_dop_cents` o `isApproved` falso → no confirmar (queda `card_pending`, se registra `status='declined'` si `IsoCode` ≠ `00`); si ya `approved` → redirigir sin repetir efectos (idempotente); si es válido: `UPDATE bookings SET status='confirmed', payment_status='verified', payment_method='card'`, `card_payments.status='approved'` y datos de respuesta, correo de recibo al cliente y aviso al admin. Si el `UPDATE` choca con el índice único (23505) o la reserva ya expiró → `card_payments.status='needs_review'`, aviso urgente al admin, resultado `revision`.
- `declined`/`cancelled`: reserva → `status='cancelled', payment_status='rejected'` (declinada) o `'cancelled'`→ libera el turno; nunca depende solo del navegador para confirmar.
- Registros: solo `orderNumber`, `bookingRef`, `IsoCode`; nunca la query completa ni claves.

- [ ] **Paso 1: pruebas que fallan** (`tests/azul-routes.test.js`, funciones del manejador separadas del acceso a BD con un doble de `db`): hash válido y monto igual → confirma; hash válido y `Amount` distinto → no confirma; hash inválido → no confirma; segunda llamada aprobada idéntica → un solo `sendReceipt`; `IsoCode='05'` → declinada y libera el turno; `orderNumber` inexistente → `revision`; conflicto 23505 → `needs_review`.
- [ ] **Paso 2:** `npm test` — Esperado: FALLA.
- [ ] **Paso 3:** implementar `routes/azul.js` (manejadores exportados como funciones puras con `db`/`email` inyectados para poder probarlos) y montarlo en `server.js` antes del manejador 404.
- [ ] **Paso 4:** `server.js`: CSP `form-action 'self' https://pagos.azul.com.do https://contpagos.azul.com.do` (más `https://pruebas.azul.com.do` si `AZUL_ENV!=='prod'`); limitador estricto en `POST /api/payments/azul/start` (como `writeLimiter`) y en las rutas de retorno (30 por 15 min por IP). No se relaja ninguna otra directiva.
- [ ] **Paso 5:** `utils/email.js`: `sendCardReceipt(booking, user, payment)` (modelo de recibo: negocio, dirección, referencia, fecha, monto en RD$ y USD, últimos datos de la autorización: `AuthorizationCode`, `RRN`; nunca tarjeta) y `sendCardNeedsReview(booking, user, payment)` al admin. Escapar todo con `esc()`.
- [ ] **Paso 6:** `npm test` PASA. Commit `feat: rutas de pago AZUL con verificación de hash`.

### Tarea 4: Simulador local de AZUL y prueba de punta a punta

**Files:** Create `scripts/azul-sim.js`, `tests/e2e-azul.md` (guion de prueba manual con resultados); Modify `scripts/dev.js` (arrancar el simulador solo con `AZUL_ENV=test` y sin `NODE_ENV=production`), `.env.example`.

**Interfaces — Consumes:** contrato HTTP de la Tarea 3. **Produces:** servidor local en `http://localhost:4010/PaymentPage/` que (a) recibe el POST, (b) **valida el `AuthHash` de la petición con la clave de pruebas** y rechaza si no coincide, (c) muestra una página con botones «Aprobar», «Declinar», «Cancelar» (sin campos de tarjeta), (d) responde redirigiendo a `ApprovedUrl`/`DeclinedUrl`/`CancelUrl` con `OrderNumber, Amount, AuthorizationCode, DateTime, ResponseCode, IsoCode, ResponseMessage, ErrorDescription, RRN, AuthHash` firmados igual que AZUL.

- [ ] **Paso 1:** implementar el simulador con `http` + `utils/azul.js` (nunca con una copia del algoritmo).
- [ ] **Paso 2:** `.env` local de prueba con valores falsos (`AZUL_MERCHANT_ID=39038540035`, `AZUL_AUTH_KEY` aleatoria larga, `AZUL_ENV=test`, `AZUL_PAYMENT_URL=http://localhost:4010/PaymentPage/`); documentar en `.env.example` sin valores reales.
- [ ] **Paso 3:** `npm run dev` y probar con el navegador: aprobada → reserva `confirmed/verified` y calendario ocupado; declinada → turno liberado; cancelada → turno liberado; recargar la URL de aprobada → sin cambios; alterar el monto de la URL de retorno → no confirma; expirar 15 min (adelantando `created_at` en la BD local) → turno libre. Registrar resultados en `tests/e2e-azul.md`.
- [ ] **Paso 4:** commit `test: simulador AZUL y prueba de punta a punta local`.

### Tarea 5: Interfaz de pago y estados

**Files:** Modify `public/assets/js/boat.js` (`showModal`, `submitBooking`), `public/boat.html` (si hace falta contenedor), `public/assets/css/style.css`, `public/assets/js/dashboard.js`, `public/assets/js/main.js:78`, `public/assets/js/admin.js:75`; Create `public/pago-resultado.html`, `public/assets/js/pago-resultado.js`.

**Interfaces — Consumes:** `GET /api/payments/azul/config`, `POST /api/payments/azul/start` (Tarea 3).

- [ ] **Paso 1:** en `showModal` agregar selector «Tarjeta (AZUL)» / «Transferencia» (transferencia queda por defecto igual que hoy; la tarjeta solo aparece si `config.enabled`). Con tarjeta: total en USD **y en RD$ a la tasa del día** (ya se obtiene `/api/rates/usd-dop`), casilla obligatoria «Acepto los Términos y Condiciones y la Política de reembolsos» con enlaces, logos Visa, MasterCard, Verified by Visa y MasterCard ID Check, texto «Pagarás en el sitio seguro de AZUL; no guardamos tu tarjeta» y botón «Pagar con tarjeta» deshabilitado hasta marcar la casilla.
- [ ] **Paso 2:** `payWithCard(calc)`: `fetch POST /api/payments/azul/start` → crear en el DOM un `<form method="post" action=...>` con inputs `hidden` por cada campo de `fields` y enviarlo (sin `innerHTML` con datos del servidor); manejar errores con `window.VBR.toast`.
- [ ] **Paso 3:** `pago-resultado.html/js`: lee `estado` y `ref` (solo los valores `aprobado|declinado|cancelado|revision`, `ref` con `/^VB-\d+$/`), muestra mensaje y enlace a `/dashboard.html`; sin scripts en línea ni `innerHTML` con parámetros de la URL.
- [ ] **Paso 4:** etiquetas «Pago con tarjeta pendiente» (`card_pending`), «Pagado con tarjeta» (`verified` + `payment_method='card'`), «Expirado» en `dashboard.js`, `main.js`, `admin.js`; el admin no ofrece «Aprobar/Rechazar comprobante» para pagos con tarjeta.
- [ ] **Paso 5:** verificar en el navegador integrado a ancho de teléfono y de laptop (flujo con el simulador de la Tarea 4); sin errores en consola; CSP sin violaciones.
- [ ] **Paso 6:** commit `feat: pago con tarjeta en el checkout y pantalla de resultado`.

### Tarea 6: Requisitos del sitio exigidos por AZUL (páginas legales)

**Files:** Create `public/terminos.html`, `public/reembolsos.html`, `public/privacidad.html`, `public/seguridad-pagos.html`, `public/assets/img/pagos/` (visa.svg, mastercard.svg, verified-by-visa.svg, mastercard-idcheck.svg); Modify el pie de `public/index.html`, `boat.html`, `embarcaciones.html`, `ventas.html`, `dashboard.html`, `auth.html`; `routes/seo.js` (sitemap/etiquetas de las páginas nuevas).

- [ ] **Paso 1:** páginas con el mismo diseño del sitio, en español: nombre comercial «VENDO BOTE RD»; descripción de servicios; política de devoluciones, reembolsos y cancelaciones (visible antes de pagar); política de entrega/servicio (turno, horarios, hora de RD); política de privacidad; política de seguridad en la transmisión de datos de tarjeta (pago en AZUL, HTTPS, 3D Secure, no almacenamos tarjetas, PCI DSS); moneda DOP/RD$; contacto (correo `ADMIN_EMAIL`, WhatsApp +1 407 361 4042, Instagram @vendobote_rd).
- [ ] **Paso 2:** pie común con enlaces a las 4 páginas, dirección permanente del comercio incluido el país, correo, teléfono y logos Visa/MasterCard; logos Verified by Visa y MasterCard ID Check en la página principal, en `seguridad-pagos.html` y en el checkout.
- [ ] **Paso 3:** **datos que solo el dueño puede dar** — la dirección permanente, la política exacta de reembolso y el texto legal. Dejar el marcador literal `[COMPLETAR-DUEÑO]` y que `npm test` incluya una prueba (`tests/no-placeholders.test.js`) que falle si algún HTML de `public/` lo contiene: así no puede llegar a producción.
- [ ] **Paso 4:** los logos SVG son versiones simples hechas a mano; avisar al dueño que deben sustituirse por los oficiales que entrega AZUL/las marcas antes de certificar.
- [ ] **Paso 5:** revisar en navegador (teléfono y laptop), sin scripts en línea; commit `feat: páginas legales y logos exigidos por AZUL`.

### Tarea 7: Documento PCI/seguridad y revisión final

**Files:** Create `docs/seguridad/pci-dss-saq-a.md`; Modify `.env.example`.

- [ ] **Paso 1:** documento que mapea los 12 requisitos PCI DSS del manual a lo que cumple el código (HTTPS/HSTS de Railway y helmet, sin datos de tarjeta, cabeceras y CSP, control de acceso y sesiones, registros sin datos sensibles, `npm audit`, pruebas) y lo que es responsabilidad del dueño (cuestionario SAQ A de AZUL, políticas internas, contraseñas del panel de Railway/GitHub con 2FA, certificación AZUL).
- [ ] **Paso 2:** `npm audit --omit=dev` — Esperado: 0 vulnerabilidades altas/críticas; corregir si aparecen.
- [ ] **Paso 3:** revisión de seguridad independiente del diff completo (skill `security-review` y `code-review` nivel alto) y corregir hallazgos.
- [ ] **Paso 4:** `npm test` y prueba de punta a punta de la Tarea 4 otra vez.
- [ ] **Paso 5:** commit `docs: cumplimiento PCI DSS y revisión de seguridad`.

---

## Orden y paralelismo
- Primero **Tarea 1** y **Tarea 2** (archivos distintos, en paralelo); después **Tarea 3**; **Tarea 4** y **Tarea 5** en paralelo tras la 3; **Tarea 6** puede ir en paralelo desde el inicio; **Tarea 7** al final.
- Un archivo, un agente: ninguna tarea comparte archivos con otra que corra al mismo tiempo (`server.js` solo en Tarea 3; `style.css` en Tareas 5 y 6 → la 6 va primero o en secuencia).

## Despliegue (tras verificar todo en local)
1. Local: pruebas y flujo de punta a punta pasan.
2. GitHub: push a `main` y comprobar mismo commit.
3. Railway: cargar `AZUL_*` (primero `AZUL_ENV=test` con las credenciales de pruebas de AZUL), desplegar desde GitHub, revisar logs y sitio. Pasar a `prod` solo después de la certificación de AZUL.

## Revisión propia del plan
- Cobertura: hash y montos (T1), retención/cotización/tasa (T2), verificación/idempotencia/CSP/limitadores/correos (T3), pruebas locales (T4), checkout/estados/3DS-logos (T5), requisitos del sitio (T6), PCI y revisión (T7).
- Pendiente que no depende del código: credenciales de AZUL, dirección y política de reembolso del dueño, ITBIS (se asume exento, `AZUL_ITBIS_RATE=0`; confirmar con tu contador/AZUL), certificación.
