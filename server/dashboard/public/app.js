/* ==========================================================================
   MeshBoat DASHBOARD – Real-time Logic, Latching Alarms, i18n (IT/EN) & Debug
   ========================================================================== */

const POLL_INTERVAL_MS = 2500;
let currentChartRange = "-6h";
let cachedRecords = [];
let currentLang = localStorage.getItem("meshboat_lang") || "it";

// Dizionario completo Italiano / Inglese ("Università di Genova" resta fisso in HTML)
const I18N = {
    it: {
        dashboard_sub: "DASHBOARD",
        debug_title: "ULTIMO MESSAGGIO RICEVUTO (RAW PAYLOAD)",
        sim_label: "Simula:",
        sim_tel_btn: "Telemetria",
        sensor_reed1: "Sensore Reed 1",
        sensor_reed2: "Sensore Reed 2",
        sensor_pir: "Sensore PIR",
        sensor_dht: "Sensore DHT11",
        sensor_mesh: "Nodo Meshtastic",
        card_status: "STATO",
        card_env: "AMBIENTE",
        card_lora: "RETE LoRa",
        btn_arm: "Arma",
        btn_disarm: "Disarma",
        btn_status: "Stato",
        status_safe: "SICURO",
        status_alarm: "ALLARME",
        status_disarmed: "DISARMATO",
        pill_online: "ON-LINE",
        pill_offline: "OFF-LINE",
        pill_intrusion: "INTRUSIONE",
        lora_connected: "CONNESSO",
        lora_reconnecting: "RICONNESSIONE...",
        chart_title: "TELEMETRIA AMBIENTALE",
        legend_temp: "Temperatura (°C)",
        legend_hum: "Umidità (%)",
        log_title: "REGISTRO EVENTI",
        th_time: "Orario",
        th_type: "Tipo",
        th_source: "Sorgente",
        th_state: "Stato",
        th_weather: "Ambiente",
        th_bat: "Bat.",
        loading_events: "Caricamento eventi...",
        empty_events: "Nessun evento registrato.",
        no_chart_data: "Nessun dato telemetrico disponibile",
        state_armed: "Armato",
        state_disarmed: "Disarmato",
        src_prua: "Portello Prua",
        src_cabina: "Porta Cabina",
        src_pir: "Sensore PIR",
        src_timer: "Timer",
        src_boot: "Avvio",
        src_cmd: "Comando LoRa",
        src_stat: "Richiesta Stato",
        src_web: "Web Dashboard",
        toast_sending_arm: "Invio comando ARMA...",
        toast_sending_disarm: "Invio comando DISARMA (Reset allarmi)...",
        toast_sending_status: "Richiesta STATO inviata...",
        toast_cmd_ok_arm: "Sistema ARMATO",
        toast_cmd_ok_disarm: "Sistema DISARMATO e allarmi resettati",
        toast_cmd_ok_status: "Richiesta STATO inviata via LoRa",
        toast_sim_ok: "Evento simulato inviato",
        toast_err: "Errore di comunicazione con Node-RED"
    },
    en: {
        dashboard_sub: "DASHBOARD",
        debug_title: "LAST MESSAGE RECEIVED (RAW PAYLOAD)",
        sim_label: "Simulate:",
        sim_tel_btn: "Telemetry",
        sensor_reed1: "Reed Sensor 1",
        sensor_reed2: "Reed Sensor 2",
        sensor_pir: "PIR Sensor",
        sensor_dht: "DHT11 Sensor",
        sensor_mesh: "Meshtastic Node",
        card_status: "STATUS",
        card_env: "ENVIRONMENT",
        card_lora: "LoRa NETWORK",
        btn_arm: "Arm",
        btn_disarm: "Disarm",
        btn_status: "Status",
        status_safe: "SAFE",
        status_alarm: "ALARM",
        status_disarmed: "DISARMED",
        pill_online: "ON-LINE",
        pill_offline: "OFF-LINE",
        pill_intrusion: "INTRUSION",
        lora_connected: "CONNECTED",
        lora_reconnecting: "RECONNECTING...",
        chart_title: "ENVIRONMENTAL TELEMETRY",
        legend_temp: "Temperature (°C)",
        legend_hum: "Humidity (%)",
        log_title: "EVENT LOG",
        th_time: "Time",
        th_type: "Type",
        th_source: "Source",
        th_state: "State",
        th_weather: "Weather",
        th_bat: "Bat.",
        loading_events: "Loading events...",
        empty_events: "No events recorded.",
        no_chart_data: "No telemetry data available",
        state_armed: "Armed",
        state_disarmed: "Disarmed",
        src_prua: "Bow Hatch",
        src_cabina: "Cabin Door",
        src_pir: "PIR Sensor",
        src_timer: "Timer",
        src_boot: "Boot",
        src_cmd: "LoRa Command",
        src_stat: "Status Req.",
        src_web: "Web Dashboard",
        toast_sending_arm: "Sending ARM command...",
        toast_sending_disarm: "Sending DISARM command (Clearing alarms)...",
        toast_sending_status: "Sending STATUS request...",
        toast_cmd_ok_arm: "System ARMED",
        toast_cmd_ok_disarm: "System DISARMED & alarms cleared",
        toast_cmd_ok_status: "STATUS request sent via LoRa",
        toast_sim_ok: "Simulated event sent",
        toast_err: "Communication error with Node-RED"
    }
};

function t(key) {
    return (I18N[currentLang] && I18N[currentLang][key]) || I18N.it[key] || key;
}

document.addEventListener("DOMContentLoaded", () => {
    applyStaticTranslations();
    updateBoatOrientation();
    fetchDashboardData();
    setInterval(fetchDashboardData, POLL_INTERVAL_MS);

    window.addEventListener("resize", () => {
        updateBoatOrientation();
        drawTelemetryChart(cachedRecords);
    });
});

/**
 * Su Mobile (<= 640px) ruota il disegno della barca in verticale (prua verso l'alto)
 */
function updateBoatOrientation() {
    const svg = document.getElementById("boat-svg");
    const group = document.getElementById("boat-blueprint-group");
    if (!svg || !group) return;

    if (window.innerWidth <= 640) {
        svg.setAttribute("viewBox", "0 0 540 1100");
        group.setAttribute("transform", "translate(0, 1100) rotate(-90)");
    } else {
        svg.setAttribute("viewBox", "0 0 1100 540");
        group.removeAttribute("transform");
    }
}

/**
 * Cambia lingua tra Italiano ('it') e Inglese ('en')
 * Tutto viene tradotto tranne "Università di Genova"
 */
function setLanguage(lang) {
    if (lang !== "it" && lang !== "en") return;
    currentLang = lang;
    localStorage.setItem("meshboat_lang", lang);
    document.documentElement.lang = lang;

    applyStaticTranslations();
    updateDashboardUI(cachedRecords);
}

function applyStaticTranslations() {
    document.getElementById("lang-it").classList.toggle("active", currentLang === "it");
    document.getElementById("lang-en").classList.toggle("active", currentLang === "en");

    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (key) el.textContent = t(key);
    });
}

function toggleDebugCard() {
    const card = document.getElementById("debug-card");
    const btn = document.getElementById("debug-toggle-btn");
    const isHidden = card.classList.toggle("hidden");
    btn.classList.toggle("active", !isHidden);
}

/**
 * Esegue la query Flux verso InfluxDB v2
 */
async function fetchDashboardData() {
    const fluxQuery = `
from(bucket: "telemetry")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "meshboatguard_telemetry")
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> group()
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 80)
`.trim();

    try {
        const res = await fetch("/api/query", {
            method: "POST",
            headers: {
                "Content-Type": "application/vnd.flux",
                "Accept": "application/csv"
            },
            body: fluxQuery
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const csvText = await res.text();
        const records = parseInfluxCSV(csvText);

        cachedRecords = records;
        updateDashboardUI(records);
    } catch (err) {
        console.warn("[MeshBoat Dashboard] InfluxDB fetch error:", err);
        setConnectionState(false);
    }
}

function parseInfluxCSV(csv) {
    if (!csv || !csv.trim()) return [];

    const lines = csv.replace(/\r\n/g, "\n").split("\n");
    let headers = null;
    const rows = [];

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const cols = splitCSVLine(rawLine);
        if (cols[1] === "result" && cols[2] === "table") {
            headers = cols;
            continue;
        }
        if (!headers) continue;

        const obj = {};
        for (let i = 0; i < headers.length; i++) {
            const key = headers[i];
            if (key) obj[key] = cols[i];
        }

        if (obj._time) {
            rows.push({
                time: new Date(obj._time),
                device: obj.device || "BoatGuard_01",
                source: (obj.source || "UNK").toUpperCase(),
                msg_type: (obj.msg_type || "TEL").toUpperCase(),
                armed: obj.armed !== undefined && obj.armed !== "" ? Number(obj.armed) : 1,
                alarm_active: obj.alarm_active !== undefined && obj.alarm_active !== "" ? Number(obj.alarm_active) : 0,
                temperature: obj.temperature !== undefined && obj.temperature !== "" ? parseFloat(obj.temperature) : null,
                humidity: obj.humidity !== undefined && obj.humidity !== "" ? parseFloat(obj.humidity) : null,
                battery: obj.battery !== undefined && obj.battery !== "" ? parseInt(obj.battery, 10) : null
            });
        }
    }

    rows.sort((a, b) => b.time - a.time);
    return rows;
}

function splitCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
            result.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

/**
 * Calcola tutti i sensori scattati dall'ultimo DISARM.
 * Se un sensore (o più sensori) scatta mentre il sistema è armato,
 * rimane ROSSO finché non viene eseguito un DISARM!
 */
function computeLatchedAlarms(records) {
    const triggeredZones = new Set();
    if (!records || records.length === 0) return triggeredZones;

    // Se l'ultimo stato attuale è DISARMED (armed === 0), il disarmo ha "pulito" tutti gli allarmi
    if (records[0].armed === 0) {
        return triggeredZones;
    }

    // Scorre dal pacchetto più recente all'indietro fino all'ultimo evento di DISARM (armed === 0)
    for (const r of records) {
        if (r.armed === 0) {
            break; // Trovato l'ultimo disarm: ci fermiamo qui
        }
        if (r.alarm_active === 1 || r.msg_type === "ALM") {
            triggeredZones.add(r.source);
        }
    }

    return triggeredZones;
}

/**
 * Aggiorna l'interfaccia utente
 */
function updateDashboardUI(records) {
    setConnectionState(true);

    if (!records || records.length === 0) {
        drawTelemetryChart([]);
        renderEventsTable([]);
        return;
    }

    const latest = records[0];

    const lastWithTemp = records.find(r => r.temperature !== null && !isNaN(r.temperature)) || latest;
    const lastWithHum = records.find(r => r.humidity !== null && !isNaN(r.humidity)) || latest;
    const lastWithBat = records.find(r => r.battery !== null && !isNaN(r.battery)) || latest;

    const tempVal = lastWithTemp.temperature !== null ? lastWithTemp.temperature : 22;
    const humVal = lastWithHum.humidity !== null ? lastWithHum.humidity : 54;
    const batVal = lastWithBat.battery !== null ? lastWithBat.battery : 98;

    // 1. Aggiorna Card DEBUG (Ultimo messaggio raw ricostruito)
    const rawPayloadObj = {
        t: latest.msg_type,
        dev: latest.device,
        s: latest.armed === 1 ? "ARM" : "DIS",
        src: latest.source,
        tmp: tempVal,
        hum: Math.round(humVal),
        bat: batVal
    };
    document.getElementById("debug-raw-json").textContent = JSON.stringify(rawPayloadObj);
    document.getElementById("debug-timestamp").textContent = formatDateTime(latest.time);

    // 2. Calcola allarmi "latched" finché non si fa Disarm
    const isArmed = latest.armed === 1;
    const triggeredZones = computeLatchedAlarms(records);
    const hasLatchedAlarm = isArmed && triggeredZones.size > 0;

    const statusCard = document.getElementById("status-card");
    const shieldWrapper = document.getElementById("shield-wrapper");
    const shieldPath = document.getElementById("shield-path");
    const statusMainText = document.getElementById("status-main-text");
    const statusSubText = document.getElementById("status-sub-text");
    const onlinePill = document.getElementById("online-pill");
    const onlineText = document.getElementById("online-text");

    const btnArm = document.getElementById("btn-arm");
    const btnDisarm = document.getElementById("btn-disarm");

    const markerReed1 = document.getElementById("marker-reed1");
    const markerReed2 = document.getElementById("marker-reed2");
    const markerPir = document.getElementById("marker-pir");
    const zoneCabina = document.getElementById("zone-highlight-cabina");
    const zonePrua = document.getElementById("zone-highlight-prua");

    // Reset iniziale (verde sicuro)
    markerReed1.className = "sensor-marker marker-reed1 status-safe";
    markerReed2.className = "sensor-marker marker-reed2 status-safe";
    markerPir.className = "sensor-marker marker-pir status-safe";
    zoneCabina.classList.remove("active-alarm");
    zonePrua.classList.remove("active-alarm");

    if (hasLatchedAlarm) {
        // UNO O PIÙ SENSORI SONO SCATTATI E NON È ANCORA STATO FATTO DISARM
        statusCard.classList.add("alarm-border");
        shieldWrapper.classList.add("shield-alarm");
        shieldPath.setAttribute("fill", "#e53935");

        statusMainText.textContent = t("status_alarm");
        statusMainText.style.color = "#c62828";

        onlinePill.className = "online-pill alarm";
        onlineText.textContent = t("pill_intrusion");

        // Accende di ROSSO tutti i sensori scattati prima del disarm!
        if (triggeredZones.has("CABINA")) {
            markerReed1.className = "sensor-marker marker-reed1 status-alarm";
            zoneCabina.classList.add("active-alarm");
        }
        if (triggeredZones.has("PRUA")) {
            markerReed2.className = "sensor-marker marker-reed2 status-alarm";
            zonePrua.classList.add("active-alarm");
        }
        if (triggeredZones.has("PIR")) {
            markerPir.className = "sensor-marker marker-pir status-alarm";
            zoneCabina.classList.add("active-alarm");
        }

        const zoneNames = Array.from(triggeredZones).map(z => getSourceText(z));
        statusSubText.textContent = zoneNames.join(" + ");
        statusSubText.classList.remove("hidden");
    } else if (isArmed) {
        // SISTEMA ARMATO E SICURO
        statusCard.classList.remove("alarm-border");
        shieldWrapper.classList.remove("shield-alarm");
        shieldPath.setAttribute("fill", "#43b554");

        statusMainText.textContent = t("status_safe");
        statusMainText.style.color = "#0b2e46";
        statusSubText.textContent = "";
        statusSubText.classList.add("hidden");

        onlinePill.className = "online-pill online";
        onlineText.textContent = t("pill_online");
    } else {
        // SISTEMA DISARMATO (Pulisce qualsiasi allarme precedente)
        statusCard.classList.remove("alarm-border");
        shieldWrapper.classList.remove("shield-alarm");
        shieldPath.setAttribute("fill", "#3b82f6");

        statusMainText.textContent = t("status_disarmed");
        statusMainText.style.color = "#1e40af";
        statusSubText.textContent = "";
        statusSubText.classList.add("hidden");

        onlinePill.className = "online-pill online";
        onlineText.textContent = t("pill_online");
    }

    btnArm.classList.toggle("active-state", isArmed);
    btnDisarm.classList.toggle("active-state", !isArmed);

    // 3. Card AMBIENTE
    const formattedTemp = Number.isInteger(tempVal) ? tempVal : tempVal.toFixed(1);
    document.getElementById("temp-value").textContent = formattedTemp;
    document.getElementById("hum-value").textContent = Math.round(humVal);

    // 4. Card RETE LoRa + Solo iconcina Batteria e percentuale
    const clampedBat = Math.max(0, Math.min(100, batVal));
    document.getElementById("bat-value").textContent = clampedBat;
    const batIcon = document.getElementById("bat-icon");

    if (clampedBat >= 50) {
        batIcon.textContent = "battery_full";
        batIcon.style.color = "#3fb950";
    } else if (clampedBat >= 20) {
        batIcon.textContent = "battery_4_bar";
        batIcon.style.color = "#f59f00";
    } else {
        batIcon.textContent = "battery_alert";
        batIcon.style.color = "#e53935";
    }

    document.getElementById("lora-status-text").textContent = t("lora_connected");

    // 5. Grafico e Tabella
    drawTelemetryChart(records);
    renderEventsTable(records);
}

function setConnectionState(isConnected) {
    const onlinePill = document.getElementById("online-pill");
    const onlineText = document.getElementById("online-text");
    const loraStatus = document.getElementById("lora-status-text");

    if (!isConnected) {
        onlinePill.className = "online-pill offline";
        onlineText.textContent = t("pill_offline");
        loraStatus.textContent = t("lora_reconnecting");
    }
}

/**
 * Invio comandi (Arma / Disarma / Stato)
 */
async function sendBoatCommand(action) {
    const sendMsgs = {
        arm: { icon: "lock", text: t("toast_sending_arm") },
        disarm: { icon: "lock_open", text: t("toast_sending_disarm") },
        status: { icon: "sync", text: t("toast_sending_status") }
    };
    const info = sendMsgs[action] || { icon: "send", text: "..." };
    showToast(info.text, info.icon);

    try {
        const res = await fetch("/api/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (data && data.ok) {
            const okText = action === "arm" ? t("toast_cmd_ok_arm")
                         : action === "disarm" ? t("toast_cmd_ok_disarm")
                         : t("toast_cmd_ok_status");
            showToast(okText, "check_circle");
            setTimeout(fetchDashboardData, 300);
        } else {
            showToast(t("toast_err"), "error");
        }
    } catch (err) {
        showToast(t("toast_err"), "error");
    }
}

function setChartRange(range, btnEl) {
    currentChartRange = range;
    document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");
    drawTelemetryChart(cachedRecords);
}

/**
 * Grafico Telemetria Ambientale su Canvas HTML5
 */
function drawTelemetryChart(records) {
    const canvas = document.getElementById("telemetry-chart");
    if (!canvas || !canvas.parentElement) return;
    const ctx = canvas.getContext("2d");

    const W = canvas.parentElement.clientWidth || 300;
    const H = canvas.parentElement.clientHeight || 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const now = Date.now();
    const rangeHours = currentChartRange === "-1h" ? 1 : currentChartRange === "-6h" ? 6 : 24;
    const cutoff = now - rangeHours * 3600 * 1000;

    let valid = (records || []).filter(r => r.temperature !== null && r.humidity !== null);
    let filtered = valid.filter(r => r.time.getTime() >= cutoff);
    if (filtered.length < 2) {
        filtered = valid.slice(0, 20);
    }

    const pts = [...filtered].reverse();

    if (pts.length === 0) {
        ctx.fillStyle = "#7b93a4";
        ctx.font = "500 14px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(t("no_chart_data"), W / 2, H / 2);
        return;
    }

    const padLeft = 42;
    const padRight = 42;
    const padTop = 18;
    const padBottom = 30;
    const plotW = W - padLeft - padRight;
    const plotH = H - padTop - padBottom;

    const temps = pts.map(p => p.temperature);
    const minTemp = Math.floor(Math.min(...temps, 15) - 2);
    const maxTemp = Math.ceil(Math.max(...temps, 30) + 2);
    const minHum = 0;
    const maxHum = 100;

    const gridSteps = 4;
    ctx.strokeStyle = "#edf2f7";
    ctx.lineWidth = 1;
    ctx.font = "600 11px -apple-system, BlinkMacSystemFont, sans-serif";

    for (let i = 0; i <= gridSteps; i++) {
        const y = padTop + (plotH / gridSteps) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(W - padRight, y);
        ctx.stroke();

        const tVal = (maxTemp - ((maxTemp - minTemp) / gridSteps) * i).toFixed(0);
        ctx.fillStyle = "#d97706";
        ctx.textAlign = "right";
        ctx.fillText(`${tVal}°`, padLeft - 8, y + 4);

        const hVal = (maxHum - ((maxHum - minHum) / gridSteps) * i).toFixed(0);
        ctx.fillStyle = "#2b98f0";
        ctx.textAlign = "left";
        ctx.fillText(`${hVal}%`, W - padRight + 8, y + 4);
    }

    const getX = (idx) => {
        if (pts.length === 1) return padLeft + plotW / 2;
        return padLeft + (idx / (pts.length - 1)) * plotW;
    };
    const getYTemp = (val) => padTop + plotH - ((val - minTemp) / (maxTemp - minTemp || 1)) * plotH;
    const getYHum = (val) => padTop + plotH - ((val - minHum) / (maxHum - minHum || 1)) * plotH;

    drawSmoothSeries(ctx, pts.map((p, i) => ({ x: getX(i), y: getYHum(p.humidity) })), "#2b98f0", "rgba(43, 152, 240, 0.10)", padTop + plotH);
    drawSmoothSeries(ctx, pts.map((p, i) => ({ x: getX(i), y: getYTemp(p.temperature) })), "#f59f00", "rgba(245, 159, 0, 0.14)", padTop + plotH);

    ctx.fillStyle = "#64748b";
    ctx.textAlign = "center";
    const labelCount = Math.min(pts.length, W < 480 ? 3 : 5);
    for (let i = 0; i < labelCount; i++) {
        const idx = labelCount === 1 ? 0 : Math.round((i / (labelCount - 1)) * (pts.length - 1));
        const x = getX(idx);
        ctx.fillText(formatTimeShort(pts[idx].time), x, H - 8);
    }
}

function drawSmoothSeries(ctx, coords, strokeColor, fillColor, baselineY) {
    if (coords.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(coords[0].x, baselineY);
    coords.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(coords[coords.length - 1].x, baselineY);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.beginPath();
    coords.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    coords.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

/**
 * Tabella Registro Eventi con Google Material Icons (zero emoji)
 */
function renderEventsTable(records) {
    const tbody = document.getElementById("events-tbody");
    if (!tbody) return;

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-row">${t("empty_events")}</td></tr>`;
        return;
    }

    const slice = records.slice(0, 50);
    tbody.innerHTML = slice.map(r => {
        const isAlm = r.alarm_active === 1 || r.msg_type === "ALM";
        const badgeClass = r.msg_type === "ALM" ? "badge-alm"
                         : r.msg_type === "ACK" ? "badge-ack"
                         : r.msg_type === "CFG" ? "badge-cfg"
                         : "badge-tel";

        const stateIcon = r.armed === 1 ? "lock" : "lock_open";
        const stateText = r.armed === 1 ? t("state_armed") : t("state_disarmed");
        const srcIcon = getSourceIconName(r.source);
        const srcText = getSourceText(r.source);

        const meteoStr = (r.temperature !== null && r.humidity !== null)
            ? `${r.temperature.toFixed(1)}°C · ${Math.round(r.humidity)}%`
            : "—";
        const batStr = r.battery !== null ? `${r.battery}%` : "—";

        return `
            <tr class="${isAlm ? 'row-alarm' : ''}">
                <td>${formatDateTime(r.time)}</td>
                <td><span class="badge-type ${badgeClass}">${r.msg_type}</span></td>
                <td>
                    <span class="cell-with-icon">
                        <span class="material-symbols-rounded">${srcIcon}</span>
                        <strong>${srcText}</strong>
                    </span>
                </td>
                <td>
                    <span class="cell-with-icon">
                        <span class="material-symbols-rounded">${stateIcon}</span>
                        <span>${stateText}</span>
                    </span>
                </td>
                <td>${meteoStr}</td>
                <td>${batStr}</td>
            </tr>
        `;
    }).join("");
}

function getSourceIconName(src) {
    const icons = {
        "PRUA": "sailing",
        "CABINA": "door_front",
        "PIR": "motion_sensor_active",
        "TIMER": "schedule",
        "BOOT": "power_settings_new",
        "CMD": "cell_tower",
        "STAT": "info",
        "WEB": "computer"
    };
    return icons[src] || "sensors";
}

function getSourceText(src) {
    const keys = {
        "PRUA": "src_prua",
        "CABINA": "src_cabina",
        "PIR": "src_pir",
        "TIMER": "src_timer",
        "BOOT": "src_boot",
        "CMD": "src_cmd",
        "STAT": "src_stat",
        "WEB": "src_web"
    };
    return keys[src] ? t(keys[src]) : src;
}

function formatTimeShort(date) {
    if (!date || isNaN(date)) return "--:--:--";
    const locale = currentLang === "en" ? "en-GB" : "it-IT";
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(date) {
    if (!date || isNaN(date)) return "--";
    const locale = currentLang === "en" ? "en-GB" : "it-IT";
    return date.toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function showToast(message, iconName = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<span class="material-symbols-rounded">${iconName}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.25s ease";
        setTimeout(() => toast.remove(), 260);
    }, 2800);
}
