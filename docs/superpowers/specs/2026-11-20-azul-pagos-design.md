# Pagos con tarjeta mediante AZUL (Página de Pago) — Diseño

Fecha: 2026-11-20 · Estado: aprobado por el usuario (enfoque, tarjeta junto a transferencia, tasa del día).

## Intención y por qué
Aceptar pagos con tarjeta en VENDO BOTE RD con la Página de Pago de AZUL (Banco Popular), cumpliendo lo que exige el manual
"E-commerce AZUL — Página de Pagos (2023-08)" y PCI DSS. El cliente paga en el sitio de AZUL: este servidor nunca ve ni guarda datos de tarjeta.

## Metas
- Cobro con tarjeta como opción nueva; transferencia/Zelle se conserva sin cambios.
- Monto calculado siempre en el servidor; `AuthHash` HMAC-SHA512 en el envío y verificación del hash de la respuesta.
- Reserva confirmada solo con respuesta aprobada y hash válido; respuestas repetidas no se aplican dos veces.
- Cumplir requisitos del sitio de AZUL (términos con casilla en el pago, reembolsos, privacidad, seguridad de datos de tarjeta, dirección, contacto, logos Visa/MasterCard, modelo de recibo).

## No-metas / anti-metas
- No pedir, recibir, guardar ni registrar en logs números de tarjeta, CVV ni vencimiento.
- No quitar la transferencia. No usar DataVault, cuotas, DCC, PayPal ni HOLD/POST/VOID (fuera de alcance).
- Anti-meta: marcar una reserva como pagada por una URL de retorno sin hash válido.

## Restricciones
- AZUL cobra en RD$ (DOP); el sitio muestra USD. Conversión con la tasa del día (`/api/rates/usd-dop`), la tasa usada se guarda con la reserva.
- Formato AZUL: `Amount` e `ITBIS` sin punto ni coma, dos últimos dígitos son decimales (ITBIS "000" si exento).
- URLs: prueba `https://pruebas.azul.com.do/PaymentPage/`; producción `https://pagos.azul.com.do/PaymentPage/Default.aspx` con alterna `https://contpagos.azul.com.do/PaymentPage/Default.aspx`. El POST lo ejecuta el navegador del cliente.
- `ApprovedUrl/DeclinedUrl/CancelUrl` deben estar en el hostname autorizado del comercio.
- `AltMerchantName` ≤25 caracteres sin `"` ni `\` (y sin `'`).
- Hash del envío: MerchantId+MerchantName+MerchantType+CurrencyCode+OrderNumber+Amount+ITBIS+ApprovedUrl+DeclinedUrl+CancelUrl+UseCustomField1+CustomField1Label+CustomField1Value+UseCustomField2+CustomField2Label+CustomField2Value+AuthKey, cadena UTF-16LE, HMAC-SHA512 con la AuthKey, hex en minúsculas.
- Hash de la respuesta: OrderNumber+Amount+AuthorizationCode+DateTime+ResponseCode+IsoCode+ResponseMessage+ErrorDescription+RRN+AuthKey (UTF-16LE, HMAC-SHA512).
- Credenciales (MerchantId, AuthKey) las entrega AZUL; viven solo en variables de entorno y se documentan en `.env.example`. Sin credenciales reales: construir y probar con valores simulados; producción requiere certificación de AZUL.
- El `OrderNumber` es único por intento de pago.

## Enfoques considerados
1. **(Elegido)** Tarjeta como método adicional: el servidor crea la reserva en estado "pendiente de pago con tarjeta", genera el formulario firmado, y confirma al verificar la respuesta. Mantiene ambos métodos.
2. Reemplazar la transferencia por tarjeta: más simple pero pierde clientes que prefieren transferir.
3. Confirmar solo por la URL de retorno del navegador sin verificar el servidor: descartado, inseguro.

## Diseño (lo decidido)
- Tabla `card_payments` (reserva, order_number único, monto DOP en centavos, tasa USD/DOP, estado, campos de respuesta sin datos de tarjeta, fechas). Idempotencia por `order_number`.
- `POST /api/payments/azul/start` (auth): valida reserva propia y pendiente, recalcula monto, convierte a DOP, devuelve campos + `AuthHash` para el formulario.
- `GET /api/payments/azul/approved|declined|cancelled`: verifica AuthHash de la respuesta (comparación en tiempo constante), contrastando monto y OrderNumber con el registro propio; solo entonces confirma/libera. Redirige a una página de resultado.
- Reserva con tarjeta pendiente retiene el turno un tiempo limitado; si no se paga, se libera.
- Logs sin datos sensibles (sin AuthKey, sin hash completo de la clave).
- CSP: añadir `form-action` hacia los dominios de AZUL; sin scripts en línea.
- Páginas: términos y condiciones, reembolsos/cancelaciones, privacidad, seguridad de datos de tarjeta; pie con dirección/contacto/logos; casilla de aceptación en el pago; modelo de recibo (correo de confirmación).

## Lo que queda al implementador
Nombres de archivos y de columnas, redacción de textos legales (sujetos a revisión del dueño), diseño visual de las páginas nuevas, tiempo de retención del turno (propuesta: 15 min).
