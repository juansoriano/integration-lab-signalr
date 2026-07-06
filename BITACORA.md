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
- El hub envía `LotteryStatusChanged` para **todos** los sorteos del sistema, no solo los del `LobbyStateSnapshot` recibido. Eventos de códigos fuera del snapshot se ignoran en la UI (correcto).
- Timezone confirmada del servidor: **UTC-4** (detectada de `changedAt`).

---

## Entradas

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

