# Cumplimiento PCI DSS (SAQ A) — VENDO BOTE RD

Estado al 2026-11-20. Este documento mapea los 12 requisitos PCI DSS (los que lista el manual de AZUL) contra lo que el código y la infraestructura hacen hoy, y contra lo que es responsabilidad del dueño.

**Honestidad ante todo:** aquí solo se marca "Cumple" lo que se verificó leyendo el código del repositorio. Lo que depende de personas, cuentas o paneles externos figura como "Del dueño" o "Pendiente". Este documento no sustituye el cuestionario SAQ A que debe completar y firmar el dueño con AZUL, ni la certificación de AZUL.

## Por qué corresponde SAQ A

El sitio usa la **Página de Pago de AZUL** (redirección): el cliente escribe su tarjeta en el sitio de AZUL, no en el nuestro. El servidor **nunca** recibe, procesa, transmite ni almacena número de tarjeta, vencimiento, nombre del titular ni CVV. Por eso aplica el cuestionario más corto (SAQ A), con los requisitos reducidos que le tocan a un comercio que tercerizó todo el entorno de datos de tarjeta. Condición para mantenerlo: **no** cambiar a un formulario de tarjeta propio ni a campos de tarjeta nuestros incrustados.

Leyenda: **Cumple** = verificado en código/infra · **Parcial** = hay base técnica pero falta algo · **Pendiente** = no verificado o no hecho · **Del dueño** = lo hace una persona, no el código.

---

## Datos de tarjeta: dónde NO pasan

```
Navegador del cliente
   |  1) POST /api/payments/azul/start  (JSON con datos de la RESERVA: barco, fecha, turno; sin tarjeta)
   v
Servidor (routes/azul.js, startPayment)
   |  2) Calcula el monto, crea la reserva 'card_pending' y el registro card_payments,
   |     devuelve { action, fields } con campos firmados (HMAC-SHA512, utils/azul.js)
   v
Navegador del cliente --- 3) formulario HTML POST ---> Página de Pago de AZUL
                                                       (AQUÍ y solo aquí se escribe la tarjeta;
                                                        3D Secure lo gestiona AZUL y el emisor)
   ^
   |  4) AZUL redirige (GET) a /api/payments/azul/{approved|declined|cancelled}/:orderNumber
   |     con: OrderNumber, Amount, AuthorizationCode, DateTime, ResponseCode, IsoCode,
   |     ResponseMessage, ErrorDescription, RRN, AuthHash
   v
Servidor (routes/azul.js, handleReturn): verifica AuthHash, OrderNumber y Amount; confirma la reserva
```

Lo que el servidor guarda de AZUL (tabla `card_payments`, `database.js`): número de orden propio, montos en centavos, `iso_code`, `response_message`, `authorization_code`, `rrn`, fecha de AZUL y estado. **Ninguno es dato de titular de tarjeta ni dato sensible de autenticación.**

Lo que NO existe en el código: ningún campo, columna, variable ni registro de PAN, vencimiento, CVV, pista magnética o PIN. Ninguna ruta del servidor lee esos valores. La `AuthKey` y el `AuthHash` nunca se escriben en registros: las llamadas a `console.*` de `routes/azul.js` solo emiten `orderNumber`, `bookingRef`, `IsoCode` y mensajes de error.

Los campos que llegan por la URL de retorno se filtran con una lista blanca (`RESPONSE_FIELDS` en `routes/azul.js`) y se acotan antes de guardarse (`cleanIso`, `cleanText`).

---

## Los 12 requisitos

### Requisito 1 — Instalar y mantener un firewall que proteja los datos del titular

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | No hay red propia con datos de tarjeta que proteger: la app corre en Railway (plataforma gestionada) y la tarjeta solo se captura en AZUL. En el código, CORS en producción se limita a `SITE_URL` (`server.js`) y `trust proxy` se activa solo en producción. La base de datos se usa solo desde el servidor con `DATABASE_URL` (`database.js`). |
| Estado | Cumple en el código; el firewall de red lo aporta Railway |
| Del dueño | Confirmar en Railway que la base de datos no queda expuesta públicamente más de lo necesario (el "Public URL / TCP Proxy" se activa solo para consultas puntuales y se desactiva después). Dejarlo asentado en el SAQ A. |

### Requisito 2 — No usar contraseñas ni parámetros de seguridad por defecto del proveedor

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | En producción el servidor no arranca sin `SESSION_SECRET` propio (`utils/session.js`). Las credenciales de AZUL, base de datos y correo salen de variables de entorno; `.env.example` solo trae marcadores vacíos. `AZUL_PAYMENT_URL` (simulador local) se ignora con `NODE_ENV=production` (`routes/azul.js`, `server.js`). El pago con tarjeta se desactiva solo (HTTP 503) si faltan `AZUL_MERCHANT_ID` o `AZUL_AUTH_KEY`. |
| Estado | Cumple en el código |
| Del dueño | Cambiar cualquier contraseña inicial de Railway, GitHub, correo y demás servicios por contraseñas únicas y largas. Usar la `AuthKey` de producción que entrega AZUL (distinta de la de pruebas). |

### Requisito 3 — Proteger los datos del titular que fueron almacenados

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | No se almacena ningún dato de titular de tarjeta (ver "Dónde NO pasan"). El esquema `card_payments` (`database.js`) no tiene PAN, vencimiento ni CVV. El correo de recibo (`sendCardReceipt` en `utils/email.js`) usa solo código de autorización, RRN y fecha. |
| Estado | Cumple (por no almacenar) |
| Del dueño | No pedir ni copiar datos de tarjeta por WhatsApp, correo, teléfono ni notas de reserva; si un cliente los envía, borrarlos. Aviso: el sitio también guarda comprobantes de transferencia y documentos de identidad en `uploads/` (disco del servidor). No son datos de tarjeta, pero sí datos personales y financieros: su retención y respaldo son decisión del dueño. |

### Requisito 4 — Cifrar la transmisión de datos en redes públicas abiertas

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | Railway sirve el sitio por HTTPS. `helmet` (`server.js`) activa `Strict-Transport-Security`. La cookie de sesión lleva `Secure` en producción (`utils/session.js`). El inicio de pago se rechaza si `SITE_URL` de producción no es `https://` (`routes/azul.js`). La CSP limita `form-action` a los dominios de AZUL (`server.js`), de modo que un script inyectado no puede enviar el formulario a otro destino. La tarjeta viaja del navegador directo a AZUL. |
| Estado | Cumple en el código; el certificado y la terminación HTTPS son de Railway |
| Del dueño | Verificar en vivo, tras conectar el dominio, que hay candado válido y redirección de HTTP a HTTPS. Nota técnica: por defecto la conexión a Postgres usa SSL con `rejectUnauthorized: false` en producción (`database.js`): cifra, pero no valida el certificado; aceptable dentro de la red privada de Railway. **Para validarlo**: definir `DB_SSL_CA` (PEM de la CA) o `DB_SSL_REJECT_UNAUTHORIZED=1` en Railway (ver `.env.example`); sin ellas se mantiene el comportamiento anterior. |

### Requisito 5 — Usar y actualizar programas antivirus

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | El servidor es un contenedor gestionado por Railway, sin acceso de usuarios finales. `utils/filecheck.js` valida los archivos que se suben. No hay antivirus propio en el servidor. |
| Estado | Parcial / mayormente no aplica al servidor |
| Del dueño | Mantener antivirus y sistema operativo actualizados en los equipos desde los que se administra el sitio. Es un punto típico del SAQ A. |

### Requisito 6 — Desarrollar y mantener sistemas y aplicaciones seguros

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | `npm audit --omit=dev`: **0 vulnerabilidades** (2026-11-20). Pruebas automáticas: `tests/azul.test.js` (hash y montos), `tests/azul-routes.test.js` (verificación, idempotencia, monto, estados), `tests/booking-quote.test.js`; guion de punta a punta en `tests/e2e-azul.md`. `helmet` y CSP estricta en `server.js` (scripts solo del propio sitio y de Google, `object-src 'none'`, `base-uri 'self'`, `script-src-attr 'none'`). Consultas SQL parametrizadas en `routes/azul.js`. Verificación HMAC-SHA512 con comparación de tiempo constante (`utils/azul.js`). El manejador global de errores nunca expone la traza al cliente (`server.js`). |
| Estado | Cumple en el código |
| Pendiente | La CSP permite `style-src 'unsafe-inline'` (las páginas usan estilos en línea); aceptado y comentado en `server.js`. La revisión de seguridad independiente del diff completo (Tarea 7, paso 3) la hace el controlador; su resultado va aparte. |
| Del dueño | Aplicar actualizaciones de dependencias con regularidad (`npm audit` antes de cada despliegue). |

### Requisito 7 — Restringir el acceso a los datos según la necesidad de saber

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | Rutas de administración protegidas con `adminRequired` (rol `admin`, `middleware/auth.js`; por ejemplo `/api/admin/stats` en `server.js`). Iniciar un pago exige sesión (`authRequired` en `/api/payments/azul/start`). Los comprobantes de pago no se sirven como archivos públicos, solo autenticados (comentario en `server.js`). Como el servidor no tiene datos de tarjeta, no hay datos de tarjeta que restringir. |
| Estado | Cumple en el código |
| Del dueño | Mantener la lista de administradores al mínimo y revocar accesos (Railway, GitHub, correo, portal AZUL) cuando un colaborador se va. |

### Requisito 8 — Identificar y autenticar el acceso a los componentes del sistema

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | Contraseñas de usuarios con `scrypt` y sal aleatoria (`utils/session.js`), mínimo 8 caracteres (`routes/auth.js`). Cookie de sesión `HttpOnly`, `SameSite=Lax`, `Secure` en producción, firmada con HMAC-SHA256 y con vencimiento a 30 días. Cambiar o restablecer la contraseña invalida las otras sesiones (`sessionVersion`); "Cerrar sesión" revoca el token (`revoked_sessions`, `middleware/auth.js`). Límite de intentos en login, registro y recuperación (`authLimiter`, `server.js`). Correo verificado obligatorio para pagar con tarjeta (`email_unverified` en `routes/azul.js`). **2FA TOTP obligatorio para administradores** (RFC 6238, `utils/totp.js`): el secreto se guarda cifrado con AES-256-GCM (clave derivada de `SESSION_SECRET`), un admin sin 2FA solo puede configurarlo (`adminRequired` responde 403 `totp_setup_required`), el login pide el código antes de emitir la sesión (también con Google o restablecer contraseña), un código no se puede reutilizar, hay 10 códigos de recuperación de un solo uso (guardados con hash), límite estricto de intentos y bloqueo de 15 min por cuenta tras 5 códigos fallidos. Desactivar o regenerar exige contraseña y código. |
| Estado | Cumple en el código para las cuentas del sitio |
| Pendiente | Nada en el código: el 2FA del panel ya es obligatorio (ver abajo). |
| Del dueño | **Activar 2FA** en GitHub, Railway, el correo y el portal de AZUL. Contraseñas únicas en un gestor. No compartir la `AuthKey` por chat ni correo. |

### Requisito 9 — Restringir el acceso físico a los datos del titular

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | No hay datos de tarjeta en equipos propios ni en papel; el centro de datos es el de Railway y AZUL. |
| Estado | Del dueño (el resto se hereda de los proveedores) |
| Del dueño | Proteger los equipos y teléfonos con los que se administra el sitio (bloqueo de pantalla, disco cifrado). No anotar datos de tarjeta en papel. Guardar la documentación de conformidad de los proveedores si el cuestionario la pide. |

### Requisito 10 — Rastrear y supervisar todos los accesos a los recursos y a los datos

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | `routes/azul.js` registra los eventos relevantes del pago con `orderNumber`, `bookingRef` e `IsoCode` (aprobado, no verificado, monto distinto, pago por revisar, orden desconocida) y **no** registra `AuthKey`, `AuthHash`, tarjetas ni datos del cliente. Cada pago queda en `card_payments` con estado, códigos de AZUL, `created_at` y `completed_at`. Los registros se consultan en los logs de Railway. **Registro de auditoría de acciones administrativas** (`audit_log`, `utils/audit.js`): inicio de sesión de admin (correcto y fallido), verificar o rechazar pagos, eliminar reservas, crear/editar/desactivar/eliminar embarcaciones, ver comprobantes, activar/desactivar el 2FA; guarda quién, qué, sobre qué registro, IP y fecha, y nunca contraseñas, secretos, códigos ni tarjetas. Se ve en el panel (Registro de actividad, últimos 200) y en `GET /api/admin/audit`. |
| Estado | Parcial |
| Pendiente | No hay alertas automáticas ante fallos repetidos. La retención de logs depende del plan de Railway. |
| Del dueño | Definir cuánto tiempo guardar los logs (ver "Operación") y revisarlos tras cada incidente. |

### Requisito 11 — Probar con regularidad los sistemas y procesos de seguridad

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | Pruebas automáticas (`npm test` = `node --test "tests/*.test.js"`) y guion de punta a punta con simulador local de AZUL (`tests/e2e-azul.md`, resultado 38/38 registrado). `npm audit --omit=dev` limpio. Nota: `tests/no-placeholders.test.js` falla a propósito mientras queden marcadores `[COMPLETAR-DUEÑO]` en las páginas legales; es el seguro para no publicar con textos incompletos. |
| Estado | Parcial |
| Pendiente | No hay prueba de intrusión ni escaneo externo de vulnerabilidades. Si AZUL exige escaneo trimestral (ASV) para el caso, confirmarlo con ellos. |
| Del dueño | Pasar la certificación de pruebas de AZUL (ambiente `test`) antes de usar `AZUL_ENV=prod`. Repetir `npm audit` y las pruebas antes de cada despliegue. |

### Requisito 12 — Mantener una política de seguridad de la información para todo el personal

| Aspecto | Detalle |
|---|---|
| Qué cumple hoy | Existen las páginas públicas que exige AZUL: `public/seguridad-pagos.html` (política de transmisión de datos de tarjeta), `public/privacidad.html`, `public/terminos.html` y `public/reembolsos.html` (todas con marcadores `[COMPLETAR-DUEÑO]` por resolver). Este documento sirve de base técnica. |
| Estado | Pendiente (depende del dueño) |
| Del dueño | Completar y firmar el cuestionario **SAQ A** de AZUL. Escribir una política interna breve (quién accede, qué hacer ante un incidente, a quién avisar). Dirección física del negocio en `BUSINESS_ADDRESS` y en los textos legales. Política de reembolsos real. **Logos oficiales** de AZUL, Visa, Mastercard, Verified by Visa y Mastercard ID Check en la página principal, la política de seguridad y el checkout (el manual los exige). **Confirmar el ITBIS** con el contador o AZUL (por defecto `AZUL_ITBIS_RATE=0.18`, 18 %, ya aplicado a los pagos con tarjeta; la transferencia no lleva ITBIS). |

---

## Resumen: qué falta antes de pasar a producción

1. Credenciales de AZUL de pruebas y luego de producción (`AZUL_MERCHANT_ID`, `AZUL_MERCHANT_NAME`, `AZUL_AUTH_KEY`).
2. Cuestionario SAQ A completado y firmado; certificación de AZUL (flujo de pruebas aprobado).
3. 2FA en GitHub, Railway, correo y portal de AZUL, y activar el 2FA del panel del sitio con la cuenta de administrador (primer ingreso tras el despliegue).
4. Reemplazar todos los `[COMPLETAR-DUEÑO]` (dirección, textos legales, política de reembolsos) y comprobar que `tests/no-placeholders.test.js` pase.
5. Colocar los logos oficiales exigidos.
6. Confirmar el ITBIS.
7. Pasar a `AZUL_ENV=prod` solo después de la certificación.

---

## Variables de entorno de pago

Se configuran en Railway (nunca en el repositorio); `.env.example` solo documenta los nombres.

| Variable | Para qué sirve | Notas |
|---|---|---|
| `AZUL_MERCHANT_ID` | Identificador del comercio entregado por AZUL | Sin él, el pago con tarjeta se desactiva |
| `AZUL_MERCHANT_NAME` | Nombre del comercio que ve el cliente | Por defecto "VENDO BOTE RD" |
| `AZUL_AUTH_KEY` | Clave secreta para firmar y verificar (HMAC-SHA512) | **Secreta.** Nunca en el repositorio, chat ni logs |
| `AZUL_ENV` | `test` (pruebas.azul.com.do) o `prod` (pagos.azul.com.do, con respaldo contpagos.azul.com.do) | Empezar en `test` |
| `AZUL_ITBIS_RATE` | Tasa de ITBIS como fracción (0.18 = 18 %) | Por defecto 0.18 (18 %): se suma al monto del pago con tarjeta y va en el campo `ITBIS` de AZUL; la transferencia no lo lleva |
| `AZUL_PAYMENT_URL` | Solo desarrollo: URL del simulador local | Se ignora en producción |
| `BUSINESS_ADDRESS` | Dirección física del negocio (la exige AZUL) | Del dueño |
| `SITE_URL` | URL pública https; base de las URL de retorno | En producción debe ser `https://`, si no el pago se rechaza |
| `SESSION_SECRET` | Firma de sesiones | Obligatorio en producción |

---

## Operación

### Rotar la AuthKey
1. Pedir a AZUL la nueva AuthKey (o generarla desde su portal si lo permite) y acordar el momento del cambio.
2. Actualizar `AZUL_AUTH_KEY` en Railway y redesplegar. Hacerlo en horas de poco tráfico: los pagos en curso firmados con la clave anterior volverán con un hash que ya no verifica y quedarán en revisión.
3. Probar un pago de bajo monto (primero en `test` si es posible) y revisar los logs.
4. Rotar de inmediato si la clave se filtró (chat, correo, captura, repositorio) y revisar los pagos recientes.

### Qué hacer ante un pago en `needs_review`
Significa que AZUL cobró (o parece haber cobrado) pero el sistema no pudo asignarlo a la reserva: turno vencido o tomado por otro, monto distinto o aprobación llegada por una ruta de rechazo. El cliente ve el estado "revisión" y el administrador recibe un correo (`sendCardNeedsReview`).
1. Buscar el pago en `card_payments` por `order_number` (viene en el correo y en los logs: `AZUL: pago por revisar orderNumber=... bookingRef=...`).
2. Confirmar la transacción en el portal de AZUL (código de autorización y RRN).
3. Decidir con el cliente: si el turno sigue libre, confirmar la reserva manualmente; si no, **reembolsar** desde el portal de AZUL y avisarle.
4. No reintentar cobros ni pedir datos de tarjeta por otros medios.

### Reembolsos desde el portal de AZUL
Los reembolsos y anulaciones se hacen desde el portal de AZUL; el sistema no los ejecuta. Anotar el RRN y el código de autorización de `card_payments` para localizar la transacción, hacer la devolución en el portal y cancelar la reserva en el panel de administración. Aplicar la política de `public/reembolsos.html`.

### Qué guardar de los logs
- **Guardar** (sirven para conciliar y auditar): `orderNumber`, `bookingRef`, `IsoCode`, `authorization_code`, `rrn`, fechas y estados (ya están en `card_payments`, sin datos de tarjeta).
- **Nunca guardar ni pegar en tickets o chats:** `AZUL_AUTH_KEY`, `AuthHash`, números de tarjeta, CVV.
- Exportar a un lugar propio los logs de Railway relacionados con pagos si se necesita más retención que la del plan, y fijar un plazo (por ejemplo 12 meses) en la política interna.
- Si aparece un dato de tarjeta en cualquier registro, borrarlo y tratarlo como incidente.
