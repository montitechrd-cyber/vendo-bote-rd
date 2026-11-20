# Prueba de punta a punta: pago con tarjeta AZUL (local)

Guion automatizado: `E2E_DB_URL=postgresql://postgres:postgres@localhost:54341/vendobote node scripts/e2e-azul.js`
(sin `E2E_DB_URL` usa la local de desarrollo, puerto 54329; el guion se niega a conectarse a un host que no sea localhost).

Levanta el simulador (4010) y varios `node server.js` con variables en línea: el principal (3011), uno con tasa
fuera de rango y `AZUL_START_LIMIT=3` (3012), una app mínima con `NODE_ENV=production` y `AZUL_ENV=test` (3013) y uno con
`RAILWAY_ENVIRONMENT` sin `NODE_ENV` (3014). Crea usuarios de prueba (`e2e-azul-*@test.invalid`, correo verificado; uno
admin) directamente en la base, firma la cookie de sesión con `SESSION_SECRET`, recorre los escenarios por la API (sin
navegador; los correos no salen: `EMAIL_USER` vacío, así que el aviso al admin se comprueba en el log) y borra todo lo que
creó. La tasa se fija con `USD_DOP_RATE=58.5`. Como solo puede haber una retención con tarjeta activa por usuario, cada
escenario usa su propio usuario. El job de expiración corre cada 2 s (`CARD_EXPIRY_INTERVAL_MS`).

## Escenarios (esperado)

| # | Qué se hace | Esperado |
|---|---|---|
| 1 | `/start` sin sesión; sin `accept_terms` (y con `"true"` como texto); correo sin verificar | 401; 400; 403 `email_unverified`; sin reservas creadas |
| 2 | Simulador recibe monto alterado / campo faltante / AuthHash falso; petición legítima | 400 en los tres; página con 3 botones sin campos de tarjeta. Los campos firmados llevan `ShowTransactionResult=0`. Con tasa 58.5, `Amount` = base + ITBIS 18 % (p. ej. 500 USD → base 29250.00, ITBIS 5265.00, total 34515.00 → `Amount=3451500`, `ITBIS=526500`) y `card_payments` guarda el total en `amount_dop_cents` y el impuesto en `itbis_dop_cents` |
| 3 | Aprobar → URL de retorno; repetir la URL | `aprobado`; `confirmed/verified/card`, pago `approved`, IsoCode 00; un solo log "pago aprobado"; la repetición no cambia nada |
| 4 | Otro usuario sobre turno confirmado o con `card_pending` | 409 |
| 5 | Declinar; cancelar | `declinado` (`cancelled/rejected`, pago `declined`, 05); `cancelado`; turno libre y otro usuario puede reservarlo |
| 6 | Monto distinto con hash válido; monto cambiado tras firmar | `revision`; no confirma; pago `needs_review` / sin confirmar (también una respuesta con el monto sin ITBIS) |
| 7 | Hash corrupto, respuesta falsificada a mano, URL sin parámetros | `revision`; sigue `pending/card_pending` |
| 8 | Adelantar `created_at` 16 min | El turno sale libre en availability al instante (sin depender del job); el job expira la reserva sola (`cancelled/expired`), el cobro pasa a `expired_unconfirmed` y el log registra el aviso (referencia/orden) |
| 9 | `GET /api/payments/azul/admin/review` | admin 200 con el cobro `expired_unconfirmed` y sin datos sensibles; usuario normal 403; sin sesión 401 |
| 10 | Aprobación tardía tras expirar | `needs_review`; la reserva NO se confirma |
| 11 | Segundo `/start` del mismo usuario | 409 "Ya tienes un pago con tarjeta en curso..." |
| 12 | 20 `/start` en paralelo del mismo usuario (turnos distintos) | Exactamente 1 `200` y 1 reserva `card_pending` (19 `409`) |
| 13 | 5 pagos iniciados y cancelados en el día; el sexto | 429 |
| 14 | `DELETE /api/bookings/:id` (admin) con pago `needs_review` o `approved` / con pago declinado | 409 y el cobro sigue en la base / 200 y se borra |
| 15 | `verify-payment` approve/reject sobre reserva con tarjeta (confirmada y `card_pending`) | 400 y no cambia nada |
| 16 | Tasa 0.58 (`USD_DOP_RATE` fuera de rango); 4.º `/start` con `AZUL_START_LIMIT=3` | 503 sin crear reserva; 429 |
| 17 | `NODE_ENV=production` con `AZUL_ENV=test`; `RAILWAY_ENVIRONMENT` sin `NODE_ENV` | `/start` 503 sin reserva y `/config` `enabled:false`; el servidor fuerza `production` y avisa |
| 18 | `GET /config`; logs sin AuthKey ni hashes de 128 hex | `enabled:true`; sin secretos |
| 19 | Pasar de 300 peticiones a las rutas de retorno desde la misma IP | 302 a `/pago-resultado.html?estado=revision` (no JSON 429) |

## Resultado de la ejecución (2026-11-20, tras las correcciones de la revisión de seguridad)

Comando: `E2E_DB_URL=postgresql://postgres:postgres@localhost:54341/vendobote node scripts/e2e-azul.js`
(base Postgres local temporal).

**59/59 comprobaciones correctas, 0 fallos.** Datos de prueba borrados (0 usuarios `e2e-azul-*` restantes).
La migración `card_payments.booking_id` → `ON DELETE RESTRICT` se comprobó además forzando `CASCADE` y ejecutando
`init()` dos veces: queda en `RESTRICT` y no falla.
