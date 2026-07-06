// ─── Estado global ───────────────────────────────────────────────────────────
const state = {
  connection:     null,
  lotteryCode:    null,
  balls:          [],
  drawnSet:       new Set(),
  lobbyData:      { activeLotteries: [], closedLotteries: [] },
  countdownTimer: null,
  serverTzOffset: null, // se detecta automáticamente del primer evento con timezone
};

// ─── Timezone del servidor ────────────────────────────────────────────────────
// CASO-001: lotteryDate llega sin timezone. Se detecta automáticamente del
// primer evento que incluya una fecha con offset (ej: changedAt en LotteryStatusChanged).
// También se puede forzar manualmente: state.serverTzOffset = "-04:00"
//
// Extrae el offset de una fecha ISO con timezone, ej: "YYYY-MM-DDThh:mm:ss-04:00" → "-04:00"
function extractTzOffset(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/([+-]\d{2}:\d{2})$/);
  return m ? m[1] : null;
}

// Parsea una fecha del servidor. Si no tiene timezone usa el offset detectado.
function parseServerDate(dateStr) {
  if (!dateStr) return null;
  // Ya tiene timezone: parsear directo
  if (/[Z+\-]\d{2}:\d{2}$/.test(dateStr)) return new Date(dateStr);
  // Sin timezone: aplicar offset conocido del servidor
  if (state.serverTzOffset) return new Date(dateStr + state.serverTzOffset);
  // Fallback: hora local del browser
  return new Date(dateStr);
}

// ─── Letras de Bingo y rangos ─────────────────────────────────────────────────
const COLUMNS = [
  { letter: "B", min: 1,  max: 15 },
  { letter: "I", min: 16, max: 30 },
  { letter: "N", min: 31, max: 45 },
  { letter: "G", min: 46, max: 60 },
  { letter: "O", min: 61, max: 75 },
];

// ─── Utilidades DOM ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function mostrar(id)  { $(id).classList.remove("oculto"); }
function ocultar(id)  { $(id).classList.add("oculto"); }

function log(tipo, msg, data) {
  const contenedor = $("log-eventos");
  const item = document.createElement("div");
  item.className = `log-item log-${tipo}`;
  const hora = new Date().toLocaleTimeString("es", { hour12: false });
  item.innerHTML = `<span class="log-hora">${hora}</span><span class="log-msg">${msg}</span>`;
  if (data !== undefined) {
    const pre = document.createElement("pre");
    pre.className = "log-data";
    pre.textContent = JSON.stringify(data, null, 2);
    item.appendChild(pre);
  }
  contenedor.prepend(item);
}

function setEstado(texto, clase) {
  const el = $("estado-conexion");
  el.textContent = texto;
  el.className = `badge badge-${clase}`;
}

// ─── Cronómetros del lobby ────────────────────────────────────────────────────
// Los estados que muestran cuenta regresiva (sorteo aún no comenzó o en venta)
const ESTADOS_CON_COUNTDOWN = new Set(["espera", "activo", "ventaabierta", "preventa"]);

function formatCountdown(ms) {
  if (ms <= 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2,"0")}s`;
  return `${s}s`;
}

function actualizarCountdowns() {
  const ahora = Date.now();
  document.querySelectorAll("[data-lottery-date]").forEach(el => {
    const ms = parseServerDate(el.dataset.lotteryDate).getTime() - ahora;
    el.textContent = ms > 0 ? formatCountdown(ms) : "En curso";
  });
}

function iniciarTimerLobby() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(actualizarCountdowns, 1000);
}

function detenerTimerLobby() {
  if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
}

// ─── Tablero de Bingo ────────────────────────────────────────────────────────
function construirTablero() {
  const tablero = $("tablero-bingo");
  tablero.innerHTML = "";
  COLUMNS.forEach(col => {
    const th = document.createElement("div");
    th.className = `celda celda-header letra-${col.letter}`;
    th.textContent = col.letter;
    tablero.appendChild(th);
  });
  for (let num = 1; num <= 15; num++) {
    COLUMNS.forEach(col => {
      const val = col.min + num - 1;
      const cell = document.createElement("div");
      cell.className = "celda celda-num";
      cell.id = `ball-${col.letter}${val}`;
      cell.textContent = val;
      tablero.appendChild(cell);
    });
  }
}

function marcarBola(ballStr) {
  const el = document.getElementById(`ball-${ballStr.toUpperCase()}`);
  if (el) el.classList.add("cantada");
}

function resetTablero() {
  document.querySelectorAll(".celda-num").forEach(el => el.classList.remove("cantada"));
}

// ─── Renderizado de bolas cantadas ───────────────────────────────────────────
function renderBolas() {
  const contenedor = $("bolas-cantadas");
  contenedor.innerHTML = "";
  state.balls.forEach(b => {
    const span = document.createElement("span");
    span.className = "bola-chip";
    span.textContent = b;
    contenedor.appendChild(span);
  });
  if (state.balls.length > 0) {
    $("bola-actual").textContent = state.balls[state.balls.length - 1];
  }
}

// ─── Renderizado de jugadas ───────────────────────────────────────────────────
function renderJugadas(snapshot) {
  const grid = $("jugadas-grid");
  grid.innerHTML = "";
  const jugadas = [
    snapshot.firstLine, snapshot.secondLine,
    snapshot.cornerPlay, snapshot.crossPlay, snapshot.littleCrossPlay,
  ].filter(Boolean);
  jugadas.forEach(j => {
    if (!j || !j.name) return;
    const card = document.createElement("div");
    card.className = "jugada-card";
    card.innerHTML = `
      <div class="jugada-nombre">${j.name}</div>
      <div class="jugada-stats">
        <span>Ganadoras: <b>${j.winnerCards ?? "—"}</b></span>
        <span>Cercanas: <b>${j.approachingCards ?? "—"}</b></span>
        <span>Restantes: <b>${j.remainingPositions ?? "—"}</b></span>
      </div>`;
    grid.appendChild(card);
  });
}

// ─── Renderizado del lobby ────────────────────────────────────────────────────
function buildSorteoItem(s, isActive) {
  const item = document.createElement("div");
  item.className = `sorteo-item ${isActive ? "sorteo-activo" : "sorteo-cerrado"}`;
  item.dataset.code = s.lotteryCode;

  // Badge de estado
  const statusNorm = (s.status ?? "").toLowerCase().replace(/\s/g, "");
  const badgeClass = isActive ? `badge-estado-${statusNorm}` : "badge-cerrado";

  // Countdown: solo para sorteos activos que tengan fecha futura
  let countdownHtml = "";
  if (isActive && s.lotteryDate) {
    const ms = parseServerDate(s.lotteryDate).getTime() - Date.now();
    const mostrarClock = ESTADOS_CON_COUNTDOWN.has(statusNorm);
    if (mostrarClock) {
      countdownHtml = `<span class="sorteo-countdown" data-lottery-date="${s.lotteryDate}">${ms > 0 ? formatCountdown(ms) : "En curso"}</span>`;
    }
  }

  item.innerHTML = `
    <div class="sorteo-item-header">
      <span class="sorteo-item-codigo">${s.lotteryCode}</span>
      <span class="badge ${badgeClass}">${s.status ?? (isActive ? "Activo" : "Cerrado")}</span>
    </div>
    <div class="sorteo-item-info">
      <span>${s.gameName ?? ""}</span>
      <span>${s.soldCards != null ? s.soldCards + " tarjetas" : "—"}</span>
    </div>
    ${countdownHtml}`;

  if (isActive) {
    item.style.cursor = "pointer";
    item.title = "Clic para suscribirse";
    item.onclick = () => {
      $("lottery-code-dash").value = s.lotteryCode;
      app.suscribirSorteo(s.lotteryCode);
    };
  }
  return item;
}

function renderLobby(snapshot) {
  state.lobbyData = {
    activeLotteries:  snapshot.activeLotteries  ?? [],
    closedLotteries:  snapshot.closedLotteries  ?? [],
  };

  const lista = $("lista-sorteos");
  const todos = [...state.lobbyData.activeLotteries, ...state.lobbyData.closedLotteries];

  if (todos.length === 0) {
    lista.innerHTML = "<p class='placeholder'>Sin sorteos disponibles.</p>";
    return;
  }

  lista.innerHTML = "";
  const activeCodes = new Set(state.lobbyData.activeLotteries.map(a => a.lotteryCode));
  todos.forEach(s => lista.appendChild(buildSorteoItem(s, activeCodes.has(s.lotteryCode))));

  iniciarTimerLobby();
}

// ─── Actualización puntual de un sorteo en el lobby ──────────────────────────
function actualizarItemLobby(lotteryCode, nuevoStatus) {
  // Actualizar en la data local
  const enActivos  = state.lobbyData.activeLotteries.find(s => s.lotteryCode === lotteryCode);
  const enCerrados = state.lobbyData.closedLotteries.find(s => s.lotteryCode === lotteryCode);
  const sorteo = enActivos ?? enCerrados;
  if (!sorteo) return;

  sorteo.status = nuevoStatus;

  // Determinar si sigue siendo activo después del cambio de estado
  const statusNorm = nuevoStatus.toLowerCase().replace(/\s/g, "");
  const esTerminado = ["realizada", "cancelada", "completado"].includes(statusNorm);

  // Si pasó a terminado, moverlo de activos a cerrados
  if (esTerminado && enActivos) {
    state.lobbyData.activeLotteries = state.lobbyData.activeLotteries.filter(s => s.lotteryCode !== lotteryCode);
    state.lobbyData.closedLotteries.unshift(sorteo);
  }

  const isActive = !esTerminado;

  // Reemplazar el elemento en el DOM
  const lista = $("lista-sorteos");
  const existing = lista.querySelector(`[data-code="${lotteryCode}"]`);
  const newItem = buildSorteoItem(sorteo, isActive);

  if (existing) {
    // Animación flash para que el usuario note el cambio
    newItem.classList.add("status-changed");
    lista.replaceChild(newItem, existing);
    setTimeout(() => newItem.classList.remove("status-changed"), 1500);

    // Si pasó a terminado, moverlo al final (después de los activos)
    if (esTerminado) {
      const primerCerrado = lista.querySelector(".sorteo-cerrado");
      if (primerCerrado) lista.insertBefore(newItem, primerCerrado);
      else lista.appendChild(newItem);
    }
  } else {
    lista.prepend(newItem);
  }
}

// ─── Snapshot de sorteo ───────────────────────────────────────────────────────
function renderLotterySnapshot(snapshot) {
  $("sorteo-codigo").textContent = snapshot.lotteryCode ?? state.lotteryCode;
  const estadoBadge = $("sorteo-estado");
  estadoBadge.textContent = snapshot.lotteryStatus ?? "—";
  estadoBadge.className = `badge ${snapshot.isCompleted ? "badge-cerrado" : "badge-activo"}`;

  $("stat-posicion").textContent = snapshot.currentPosition ?? 0;
  $("stat-tarjetas").textContent = snapshot.noCardSold ?? "—";
  $("stat-monto").textContent = snapshot.totalAmount != null
    ? snapshot.totalAmount.toLocaleString("es", { style: "currency", currency: "USD" })
    : "—";

  if (Array.isArray(snapshot.result)) {
    state.balls = [...snapshot.result];
    state.drawnSet = new Set(snapshot.result.map(b => b.toUpperCase()));
    resetTablero();
    state.balls.forEach(b => marcarBola(b));
    renderBolas();
  }

  renderJugadas(snapshot);
  ocultar("seccion-sin-sorteo");
  mostrar("seccion-sorteo");
}

// ─── App principal ────────────────────────────────────────────────────────────
const app = {

  async conectar() {
    const apiBase = $("api-base").value.trim().replace(/\/$/, "");
    const token   = $("token-input").value.trim();
    const lotCode = $("lottery-code").value.trim();

    if (!apiBase) { $("msg-conexion").textContent = "Ingrese la URL de la API."; return; }
    if (!token)   { $("msg-conexion").textContent = "Ingrese el token de acceso."; return; }

    $("msg-conexion").textContent = "Conectando...";
    $("btn-conectar").disabled = true;

    try {
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(`${apiBase}/lotteryHub`, { accessTokenFactory: () => token })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning)
        .build();

      // ── Eventos del lobby ──
      connection.on("LobbyStateSnapshot", (snapshot) => {
        log("info", "LobbyStateSnapshot", snapshot);
        renderLobby(snapshot);
      });

      connection.on("LotterySalesUpdated", (dto) => {
        log("info", "LotterySalesUpdated", dto);
        // Actualizar tarjetas vendidas en el item del lobby
        const code = dto.lotteryCode ?? dto.LotteryCode;
        if (!code) return;
        const sorteo = [...state.lobbyData.activeLotteries, ...state.lobbyData.closedLotteries]
          .find(s => s.lotteryCode === code);
        if (sorteo && dto.soldCards != null) {
          sorteo.soldCards = dto.soldCards;
          const el = $("lista-sorteos").querySelector(`[data-code="${code}"] .sorteo-item-info span:last-child`);
          if (el) el.textContent = `${dto.soldCards} tarjetas`;
        }
      });

      connection.on("LotteryPayoutsUpdated", (dto) => {
        log("info", "LotteryPayoutsUpdated", dto);
      });

      // ── Evento de cambio de estado (lobby + sorteo activo) ──
      connection.on("LotteryStatusChanged", (status) => {
        log("warn", "LotteryStatusChanged", status);
        const code = status.lotteryCode ?? status.LotteryCode;
        const nuevoStatus = status.status ?? status.Status;

        // Detectar timezone del servidor la primera vez
        if (!state.serverTzOffset && status.changedAt) {
          const offset = extractTzOffset(status.changedAt);
          if (offset) {
            state.serverTzOffset = offset;
            log("info", `Timezone del servidor detectada: ${offset}`);
          }
        }

        if (code && nuevoStatus) actualizarItemLobby(code, nuevoStatus);

        // Si es el sorteo actualmente suscrito, actualizar su badge
        if (code === state.lotteryCode) {
          const badge = $("sorteo-estado");
          if (badge) { badge.textContent = nuevoStatus; }
        }
      });

      // ── Eventos del sorteo ──
      connection.on("LotteryStateSnapshot", (snapshot) => {
        log("info", "LotteryStateSnapshot", snapshot);
        renderLotterySnapshot(snapshot);
      });

      connection.on("BallDrawn", (ball) => {
        log("success", `BallDrawn → ${ball.ball} (pos ${ball.position})`, ball);
        state.balls.push(ball.ball);
        state.drawnSet.add(ball.ball.toUpperCase());
        marcarBola(ball.ball);
        renderBolas();
        $("stat-posicion").textContent = ball.position;
      });

      connection.on("LineWinnersUpdated", (winners) => {
        log("winner", "LineWinnersUpdated", winners);
      });

      connection.on("SpecialPlayWinnersUpdated", (winners) => {
        log("winner", "SpecialPlayWinnersUpdated", winners);
      });

      connection.on("LotteryCompleted", (completed) => {
        log("winner", "LotteryCompleted 🏆", completed);
        $("sorteo-estado").textContent = "Completado";
        $("sorteo-estado").className = "badge badge-cerrado";
      });

      connection.on("ClientLineWinnersUpdated", (winners) => {
        log("winner", "ClientLineWinnersUpdated (mis tarjetas)", winners);
      });

      connection.on("ClientSpecialWinnersUpdated", (winners) => {
        log("winner", "ClientSpecialWinnersUpdated (mis tarjetas)", winners);
      });

      // ── Reconexión ──
      connection.onreconnecting(() => setEstado("Reconectando...", "warn"));
      connection.onreconnected(() => setEstado("Conectado", "conectado"));
      connection.onclose(() => { setEstado("Desconectado", "cerrado"); detenerTimerLobby(); });

      await connection.start();
      state.connection = connection;
      log("info", `Conectado a ${apiBase}/lotteryHub — ID: ${connection.connectionId}`);

      await connection.invoke("SubscribeToLobby");
      log("info", "SubscribeToLobby invocado");

      $("header-url").textContent = apiBase;
      ocultar("panel-conexion");
      mostrar("dashboard");
      construirTablero();

      if (lotCode) {
        $("lottery-code-dash").value = lotCode;
        await this.suscribirSorteo(lotCode);
      }

    } catch (err) {
      log("error", "Error al conectar", { message: err.message });
      $("msg-conexion").textContent = `Error: ${err.message}`;
      $("btn-conectar").disabled = false;
    }
  },

  async suscribirSorteo(codigo) {
    const code = codigo ?? $("lottery-code-dash").value.trim();
    if (!code || !state.connection) return;
    try {
      if (state.lotteryCode && state.lotteryCode !== code) {
        await state.connection.invoke("UnsubscribeFromLottery", state.lotteryCode);
        log("warn", `UnsubscribeFromLottery → ${state.lotteryCode}`);
      }
      state.lotteryCode = code;
      state.balls = [];
      state.drawnSet = new Set();
      resetTablero();
      renderBolas();
      await state.connection.invoke("SubscribeToLottery", code);
      log("info", `SubscribeToLottery → ${code}`);
    } catch (err) {
      log("error", `Error al suscribirse a ${code}`, { message: err.message });
    }
  },

  async desuscribirSorteo() {
    if (!state.connection || !state.lotteryCode) return;
    try {
      await state.connection.invoke("UnsubscribeFromLottery", state.lotteryCode);
      log("warn", `UnsubscribeFromLottery → ${state.lotteryCode}`);
    } catch (err) {
      log("error", "Error al desuscribirse", { message: err.message });
    }
    state.lotteryCode = null;
    state.balls = [];
    state.drawnSet = new Set();
    ocultar("seccion-sorteo");
    mostrar("seccion-sin-sorteo");
  },

  async desconectar() {
    detenerTimerLobby();
    if (state.connection) {
      try { await state.connection.stop(); } catch (_) {}
      state.connection = null;
    }
    state.lotteryCode = null;
    state.balls = [];
    state.drawnSet = new Set();
    state.lobbyData = { activeLotteries: [], closedLotteries: [] };
    ocultar("dashboard");
    mostrar("panel-conexion");
    $("btn-conectar").disabled = false;
    $("msg-conexion").textContent = "";
  },

  limpiarLog() {
    $("log-eventos").innerHTML = "";
  }
};

