# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Turistas y locales que quieren pasar un día de playa en bote en República Dominicana (Boca Chica, Punta Cana y La Romana). Entran sobre todo desde el celular, comparan embarcaciones, eligen fecha y turno, y reservan sin llamar. Pagan por transferencia bancaria o Zelle y suben el comprobante en su panel. También hay compradores de botes y yates en la sección de ventas, que consultan por WhatsApp.

## Product Purpose
VENDO BOTE RD es la plataforma de renta (y venta) de embarcaciones del negocio. Permite ver cada embarcación con fotos y video, conocer su precio, elegir fecha y turno con disponibilidad en tiempo real y reservar en línea. Éxito: que el cliente complete la reserva y suba su comprobante sin tener que escribir o llamar.

## Positioning
Catálogo propio de embarcaciones reales con precio claro por día de la semana, combo de cumpleaños y reserva en línea con disponibilidad en tiempo real, en lugar de cotizar por mensajes.

## Operating Context
- Reserva de un solo día, en turnos (9:00 AM–3:00 PM y 4:00 PM–10:00 PM en Boca Chica; horarios propios en otras embarcaciones). Hora de República Dominicana (UTC-4).
- No se puede reservar un turno que ya pasó ni con menos de 2 horas de antelación.
- Precios por día de la semana (lunes a viernes / sábado y domingo) y opción de combo de cumpleaños, solo en las embarcaciones de Boca Chica. Las embarcaciones fuera de Boca Chica usan otro sistema de precio todavía por definir.
- El pago es por transferencia o Zelle (varias cuentas); no hay pago con tarjeta. La reserva se confirma cuando el administrador verifica el comprobante.
- Cuentas de cliente con correo y contraseña propios; un administrador gestiona embarcaciones, reservas y pagos desde un panel.
- Contacto directo del equipo por WhatsApp (+1 407 361 4042) e Instagram @vendobote_rd.
- Hosting en Railway con PostgreSQL; el sitio lo sirve Express con páginas HTML estáticas.

## Capabilities and Constraints
- Renta por turno con calendario, personas, combo de cumpleaños y resumen con total antes de reservar.
- Combo de cumpleaños incluye: 1 hora de jetski, decoración, bizcocho, parrillada, agua, hielo y refresco. El servicio normal no incluye el jetski.
- Venta de embarcaciones con ficha y consulta por WhatsApp (sin reserva ni pago en línea).
- Todo el texto del sitio es en español.
- Pendiente de definir: sistema de precios para embarcaciones fuera de Boca Chica; precios y detalles de Andrea del Mar para el combo de cumpleaños; capacidad e inclusiones reales de Azimut Nona.

## Brand Commitments
- Se conservan el logo actual y los colores del sitio (azul marino y celeste).
- Las fotos y los videos de las embarcaciones se muestran completos: nunca recortados, estirados ni modificados.

## Evidence on Hand
Fotos y videos reales de cada embarcación en `public/assets/img/` y `public/assets/video/`. No hay testimonios ni reseñas propias cargadas todavía: no se deben inventar.

## Product Principles
1. Primero el celular: todo debe verse y funcionar perfecto en pantalla pequeña.
2. El cliente reserva sin preguntar: el precio, lo incluido y la disponibilidad están claros en el mismo lugar.
3. Las imágenes del producto son la prueba: se muestran tal cual son.
4. Compacto y directo: la información necesaria para reservar cabe junta, sin pasos de más.
5. Nada inventado: precios, capacidades y testimonios salen siempre de datos confirmados por el dueño.

## Accessibility & Inclusion
Sin requisito específico establecido; mantener contraste suficiente, tamaños táctiles cómodos en celular y textos legibles.
