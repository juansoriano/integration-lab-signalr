# 🎱 GameRes LotteryHub — WebSocket Demo

Demo de integración con el hub SignalR de GameRes para sorteos de Bingo en tiempo real.  
Creado como referencia práctica para integradores que necesiten conectarse al hub `/lotteryHub`.

---

## ¿Qué hace este proyecto?

Una app web vanilla (sin frameworks, sin bundler) que:

- Se autentica y conecta al hub SignalR `/lotteryHub`
- Muestra el **lobby** con sorteos activos y sus estados en tiempo real
- Permite suscribirse a un sorteo y ver:
  - Tablero B-I-N-G-O con bolas cantadas resaltadas
  - Cronómetro de cuenta regresiva hasta el inicio del sorteo
  - Jugadas activas (Línea 1, Línea 2, Esquinas, etc.)
  - Log en vivo de todos los eventos SignalR
- Actualiza el estado del lobby automáticamente al recibir `LotteryStatusChanged`

## Por qué existe este repo

Durante la integración con el hub SignalR de GameRes nos encontramos con comportamientos no documentados y algunos problemas que tuvimos que resolver. Este repo documenta:

1. **El código de la demo** — implementación de referencia funcional y probada
2. **La bitácora** — registro de los problemas encontrados y cómo los resolvimos, incluyendo un caso abierto con el proveedor

---

## Estructura del proyecto

```
WebSocketDemo/
├── index.html      # UI principal — punto de entrada
├── app.js          # Lógica SignalR completa
├── styles.css      # Tema oscuro
└── BITACORA.md     # Registro de decisiones y problemas resueltos
```

---

## Inicio rápido

No requiere instalación ni build. Servir la carpeta con cualquier servidor estático:

```bash
# Con Node.js
npx serve .

# Con Python
python -m http.server 8080

# Con VS Code
# Instalar extensión Live Server → clic derecho en index.html → Open with Live Server
```

Abrir `http://localhost:<puerto>` en el browser, ingresar la URL del hub y el token de acceso.

---

## Uso

1. **Ingresar la URL base** de la API (ej: `https://tu-servidor/`)
2. **Pegar el token** de acceso (Bearer o `txa_...`)
3. Clic en **Conectar** — la app se suscribe al lobby automáticamente
4. Seleccionar un sorteo de la lista o ingresar el código manualmente
5. Observar el tablero, las bolas y los eventos en tiempo real

---

## Documentación

| Documento | Descripción |
|-----------|-------------|
| [`BITACORA.md`](BITACORA.md) | Registro cronológico: decisiones, problemas resueltos y casos abiertos con el proveedor |

---

## Eventos SignalR implementados

| Evento | Descripción |
|--------|-------------|
| `LobbyStateSnapshot` | Estado inicial del lobby |
| `LotteryStateSnapshot` | Estado inicial del sorteo suscrito |
| `BallDrawn` | Bola cantada en tiempo real |
| `LotteryStatusChanged` | Cambio de estado de un sorteo |
| `LotterySalesUpdated` | Actualización de ventas |
| `LotteryPayoutsUpdated` | Actualización de premios |
| `LineWinnersUpdated` | Ganadores de línea |
| `SpecialPlayWinnersUpdated` | Ganadores de jugadas especiales |
| `LotteryCompleted` | Sorteo finalizado |
| `ClientLineWinnersUpdated` | Mis tarjetas ganadoras (evento privado) |
| `ClientSpecialWinnersUpdated` | Mis tarjetas especiales (evento privado) |

---

## Dependencia externa

La única dependencia es la librería cliente de SignalR cargada desde CDN:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/8.0.0/signalr.min.js"></script>
```

Para instalarla localmente:

```bash
npm install @microsoft/signalr
```

---

## Hallazgos importantes de la integración

Durante el desarrollo encontramos comportamientos que no estaban en la documentación oficial. Los más relevantes:

- **`LotteryStatusChanged` es global** — el hub emite este evento para *todos* los sorteos del sistema, no solo los suscritos. Hay que filtrar por `lotteryCode`.
- **`lotteryDate` llega sin timezone** — el resto de fechas incluyen offset. Implementamos detección automática del offset del servidor a partir del campo `changedAt`. Ver [CASO-001 en la bitácora](BITACORA.md).
- **CORS debe estar habilitado** en el backend para el origen de la UI.

---

## Licencia

[MIT](LICENSE) — libre para usar, copiar y adaptar en tus integraciones.
