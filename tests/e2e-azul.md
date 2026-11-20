# Prueba de punta a punta: pago con tarjeta AZUL (local)

Guion automatizado: `node scripts/e2e-azul.js`. Levanta el simulador (puerto 4010) y `node server.js` (PORT 3011) con
variables en línea contra la Postgres local (`postgresql://postgres:postgres@localhost:54329/vendobote`), crea
usuarios de prueba (`e2e-azul-*@test.invalid`, correo verificado) directamente en la base, firma la cookie de sesión con
`SESSION_SECRET`, recorre los escenarios por la API (sin navegador; los correos no salen: `EMAIL_USER` vacío) y borra
todo lo que creó. La tasa se fija con `USD_DOP_RATE=58.5` para no depender de internet.

## Estado de la ejecución

**PENDIENTE.** El 20-nov-2026 la Postgres local del puerto 54329 dejó de responder: su proceso principal
(PID 22860) ya no existe y un proceso `io_worker` huérfano (PID 18676) mantiene el puerto en escucha sin atender, por lo
que toda conexión caduca (también la del servidor viejo del puerto 3000). Liberarlo exige matar un proceso que no es
de esta tarea y reiniciar la base (`node scripts/dev-db.js`); no se hizo. Verificado sin base de datos: el simulador
(petición alterada/campo faltante → 400, hashes de respuesta válidos con `verifyResponseHash`, modos `hash`, `amount`
y `amountforged`).

## Escenarios que ejecuta el guion (esperado)

| # | Qué se hace | Esperado |
|---|---|---|
| 1 | `/start` sin sesión | 401 |
| 2 | `/start` sin `accept_terms` (y con `"true"` como texto) | 400 |
| 3 | `/start` con correo sin verificar | 403 `email_unverified` |
| 4 | Simulador recibe petición con monto alterado / campo faltante / AuthHash falso | 400 en los tres casos |
| 5 | Petición legítima | Página con 3 botones y sin campos de tarjeta |
| 6 | Aprobar → URL de retorno | `estado=aprobado`; reserva `confirmed/verified/card`, pago `approved`, IsoCode 00; turno ocupado en `/api/boats/:id/availability`; un solo log "pago aprobado" |
| 7 | Repetir la URL aprobada | Sin cambios (mismo `completed_at`), sin segundo log (sin segundo correo) |
| 8 | Otro usuario sobre turno confirmado / con `card_pending` | 409 |
| 9 | Declinar | `estado=declinado`; reserva `cancelled/rejected`; pago `declined` (05); turno libre; otro usuario puede reservarlo |
| 10 | Cancelar | `estado=cancelado`; `cancelled/cancelled`; turno libre |
| 11 | Monto distinto con hash válido (`?tamper=amount`) | `revision`; no confirma; pago `needs_review` |
| 12 | Monto cambiado tras firmar (`?tamper=amountforged`) | `revision`; no confirma |
| 13 | Hash corrupto (`?tamper=hash`), respuesta falsificada a mano, URL aprobada sin parámetros | `revision`; sigue `pending/card_pending` |
| 14 | Adelantar `created_at` 16 min | Turno libre en availability; reserva `cancelled/expired`; otro usuario puede reservar |
| 15 | Aprobación tardía tras expirar | `needs_review`; la reserva NO se confirma |
| 16 | `GET /config`; logs sin AuthKey ni hashes de 128 hex | `enabled:true`; sin secretos |

## Resultados

Sin ejecutar todavía (ver "Estado"). Al correr el guion, pegar aquí la salida (`OK`/`FALLA` por comprobación).

---

## Resultado de la ejecución (2026-11-20)

Comando: `E2E_DB_URL=postgresql://postgres:postgres@localhost:54341/vendobote node scripts/e2e-azul.js`
(base Postgres local temporal y vacía; la de 54329 había quedado colgada por procesos huérfanos).

**38/38 comprobaciones correctas, 0 fallos.** Cubre: sin sesión 401; sin `accept_terms` 400; correo sin verificar 403;
aprobada → confirmada y turno ocupado; URL aprobada repetida sin efectos ni segundo correo; segundo usuario 409;
declinada y cancelada liberan el turno; monto alterado con hash válido → `needs_review`; monto o hash alterado,
respuesta falsificada a mano y URL sin parámetros → no confirman; retención de 15 min y expiración;
aprobación tardía tras expirar → `needs_review`; los logs no contienen la AuthKey ni AuthHash completos.
