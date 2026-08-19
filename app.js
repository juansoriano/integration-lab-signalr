// ─── Estado global ───────────────────────────────────────────────────────────
const state = {
  connection:     null,
  authMode:       "login",
  accessToken:    null,
  lotteryCode:    null,
  lotteryId:      null,
  subscription:   null, // { type: "code" | "id", value: string }
  balls:          [],
  drawnSet:       new Set(),
  lobbyData:      { activeLotteries: [], closedLotteries: [] },
  countdownTimer: null,
  serverTzOffset: null, // se detecta automáticamente del primer evento con timezone
  lobbyAcknowledgement: null,
  lotteryAcknowledgement: null,
  plays:          new Map(),
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
  if (/Z$/i.test(dateStr) || /[+\-]\d{2}:\d{2}$/.test(dateStr)) return new Date(dateStr);
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

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function getLotteryCode(payload) {
  return payload?.lotteryCode ?? payload?.LotteryCode ?? null;
}

function getLotteryId(payload) {
  return payload?.lotteryId ?? payload?.LotteryId ?? payload?.gameLotteryGid ?? payload?.GameLotteryGid ?? null;
}

function perteneceAlSorteoSeleccionado(payload) {
  if (!state.subscription) return false;
  const code = getLotteryCode(payload);
  const id = getLotteryId(payload);
  if (code && state.lotteryCode) return String(code).toLowerCase() === String(state.lotteryCode).toLowerCase();
  if (id && state.lotteryId) return String(id).toLowerCase() === String(state.lotteryId).toLowerCase();
  return false;
}

function mensajeError(err) {
  const raw = err?.message ?? String(err);
  if (/unauthorized|401/i.test(raw)) return "El token no es válido o expiró.";
  if (/forbidden|403|permission|permiso/i.test(raw)) return "El token no tiene permiso para este sorteo.";
  if (/not found|404|no existe/i.test(raw)) return "No se encontró el sorteo solicitado.";
  if (/disconnected|not connected|connection.*inactive/i.test(raw)) return "La conexión se interrumpió. Intente nuevamente.";
  return raw;
}

async function autenticar(apiBase) {
  if (state.authMode === "token") {
    const token = $("token-input").value.trim().replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Ingrese el token de acceso.");
    return token;
  }

  const username = $("username-input").value.trim();
  const passwordInput = $("password-input");
  const password = passwordInput.value;
  if (!username) throw new Error("Ingrese el usuario.");
  if (!password) throw new Error("Ingrese la clave.");

  try {
    const response = await fetch(`${apiBase}/api/Connection/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json().catch(() => null);
    const token = payload?.mainObject?.token ?? payload?.MainObject?.Token;
    const success = payload?.success ?? payload?.Success;
    if (!response.ok || success !== true || !token) {
      const message = payload?.message ?? payload?.Message;
      throw new Error(message || "Usuario o clave incorrectos.");
    }
    return token;
  } finally {
    passwordInput.value = "";
  }
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
    const lotteryDate = parseServerDate(el.dataset.lotteryDate);
    const status = (el.dataset.status ?? "").toLowerCase();
    if (!lotteryDate || Number.isNaN(lotteryDate.getTime())) {
      el.textContent = "Horario no disponible";
      return;
    }
    const ms = lotteryDate.getTime() - ahora;
    if (status === "activo") {
      el.textContent = "En curso";
    } else if (ms > 0) {
      el.textContent = formatCountdown(ms);
    } else {
      el.textContent = "Pendiente de actualización";
    }
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
  } else {
    $("bola-actual").textContent = "—";
  }
}

function resetLotteryView() {
  state.balls = [];
  state.drawnSet = new Set();
  state.lotteryAcknowledgement = null;
  state.plays = new Map();
  resetTablero();
  renderBolas();
  $("stat-posicion").textContent = "0";
  $("stat-tarjetas").textContent = "0";
  $("stat-monto").textContent = (0).toLocaleString("es", { style: "currency", currency: "USD" });
  $("sorteo-estado").textContent = "—";
  $("jugadas-grid").innerHTML = "";
}

function acknowledgementValido(ack, subscription) {
  return Boolean(
    ack &&
    String(ack.subscription ?? "").toLowerCase() === subscription.toLowerCase() &&
    ack.connectionId
  );
}

// ─── Renderizado de jugadas ───────────────────────────────────────────────────
function playKey(play) {
  return String(play.code ?? play.name ?? "jugada").trim().toLowerCase();
}

function playLabel(code) {
  const labels = {
    l1: "Línea 1",
    l2: "Línea 2",
    corner: "Cuatro esquinas",
    cross: "Cruz grande",
    little_cross: "Cruz pequeña",
    full_bingo: "Full Bingo",
  };
  return labels[String(code ?? "").toLowerCase()] ?? code ?? "Jugada";
}

function normalizeCards(cards) {
  return [...new Set((Array.isArray(cards) ? cards : []).map(Number).filter(Number.isFinite))];
}

function upsertPlay(play) {
  if (!play?.name) return;
  const key = playKey(play);
  const previous = state.plays.get(key) ?? {};
  state.plays.set(key, {
    ...previous,
    ...play,
    winnerCardList: normalizeCards(play.winnerCardList ?? previous.winnerCardList),
    approachingCardList: normalizeCards(play.approachingCardList ?? previous.approachingCardList),
  });
}

function snapshotPlay(play, fallbackName) {
  if (!play) return null;
  const winnerCardList = Array.isArray(play.winnerCardList)
    ? play.winnerCardList
    : (Array.isArray(play.winnerCards) ? play.winnerCards : []);
  const winnerCards = typeof play.winnerCards === "number"
    ? play.winnerCards
    : (play.noWinners ?? winnerCardList.length);
  return {
    name: play.name ?? play.playName ?? fallbackName,
    code: play.code ?? play.lineCode ?? play.wayOfWin ?? fallbackName,
    winnerCards,
    winnerCardList,
    approachingCards: play.approachingCards ?? 0,
    approachingCardList: play.approachingCardList ?? [],
    remainingPositions: play.remainingPositions,
    unitPrize: play.unitPrize,
    isClosed: Boolean(play.isClosed),
  };
}

function eventPlay(event, type) {
  const code = type === "line" ? event.lineCode : event.wayToWin;
  return {
    name: playLabel(code),
    code,
    winnerCards: event.winnerCards ?? 0,
    winnerCardList: event.winnerCardList ?? [],
    approachingCards: event.approachingCards ?? 0,
    approachingCardList: event.approachingCardList ?? [],
    remainingPositions: event.remainingPositions,
    unitPrize: event.unitPrize,
    isClosed: Boolean(event.isClosed),
  };
}

function renderJugadas(snapshot) {
  const grid = $("jugadas-grid");
  grid.innerHTML = "";

  if (snapshot) {
    [
      snapshotPlay(snapshot.firstLine, "Línea 1"),
      snapshotPlay(snapshot.secondLine, "Línea 2"),
      snapshotPlay(snapshot.cornerPlay, "Cuatro esquinas"),
      snapshotPlay(snapshot.crossPlay, "Cruz grande"),
      snapshotPlay(snapshot.littleCrossPlay, "Cruz pequeña"),
    ].filter(Boolean).forEach(upsertPlay);

    if ((snapshot.noFullBingoCardWinners ?? 0) > 0 || (snapshot.fullBingoCardWinnerList?.length ?? 0) > 0) {
      upsertPlay({
        name: "Full Bingo",
        code: "full_bingo",
        winnerCards: snapshot.noFullBingoCardWinners ?? snapshot.fullBingoCardWinnerList.length,
        winnerCardList: snapshot.fullBingoCardWinnerList ?? [],
        unitPrize: snapshot.fullBingoUnitPrize,
        isClosed: snapshot.isCompleted,
      });
    }
  }

  if (state.plays.size === 0) {
    grid.innerHTML = '<div class="jugadas-vacio">Aún no hay información de patrones ganadores.</div>';
    return;
  }

  [...state.plays.values()].forEach(j => {
    const card = document.createElement("div");
    const hasWinners = j.winnerCardList.length > 0 || Number(j.winnerCards) > 0;
    card.className = `jugada-card${hasWinners ? " jugada-ganadora" : ""}`;
    const ganadoras = j.winnerCardList.length
      ? j.winnerCardList.map(code => `<span class="tarjeta-ganadora">#${code}</span>`).join("")
      : '<span class="sin-ganadoras">Sin ganadoras</span>';
    const prize = j.unitPrize != null
      ? Number(j.unitPrize).toLocaleString("es", { style: "currency", currency: "USD" })
      : "—";
    card.innerHTML = `
      <div class="jugada-header">
        <div class="jugada-nombre">${j.name}</div>
        <span class="jugada-conteo">${j.winnerCards ?? j.winnerCardList.length}</span>
      </div>
      <div class="tarjetas-ganadoras">${ganadoras}</div>
      <div class="jugada-stats">
        <span>Cercanas: <b>${j.approachingCards ?? "—"}</b></span>
        <span>Restantes: <b>${j.remainingPositions ?? "—"}</b></span>
        <span>Premio unitario: <b>${prize}</b></span>
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

  // Countdown: la fecha no puede convertir por si sola un sorteo en "En curso".
  let countdownHtml = "";
  if (isActive && s.lotteryDate) {
    const ms = parseServerDate(s.lotteryDate).getTime() - Date.now();
    const mostrarClock = ESTADOS_CON_COUNTDOWN.has(statusNorm);
    if (mostrarClock) {
      const countdownText = statusNorm === "activo"
        ? "En curso"
        : (ms > 0 ? formatCountdown(ms) : "Pendiente de actualización");
      countdownHtml = `<span class="sorteo-countdown" data-lottery-date="${s.lotteryDate}" data-status="${statusNorm}">${countdownText}</span>`;
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
  const byOperationalOrder = (left, right) => {
    const leftStatus = String(left.status ?? "").toLowerCase();
    const rightStatus = String(right.status ?? "").toLowerCase();
    const leftPriority = leftStatus === "activo" ? 0 : 1;
    const rightPriority = rightStatus === "activo" ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return (parseServerDate(left.lotteryDate)?.getTime() ?? Number.MAX_SAFE_INTEGER)
      - (parseServerDate(right.lotteryDate)?.getTime() ?? Number.MAX_SAFE_INTEGER);
  };
  state.lobbyData = {
    activeLotteries:  [...(snapshot.activeLotteries ?? [])].sort(byOperationalOrder),
    closedLotteries:  [...(snapshot.closedLotteries ?? [])].sort((left, right) =>
      (parseServerDate(right.lotteryDate)?.getTime() ?? 0)
      - (parseServerDate(left.lotteryDate)?.getTime() ?? 0)),
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

  cambiarModoAcceso(mode) {
    state.authMode = mode === "token" ? "token" : "login";
    const isLogin = state.authMode === "login";
    $("tab-login").classList.toggle("activo", isLogin);
    $("tab-token").classList.toggle("activo", !isLogin);
    $("tab-login").setAttribute("aria-selected", String(isLogin));
    $("tab-token").setAttribute("aria-selected", String(!isLogin));
    $("panel-login").classList.toggle("oculto", !isLogin);
    $("panel-token").classList.toggle("oculto", isLogin);
    $("btn-conectar").textContent = isLogin ? "Iniciar sesión y conectar" : "Conectar con token";
    $("msg-conexion").textContent = "";
    (isLogin ? $("username-input") : $("token-input")).focus();
  },

  async conectar() {
    const apiBase = $("api-base").value.trim().replace(/\/$/, "");
    const lotCode = $("lottery-code").value.trim();

    if (!apiBase) { $("msg-conexion").textContent = "Ingrese la URL de la API."; return; }

    $("msg-conexion").textContent = state.authMode === "login" ? "Iniciando sesión..." : "Conectando...";
    $("btn-conectar").disabled = true;

    try {
      const token = await autenticar(apiBase);
      state.accessToken = token;
      $("msg-conexion").textContent = "Conectando...";
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(`${apiBase}/lotteryHub`, { accessTokenFactory: () => state.accessToken ?? "" })
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

        if (state.lotteryCode && String(code).toLowerCase() === String(state.lotteryCode).toLowerCase()) {
          if (dto.soldCards != null) $("stat-tarjetas").textContent = dto.soldCards;
          if (dto.soldAmount != null) {
            $("stat-monto").textContent = Number(dto.soldAmount).toLocaleString("es", {
              style: "currency",
              currency: "USD",
            });
          }
        }
      });

      connection.on("LotteryPayoutsUpdated", (dto) => {
        log("info", "LotteryPayoutsUpdated", dto);
      });

      // ── Estado global del lobby ──
      connection.on("LobbyLotteryStatusChanged", (status) => {
        log("warn", "LobbyLotteryStatusChanged", status);
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

      });

      // ── Estado del sorteo al que este cliente está suscrito ──
      connection.on("LotteryStatusChanged", (status) => {
        log("warn", "LotteryStatusChanged", status);
        const code = status.lotteryCode ?? status.LotteryCode;
        const nuevoStatus = status.status ?? status.Status;
        if (code && state.lotteryCode && String(code).toLowerCase() === String(state.lotteryCode).toLowerCase()) {
          const badge = $("sorteo-estado");
          if (badge) { badge.textContent = nuevoStatus; }
        }
      });

      // ── Eventos del sorteo ──
      connection.on("LotteryStateSnapshot", (snapshot) => {
        log("info", "LotteryStateSnapshot", snapshot);
        if (!state.subscription) return;
        state.lotteryCode = getLotteryCode(snapshot) ?? state.lotteryCode;
        state.lotteryId = getLotteryId(snapshot) ?? state.lotteryId;
        renderLotterySnapshot(snapshot);
      });

      connection.on("BallDrawn", (ball) => {
        log("success", `BallDrawn → ${ball.ball} (pos ${ball.position})`, ball);
        if (!perteneceAlSorteoSeleccionado(ball) || !ball.ball) return;
        const ballKey = ball.ball.toUpperCase();
        if (state.drawnSet.has(ballKey)) return;
        state.balls.push(ball.ball);
        state.drawnSet.add(ballKey);
        marcarBola(ball.ball);
        renderBolas();
        $("stat-posicion").textContent = ball.position;
      });

      connection.on("LineWinnersUpdated", (winners) => {
        log("winner", "LineWinnersUpdated", winners);
        if (!perteneceAlSorteoSeleccionado(winners)) return;
        upsertPlay(eventPlay(winners, "line"));
        renderJugadas();
      });

      connection.on("SpecialPlayWinnersUpdated", (winners) => {
        log("winner", "SpecialPlayWinnersUpdated", winners);
        if (!perteneceAlSorteoSeleccionado(winners)) return;
        upsertPlay(eventPlay(winners, "special"));
        renderJugadas();
      });

      connection.on("LotteryCompleted", (completed) => {
        log("winner", "LotteryCompleted 🏆", completed);
        if (!perteneceAlSorteoSeleccionado(completed)) return;
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
      connection.onreconnecting(() => {
        state.lobbyAcknowledgement = null;
        state.lotteryAcknowledgement = null;
        setEstado("Reconectando...", "warn");
      });
      connection.onreconnected(async () => {
        setEstado("Restaurando...", "warn");
        try {
          const lobbyAck = await connection.invoke("SubscribeToLobby");
          if (!acknowledgementValido(lobbyAck, "Lobby")) throw new Error("El lobby no confirmó la suscripción.");
          state.lobbyAcknowledgement = lobbyAck;
          log("info", "Suscripción al lobby restaurada", lobbyAck);
          if (state.subscription) {
            const method = state.subscription.type === "id" ? "SubscribeToLotteryById" : "SubscribeToLottery";
            const lotteryAck = await connection.invoke(method, state.subscription.value);
            if (!acknowledgementValido(lotteryAck, "Lottery")) throw new Error("El sorteo no confirmó la suscripción.");
            state.lotteryAcknowledgement = lotteryAck;
            state.lotteryCode = lotteryAck.lotteryCode ?? state.lotteryCode;
            log("info", `${method} restaurado → ${state.subscription.value}`, lotteryAck);
          }
          setEstado(state.subscription ? "Suscrito" : "Conectado", "conectado");
        } catch (err) {
          setEstado("Reconexión incompleta", "cerrado");
          log("error", "No se pudieron restaurar las suscripciones", { message: err.message });
        }
      });
      connection.onclose(() => {
        state.lobbyAcknowledgement = null;
        state.lotteryAcknowledgement = null;
        setEstado("Desconectado", "cerrado");
        detenerTimerLobby();
      });

      await connection.start();
      state.connection = connection;
      log("info", `Conectado a ${apiBase}/lotteryHub — ID: ${connection.connectionId}`);

      setEstado("Conectado", "conectado");
      const lobbyAck = await connection.invoke("SubscribeToLobby");
      if (!acknowledgementValido(lobbyAck, "Lobby")) throw new Error("El lobby no confirmó la suscripción.");
      state.lobbyAcknowledgement = lobbyAck;
      log("info", "SubscribeToLobby confirmado", lobbyAck);

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
      if (state.connection) {
        try { await state.connection.stop(); } catch (_) {}
        state.connection = null;
      }
      state.lobbyAcknowledgement = null;
      state.lotteryAcknowledgement = null;
      state.accessToken = null;
      setEstado("Desconectado", "cerrado");
      $("msg-conexion").textContent = mensajeError(err);
      $("btn-conectar").disabled = false;
    }
  },

  async suscribirSorteo(codigo) {
    const value = String(codigo ?? $("lottery-code-dash").value).trim();
    if (!value || !state.connection) return;
    const isId = GUID_PATTERN.test(value);
    const nextSubscription = { type: isId ? "id" : "code", value };
    const previous = {
      subscription: state.subscription,
      lotteryCode: state.lotteryCode,
      lotteryId: state.lotteryId,
    };
    let previousWasUnsubscribed = false;
    $("msg-sorteo").textContent = "Suscribiendo...";
    try {
      if (state.lotteryCode && state.subscription?.value !== value) {
        await state.connection.invoke("UnsubscribeFromLottery", state.lotteryCode);
        previousWasUnsubscribed = true;
        log("warn", `UnsubscribeFromLottery → ${state.lotteryCode}`);
      }
      state.subscription = nextSubscription;
      state.lotteryCode = isId ? null : value;
      state.lotteryId = isId ? value : null;
      resetLotteryView();
      const method = isId ? "SubscribeToLotteryById" : "SubscribeToLottery";
      const acknowledgement = await state.connection.invoke(method, value);
      if (!acknowledgementValido(acknowledgement, "Lottery")) {
        throw new Error("El servidor no confirmó la suscripción al sorteo.");
      }
      state.lotteryAcknowledgement = acknowledgement;
      state.lotteryCode = acknowledgement.lotteryCode ?? state.lotteryCode;
      setEstado("Suscrito", "conectado");
      log("info", `${method} confirmado → ${value}`, acknowledgement);
      $("msg-sorteo").textContent = "";
    } catch (err) {
      state.subscription = previous.subscription;
      state.lotteryCode = previous.lotteryCode;
      state.lotteryId = previous.lotteryId;
      if (previousWasUnsubscribed && previous.subscription) {
        try {
          const restoreMethod = previous.subscription.type === "id" ? "SubscribeToLotteryById" : "SubscribeToLottery";
          const restoreAck = await state.connection.invoke(restoreMethod, previous.subscription.value);
          if (!acknowledgementValido(restoreAck, "Lottery")) throw new Error("No se confirmó la restauración.");
          state.lotteryAcknowledgement = restoreAck;
          log("info", `Suscripción anterior restaurada → ${previous.subscription.value}`, restoreAck);
        } catch (restoreErr) {
          log("error", "Tampoco se pudo restaurar la suscripción anterior", { message: restoreErr.message });
          state.subscription = null;
          state.lotteryCode = null;
          state.lotteryId = null;
        }
      }
      const detail = mensajeError(err);
      log("error", `Error al suscribirse a ${value}`, { message: err.message, type: isId ? "GID" : "código" });
      $("msg-sorteo").textContent = `No se pudo entrar: ${detail}`;
    }
  },

  async refrescarLobby() {
    if (!state.connection) return;
    const button = $("btn-refrescar-lobby");
    button.disabled = true;
    try {
      await state.connection.invoke("UnsubscribeFromLobby");
      const lobbyAck = await state.connection.invoke("SubscribeToLobby");
      if (!acknowledgementValido(lobbyAck, "Lobby")) throw new Error("El lobby no confirmó la suscripción.");
      state.lobbyAcknowledgement = lobbyAck;
      log("info", "Lobby refrescado", lobbyAck);
    } catch (err) {
      log("error", "No se pudo refrescar el lobby", { message: err.message });
    } finally {
      button.disabled = false;
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
    state.lotteryId = null;
    state.subscription = null;
    resetLotteryView();
    setEstado("Conectado", "conectado");
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
    state.lotteryId = null;
    state.subscription = null;
    state.lobbyAcknowledgement = null;
    state.accessToken = null;
    resetLotteryView();
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

