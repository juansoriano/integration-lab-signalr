# Bitácora del Proyecto: WebSocketDemo - Bingo SignalR

## Descripción General
App web demo para conectarse al hub SignalR `/lotteryHub` de `GameRes API` y visualizar en tiempo real el estado de sorteos de Bingo.

---

## Payloads y Comportamientos Confirmados

### `LotteryStatusChanged` — valores de `status` observados
| Valor | Comportamiento | Confirmado |
|-------|---------------|-----------|
| `Espera` | Badge azul, countdown activo | ✓ |
| `Activo` | Badge verde, countdown activo | ✓ |
| `VentaCerrada` | Badge naranja, sin countdown | ✓ |
| `Realizada` | Badge rojo, se mueve a cerrados | ✓ |
| `Cancelada` | Badge rojo, se mueve a cerrados | pendiente |

### Comportamiento del hub
- `LobbyLotteryStatusChanged` publica los cambios globales necesarios para mantener actualizado el lobby.
- `LotteryStatusChanged` se limita al sorteo al que el cliente se suscribió.
- `SubscribeToLobby`, `SubscribeToLottery` y `SubscribeToLotteryById` devuelven un acknowledgement que debe confirmarse antes de declarar la suscripción activa.
- Timezone confirmada del servidor: **UTC-4** (detectada de `changedAt`).

---

## Entradas

### 2026-08-19 — Ventana autoritativa del lobby y contador por estado

**Hallazgo QA:**
- El snapshot mostraba sorteos antiguos en `Espera`, omitía el activo y tomaba diez elementos de una fuente de ventas con ordenamiento no autoritativo.
- El demo mostraba `En curso` cuando la hora ya había pasado, aunque el estado continuara en `Espera`.

**Correcciones:**
- El backend combina los sorteos de hoy, como autoridad de estado/fecha, con el resumen de ventas y premios por GID.
- La ventana publica primero el sorteo `Activo` y luego los próximos en `Espera`; excluye esperas vencidas y separa los cerrados recientes.
- El demo ordena defensivamente el activo primero y solo muestra `En curso` cuando el estado es `Activo`.
- Una hora vencida con estado `Espera` se presenta como `Pendiente de actualización`.

### 2026-08-19 — Login interactivo para certificacion reproducible

**Cambios aplicados:**
- La pantalla inicial usa `Usuario y clave` como pestana principal.
- El demo obtiene el token mediante `POST /api/Connection/Login` en la misma URL base de GameRes.
- La pestana secundaria `Token` conserva el acceso con JWT o Transaction Access Token `txa_`.
- La clave se limpia despues de cada intento y el token se mantiene solo en memoria; ninguno se escribe en storage, URL o log de eventos.
- El manual de integracion SignalR se actualizo a la version 1.2 con ambos recorridos.

**Pendiente de certificar en QA:**
- Login con un usuario QA valido, conexion, lobby y suscripcion a un sorteo activo.
- Verificacion visual de ambas pestanas en Chrome y Edge.

### 2026-08-18 — Certificación local de entrada tardía, ventas y ganadores

**Evidencia funcional:**
- Se salió y volvió a entrar varias veces durante el sorteo `757365`.
- Los snapshots recibidos con `18`, `30` y `34` bolas reconstruyeron inmediatamente todo el tablero.
- El siguiente `BallDrawn` continuó desde la posición posterior sin perder ni duplicar bolas.
- La primera carga de un sorteo con cuatro cartones mostró `4` y RD$20, igual que el Portal; se corrigió el conteo anterior que acumulaba el total y mostraba `8`.
- Al cambiar de sorteo, bolas, ventas, monto y jugadas anteriores se reemplazan por el nuevo snapshot.

**Mejora demostrativa:**
- La sección `JUGADAS` procesa `firstLine`, `secondLine`, `cornerPlay`, `crossPlay` y `littleCrossPlay` desde el snapshot.
- `LineWinnersUpdated` y `SpecialPlayWinnersUpdated` actualizan la presentación en vivo.
- Cada patrón muestra tarjetas ganadoras, próximas a ganar, posiciones restantes y premio unitario cuando el servidor los informa.
- Las listas se deduplican para tolerar snapshot, reconexión o eventos repetidos.

**Validaciones técnicas:**
- Sintaxis de `app.js` aprobada con Node.
- El servidor estático entregó la versión nueva y registró ambos handlers de ganadores.
- La certificación integral en QA permanece pendiente después de publicar GameRes y Portal.

### 2026-08-18 — Suscripción por GID y recuperación de conexión

**Cambios aplicados:**
- El campo de suscripción acepta `lotteryCode` o `gameLotteryGid` (UUID).
- Los UUID usan `SubscribeToLotteryById`; el flujo por código no cambia.
- Se agregó refresco manual del lobby mediante una nueva suscripción.
- Después de una reconexión se restauran el lobby y el sorteo seleccionado.
- Los eventos `BallDrawn` y `LotteryCompleted` solo actualizan la vista si pertenecen al sorteo seleccionado.
- Se evitan bolas duplicadas y se muestran errores de suscripción más comprensibles.
- Se adoptó el contrato 1.1: acknowledgement de suscripciones y separación entre eventos de lobby y sorteo.
- Al cambiar de sorteo se limpia todo el estado visual anterior y las ventas actualizan tanto el lobby como el detalle seleccionado.

**Pendiente de validar con el ambiente:**
- Confirmar el payload real de los endpoints HTTP de carrusel antes de usarlos como fuente principal del lobby.
- Confirmar que el `LotteryStateSnapshot` devuelto al suscribirse por GID siempre incluya `lotteryCode`, necesario para `UnsubscribeFromLottery`.

---

### YYYY-MM-DD — Inicio del proyecto

**Tarea:** Crear aplicación web demo que consuma el hub SignalR de Bingo.

**Alcance definido:**
- Pantalla de conexión (token + URL base)
- Vista de lobby con sorteos activos
- Vista de sorteo con tablero de bingo, bolas cantadas y ganadores en tiempo real
- Bitácora de eventos en consola visual

**Tecnología elegida:**
- HTML/CSS/JS vanilla (sin frameworks) para que sea portable y fácil de distribuir
- `@microsoft/signalr` desde CDN (sin bundler) para evitar dependencias de build
- Un solo archivo `index.html` + `app.js` + `styles.css` para simplificar el despliegue en demo

**Estructura de archivos planeada:**
```
WebSocketDemo/
├── index.html        # Entrada principal
├── app.js            # Lógica SignalR y UI
├── styles.css        # Estilos
├── BITACORA.md       # Este archivo
└── docs/
    └── API.md        # Documentación original del proveedor
```

**Valores de status confirmados en `LotteryStatusChanged` (campo `status`):**

| Valor recibido | Comportamiento en UI |
|----------------|----------------------|
| `Activo`       | Badge verde, con countdown |
| `VentaCerrada` | Badge naranja, sin countdown, permanece en activos |
| `Realizada`    | Badge rojo, se mueve a cerrados *(pendiente confirmar)* |
| `Cancelada`    | Badge rojo, se mueve a cerrados *(pendiente confirmar)* |
| `Espera`       | Badge azul, con countdown |

---

**Observaciones / Casos para el proveedor:**

#### CASO-001 — `lotteryDate` sin información de timezone
- **Detectado:** YYYY-MM-DD
- **Campo afectado:** `LobbyStateSnapshot → activeLotteries[n].lotteryDate`
- **Ejemplo recibido:** `"YYYY-MM-DDT09:00:00"` (sin sufijo `Z` ni offset)
- **Impacto:** JavaScript parsea la fecha como hora local del browser. Si el servidor corre en una zona horaria distinta, el cronómetro de cuenta regresiva queda desfasado por la diferencia horaria.
- **Solución ideal:** El backend debería enviar la fecha con timezone explícita, ej. `"YYYY-MM-DDT10:40:00-05:00"` o `"YYYY-MM-DDT15:40:00Z"`.
- **Workaround aplicado en el cliente:** Se documenta el supuesto de que la fecha es hora local del servidor. Si se confirma que el servidor emite en UTC, se añadirá sufijo `Z` al parsear.
- **Workaround definitivo (YYYY-MM-DD):** Se detecta el offset automáticamente del campo `changedAt` del evento `LotteryStatusChanged` (ej: `"YYYY-MM-DDT10:30:00.000000-04:00"` → offset `-04:00`). Se almacena en `state.serverTzOffset` y se aplica al parsear `lotteryDate`. Servidor confirmado en **UTC-4**.
- **Estado:** Workaround activo. Pendiente que el proveedor normalice `lotteryDate` con timezone explícita para eliminar el workaround.

---

