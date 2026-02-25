(function () {
    "use strict";

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    // =========================================
    // CONFIG
    // =========================================
    const POPUP_WEBHOOK_URL =
        "https://n8n.clinicaexperts.com.br/webhook/d2f443f4-9d71-4b35-b370-96cefea1e9f8";

    const CONTACT_STORAGE_KEY = "ce_lead_contact_v1";

    // =========================================
    // RESULT VIDEO (YouTube)
    // =========================================
    // Cole aqui o link do vídeo (qualquer formato: watch, youtu.be, shorts ou embed)
    // Ex.: https://www.youtube.com/watch?v=XXXXXXXXXXX
    const RESULT_YOUTUBE_VIDEO_URL = "https://www.youtube.com/embed/_0v2nd4bR6A?rel=0";

    function toYouTubeEmbedUrl(raw) {
        const u = String(raw || "").trim();
        if (!u) return "";

        // Se já for embed
        if (u.includes("youtube.com/embed/")) return u;

        // Se for apenas um ID
        if (/^[a-zA-Z0-9_-]{6,}$/.test(u)) return `https://www.youtube.com/embed/${u}`;

        try {
            const url = new URL(u);

            // youtu.be/ID
            if (url.hostname.includes("youtu.be")) {
                const id = url.pathname.split("/").filter(Boolean)[0];
                return id ? `https://www.youtube.com/embed/${id}` : "";
            }

            if (url.hostname.includes("youtube.com")) {
                // watch?v=ID
                const v = url.searchParams.get("v");
                if (v) return `https://www.youtube.com/embed/${v}`;

                // /shorts/ID
                const m = url.pathname.match(/\/shorts\/([^\/\?]+)/);
                if (m && m[1]) return `https://www.youtube.com/embed/${m[1]}`;
            }
        } catch (_) { }

        return "";
    }

    function initResultVideoEmbed() {
        const iframe = $("#resultYoutubeEmbed");
        if (!iframe) return;

        const embed = toYouTubeEmbedUrl(RESULT_YOUTUBE_VIDEO_URL);
        const card = iframe.closest ? iframe.closest(".videoCard") : null;

        if (embed) {
            iframe.src = embed;
            if (card) card.classList.add("is-video-ready");
        } else {
            // mantém vazio e exibe o placeholder no HTML/CSS
            iframe.removeAttribute("src");
            if (card) card.classList.remove("is-video-ready");
        }
    }


    // =========================================
    // STATE
    // =========================================
    const state = {
        // Auditoria (3 etapas)
        fixedCostMonthly: null,     // R$
        openHoursMonthly: null,     // horas
        procedureName: "",
        procedurePrice: null,       // R$
        procedureMinutes: null,     // minutos
        taxesPercent: null,         // %
        commissionPercent: null,    // %
        cmvValue: null,             // R$

        // Modal especialista
        area: "",
        teamSize: "",
        isSubscriber: "",
        specialistChallenge: "",
        usesSystem: "",
        investmentOk: "",

        // Contato (reutilizado)
        leadName: "",
        leadPhone: "",
        leadEmail: "",
    };

    const AUDIT_FORM_STEPS = 3;   // 3 etapas do formulário
    const AUDIT_TOTAL_STEPS = 4;  // 3 etapas + Resultado no stepper
    let auditStepIndex = 1;

    // Chart.js
    let donutChart = null;

    // =========================================
    // HELPERS
    // =========================================
    function onlyDigits(s) {
        return String(s || "").replace(/\D+/g, "");
    }

    function parseIntSafe(value) {
        const d = onlyDigits(value);
        if (!d) return null;
        const n = Number(d);
        return Number.isFinite(n) ? n : null;
    }

    // =========================================
    // OPEN HOURS SCHEDULE (Step 1)
    // =========================================
    const OPEN_HOURS_WEEKS_PER_MONTH = 4; // aproximação simples (4 semanas)

    function syncOpenHoursFromSchedule() {
        const daysEl = $("#openWeekdaysSelect");
        const hoursEl = $("#openWeekdayHoursSelect");

        // Se não existir a UI de schedule, mantém compatibilidade com o input antigo
        if (!daysEl || !hoursEl) return parseIntSafe($("#openHoursInput")?.value);

        const days = parseIntSafe(daysEl.value);
        const hours = parseIntSafe(hoursEl.value);

        const sat = parseIntSafe($("#openSatHoursSelect")?.value);
        const sun = parseIntSafe($("#openSunHoursSelect")?.value);

        let monthly = null;

        if (days != null && hours != null && days > 0 && hours > 0) {
            const weekly = (days * hours) + (sat != null ? sat : 0) + (sun != null ? sun : 0);
            if (weekly > 0) monthly = weekly * OPEN_HOURS_WEEKS_PER_MONTH;
        }

        const hidden = $("#openHoursInput");
        if (hidden) hidden.value = monthly == null ? "" : String(monthly);

        const preview = $("#openHoursMonthlyPreview");
        if (preview) preview.textContent = monthly == null ? "0" : String(monthly);

        const result = $("#openHoursResult");
        if (result) result.dataset.ready = monthly == null ? "0" : "1";

        return monthly;
    }


    // =========================================
    // TYPEWRITER (CALLOUTS)
    // =========================================
    const TYPEWRITER_SPEED_MS = 14; // menor = mais rápido
    const TYPEWRITER_LIVE_IDS = new Set(["fixedHourlyCost", "procedureHoursRounded"]);

    function initCalloutTypewriterSystem() {
        $$(".callout.callout--warn .callout__text").forEach((el) => {
            if (!el.dataset.typewriterHtml) el.dataset.typewriterHtml = el.innerHTML;
            if (!el.dataset.typewriterTyped) el.dataset.typewriterTyped = "0";
            if (!el.dataset.typewriterTyping) el.dataset.typewriterTyping = "0";
        });

        // Observa mudanças de "hidden" para disparar o efeito em qualquer callout verde
        if (!initCalloutTypewriterSystem.__observer && document.body) {
            const obs = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type !== "attributes" || m.attributeName !== "hidden") continue;
                    const el = m.target;
                    if (!(el instanceof HTMLElement)) continue;
                    if (!el.classList.contains("callout") || !el.classList.contains("callout--warn")) continue;

                    if (el.hidden) resetCalloutTypewriter(el);
                    else maybeTypeCallout(el);
                }
            });

            obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
            initCalloutTypewriterSystem.__observer = obs;
        }
    }

    function resetCalloutTypewriter(calloutEl) {
        const textEl = calloutEl?.querySelector?.(".callout__text");
        if (!textEl) return;

        if (!textEl.dataset.typewriterHtml) textEl.dataset.typewriterHtml = textEl.innerHTML;

        if (textEl.__typewriterTimer) {
            clearTimeout(textEl.__typewriterTimer);
            textEl.__typewriterTimer = null;
        }

        textEl.dataset.typewriterTyping = "0";
        textEl.dataset.typewriterTyped = "0";
        textEl.innerHTML = textEl.dataset.typewriterHtml;
    }

    function maybeTypeCallout(calloutEl) {
        const textEl = calloutEl?.querySelector?.(".callout__text");
        if (!calloutEl || !textEl) return;
        if (calloutEl.hidden) return;

        if (!textEl.dataset.typewriterHtml) textEl.dataset.typewriterHtml = textEl.innerHTML;
        if (textEl.dataset.typewriterTyped === "1" || textEl.dataset.typewriterTyping === "1") return;

        runTypewriterOnElement(textEl);
    }

    function runTypewriterOnElement(textEl) {
        if (textEl.__typewriterTimer) {
            clearTimeout(textEl.__typewriterTimer);
            textEl.__typewriterTimer = null;
        }

        const html = textEl.dataset.typewriterHtml ?? textEl.innerHTML;
        textEl.dataset.typewriterHtml = html;
        textEl.dataset.typewriterTyping = "1";
        textEl.dataset.typewriterTyped = "0";

        const template = document.createElement("template");
        template.innerHTML = html;

        const pairs = [];

        function cloneNode(src, parentIsLive) {
            if (!src) return null;

            if (src.nodeType === Node.TEXT_NODE) {
                const full = src.textContent || "";
                const tn = document.createTextNode(parentIsLive ? full : "");
                if (!parentIsLive && full.length) pairs.push({ node: tn, text: full });
                return tn;
            }

            if (src.nodeType === Node.ELEMENT_NODE) {
                const el = document.createElement(src.tagName.toLowerCase());

                for (const attr of Array.from(src.attributes || [])) {
                    el.setAttribute(attr.name, attr.value);
                }

                const isLive = !!(parentIsLive || (src.id && TYPEWRITER_LIVE_IDS.has(src.id)));

                for (const child of Array.from(src.childNodes || [])) {
                    const c = cloneNode(child, isLive);
                    if (c) el.appendChild(c);
                }

                return el;
            }

            return null;
        }

        // Mantém a mesma estrutura HTML e “digita” somente os textos
        textEl.innerHTML = "";
        for (const child of Array.from(template.content.childNodes)) {
            const c = cloneNode(child, false);
            if (c) textEl.appendChild(c);
        }

        let nodeIndex = 0;
        let charIndex = 0;

        const tick = () => {
            if (nodeIndex >= pairs.length) {
                textEl.dataset.typewriterTyping = "0";
                textEl.dataset.typewriterTyped = "1";
                textEl.__typewriterTimer = null;
                return;
            }

            const current = pairs[nodeIndex];
            const full = current.text || "";

            if (!full.length) {
                nodeIndex += 1;
                charIndex = 0;
                textEl.__typewriterTimer = setTimeout(tick, TYPEWRITER_SPEED_MS);
                return;
            }

            current.node.textContent = full.slice(0, charIndex + 1);
            charIndex += 1;

            if (charIndex >= full.length) {
                nodeIndex += 1;
                charIndex = 0;
            }

            textEl.__typewriterTimer = setTimeout(tick, TYPEWRITER_SPEED_MS);
        };

        tick();
    }




    function parseBRNumber(raw) {
        const s = String(raw || "").trim();
        if (!s) return null;

        let t = s.replace(/[^\d,.\-]/g, "");
        if (!t) return null;

        // 1.234,56 -> 1234.56
        if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
        else if (t.includes(",")) t = t.replace(",", ".");

        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }

    function clamp(n, min, max) {
        const v = Number(n);
        if (!Number.isFinite(v)) return null;
        return Math.max(min, Math.min(max, v));
    }

    function isValidEmail(email) {
        const e = String(email || "").trim();
        return e.includes("@") && e.includes(".") && e.length >= 6;
    }

    function formatBRL(n, decimals = 2) {
        const v = Number(n);
        if (!Number.isFinite(v)) return "R$ 0,00";
        return new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(v);
    }

    function formatPct(n, decimals = 1) {
        const v = Number(n);
        if (!Number.isFinite(v)) return "0%";
        return `${v.toFixed(decimals)}%`;
    }

    function getCookie(name) {
        const cookies = String(document.cookie || "")
            .split(";")
            .map((s) => s.trim());
        for (const c of cookies) {
            if (c.startsWith(name + "=")) return decodeURIComponent(c.slice(name.length + 1));
        }
        return "";
    }

    function normalizePhoneBRNational(raw) {
        let d = onlyDigits(raw).replace(/^0+/, "");
        if (!d) return "";
        if (d.startsWith("55")) d = d.slice(2);
        return d;
    }

    function normalizePhoneBR55(raw) {
        let d = normalizePhoneBRNational(raw);
        if (!d) return "";

        // se 10 dígitos (DDD + 8), insere o 9
        if (d.length === 10) d = d.slice(0, 2) + "9" + d.slice(2);

        if (d.length !== 11) return "";
        return "55" + d;
    }

    (function () {
        function isFiniteNumber(n) {
            return typeof n === "number" && Number.isFinite(n);
        }

        // Converte "1.000,00" / "1000" / "1000,5" => number
        function parseBRNumber(value) {
            const s = String(value ?? "").trim();
            if (!s) return null;

            // mantém dígitos + separadores básicos
            const cleaned = s.replace(/[^\d.,-]/g, "");
            if (!cleaned) return null;

            // remove milhares "." e troca "," por "."
            const normalized = cleaned.replace(/\./g, "").replace(/,/g, ".");
            const n = Number(normalized);
            return isFiniteNumber(n) ? n : null;
        }

        // Moeda como inteiro (reais) com ",00" fixo
        function parseMoneyInt(value) {
            const n = parseBRNumber(value);
            if (n === null) return null;
            // inteiro em reais (sem centavos)
            const i = Math.round(n);
            return i >= 0 ? i : 0;
        }

        function formatMoneyIntBR(intReais) {
            return `${intReais.toLocaleString("pt-BR")},00`;
        }

        function placeCaretBeforeComma(input) {
            const idx = input.value.indexOf(",");
            const pos = idx >= 0 ? idx : input.value.length;
            try { input.setSelectionRange(pos, pos); } catch (_) { }
        }

        function applyMoneyIntMask(input) {
            input.type = "text";
            input.inputMode = "numeric";
            input.autocomplete = "off";

            const update = () => {
                const n = parseMoneyInt(input.value);
                input.dataset.raw = n === null ? "" : String(n);
                input.value = n === null ? "" : formatMoneyIntBR(n);

                // evita “sumir” dígitos digitados depois do ",00"
                if (document.activeElement === input && input.value) {
                    placeCaretBeforeComma(input);
                }
            };

            input.addEventListener("focus", () => {
                if (input.value) placeCaretBeforeComma(input);
            });

            input.addEventListener("input", update);
            input.addEventListener("blur", update);

            update(); // formata valor inicial (se existir)
        }

        // Percentual com "%" no final
        function parsePercent(value) {
            const n = parseBRNumber(value);
            if (n === null) return null;
            const i = Math.round(n);
            return i >= 0 ? i : 0;
        }

        function formatPercentBR(intPct) {
            return `${intPct}%`;
        }

        function placeCaretBeforePercent(input) {
            const idx = input.value.indexOf("%");
            const pos = idx >= 0 ? idx : input.value.length;
            try { input.setSelectionRange(pos, pos); } catch (_) { }
        }

        function applyPercentMask(input) {
            input.type = "text";
            input.inputMode = "numeric";
            input.autocomplete = "off";

            const update = () => {
                const n = parsePercent(input.value);
                input.dataset.raw = n === null ? "" : String(n);
                input.value = n === null ? "" : formatPercentBR(n);

                if (document.activeElement === input && input.value) {
                    placeCaretBeforePercent(input);
                }
            };

            input.addEventListener("focus", () => {
                if (input.value) placeCaretBeforePercent(input);
            });

            input.addEventListener("input", update);
            input.addEventListener("blur", update);

            update();
        }

        document.addEventListener("DOMContentLoaded", () => {
            document.querySelectorAll('input[data-mask="money-int"]').forEach(applyMoneyIntMask);
            document.querySelectorAll('input[data-mask="percent"]').forEach(applyPercentMask);
        });

        // Helpers opcionais p/ seu cálculo/payload (não depende do dataset, mas ajuda)
        window.__getMoneyInt = (el) => parseMoneyInt(el?.value) ?? 0;
        window.__getPercentInt = (el) => parsePercent(el?.value) ?? 0;
    })();

    function normalizeTeam(teamLabel) {
        const t = String(teamLabel || "").trim();
        const map = {
            "Somente eu": "1",
            "Eu e mais uma pessoa": "2",
            "De 3 a 5 pessoas": "3 a 5",
            "De 6 a 10 pessoas": "6 a 10",
            "Mais de 10 pessoas": "Mais de 10",
        };
        return map[t] || t;
    }

    function mapAreaSlug(areaLabel) {
        const raw = String(areaLabel || "").trim();
        const a = raw.toLowerCase();
        const aNorm = a.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const map = {
            estética: "aesthetic",
            estetica: "aesthetic",
            odontologia: "dentistry",
            medicina: "medicine",
            biomedicina: "biomedicine",
            fisioterapia: "physiotherapy",
            psicologia: "psychology",
            nutrição: "nutrition",
            nutricao: "nutrition",
            podologia: "podiatry",
            massoterapia: "massage-therapy",
            micropigmentação: "micropigmentation",
            micropigmentacao: "micropigmentation",
            microblading: "microblading",
            "manicure/pedicure": "manicure-pedicure",
            "manicure / pedicure": "manicure-pedicure",
            "lash designer": "lash-designer",
            depilação: "depilation",
            depilacao: "depilation",
            "salão de beleza": "beauty",
            "salao de beleza": "beauty",
            outra: "default",
        };

        return map[a] || map[aNorm] || "";
    }

    function normalizeAreaValue(rawArea) {
        const raw = String(rawArea || "").trim();
        if (!raw) return "";

        const slug = mapAreaSlug(raw);
        if (slug) return slug;

        const maybe = raw.toLowerCase();
        const allowed = new Set([
            "aesthetic",
            "dentistry",
            "medicine",
            "biomedicine",
            "physiotherapy",
            "psychology",
            "nutrition",
            "beauty",
            "depilation",
            "lash-designer",
            "manicure-pedicure",
            "massage-therapy",
            "microblading",
            "micropigmentation",
            "podiatry",
            "default",
        ]);
        if (allowed.has(maybe)) return maybe;

        return "default";
    }

    function pickTrackingFromUrl() {
        const p = new URLSearchParams(window.location.search || "");
        const out = {};
        const keys = [
            "utm_campaign",
            "utm_content",
            "utm_id",
            "utm_medium",
            "utm_source",
            "utm_term",
            "fbclid",
            "gclid",
            "wbraid",
            "gbraid",
        ];
        keys.forEach((k) => {
            const v = p.get(k);
            if (v) out[k] = v;
        });
        const utmSearch = p.get("utm_search") || p.get("utm-search");
        if (utmSearch) out.utm_search = utmSearch;
        return out;
    }

    function getOrCreateEventId() {
        try {
            let eventId = window.localStorage.getItem("lead_event_id");
            if (!eventId) {
                const uuid =
                    window.crypto && typeof window.crypto.randomUUID === "function"
                        ? window.crypto.randomUUID()
                        : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
                            .toString(16)
                            .slice(2)}`;
                eventId = "lead-" + uuid;
                window.localStorage.setItem("lead_event_id", eventId);
            }
            return eventId;
        } catch (_) {
            const uuid =
                window.crypto && typeof window.crypto.randomUUID === "function"
                    ? window.crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
                        .toString(16)
                        .slice(2)}`;
            return "lead-" + uuid;
        }
    }

    function getFbp() {
        const fromCookie = getCookie("_fbp");
        if (fromCookie) return fromCookie;
        const p = new URLSearchParams(window.location.search || "");
        return p.get("fbp") || "";
    }

    function saveLeadContactToStorage() {
        try {
            const payload = {
                name: String(state.leadName || "").trim(),
                phone: normalizePhoneBRNational(state.leadPhone || ""),
                email: String(state.leadEmail || "").trim(),
                ts: Date.now(),
            };
            window.localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(payload));
        } catch (_) { }
    }

    function loadLeadContactFromStorage(force = false) {
        try {
            const raw = window.localStorage.getItem(CONTACT_STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!data || typeof data !== "object") return;

            const name = String(data.name || "").trim();
            const phone = normalizePhoneBRNational(data.phone || "").slice(0, 11);
            const email = String(data.email || "").trim();

            if (force || !state.leadName) state.leadName = name;
            if (force || !state.leadPhone) state.leadPhone = phone;
            if (force || !state.leadEmail) state.leadEmail = email;
        } catch (_) { }
    }

    async function postToWebhook(url, payloadObj) {
        const body = JSON.stringify(payloadObj);

        try {
            await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
                keepalive: true,
            });
            return;
        } catch (_) { }

        try {
            if (navigator.sendBeacon) {
                const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
                navigator.sendBeacon(url, blob);
                return;
            }
        } catch (_) { }

        try {
            await fetch(url, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "text/plain;charset=UTF-8" },
                body,
                keepalive: true,
            });
        } catch (_) { }
    }

    // =========================================
    // VIEWS
    // =========================================
    const views = $$(".view");

    function setActiveView(name) {
        views.forEach((v) => {
            const isTarget = v.dataset.view === name;
            v.classList.toggle("is-active", isTarget);
            v.setAttribute("aria-hidden", String(!isTarget));
        });
        window.scrollTo({ top: 0, behavior: "smooth" });

        if (name === "audit") {
            updateAuditStepper(auditStepIndex);
            setAuditStep(auditStepIndex);
        }

        if (name === "result") updateAuditStepper(4);
    }

    // =========================================
    // CÁLCULO
    // =========================================
    function computeAudit() {
        const fixed = Number(state.fixedCostMonthly || 0);
        const hours = Number(state.openHoursMonthly || 0);
        const price = Number(state.procedurePrice || 0);
        const minutes = Number(state.procedureMinutes || 0);

        const taxesPct = Number(state.taxesPercent || 0);
        const commPct = Number(state.commissionPercent || 0);
        const cmv = Number(state.cmvValue || 0);

        const costPerHour = hours > 0 ? fixed / hours : 0;

        // Regra "pulo do gato": custo de sala arredonda para cima em horas cheias
        const roomHoursRaw = minutes > 0 ? minutes / 60 : 0;
        const roomHoursRounded = minutes > 0 ? Math.ceil(roomHoursRaw) : 0;

        const taxes = (taxesPct / 100) * price;
        const commission = (commPct / 100) * price;
        const contribution = price - taxes - cmv - commission;

        const roomCost = costPerHour * roomHoursRounded;
        const profit = contribution - roomCost;

        const marginPct = price > 0 ? (profit / price) * 100 : 0;

        return {
            fixed,
            hours,
            costPerHour,
            procedureName: state.procedureName,
            price,
            minutes,
            roomHoursRaw,
            roomHoursRounded,
            taxesPct,
            commPct,
            cmv,
            taxes,
            commission,
            contribution,
            roomCost,
            profit,
            profitForChart: Math.max(0, profit),
            marginPct,
        };
    }

    // =========================================
    // AUDIT (3 ETAPAS)
    // =========================================
    function readAuditInputs() {
        state.fixedCostMonthly = parseBRNumber($("#fixedCostInput")?.value);
        state.openHoursMonthly = syncOpenHoursFromSchedule();

        state.procedureName = String($("#procedureNameInput")?.value || "").trim();
        state.procedurePrice = parseBRNumber($("#procedurePriceInput")?.value);
        state.procedureMinutes = parseIntSafe($("#procedureMinutesInput")?.value);

        state.taxesPercent = clamp(parseBRNumber($("#taxPctInput")?.value), 0, 100);
        state.commissionPercent = clamp(parseBRNumber($("#commissionPctInput")?.value), 0, 100);
        state.cmvValue = parseBRNumber($("#materialsCostInput")?.value);
    }

    function validateAuditSteps() {
        readAuditInputs();

        const ok1 =
            !!(state.fixedCostMonthly && state.fixedCostMonthly > 0) &&
            !!(state.openHoursMonthly && state.openHoursMonthly > 0);

        const ok2 =
            ok1 &&
            state.procedureName.length >= 2 &&
            !!(state.procedurePrice && state.procedurePrice > 0) &&
            !!(state.procedureMinutes && state.procedureMinutes > 0);

        const ok3 =
            ok2 &&
            state.taxesPercent != null &&
            state.commissionPercent != null &&
            state.cmvValue != null &&
            state.cmvValue >= 0;

        const next1 = $("#auditNext1");
        const next2 = $("#auditNext2");
        const toUnlock = $("#auditToUnlock");
        if (next1) next1.disabled = !ok1;
        if (next2) next2.disabled = !ok2;
        if (toUnlock) toUnlock.disabled = !ok3;

        // Callout Step 1
        const fixedCallout = $("#fixedCallout");
        const fixedHourlyCost = $("#fixedHourlyCost");
        if (fixedCallout) fixedCallout.hidden = !ok1;
        if (fixedHourlyCost && ok1) {
            const a = computeAudit();
            fixedHourlyCost.textContent = formatBRL(a.costPerHour, 2);
        }

        // Callout Step 2 (O pulo do gato do tempo de sala)
        const procedureCallout = $("#procedureCallout");
        if (procedureCallout) procedureCallout.hidden = !ok2;

        // Callout Step 3 (dica de custos variáveis)
        const variablesCallout = $("#variablesCallout");
        if (variablesCallout) variablesCallout.hidden = !ok3;

        // Callout Step 2 (horas arredondadas)
        const hoursRounded = $("#procedureHoursRounded");
        if (hoursRounded) {
            const mins = Number(state.procedureMinutes || 0);
            const hr = mins > 0 ? Math.ceil(mins / 60) : 1;
            hoursRounded.textContent = String(hr);
        }

        // Typewriter nas dicas verdes (callouts)
        if (fixedCallout) {
            if (!ok1) resetCalloutTypewriter(fixedCallout);
            else maybeTypeCallout(fixedCallout);
        }
        if (procedureCallout) {
            if (!ok2) resetCalloutTypewriter(procedureCallout);
            else maybeTypeCallout(procedureCallout);
        }
        if (variablesCallout) {
            if (!ok3) resetCalloutTypewriter(variablesCallout);
            else maybeTypeCallout(variablesCallout);
        }

        return { ok1, ok2, ok3 };
    }

    function updateAuditHeader(step) {
        const title = $("#auditStepTitle");
        const desc = $("#auditStepDesc");
        if (!title || !desc) return;

        const map = {
            1: {
                t: "O Custo de Existir",
                d: "Antes de atender qualquer paciente, sua clínica já tem um custo por hora.",
            },
            2: {
                t: "O Procedimento",
                d: "Agora vamos entender quanto esse procedimento paga de verdade para a sua clínica.",
            },
            3: {
                t: "Custos Variáveis",
                d: "Impostos, comissão e materiais: o que sai do caixa em cada atendimento.",
            },
        };

        const m = map[step] || map[1];
        title.textContent = m.t;
        desc.textContent = m.d;
    }

    function updateAuditStepper(activeStep) {
        const stepper = $("#auditStepper");
        const fill = $("#auditStepperFill");
        if (!stepper) return;

        const steps = Array.from(stepper.querySelectorAll(".auditStep"));
        steps.forEach((el) => {
            const idx = Number(el.dataset.step || el.getAttribute("data-step") || 0);
            el.classList.toggle("is-complete", idx < activeStep);
            el.classList.toggle("is-current", idx === activeStep);
            el.classList.toggle("is-upcoming", idx > activeStep);

            // troca o número por ✓ quando completo
            const dot = el.querySelector(".auditStep__dot");
            if (dot) dot.textContent = idx < activeStep ? "✓" : String(idx);
        });

        if (fill) {
            const pct = ((Math.max(1, Math.min(AUDIT_TOTAL_STEPS, activeStep)) - 1) / (AUDIT_TOTAL_STEPS - 1)) * 100;
            fill.style.width = `${pct}%`;
        }
    }

    function setAuditStep(n) {
        auditStepIndex = Math.max(1, Math.min(AUDIT_FORM_STEPS, Number(n) || 1));

        $$(".auditPane").forEach((pane) => {
            pane.classList.toggle("is-active", Number(pane.dataset.auditStep) === auditStepIndex);
        });

        updateAuditHeader(auditStepIndex);
        updateAuditStepper(auditStepIndex);
        validateAuditSteps();

        focusAuditStep(auditStepIndex);
    }

    function focusAuditStep(n) {
        const auditView = $('[data-view="audit"]');
        if (!auditView || !auditView.classList.contains('is-active')) return;

        const map = {
            1: "#fixedCostInput",
            2: "#procedureNameInput",
            3: "#taxPctInput",
        };
        const sel = map[n];
        setTimeout(() => {
            const el = sel ? $(sel) : null;
            if (el && typeof el.focus === "function") el.focus();
        }, 80);
    }

    function resetAuditForm() {
        state.fixedCostMonthly = null;
        state.openHoursMonthly = null;
        state.procedureName = "";
        state.procedurePrice = null;
        state.procedureMinutes = null;
        state.taxesPercent = null;
        state.commissionPercent = null;
        state.cmvValue = null;

        const clear = (id) => {
            const el = $(id);
            if (el) el.value = "";
        };

        clear("#fixedCostInput");
        clear("#openHoursInput");
        clear("#procedureNameInput");
        clear("#procedurePriceInput");
        clear("#procedureMinutesInput");
        clear("#taxPctInput");
        clear("#commissionPctInput");
        clear("#materialsCostInput");

        auditStepIndex = 1;
        setAuditStep(1);
    }

    // =========================================
    // RESULT UI + DONUT
    // =========================================
    function setText(id, value) {
        const el = $(id);
        if (el) el.textContent = value;
    }

    function setStatus(marginPct) {
        const card = $("#statusCard");
        const title = $("#statusTitle");
        const text = $("#statusText");
        if (!card || !title || !text) return;

        card.classList.remove("status--good", "status--warn", "status--bad");

        if (marginPct >= 25) {
            card.classList.add("status--good");
            title.textContent = "Parabéns! Sua margem está saudável.";
            text.textContent =
                "Sua precificação está no caminho certo! Continue monitorando para manter essa margem saudável.";
            return;
        }
        if (marginPct >= 10) {
            card.classList.add("status--warn");
            title.textContent = "Atenção: sua margem está apertada.";
            text.textContent =
                "Pequenos ajustes em comissão, custos e tempo de sala podem mudar bastante seu lucro real.";
            return;
        }

        card.classList.add("status--bad");
        title.textContent = "Alerta: você pode estar no prejuízo.";
        text.textContent =
            "Revisar impostos/taxas, comissão, materiais e custo de sala é urgente para não pagar para trabalhar.";
    }

    function renderDonut(audit) {
        const canvas = $("#donutChart");
        const legend = $("#donutLegend");
        if (!canvas || !window.Chart) return;

        const revenue = audit.price || 0;

        const parts = [
            { key: "taxes", label: "Impostos/Taxas", value: Math.max(0, audit.taxes), color: "#F59E0B" },
            { key: "cmv", label: "Materiais (CMV)", value: Math.max(0, audit.cmv), color: "#F97316" },
            { key: "commission", label: "Comissão", value: Math.max(0, audit.commission), color: "#1E3A8A" },
            { key: "room", label: "Custo da Sala", value: Math.max(0, audit.roomCost), color: "#9CA3AF" },
            { key: "profit", label: "Seu Lucro", value: Math.max(0, audit.profitForChart), color: "#10B981" },
        ];

        const dataValues = parts.map((p) => p.value);
        const labels = parts.map((p) => p.label);
        const colors = parts.map((p) => p.color);

        const ctx = canvas.getContext("2d");

        if (donutChart) {
            donutChart.data.labels = labels;
            donutChart.data.datasets[0].data = dataValues;
            donutChart.data.datasets[0].backgroundColor = colors;
            donutChart.update();
        } else {
            donutChart = new window.Chart(ctx, {
                type: "doughnut",
                data: {
                    labels,
                    datasets: [{ data: dataValues, backgroundColor: colors, borderWidth: 0 }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "68%",
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx2) => {
                                    const v = Number(ctx2.parsed || 0);
                                    const pct = revenue > 0 ? (v / revenue) * 100 : 0;
                                    return `${ctx2.label}: ${formatBRL(v, 2)} (${pct.toFixed(0)}%)`;
                                },
                            },
                        },
                    },
                },
            });
        }

        if (legend) {
            legend.innerHTML = "";
            parts.forEach((p) => {
                const pct = revenue > 0 ? (p.value / revenue) * 100 : 0;

                const item = document.createElement("div");
                item.className = "donutLegend__item";

                const sw = document.createElement("span");
                sw.className = "donutLegend__swatch";
                sw.style.background = p.color;

                const txt = document.createElement("span");
                txt.className = "donutLegend__text";
                txt.textContent = p.label;

                const val = document.createElement("span");
                val.className = "donutLegend__pct";
                val.textContent = `${pct.toFixed(0)}%`;

                item.appendChild(sw);
                item.appendChild(txt);
                item.appendChild(val);
                legend.appendChild(item);
            });
        }
    }

    function updateResultUI() {
        const a = computeAudit();

        setText("#resProcName", a.procedureName || "procedimento");
        setText("#resProcPrice", formatBRL(a.price, 2));

        setStatus(a.marginPct);

        setText("#dreRevenue", formatBRL(a.price, 2));
        setText("#dreTaxes", `-${formatBRL(a.taxes, 2)}`);
        setText("#dreMaterials", `-${formatBRL(a.cmv, 2)}`);
        setText("#dreCommission", `-${formatBRL(a.commission, 2)}`);
        setText("#dreContribution", formatBRL(a.contribution, 2));
        setText("#dreRoomCost", `-${formatBRL(a.roomCost, 2)}`);

        setText("#dreNetProfit", formatBRL(a.profit, 2));
        setText("#dreNetMargin", formatPct(a.marginPct, 1));

        renderDonut(a);
    }

    // =========================================
    // MODAL 1: desbloquear resultado (SHORT)
    // =========================================
    const preResultModal = $("#preResultModal");
    const preResultFormShort = $("#preResultFormShort");
    let lastFocusElPre = null;

    function prefillPreResultFromState() {
        const n = $("#preNameInput");
        const p = $("#prePhoneInput");
        const e = $("#preEmailInput");

        if (n && !String(n.value || "").trim() && state.leadName) n.value = state.leadName;
        if (p && !String(p.value || "").trim() && state.leadPhone) {
            p.value = state.leadPhone;
            formatPhoneFieldInPlace(p);
        }
        if (e && !String(e.value || "").trim() && state.leadEmail) e.value = state.leadEmail;
    }

    function openPreResultModal() {
        if (!preResultModal) return;

        lastFocusElPre = document.activeElement;
        preResultModal.hidden = false;
        preResultModal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";

        loadLeadContactFromStorage(false);
        prefillPreResultFromState();
        validatePreResultForm();

        setTimeout(() => {
            const el = $("#preNameInput");
            if (el && typeof el.focus === "function") el.focus();
        }, 60);
    }

    function closePreResultModal() {
        if (!preResultModal) return;
        preResultModal.hidden = true;
        preResultModal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";

        if (lastFocusElPre && typeof lastFocusElPre.focus === "function") {
            try {
                lastFocusElPre.focus();
            } catch (_) { }
        }
    }

    function readPreResultInputs() {
        state.leadName = String($("#preNameInput")?.value || "").trim();
        state.leadPhone = normalizePhoneBRNational($("#prePhoneInput")?.value || "");
        state.leadEmail = String($("#preEmailInput")?.value || "").trim();
    }

    function validatePreResultForm() {
        readPreResultInputs();

        const okName = state.leadName.length >= 2;
        const okPhone = !!normalizePhoneBR55(state.leadPhone);
        const okEmail = isValidEmail(state.leadEmail);

        const submitBtn = $("#preResultSubmitBtn");
        if (submitBtn) submitBtn.disabled = !(okName && okPhone && okEmail);

        return { okName, okPhone, okEmail };
    }

    // =========================================
    // MODAL 2: falar com especialista (FULL)
    // =========================================
    const specialistModal = $("#specialistModal");
    const specialistForm = $("#specialistForm");

    const SPECIALIST_TOTAL_STEPS = 3;
    let specialistStepIndex = 1;
    let lastFocusElSpecialist = null;

    function updateSpecialistStepper(active) {
        if (!specialistModal) return;
        const steps = Array.from(specialistModal.querySelectorAll(".stepperModal .stepModal"));
        steps.forEach((step) => {
            const idx = Number(step.dataset.index);
            step.classList.toggle("is-complete", idx < active);
            step.classList.toggle("is-current", idx === active);
            step.classList.toggle("is-upcoming", idx > active);

            const circle = step.querySelector(".step__circle");
            if (!circle) return;
            circle.textContent = idx < active ? "✓" : String(idx);
        });
    }

    function setSpecialistStep(n) {
        specialistStepIndex = Math.max(1, Math.min(SPECIALIST_TOTAL_STEPS, Number(n) || 1));
        if (!specialistModal) return;

        Array.from(specialistModal.querySelectorAll(".qualifyStep")).forEach((s) => {
            s.classList.toggle("is-active", Number(s.dataset.qualifyStep) === specialistStepIndex);
        });

        updateSpecialistStepper(specialistStepIndex);

        if (specialistStepIndex === 3) {
            loadLeadContactFromStorage(false);
            prefillSpecialistFromState();
        }

        validateSpecialistForm();
        focusSpecialistStep(specialistStepIndex);
    }

    function focusSpecialistStep(n) {
        const map = { 1: "#challengeInput", 2: "#areaInput", 3: "#nameInput" };
        setTimeout(() => {
            const sel = map[n];
            const el = sel ? $(sel) : null;
            if (el && typeof el.focus === "function") el.focus();
        }, 60);
    }

    function readSpecialistInputs() {
        state.area = String($("#areaInput")?.value || "").trim();
        state.teamSize = String($("#teamSizeInput")?.value || "").trim();

        const subRaw = String($("#subscriberInput")?.value || "").trim().toLowerCase();
        if (subRaw === "sim") state.isSubscriber = "yes";
        else if (subRaw === "não" || subRaw === "nao") state.isSubscriber = "no";
        else state.isSubscriber = "";

        state.leadName = String($("#nameInput")?.value || "").trim();
        state.leadPhone = normalizePhoneBRNational($("#phoneInput")?.value || "");
        state.leadEmail = String($("#emailInput")?.value || "").trim();

        state.specialistChallenge = String($("#challengeInput")?.value || "").trim();

        const usesRaw = String($("#usesSystemInput")?.value || "").trim().toLowerCase();
        if (usesRaw === "sim") state.usesSystem = "yes";
        else if (usesRaw === "não" || usesRaw === "nao") state.usesSystem = "no";
        else state.usesSystem = "";

        const invRaw = String($("#investmentOkInput")?.value || "").trim().toLowerCase();
        if (invRaw === "sim") state.investmentOk = "yes";
        else if (invRaw === "não" || invRaw === "nao") state.investmentOk = "no";
        else state.investmentOk = "";
    }

    function validateSpecialistForm() {
        readSpecialistInputs();

        const okChallenge = !!state.specialistChallenge;
        const okTeam = state.teamSize.length >= 2;
        const okUsesSystem = state.usesSystem === "yes" || state.usesSystem === "no";
        const okStep1 = okChallenge && okTeam && okUsesSystem;

        const okArea = state.area.length >= 2;
        const okSub = state.isSubscriber === "yes" || state.isSubscriber === "no";
        const okInvestment = state.investmentOk === "yes" || state.investmentOk === "no";
        const okStep2 = okArea && okSub && okInvestment;

        const okName = state.leadName.length >= 2;
        const okPhone = !!normalizePhoneBR55(state.leadPhone);
        const okEmail = isValidEmail(state.leadEmail);
        const okStep3 = okName && okPhone && okEmail;

        const nextBtn1 = $("#qualifyNextBtn");
        if (nextBtn1) nextBtn1.disabled = !okStep1;

        const nextBtn2 = $("#qualifyNextBtn2");
        if (nextBtn2) nextBtn2.disabled = !(okStep1 && okStep2);

        const submitBtn = $("#qualifySubmitBtn");
        if (submitBtn) submitBtn.disabled = !(okStep1 && okStep2 && okStep3);

        return { okStep1, okStep2, okStep3 };
    }

    function prefillSpecialistFromState() {
        const n = $("#nameInput");
        const p = $("#phoneInput");
        const e = $("#emailInput");

        if (n && !String(n.value || "").trim() && state.leadName) n.value = state.leadName;
        if (p && !String(p.value || "").trim() && state.leadPhone) {
            p.value = state.leadPhone;
            formatPhoneFieldInPlace(p);
        }
        if (e && !String(e.value || "").trim() && state.leadEmail) e.value = state.leadEmail;
    }

    function openSpecialistModal() {
        if (!specialistModal) return;

        lastFocusElSpecialist = document.activeElement;
        specialistModal.hidden = false;
        specialistModal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";

        // reseta respostas
        state.area = "";
        state.teamSize = "";
        state.isSubscriber = "";
        state.specialistChallenge = "";
        state.usesSystem = "";
        state.investmentOk = "";

        const resetSelect = (sel) => {
            const el = $(sel);
            if (!el) return;
            el.value = "";
            el.dispatchEvent(new Event("change", { bubbles: true }));
        };

        resetSelect("#areaInput");
        resetSelect("#teamSizeInput");
        resetSelect("#subscriberInput");
        resetSelect("#challengeInput");
        resetSelect("#usesSystemInput");
        resetSelect("#investmentOkInput");

        loadLeadContactFromStorage(false);
        prefillSpecialistFromState();
        setSpecialistStep(1);
    }

    function closeSpecialistModal() {
        if (!specialistModal) return;
        specialistModal.hidden = true;
        specialistModal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";

        if (lastFocusElSpecialist && typeof lastFocusElSpecialist.focus === "function") {
            try {
                lastFocusElSpecialist.focus();
            } catch (_) { }
        }
    }

    function buildPopupWebhookPayload() {
        const challenge = String(state.specialistChallenge || "").trim();
        const area = normalizeAreaValue(state.area);
        const team = normalizeTeam(state.teamSize);
        const system = state.usesSystem || "";
        const active = state.isSubscriber || "";
        const money = state.investmentOk || "";

        const name = state.leadName || "";
        const phone = state.leadPhone ? normalizePhoneBR55(state.leadPhone) : "";
        const email = state.leadEmail || "";

        const event_id = getOrCreateEventId();
        const fbp = getFbp();

        const referrer = document.referrer || "";
        const source_url = window.location.href;
        const user_agent = navigator.userAgent || "";
        const urlFields = pickTrackingFromUrl();

        const payload = {
            challenge,
            area,
            team,
            system,
            active,
            money,
            event: "diagnostico",
            event_id,
            referrer,
            source_url,
            user_agent,
        };

        if (email) payload.email = email;
        if (name) payload.name = name;
        if (phone) payload.phone = phone;

        if (urlFields.fbclid) payload.fbclid = urlFields.fbclid;
        if (urlFields.gclid) payload.gclid = urlFields.gclid;
        if (urlFields.wbraid) payload.wbraid = urlFields.wbraid;
        if (urlFields.gbraid) payload.gbraid = urlFields.gbraid;
        if (fbp) payload.fbp = fbp;

        if (urlFields.utm_campaign) payload.utm_campaign = urlFields.utm_campaign;
        if (urlFields.utm_content) payload.utm_content = urlFields.utm_content;
        if (urlFields.utm_id) payload.utm_id = urlFields.utm_id;
        if (urlFields.utm_medium) payload.utm_medium = urlFields.utm_medium;
        if (urlFields.utm_source) payload.utm_source = urlFields.utm_source;
        if (urlFields.utm_term) payload.utm_term = urlFields.utm_term;
        if (urlFields.utm_search) payload.utm_search = urlFields.utm_search;

        return payload;
    }

    // =========================================
    // AWAIT -> RESULT
    // =========================================
    let awaitTimer = null;

    function startAwaitThenResult() {
        setActiveView("await");

        clearTimeout(awaitTimer);
        awaitTimer = setTimeout(() => {
            updateResultUI();
            setActiveView("result");
        }, 2000);
    }

    // =========================================
    // INPUT LISTENERS (AUDIT)
    // =========================================
    $("#fixedCostInput")?.addEventListener("input", validateAuditSteps);

    function onOpenHoursScheduleChange() {
        validateAuditSteps();
    }

    $("#openWeekdaysSelect")?.addEventListener("change", onOpenHoursScheduleChange);
    $("#openWeekdayHoursSelect")?.addEventListener("change", onOpenHoursScheduleChange);
    $("#openSatHoursSelect")?.addEventListener("change", onOpenHoursScheduleChange);
    $("#openSunHoursSelect")?.addEventListener("change", onOpenHoursScheduleChange);


    $("#procedureNameInput")?.addEventListener("input", validateAuditSteps);
    $("#procedurePriceInput")?.addEventListener("input", validateAuditSteps);

    $("#procedureMinutesInput")?.addEventListener("input", (e) => {
        e.target.value = onlyDigits(e.target.value).slice(0, 4);
        validateAuditSteps();
    });

    $("#taxPctInput")?.addEventListener("input", (e) => {
        e.target.value = String(e.target.value || "").replace(/[^\d.,]/g, "").slice(0, 6);
        validateAuditSteps();
    });

    $("#commissionPctInput")?.addEventListener("input", (e) => {
        e.target.value = String(e.target.value || "").replace(/[^\d.,]/g, "").slice(0, 6);
        validateAuditSteps();
    });

    $("#materialsCostInput")?.addEventListener("input", validateAuditSteps);

    // =========================================
    // NAV (AUDIT)
    // =========================================
    $("#auditNext1")?.addEventListener("click", () => {
        const v = validateAuditSteps();
        if (!v.ok1) return;
        setAuditStep(2);
    });

    $("#auditBack2")?.addEventListener("click", () => setAuditStep(1));

    $("#auditNext2")?.addEventListener("click", () => {
        const v = validateAuditSteps();
        if (!v.ok2) return;
        setAuditStep(3);
    });

    $("#auditBack3")?.addEventListener("click", () => setAuditStep(2));

    $("#auditToUnlock")?.addEventListener("click", () => {
        const v = validateAuditSteps();
        if (!v.ok3) return;
        openPreResultModal();
    });

    // =========================================
    // RESULT ACTIONS
    // =========================================
    $("#startAuditBtn")?.addEventListener("click", () => {
        setActiveView("audit");
        resetAuditForm();
    });

    $("#simulateBtn")?.addEventListener("click", () => {
        resetAuditForm();
        setActiveView("audit");
    });

    // =========================================
    // MODAL EVENTS
    // =========================================
    $("#preResultCancelBtn")?.addEventListener("click", closePreResultModal);
    preResultModal?.addEventListener("click", (e) => {
        if (e.target === preResultModal) closePreResultModal();
    });

    preResultFormShort?.addEventListener("submit", (e) => {
        e.preventDefault();
        const v = validatePreResultForm();
        if (!(v.okName && v.okPhone && v.okEmail)) return;

        saveLeadContactToStorage();

        // Envio SOMENTE do lead (popup liberar resultado)
        const payload = {
            name: state.leadName || "",
            phone: state.leadPhone ? normalizePhoneBR55(state.leadPhone) : "",
            email: state.leadEmail || "",
            event: "diagnostico-n8n-data",
        };
        void postToWebhook(POPUP_WEBHOOK_URL, payload);

        closePreResultModal();
        startAwaitThenResult();
    });

    $("#ctaSpecialistBtn")?.addEventListener("click", openSpecialistModal);

    $("#qualifyCancelBtn")?.addEventListener("click", closeSpecialistModal);
    $("#qualifyBackBtn")?.addEventListener("click", () => setSpecialistStep(1));
    $("#qualifyBackBtn3")?.addEventListener("click", () => setSpecialistStep(2));

    $("#qualifyNextBtn")?.addEventListener("click", () => {
        const v = validateSpecialistForm();
        if (!v.okStep1) return;
        setSpecialistStep(2);
    });

    $("#qualifyNextBtn2")?.addEventListener("click", () => {
        const v = validateSpecialistForm();
        if (!(v.okStep1 && v.okStep2)) return;
        setSpecialistStep(3);
    });

    specialistModal?.addEventListener("click", (e) => {
        if (e.target === specialistModal) closeSpecialistModal();
    });

    specialistForm?.addEventListener("submit", (e) => {
        e.preventDefault();
        const v = validateSpecialistForm();

        if (!v.okStep1) return setSpecialistStep(1);
        if (specialistStepIndex === 1) return setSpecialistStep(2);

        if (!v.okStep2) return setSpecialistStep(2);
        if (specialistStepIndex === 2) return setSpecialistStep(3);

        if (!v.okStep3) return setSpecialistStep(3);

        saveLeadContactToStorage();

        const payload = buildPopupWebhookPayload();
        void postToWebhook(POPUP_WEBHOOK_URL, payload);

        closeSpecialistModal();
        setActiveView("specialistThanks");
    });

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (specialistModal && !specialistModal.hidden) closeSpecialistModal();
        else if (preResultModal && !preResultModal.hidden) closePreResultModal();
    });


    // =========================================
    // ENTER TO ADVANCE (wizard + modais)
    // =========================================
    function isEditableTarget(el) {
        if (!el) return false;
        const tag = String(el.tagName || "").toUpperCase();
        return tag === "TEXTAREA" || !!el.isContentEditable;
    }

    function safeRequestSubmit(formEl, fallbackBtnSel) {
        if (!formEl) return;
        if (typeof formEl.requestSubmit === "function") {
            formEl.requestSubmit();
            return;
        }
        const btn = fallbackBtnSel ? $(fallbackBtnSel) : null;
        if (btn) btn.click();
    }

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        if (e.defaultPrevented) return; // ex.: customSelect usa Enter para abrir/selecionar
        if (e.isComposing) return;

        const active = document.activeElement;
        if (isEditableTarget(active)) return;

        // Modal: falar com especialista
        if (specialistModal && !specialistModal.hidden) {
            const v = validateSpecialistForm();

            if (specialistStepIndex === 1) {
                if (!v.okStep1) return;
                e.preventDefault();
                setSpecialistStep(2);
                return;
            }

            if (specialistStepIndex === 2) {
                if (!(v.okStep1 && v.okStep2)) return;
                e.preventDefault();
                setSpecialistStep(3);
                return;
            }

            if (specialistStepIndex === 3) {
                if (!(v.okStep1 && v.okStep2 && v.okStep3)) return;
                e.preventDefault();
                safeRequestSubmit(specialistForm, "#qualifySubmitBtn");
                return;
            }

            return;
        }

        // Modal: desbloquear resultado
        if (preResultModal && !preResultModal.hidden) {
            const v = validatePreResultForm();
            if (!(v.okName && v.okPhone && v.okEmail)) return;
            e.preventDefault();
            safeRequestSubmit(preResultFormShort, "#preResultSubmitBtn");
            return;
        }

        // Wizard da auditoria
        const auditView = $('[data-view="audit"]');
        if (!auditView || !auditView.classList.contains("is-active")) return;

        const v = validateAuditSteps();

        if (auditStepIndex === 1) {
            if (!v.ok1) return;
            e.preventDefault();
            $("#auditNext1")?.click();
            return;
        }

        if (auditStepIndex === 2) {
            if (!v.ok2) return;
            e.preventDefault();
            $("#auditNext2")?.click();
            return;
        }

        if (auditStepIndex === 3) {
            if (!v.ok3) return;
            e.preventDefault();
            $("#auditToUnlock")?.click();
            return;
        }
    });

    // =========================================
    // INPUT LISTENERS (MODAIS)
    // =========================================
    $("#preNameInput")?.addEventListener("input", validatePreResultForm);
    $("#preEmailInput")?.addEventListener("input", validatePreResultForm);
    $("#nameInput")?.addEventListener("input", validateSpecialistForm);
    $("#emailInput")?.addEventListener("input", validateSpecialistForm);

    function formatPhoneBRDisplay(digits) {
        const d = onlyDigits(digits).replace(/^0+/, "").slice(0, 11);
        if (!d) return "";

        if (d.length <= 2) return "(" + d;

        const ddd = d.slice(0, 2);
        const tail = d.slice(2);

        // (DD)
        if (!tail) return `(${ddd})`;

        // (DD) X...
        if (d.length <= 6) return `(${ddd}) ${tail}`;

        // 10 dígitos (DD + 8): (DD) XXXX-XXXX
        if (d.length <= 10) {
            const a = tail.slice(0, 4);
            const b = tail.slice(4);
            return b ? `(${ddd}) ${a}-${b}` : `(${ddd}) ${a}`;
        }

        // 11 dígitos (DD + 9 + 8): (DD) 9 XXXX-XXXX
        const nine = tail.slice(0, 1);
        const mid = tail.slice(1, 5);
        const end = tail.slice(5);
        let out = `(${ddd}) ${nine}`;
        if (mid) out += ` ${mid}`;
        if (end) out += `-${end}`;
        return out;
    }

    function caretPosFromDigitIndex(formatted, digitIndex) {
        if (!formatted) return 0;
        const target = Math.max(0, Number(digitIndex) || 0);
        if (target === 0) return 0;

        let count = 0;
        for (let i = 0; i < formatted.length; i++) {
            if (/\d/.test(formatted[i])) count += 1;
            if (count >= target) return i + 1;
        }
        return formatted.length;
    }

    function formatPhoneFieldInPlace(inputEl) {
        if (!inputEl) return;
        const digits = normalizePhoneBRNational(inputEl.value || "").slice(0, 11);
        inputEl.value = formatPhoneBRDisplay(digits);
    }

    function bindPhoneInputMask(inputEl, validateFn) {
        if (!inputEl) return;

        try {
            inputEl.setAttribute("inputmode", "numeric");
            inputEl.setAttribute("autocomplete", "tel");
        } catch (_) { }

        // deixa o maxlength alto (a máscara tem símbolos)
        try { inputEl.setAttribute("maxlength", "20"); } catch (_) { }

        const update = (preserveCaret) => {
            const prev = String(inputEl.value || "");
            const selStart = inputEl.selectionStart == null ? prev.length : inputEl.selectionStart;

            let digitsBefore = preserveCaret ? onlyDigits(prev.slice(0, selStart)).length : null;

            const digits = normalizePhoneBRNational(prev).slice(0, 11);
            const formatted = formatPhoneBRDisplay(digits);

            inputEl.value = formatted;

            if (preserveCaret && digitsBefore != null) {
                const capped = Math.min(digitsBefore, digits.length);
                const caret = caretPosFromDigitIndex(formatted, capped);
                try { inputEl.setSelectionRange(caret, caret); } catch (_) { }
            }

            if (typeof validateFn === "function") validateFn();
        };

        inputEl.addEventListener("input", () => update(true));
        inputEl.addEventListener("blur", () => update(false));

        // formata valor inicial (se já existir)
        update(false);
    }

    bindPhoneInputMask($("#prePhoneInput"), validatePreResultForm);
    bindPhoneInputMask($("#phoneInput"), validateSpecialistForm);

    $("#areaInput")?.addEventListener("change", validateSpecialistForm);
    $("#teamSizeInput")?.addEventListener("change", validateSpecialistForm);
    $("#subscriberInput")?.addEventListener("change", validateSpecialistForm);
    $("#challengeInput")?.addEventListener("change", validateSpecialistForm);
    $("#usesSystemInput")?.addEventListener("change", validateSpecialistForm);
    $("#investmentOkInput")?.addEventListener("change", validateSpecialistForm);

    // =========================================
    // CUSTOM SELECT (mesma lógica do projeto anterior)
    // =========================================
    function initCustomSelects() {
        const selects = Array.from(document.querySelectorAll("select.select"));
        selects.forEach((sel) => {
            if (sel.dataset.enhanced === "1") return;
            sel.dataset.enhanced = "1";

            const wrapper = document.createElement("div");
            wrapper.className = "customSelect";
            wrapper.tabIndex = -1;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "customSelect__button";
            btn.setAttribute("aria-haspopup", "listbox");
            btn.setAttribute("aria-expanded", "false");

            const menu = document.createElement("div");
            menu.className = "customSelect__menu";
            menu.setAttribute("role", "listbox");

            const optionButtons = [];
            Array.from(sel.options).forEach((opt, i) => {
                const ob = document.createElement("button");
                ob.type = "button";
                ob.className = "customSelect__option";
                ob.setAttribute("role", "option");
                ob.dataset.value = opt.value;
                ob.textContent = opt.textContent;

                if ((opt.value || "") === "" && i === 0) ob.dataset.placeholder = "1";

                ob.addEventListener("click", () => {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event("change", { bubbles: true }));
                    close();
                    btn.focus();
                });

                optionButtons.push(ob);
                menu.appendChild(ob);
            });

            function syncFromNative() {
                const v = sel.value;
                const nativeOpt = sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0] : null;
                const label = nativeOpt ? nativeOpt.textContent : "";

                btn.textContent = label || "Selecione";
                btn.dataset.hasValue = v ? "1" : "0";

                optionButtons.forEach((ob) => {
                    const isSelected = ob.dataset.value === v;
                    ob.classList.toggle("is-selected", isSelected);
                    ob.setAttribute("aria-selected", isSelected ? "true" : "false");
                });
            }

            function positionMenu() {
                const rect = btn.getBoundingClientRect();
                const gap = 8;
                const padding = 12;

                const modal = btn.closest(".modalCard");
                const bounds = modal ? modal.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };

                const spaceBelow = bounds.bottom - rect.bottom;
                const spaceAbove = rect.top - bounds.top;
                const wanted = 200;

                const shouldOpenUp = spaceBelow < wanted && spaceAbove > spaceBelow;
                wrapper.classList.toggle("is-open-up", shouldOpenUp);

                const available = (shouldOpenUp ? spaceAbove : spaceBelow) - (gap + padding);
                const clamped = Math.max(140, Math.min(220, available));
                menu.style.maxHeight = `${clamped}px`;
            }

            function open() {
                wrapper.classList.add("is-open");
                btn.setAttribute("aria-expanded", "true");
                positionMenu();

                const v = sel.value;
                let target = optionButtons.find((b) => b.dataset.value === v) || null;
                if (!target) target = optionButtons.find((b) => b.dataset.placeholder !== "1") || optionButtons[0];
                target && target.focus();
            }

            function close() {
                wrapper.classList.remove("is-open");
                btn.setAttribute("aria-expanded", "false");
            }

            function toggle() {
                if (wrapper.classList.contains("is-open")) close();
                else open();
            }

            btn.addEventListener("click", toggle);
            btn.addEventListener("keydown", (e) => {
                // Enter serve para avançar etapas quando o select já tem valor.
                // Para reabrir o menu, use ArrowDown ou Espaço.
                if (e.key === "ArrowDown" || e.key === " " || e.key === "Enter") {
                    const hasValue = !!String(sel.value || "").trim();
                    if (e.key === "Enter" && hasValue) return; // deixa o Enter propagar (wizard)
                    e.preventDefault();
                    open();
                }
            });

            menu.addEventListener("keydown", (e) => {
                const active = document.activeElement;
                const idx = optionButtons.indexOf(active);

                if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                    btn.focus();
                    return;
                }
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const next = optionButtons[Math.min(optionButtons.length - 1, idx + 1)];
                    next && next.focus();
                }
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const prev = optionButtons[Math.max(0, idx - 1)];
                    prev && prev.focus();
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    active && active.click();
                }
            });

            document.addEventListener("click", (e) => {
                if (!wrapper.contains(e.target)) close();
            });

            const modal = btn.closest(".modalCard");
            if (modal) {
                modal.addEventListener(
                    "scroll",
                    () => {
                        if (wrapper.classList.contains("is-open")) positionMenu();
                    },
                    { passive: true }
                );
            }

            sel.classList.add("select--nativeHidden");
            sel.insertAdjacentElement("afterend", wrapper);
            wrapper.appendChild(btn);
            wrapper.appendChild(menu);

            sel.addEventListener("change", syncFromNative);
            syncFromNative();
        });
    }

    // =========================================
    // INIT
    // =========================================
    initCalloutTypewriterSystem();
    initCustomSelects();
    initResultVideoEmbed();
    updateAuditStepper(1);
    setAuditStep(1);
    validateAuditSteps();

    // garante estado inicial coerente com o HTML
    const homeView = $('[data-view="home"]');
    const auditView = $('[data-view="audit"]');

    if (homeView && homeView.classList.contains("is-active")) setActiveView("home");
    else if (auditView && auditView.classList.contains("is-active")) setActiveView("audit");
    else if (homeView) setActiveView("home");
    else setActiveView("audit");
})();