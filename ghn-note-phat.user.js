// ==UserScript==
// @name         GHN Note Phạt
// @namespace    ghn.vn/noibo/note-phat
// @version      1.0.8
// @description  Đọc lịch sử đơn hàng GHN và mở Google Form note phạt đã điền sẵn.
// @author       GHN CS
// @match        https://noibo.ghn.vn/*
// @match        https://tracuunoibo.ghn.vn/*
// @match        https://docs.google.com/forms/d/e/1FAIpQLSeiu9kC4GvfD2CyYig8JZfGeXVQq9BlICqM3oezP4qZ0VJ7lA/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/ghn-note-phat.user.js
// @downloadURL  https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/ghn-note-phat.user.js
// ==/UserScript==

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GHNPenaltyCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORM_URLS = {
    calllog: "https://docs.google.com/forms/d/e/1FAIpQLSfAqcLaLlBG3T73QCM0FVWxsTgsnrRQBOwFVilTeNPRuYfw1w/viewform",
    pod: "https://docs.google.com/forms/d/e/1FAIpQLSfud5r6cto6KEQpbkKOz9baBLnd150dW7eCoCM3RN_lnlLO7Q/viewform",
    lost: "https://docs.google.com/forms/d/e/1FAIpQLSeiu9kC4GvfD2CyYig8JZfGeXVQq9BlICqM3oezP4qZ0VJ7lA/viewform",
  };

  const CALLLOG_ENTRIES = {
    orderCode: "entry.1480644958",
    penaltyType: "entry.104830232",
    postOffice: "entry.632037489",
    employeeId: "entry.751988222",
    attempt: "entry.1608710228",
    noteEmployee: "entry.1063378924",
  };

  const POD_ENTRIES = {
    orderCode: "entry.1617423737",
    problemType: "entry.353166002",
    postOffice: "entry.1211699941",
    employeeId: "entry.285917235",
    dateBase: "entry.693248304",
    detail: "entry.591751683",
    noteEmployee: "entry.1051970470",
  };

  const LOST_ENTRIES = {
    group: "entry.1706636230",
    orderCode: "entry.118525122",
    requestType: "entry.745320069",
    currentWarehouse: "entry.1130875905",
    task: "entry.1450111763",
  };

  const NOTE_EMPLOYEES = [
    { name: "Trần Lâm Thị Tiểu My", email: "mytltt@ghn.vn" },
    { name: "Nguyễn Thị Vân Trúc", email: "trucntv@ghn.vn" },
    { name: "Nguyễn Thị Mỹ Hảo", email: "haontm@ghn.vn" },
    { name: "Huỳnh Tú Anh", email: "anhht@ghn.vn" },
    { name: "Bùi Thị Bích Tâm", email: "tambtb@ghn.vn" },
    { name: "Phạm Kim Ngân", email: "nganpk@ghn.vn" },
    { name: "Nguyễn Quỳnh Kim Phương", email: "phuongqk@ghn.vn" },
    { name: "Nguyễn Thị Bích Trâm", email: "tramntb@ghn.vn" },
    { name: "Hoàng Diệu Linh", email: "linhhd@ghn.vn" },
    { name: "Lê Hoàng Anh Thư", email: "thulha@ghn.vn" },
    { name: "Nguyễn Thị Ngọc Trâm", email: "tramntn@ghn.vn" },
  ];

  const PENALTY_OPTIONS = [
    {
      key: "delivery-no-call",
      operation: "delivery",
      label: "Giao — Không gọi khi giao hàng",
      formValue: "Người nhận khiếu nại NV PTTT không gọi khi giao hàng",
    },
    {
      key: "delivery-wrong-reason",
      operation: "delivery",
      label: "Giao — Cập nhật sai lý do giao thất bại",
      formValue: "Người nhận khiếu nại NVPTTT cập nhật sai lý do giao thất bại",
    },
    {
      key: "pickup-no-call",
      operation: "pickup",
      label: "Lấy — Không gọi khi lấy hàng",
      formValue: "Người gửi khiếu nại NV PTTT không gọi khi lấy hàng",
    },
    {
      key: "pickup-wrong-reason",
      operation: "pickup",
      label: "Lấy — Cập nhật sai lý do lấy thất bại",
      formValue: "Người gửi khiếu nại NV PTTT cập nhật sai lý do lấy thất bại",
    },
    {
      key: "return-no-call",
      operation: "return",
      label: "Trả — Không gọi khi trả hàng",
      formValue: "Người gửi khiếu nại NV PTTT không gọi khi trả hàng",
    },
    {
      key: "return-wrong-reason",
      operation: "return",
      label: "Trả — Cập nhật sai lý do trả thất bại",
      formValue: "Người gửi khiếu nại NV PTTT cập nhật sai lý do trả thất bại",
    },
  ];

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function digits(value) {
    const match = clean(value).match(/\b\d{3,}\b/);
    return match ? match[0] : "";
  }

  function normalizeDate(value) {
    const match = clean(value).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    return {
      day: String(Number(match[1])),
      month: String(Number(match[2])),
      year: match[3],
      display: `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}`,
    };
  }

  function parseWarehouseSummary(text) {
    const normalized = clean(text);
    const labels = [
      ["current", "Kho hiện tại"],
      ["pickup", "Kho lấy"],
      ["delivery", "Kho giao"],
      ["return", "Kho trả"],
    ];
    const result = {};
    for (let i = 0; i < labels.length; i += 1) {
      const [key, label] = labels[i];
      const nextLabel = labels[i + 1] ? labels[i + 1][1] : "Thao tác đơn hàng";
      const pattern = new RegExp(`${label}\\s+(.+?)(?=\\s+${nextLabel}|$)`, "i");
      const match = normalized.match(pattern);
      const full = clean(match && match[1]);
      result[key] = { id: digits(full), label: full };
    }
    return result;
  }

  function classifyOperation(action) {
    const value = clean(action).toLowerCase();
    if (/lấy(?: hàng)? không thành công|lấy thất bại/.test(value)) return "pickup";
    if (/trả(?: hàng)? không thành công|hoàn(?: hàng)? không thành công|trả thất bại|hoàn thất bại/.test(value)) return "return";
    if (/giao hàng không thành công|giao thất bại/.test(value)) return "delivery";
    return "";
  }

  function parseAttempt(action) {
    const match = clean(action).match(/lần\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function isFailureAction(action) {
    return Boolean(classifyOperation(action));
  }

  function successType(action) {
    const value = clean(action).toLowerCase();
    if (/giao hàng thành công|giao thành công/.test(value)) return "Giao";
    if (/trả hàng thành công|hoàn hàng thành công|trả thành công|hoàn thành công/.test(value)) return "Trả";
    return "";
  }

  function completedOperation(action) {
    const value = clean(action).toLowerCase();
    if (/lấy(?: hàng)? thành công/.test(value)) return "pickup";
    if (/giao(?: hàng)? thành công/.test(value)) return "delivery";
    if (/(?:trả|hoàn)(?: hàng)? thành công/.test(value)) return "return";
    return "";
  }

  function isAhamoveActorId(employeeId) {
    const value = clean(employeeId);
    return value === "7777" || /^\d{9,12}$/.test(value);
  }

  function ensureAttempts(rows) {
    const counters = { delivery: 0, pickup: 0, return: 0 };
    const chronological = rows.slice().reverse();
    for (const row of chronological) {
      if (!row.operation) continue;
      counters[row.operation] += 1;
      if (!row.attempt) row.attempt = counters[row.operation];
    }
    return rows;
  }

  function warehouseForOperation(warehouses, operation) {
    if (operation === "pickup") return warehouses.pickup || { id: "", label: "" };
    if (operation === "return") return warehouses.return || { id: "", label: "" };
    return warehouses.delivery || { id: "", label: "" };
  }

  function warehouseNameOnly(warehouse) {
    const label = clean(warehouse && warehouse.label != null ? warehouse.label : warehouse);
    return clean(label.replace(/^\s*\d{3,}\s*[-–—:]\s*/, ""));
  }

  function buildPrefillUrl(base, values) {
    const url = new URL(base);
    url.searchParams.set("usp", "pp_url");
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== null && String(value) !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("srd", "true");
    return url.toString();
  }

  function buildCalllogUrl(data) {
    return buildPrefillUrl(FORM_URLS.calllog, {
      [CALLLOG_ENTRIES.orderCode]: data.orderCode,
      [CALLLOG_ENTRIES.penaltyType]: data.penaltyType,
      [CALLLOG_ENTRIES.postOffice]: data.postOffice,
      [CALLLOG_ENTRIES.employeeId]: data.employeeId,
      [CALLLOG_ENTRIES.attempt]: data.attempt,
      [CALLLOG_ENTRIES.noteEmployee]: data.noteEmployee,
    });
  }

  function buildPodUrl(data) {
    const date = normalizeDate(data.violationDate);
    if (!date) throw new Error("Ngày vi phạm không hợp lệ.");
    return buildPrefillUrl(FORM_URLS.pod, {
      [POD_ENTRIES.orderCode]: data.orderCode,
      [POD_ENTRIES.problemType]: data.problemType,
      [POD_ENTRIES.postOffice]: data.postOffice,
      [POD_ENTRIES.employeeId]: data.employeeId,
      [`${POD_ENTRIES.dateBase}_year`]: date.year,
      [`${POD_ENTRIES.dateBase}_month`]: date.month,
      [`${POD_ENTRIES.dateBase}_day`]: date.day,
      [POD_ENTRIES.detail]: data.detail,
      [POD_ENTRIES.noteEmployee]: data.noteEmployee,
    });
  }

  function buildLostUrl(data) {
    const url = new URL(buildPrefillUrl(FORM_URLS.lost, {
      [LOST_ENTRIES.group]: "B2C_VÙNG 3",
      [LOST_ENTRIES.orderCode]: data.orderCode,
      [LOST_ENTRIES.currentWarehouse]: data.currentWarehouse,
      [LOST_ENTRIES.task]: data.task,
    }));
    // Google Forms does not pre-check this control from an entry.* value.
    // The content script uses this marker to tick “Lưu lại email” after opening.
    url.searchParams.set("emailReceipt", "true");
    return url.toString();
  }

  function extractOrderCodes(text) {
    const matches = String(text || "").toUpperCase().match(/\bG[A-Z0-9]{7,11}\b/g) || [];
    return Array.from(new Set(matches));
  }

  return {
    FORM_URLS,
    CALLLOG_ENTRIES,
    POD_ENTRIES,
    LOST_ENTRIES,
    NOTE_EMPLOYEES,
    PENALTY_OPTIONS,
    clean,
    digits,
    normalizeDate,
    parseWarehouseSummary,
    classifyOperation,
    parseAttempt,
    isFailureAction,
    successType,
    completedOperation,
    isAhamoveActorId,
    ensureAttempts,
    warehouseForOperation,
    warehouseNameOnly,
    buildPrefillUrl,
    buildCalllogUrl,
    buildPodUrl,
    buildLostUrl,
    extractOrderCodes,
  };
});

(function () {
  "use strict";

  const PREFIX = "GHN_PENALTY_";
  const REGISTRY_PREFIX = "ghnPenalty.runtime.";
  const REQUEST_KEY = `${REGISTRY_PREFIX}request`;
  const HEARTBEAT_MS = 4000;
  // Chrome throttles timers on background tabs, sometimes to one tick per minute.
  // Keep the registry alive long enough for a lookup tab that is open but inactive.
  const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
  const TASK_CACHE_PREFIX = "ghnPenalty.taskCache.";
  const TASK_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const instanceId = sessionStorage.getItem("ghnPenalty.instanceId") || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem("ghnPenalty.instanceId", instanceId);

  let contextProvider = null;
  let readOrderHandler = null;
  let requestListenerId = null;
  let heartbeatTimer = null;
  const ownRegistryKeys = new Set();

  function maybePromise(value) {
    return value && typeof value.then === "function" ? value : Promise.resolve(value);
  }

  async function getValue(key, fallback) {
    return maybePromise(GM_getValue(key, fallback));
  }

  async function setValue(key, value) {
    return maybePromise(GM_setValue(key, value));
  }

  async function deleteValue(key) {
    return maybePromise(GM_deleteValue(key));
  }

  async function listValues() {
    return maybePromise(GM_listValues());
  }

  function lookupRegistryKey() {
    return `${REGISTRY_PREFIX}lookup.${instanceId}`;
  }

  function taskRegistryKey() {
    return `${REGISTRY_PREFIX}task.${instanceId}`;
  }

  async function publishContext() {
    if (!contextProvider) return;
    const context = contextProvider();
    const now = Date.now();

    if (location.hostname === "tracuunoibo.ghn.vn") {
      const key = lookupRegistryKey();
      ownRegistryKeys.add(key);
      await setValue(key, {
        instanceId,
        orderCode: context.orderCode || "",
        url: location.href,
        title: document.title || "Tra cứu nội bộ",
        heartbeat: now,
      });
    }

    if (location.hostname === "noibo.ghn.vn") {
      const key = taskRegistryKey();
      ownRegistryKeys.add(key);
      const normalized = context.pageTextNormalized || "";
      const taskContext = {
        instanceId,
        orderCodes: context.orderCodes || [],
        isTaskDetail: Boolean(context.isTaskDetail),
        receiverMissing: normalized.includes("người nhận khiếu nại chưa nhận được hàng"),
        senderMissingReturn: normalized.includes("người gửi khiếu nại chưa nhận được hàng trả"),
        overdueJourney: normalized.includes("đơn hàng bị quá hạn toàn trình"),
        url: location.href,
        heartbeat: now,
      };
      await setValue(key, taskContext);
      if (taskContext.isTaskDetail && taskContext.overdueJourney) {
        for (const orderCode of taskContext.orderCodes) {
          await setValue(`${TASK_CACHE_PREFIX}${orderCode}.overdueJourney`, {
            orderCode,
            overdueJourney: true,
            url: taskContext.url,
            savedAt: now,
          });
        }
      }
    }
  }

  async function activeRegistry(kind) {
    const keys = (await listValues()).filter((key) => key.startsWith(`${REGISTRY_PREFIX}${kind}.`));
    const now = Date.now();
    const values = [];
    for (const key of keys) {
      const value = await getValue(key, null);
      if (value && now - Number(value.heartbeat || 0) <= ACTIVE_WINDOW_MS) values.push(value);
      else if (value) await deleteValue(key);
    }
    return values;
  }

  function installRequestListener() {
    if (requestListenerId != null || typeof GM_addValueChangeListener !== "function") return;
    requestListenerId = GM_addValueChangeListener(REQUEST_KEY, async (_name, _oldValue, request) => {
      if (!request || request.targetInstanceId !== instanceId || !readOrderHandler) return;
      const responseKey = `${REGISTRY_PREFIX}response.${request.id}`;
      try {
        const response = await readOrderHandler();
        await setValue(responseKey, response);
      } catch (error) {
        await setValue(responseKey, { ok: false, error: error.message || String(error) });
      }
    });
  }

  async function requestLookup(tabId) {
    const lookups = await activeRegistry("lookup");
    const target = lookups.find((item) => item.instanceId === tabId);
    if (!target) return { ok: false, error: "Tab Tra cứu không còn hoạt động. Hãy tải lại trang và thử lại." };

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const responseKey = `${REGISTRY_PREFIX}response.${id}`;

    return new Promise(async (resolve) => {
      let completed = false;
      let responseListenerId = null;
      const finish = async (value) => {
        if (completed) return;
        completed = true;
        if (responseListenerId != null && typeof GM_removeValueChangeListener === "function") {
          GM_removeValueChangeListener(responseListenerId);
        }
        await deleteValue(responseKey);
        resolve(value);
      };

      responseListenerId = GM_addValueChangeListener(responseKey, (_name, _oldValue, value) => {
        if (value) finish(value);
      });

      await setValue(REQUEST_KEY, { id, targetInstanceId: target.instanceId, createdAt: Date.now() });

      const poll = setInterval(async () => {
        if (completed) return clearInterval(poll);
        const value = await getValue(responseKey, null);
        if (value) {
          clearInterval(poll);
          finish(value);
        }
      }, 250);

      setTimeout(() => {
        clearInterval(poll);
        finish({ ok: false, error: "Hết thời gian chờ tab Tra cứu phản hồi. Hãy tải lại tab Tra cứu." });
      }, 18000);
    });
  }

  async function findTask(orderCode, expectedText) {
    const tasks = await activeRegistry("task");
    const wantsReturn = String(expectedText || "").toLowerCase().includes("hàng trả");
    const wantsOverdueJourney = String(expectedText || "").toLowerCase().includes("quá hạn toàn trình");
    const candidates = tasks
      .filter((task) => task.isTaskDetail && (!orderCode || task.orderCodes.includes(orderCode)))
      .map((task) => ({
        ...task,
        score: wantsOverdueJourney
          ? Number(task.overdueJourney)
          : wantsReturn ? Number(task.senderMissingReturn) : Number(task.receiverMissing),
      }))
      .sort((a, b) => b.score - a.score);
    if (candidates[0] && candidates[0].score) return candidates[0].url;
    if (wantsOverdueJourney && orderCode) {
      const cacheKey = `${TASK_CACHE_PREFIX}${orderCode}.overdueJourney`;
      const cached = await getValue(cacheKey, null);
      if (cached && Date.now() - Number(cached.savedAt || 0) <= TASK_CACHE_MAX_AGE_MS) return cached.url || "";
      if (cached) await deleteValue(cacheKey);
    }
    return candidates[0] ? candidates[0].url : "";
  }

  async function send(message) {
    if (message.type === `${PREFIX}LIST_LOOKUPS`) {
      // When the panel is opened on Tra cứu itself, avoid a slower round-trip
      // through Tampermonkey's cross-tab storage. This also works on browsers
      // that delay value-change events in background tabs.
      if (location.hostname === "tracuunoibo.ghn.vn" && contextProvider) {
        const context = contextProvider();
        return {
          ok: true,
          lookups: [{
            tabId: instanceId,
            url: location.href,
            title: document.title || "Tra cứu nội bộ",
            orderCode: context.orderCode || "",
            lastAccessed: Date.now(),
          }],
        };
      }
      const lookups = (await activeRegistry("lookup"))
        .map((item) => ({
          tabId: item.instanceId,
          url: item.url,
          title: item.title,
          orderCode: item.orderCode,
          lastAccessed: item.heartbeat,
        }))
        .sort((a, b) => b.lastAccessed - a.lastAccessed);
      return { ok: true, lookups };
    }
    if (message.type === `${PREFIX}READ_LOOKUP`) {
      if (message.tabId === instanceId && location.hostname === "tracuunoibo.ghn.vn" && readOrderHandler) {
        try {
          return await readOrderHandler();
        } catch (error) {
          return { ok: false, error: error.message || String(error) };
        }
      }
      return requestLookup(message.tabId);
    }
    if (message.type === `${PREFIX}FIND_TASK`) {
      return { ok: true, url: await findTask(message.orderCode, message.expectedText) };
    }
    if (message.type === `${PREFIX}OPEN_FORM`) {
      GM_openInTab(message.url, { active: true, insert: true, setParent: true });
      return { ok: true };
    }
    return { ok: false, error: "Yêu cầu không được hỗ trợ." };
  }

  async function storageGet(key) {
    return getValue(key, undefined);
  }

  async function storageSet(values) {
    for (const [key, value] of Object.entries(values)) await setValue(key, value);
  }

  function registerContextProvider(provider) {
    contextProvider = provider;
    publishContext();
    if (!heartbeatTimer) heartbeatTimer = setInterval(publishContext, HEARTBEAT_MS);
  }

  function registerReadOrder(handler) {
    readOrderHandler = handler;
    installRequestListener();
  }

  window.addEventListener("beforeunload", () => {
    for (const key of ownRegistryKeys) GM_deleteValue(key);
  });
  window.addEventListener("pageshow", publishContext);
  window.addEventListener("focus", publishContext);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) publishContext();
  });

  globalThis.GHNPenaltyBridge = {
    send,
    storageGet,
    storageSet,
    registerContextProvider,
    registerReadOrder,
  };
})();

(function () {
  "use strict";

  if (window.__GHN_PENALTY_LOADED__) return;
  window.__GHN_PENALTY_LOADED__ = true;

  const Core = globalThis.GHNPenaltyCore;
  const Bridge = globalThis.GHNPenaltyBridge || null;
  const PREFIX = "GHN_PENALTY_";
  const STORAGE_PROFILE = "ghnPenalty.profileEmail";
  const STORAGE_LAUNCHER_POSITION = "ghnPenalty.launcherPosition";
  const HOST_ID = "ghn-penalty-assistant-root";

  const LOST_FORM_ID = "1FAIpQLSeiu9kC4GvfD2CyYig8JZfGeXVQq9BlICqM3oezP4qZ0VJ7lA";
  if (location.hostname === "docs.google.com" && location.pathname.includes(LOST_FORM_ID)) {
    if (new URL(location.href).searchParams.get("emailReceipt") === "true") {
      const tickEmail = () => {
        const checkbox = document.querySelector('[role="checkbox"][aria-label^="Lưu lại"]');
        if (checkbox && checkbox.getAttribute("aria-checked") !== "true") checkbox.click();
        return checkbox;
      };
      if (!tickEmail()) {
        const observer = new MutationObserver(() => { if (tickEmail()) observer.disconnect(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15000);
      }
    }
    return;
  }

  const state = {
    lookups: [],
    lookupTabId: null,
    order: null,
    flow: null,
    selectedFailure: null,
    selectedSuccess: null,
    selectedPenaltyKey: "delivery-wrong-reason",
    profile: null,
    taskLink: "",
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function send(message) {
    return Bridge ? Bridge.send(message) : chrome.runtime.sendMessage(message);
  }

  function storageGet(key) {
    if (Bridge) return Bridge.storageGet(key);
    return new Promise((resolve) => chrome.storage.local.get([key], (result) => resolve(result[key])));
  }

  function storageSet(values) {
    if (Bridge) return Bridge.storageSet(values);
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }

  function getOrderCodeFromPage() {
    const url = new URL(location.href);
    const direct = ["order_code", "q", "search_text"]
      .map((key) => url.searchParams.get(key))
      .find((value) => /^G[A-Z0-9]{7,11}$/i.test(value || ""));
    if (direct) return direct.toUpperCase();
    const codes = Core.extractOrderCodes(document.body ? document.body.innerText : "");
    return codes.length === 1 ? codes[0] : "";
  }

  function getPageContext() {
    const text = document.body ? document.body.innerText : "";
    return {
      orderCode: getOrderCodeFromPage(),
      orderCodes: Core.extractOrderCodes(text),
      isTaskDetail: /\/ghn-ticket\/(?:cs\/)?detail\/\d+/i.test(location.pathname),
      pageTextNormalized: Core.clean(text).toLowerCase(),
    };
  }

  function waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        let result = null;
        try { result = predicate(); } catch (_error) { result = null; }
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(new Error("Trang Tra cứu chưa tải xong lịch sử đơn hàng."));
        }
      }, 250);
    });
  }

  async function ensureHistoryLoaded() {
    let pane = document.querySelector("#order-tab-tabpane-order-history");
    if (!pane || !pane.querySelector(".table-row")) {
      const tab = document.querySelector("#order-tab-tab-order-history");
      if (!tab) throw new Error("Không tìm thấy mục Lịch sử đơn hàng trên trang Tra cứu.");
      tab.click();
    }
    pane = await waitFor(
      () => {
        const candidate = document.querySelector("#order-tab-tabpane-order-history");
        return candidate && candidate.querySelector(".table-row") ? candidate : null;
      },
      15000,
    );
    return pane;
  }

  function parseActor(cell) {
    const pieces = Array.from(cell ? cell.querySelectorAll("div") : [])
      .map((node) => Core.clean(node.textContent))
      .filter(Boolean);
    const raw = Core.clean(cell && cell.textContent);
    const idCandidates = pieces.concat([raw]).flatMap((part) => part.match(/\b\d{4,9}\b/g) || []);
    const employeeId = idCandidates.length ? idCandidates[idCandidates.length - 1] : "";
    const employeeName = Core.clean((pieces[0] || raw).replace(employeeId, ""));
    return { employeeId, employeeName };
  }

  function parseHistoryRows(pane) {
    const rows = [];
    let currentDate = "";
    const tables = pane.querySelectorAll(".responsive-table");
    for (const table of tables) {
      for (const child of Array.from(table.children)) {
        if (child.classList.contains("table-header")) {
          const label = child.querySelector(".table-col");
          const parsed = Core.normalizeDate(label && label.textContent);
          if (parsed) currentDate = parsed.display;
          continue;
        }
        if (!child.classList.contains("table-row")) continue;
        const columns = Array.from(child.children).filter((node) => node.classList.contains("table-col"));
        if (columns.length < 5) continue;
        const action = Core.clean(columns[1].textContent);
        const detail = Core.clean(columns[2].textContent);
        const warehouse = Core.clean(columns[3].textContent);
        const actor = parseActor(columns[4]);
        const operation = Core.classifyOperation(action);
        const problemType = Core.successType(action);
        rows.push({
          date: currentDate,
          time: Core.clean(columns[0].textContent),
          action,
          detail,
          reason: Core.clean((columns[2].querySelector(".error") || {}).textContent || detail.replace(/^Giao hàng không thành công\s*/i, "")),
          warehouse,
          warehouseId: Core.digits(warehouse),
          employeeName: actor.employeeName,
          employeeId: actor.employeeId,
          operation,
          attempt: operation ? Core.parseAttempt(action) : null,
          problemType,
        });
      }
    }
    return Core.ensureAttempts(rows);
  }

  async function readOrder() {
    if (location.hostname !== "tracuunoibo.ghn.vn") {
      throw new Error("Trang này không phải Tra cứu nội bộ.");
    }
    const pane = await ensureHistoryLoaded();
    const pageText = document.body ? document.body.innerText : "";
    const rows = parseHistoryRows(pane);
    const warehouses = Core.parseWarehouseSummary(pageText);
    const orderCode = getOrderCodeFromPage();
    const failures = rows.filter((row) => row.operation && row.employeeId);
    const successes = rows.filter((row) => row.problemType && row.employeeId);
    const completedOperations = Array.from(new Set(rows.map((row) => Core.completedOperation(row.action)).filter(Boolean)));
    const isAhamove = rows.some((row) => Core.isAhamoveActorId(row.employeeId));
    return {
      ok: true,
      data: {
        orderCode,
        warehouses,
        failures,
        successes,
        completedOperations,
        isAhamove,
        rowCount: rows.length,
        sourceUrl: location.href,
      },
    };
  }

  if (Bridge) {
    Bridge.registerContextProvider(getPageContext);
    Bridge.registerReadOrder(readOrder);
  } else {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") return false;
      if (message.type === `${PREFIX}PAGE_CONTEXT`) {
        sendResponse(getPageContext());
        return false;
      }
      if (message.type === `${PREFIX}READ_ORDER`) {
        readOrder().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
      }
      return false;
    });
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}*{box-sizing:border-box}button,select,input{font:inherit}.launcher{position:fixed;right:18px;bottom:86px;z-index:2147483600;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:#d95736;color:#fff;font:600 14px/1 "Segoe UI",Arial,sans-serif;box-shadow:0 6px 18px #7130184d;cursor:grab;touch-action:none;user-select:none}.launcher.dragging{cursor:grabbing}.launcher:hover{background:#c94d2e}.launcher svg{width:20px;height:20px}.launcher-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.scrim{position:fixed;inset:0;z-index:2147483601;background:#0f172a55;display:none}.scrim.open{display:block}.panel{position:fixed;z-index:2147483602;top:12px;right:12px;bottom:12px;width:min(440px,calc(100vw - 24px));display:flex;flex-direction:column;border-radius:16px;background:#fff;color:#26313c;font:14px/1.45 "Segoe UI",Arial,sans-serif;box-shadow:0 20px 60px #0f172a66;transform:translateX(calc(100% + 30px));transition:transform .2s ease;overflow:hidden}.panel.open{transform:translateX(0)}.head{display:flex;align-items:center;gap:10px;padding:16px 18px;background:#d95736;color:#fff}.head-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#ffffff22}.title{flex:1}.title strong{display:block;font-size:16px}.title span{font-size:12px;opacity:.88}.icon-button{width:36px;height:36px;border:0;border-radius:50%;display:grid;place-items:center;background:#ffffff1f;color:#fff;cursor:pointer}.icon-button svg,.head-mark svg{width:18px;height:18px}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:12px 18px 0}.step{height:4px;border-radius:2px;background:#e2e6ea}.step.on{background:#d95736}.body{flex:1;padding:18px;overflow:auto}.footer{display:flex;gap:9px;padding:14px 18px 17px;border-top:1px solid #e1e5e9}.footer[hidden]{display:none}.btn{min-height:42px;padding:0 14px;border:1px solid #d7dde2;border-radius:9px;background:#fff;color:#26313c;font-weight:600;cursor:pointer}.btn.primary{flex:1;border-color:#d95736;background:#d95736;color:#fff}.btn:disabled{opacity:.45;cursor:not-allowed}.lead{margin:3px 0 15px;color:#68737e}.order-strip{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;margin-bottom:14px;border-radius:10px;background:#fff0ea}.ok{color:#167650;font-size:12px}.section-title{margin:0;font-size:19px}.type-list,.choice-list{display:grid;gap:10px}.type{width:100%;display:grid;grid-template-columns:42px 1fr 20px;gap:11px;align-items:center;padding:14px;border:1px solid #dce1e6;border-radius:12px;background:#fff;color:#26313c;text-align:left;cursor:pointer}.type:hover{background:#f8f9fa}.type-icon{width:42px;height:42px;border-radius:10px;display:grid;place-items:center;background:#fff0ea;color:#d95736}.type-icon svg{width:20px}.type strong,.type small{display:block}.type small{margin-top:3px;color:#68737e}.field{display:grid;gap:6px;margin-bottom:13px}.field label{font-size:12px;color:#68737e;font-weight:600}.field select,.field input{width:100%;min-height:41px;padding:8px 10px;border:1px solid #cfd6dc;border-radius:8px;background:#fff;color:#26313c}.choice{display:grid;grid-template-columns:22px 1fr;gap:10px;padding:12px;border:1px solid #dce1e6;border-radius:12px;background:#fff;cursor:pointer}.choice:has(input:checked){border-color:#d95736;background:#fff0ea}.choice input{margin-top:4px;accent-color:#d95736}.choice-top{display:flex;justify-content:space-between;gap:8px}.choice-name{font-weight:600}.choice-time,.muted{font-size:12px;color:#68737e}.person{margin:4px 0}.reason{font-size:12px;color:#68737e}.alert{padding:11px 12px;border-radius:9px;background:#fff4e5;color:#8a4b08;margin-bottom:13px}.alert.error{background:#fff0f0;color:#a51d16}.loading{min-height:330px;display:grid;place-items:center;text-align:center}.spinner{width:46px;height:46px;margin:0 auto 14px;border:4px solid #f4c8ba;border-top-color:#d95736;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.person-card{display:flex;gap:11px;align-items:center;padding:13px;margin-bottom:13px;border-radius:11px;background:#fff0ea}.avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#d95736;color:#fff;font-weight:700}.review{margin:0}.review-row{display:grid;grid-template-columns:140px 1fr;gap:10px;padding:9px 0;border-bottom:1px solid #e4e8eb}.review-row dt{color:#68737e}.review-row dd{margin:0;word-break:break-word}.note{margin-top:12px;color:#68737e;font-size:12px}.profile{margin-top:18px;padding-top:15px;border-top:1px solid #e1e5e9}.empty{text-align:center;padding:34px 10px;color:#68737e}.lookup{display:flex;align-items:center;gap:10px}.lookup span{flex:1}.badge{font-size:11px;color:#167650}.success{text-align:center;padding:45px 8px}.success-mark{width:58px;height:58px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;background:#167650;color:#fff;font-size:28px}@media(max-width:520px){.panel{top:0;right:0;bottom:0;width:100vw;border-radius:0}.review-row{grid-template-columns:112px 1fr}}
    </style>
    <button class="launcher" type="button" aria-label="Mở GHN Note Phạt" title="Note phạt • Giữ và kéo để di chuyển">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>
      <span class="launcher-label">NOTE PHẠT</span>
    </button>
    <div class="scrim"></div>
    <aside class="panel" aria-label="GHN Note Phạt">
      <header class="head"><span class="head-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg></span><span class="title"><strong>GHN Note Phạt</strong><span>Đọc dữ liệu từ Tra cứu nội bộ</span></span><button class="icon-button close" type="button" aria-label="Đóng">×</button></header>
      <div class="steps"><span class="step on"></span><span class="step"></span><span class="step"></span></div>
      <main class="body"></main>
      <footer class="footer" hidden><button class="btn back" type="button">Quay lại</button><button class="btn primary next" type="button">Tiếp tục</button></footer>
    </aside>
  `;

  const $ = (selector) => shadow.querySelector(selector);
  const launcher = $(".launcher");
  const scrim = $(".scrim");
  const panel = $(".panel");
  const body = $(".body");
  const footer = $(".footer");
  const backButton = $(".back");
  const nextButton = $(".next");
  const steps = Array.from(shadow.querySelectorAll(".step"));
  let suppressLauncherClick = false;

  function clampLauncherPosition(left, top) {
    const rect = launcher.getBoundingClientRect();
    const margin = 8;
    return {
      left: Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin)),
    };
  }

  function applyLauncherPosition(position) {
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
    const next = clampLauncherPosition(position.left, position.top);
    launcher.style.left = `${next.left}px`;
    launcher.style.top = `${next.top}px`;
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
  }

  async function restoreLauncherPosition() {
    applyLauncherPosition(await storageGet(STORAGE_LAUNCHER_POSITION));
  }

  function installLauncherDrag() {
    let drag = null;
    launcher.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = launcher.getBoundingClientRect();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
      launcher.setPointerCapture(event.pointerId);
      launcher.classList.add("dragging");
    });
    const move = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      applyLauncherPosition({ left: drag.left + dx, top: drag.top + dy });
    };
    const finish = async (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved;
      drag = null;
      launcher.classList.remove("dragging");
      try { launcher.releasePointerCapture(event.pointerId); } catch (_error) { /* no-op */ }
      if (moved) {
        suppressLauncherClick = true;
        const rect = launcher.getBoundingClientRect();
        await storageSet({ [STORAGE_LAUNCHER_POSITION]: { left: rect.left, top: rect.top } });
        setTimeout(() => { suppressLauncherClick = false; }, 0);
      }
    };
    launcher.addEventListener("pointermove", move);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("mousemove", (event) => {
      if (!drag) return;
      move({
        pointerId: drag.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        preventDefault: () => event.preventDefault(),
      });
    }, { passive: false });
    launcher.addEventListener("pointerup", finish);
    launcher.addEventListener("pointercancel", finish);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("mouseup", (event) => {
      if (drag) finish({ pointerId: drag.pointerId, clientX: event.clientX, clientY: event.clientY });
    });
    window.addEventListener("resize", () => {
      if (launcher.style.left) {
        const rect = launcher.getBoundingClientRect();
        applyLauncherPosition({ left: rect.left, top: rect.top });
      }
    });
  }

  function setStep(number) {
    steps.forEach((step, index) => step.classList.toggle("on", index < number));
  }

  function showFooter(config) {
    footer.hidden = !config;
    if (!config) return;
    backButton.textContent = config.backLabel || "Quay lại";
    nextButton.textContent = config.nextLabel || "Tiếp tục";
    nextButton.disabled = Boolean(config.disabled);
    backButton.onclick = config.onBack || null;
    nextButton.onclick = config.onNext || null;
  }

  function profileOptions() {
    return Core.NOTE_EMPLOYEES.map((employee) => `<option value="${escapeHtml(employee.email)}" ${state.profile && state.profile.email === employee.email ? "selected" : ""}>${escapeHtml(employee.name)} — ${escapeHtml(employee.email)}</option>`).join("");
  }

  function profileField() {
    return `<div class="profile field"><label for="ghn-note-profile">Nhân viên CS đang note</label><select id="ghn-note-profile"><option value="">Chọn tài khoản của bạn</option>${profileOptions()}</select></div>`;
  }

  function bindProfile() {
    const select = $("#ghn-note-profile");
    if (!select) return;
    select.addEventListener("change", async () => {
      state.profile = Core.NOTE_EMPLOYEES.find((employee) => employee.email === select.value) || null;
      await storageSet({ [STORAGE_PROFILE]: select.value });
      if (nextButton && !footer.hidden) nextButton.disabled = !state.profile || (!state.selectedFailure && state.flow === "calllog");
    });
  }

  function renderLoading(message) {
    setStep(1);
    showFooter(null);
    body.innerHTML = `<div class="loading"><div><div class="spinner"></div><h2 class="section-title">${escapeHtml(message)}</h2><p class="lead">Bạn không cần chuyển sang tab Lịch sử đơn hàng.</p></div></div>`;
  }

  function renderError(message, retry) {
    body.innerHTML = `<h2 class="section-title">Không thể tiếp tục</h2><p class="lead">Kiểm tra trang Tra cứu rồi thử lại.</p><div class="alert error">${escapeHtml(message)}</div>`;
    showFooter({ backLabel: "Đóng", nextLabel: "Thử lại", onBack: closePanel, onNext: retry });
  }

  async function loadProfile() {
    const savedEmail = await storageGet(STORAGE_PROFILE);
    state.profile = Core.NOTE_EMPLOYEES.find((employee) => employee.email === savedEmail) || null;
    if (!state.profile && state.flow !== "lost") {
      const firstText = Core.clean((document.body && document.body.innerText || "").slice(0, 1600));
      state.profile = Core.NOTE_EMPLOYEES.find((employee) => firstText.includes(employee.name)) || null;
      if (state.profile) await storageSet({ [STORAGE_PROFILE]: state.profile.email });
    }
  }

  async function loadLookups() {
    const response = await send({ type: `${PREFIX}LIST_LOOKUPS` });
    state.lookups = response && response.ok ? response.lookups : [];
    if (state.lookups.length === 1) state.lookupTabId = state.lookups[0].tabId;
    if (state.lookups.length > 1) {
      const currentCode = getOrderCodeFromPage();
      const exact = currentCode && state.lookups.find((item) => item.orderCode === currentCode);
      state.lookupTabId = exact ? exact.tabId : null;
    }
  }

  function renderHome() {
    setStep(1);
    showFooter(null);
    const selected = state.lookups.find((item) => item.tabId === state.lookupTabId);
    const lookupHtml = state.lookups.length === 0
      ? `<div class="alert error">Chưa tìm thấy tab Tra cứu nội bộ đang mở.</div>`
      : state.lookups.length === 1 || selected
        ? `<div class="order-strip"><strong>${escapeHtml((selected || state.lookups[0]).orderCode || "Chưa nhận diện mã đơn")}</strong><span class="ok">● Đã tìm thấy tab Tra cứu</span></div>`
        : `<div class="field"><label for="ghn-lookup-select">Chọn đơn đang tra cứu</label><select id="ghn-lookup-select"><option value="">Chọn mã đơn</option>${state.lookups.map((item) => `<option value="${item.tabId}">${escapeHtml(item.orderCode || item.title)}</option>`).join("")}</select></div>`;
    body.innerHTML = `
      <h2 class="section-title">Chọn loại ghi nhận</h2>
      <p class="lead">Tool sẽ tự đọc lịch sử từ tab Tra cứu đang mở.</p>
      ${lookupHtml}
      <div class="type-list">
        <button class="type" type="button" data-flow="calllog"><span class="type-icon">☎</span><span><strong>Calllog / sai lý do GLT</strong><small>Chọn đúng ca và nhân viên vi phạm</small></span><span>›</span></button>
        <button class="type" type="button" data-flow="pod"><span class="type-icon">✓</span><span><strong>Ghi nhận lỗi POD</strong><small>Tự nhận diện giao hoặc trả thành công</small></span><span>›</span></button>
        <button class="type" type="button" data-flow="lost"><span class="type-icon">!</span><span><strong>Tick mất hàng</strong><small>Điền mã đơn, kho hiện tại và Task quá hạn</small></span><span>›</span></button>
      </div>
      ${profileField()}
    `;
    bindProfile();
    const lookupSelect = $("#ghn-lookup-select");
    if (lookupSelect) lookupSelect.addEventListener("change", () => { state.lookupTabId = Number(lookupSelect.value) || null; });
    shadow.querySelectorAll("[data-flow]").forEach((button) => button.addEventListener("click", () => startFlow(button.dataset.flow)));
  }

  async function startFlow(flow) {
    if (!state.lookupTabId) {
      renderError("Hãy chọn tab Tra cứu có đúng mã đơn.", renderHome);
      return;
    }
    if (!state.profile) {
      const select = $("#ghn-note-profile");
      if (select) select.focus();
      renderError("Hãy chọn tên nhân viên CS đang note trước khi tiếp tục.", renderHome);
      return;
    }
    state.flow = flow;
    state.selectedFailure = null;
    state.selectedSuccess = null;
    renderLoading("Đang đọc lịch sử đơn hàng…");
    const response = await send({ type: `${PREFIX}READ_LOOKUP`, tabId: state.lookupTabId });
    if (!response || !response.ok) {
      renderError(response && response.error || "Không đọc được dữ liệu đơn hàng.", () => startFlow(flow));
      return;
    }
    state.order = response.data;
    if (!state.order.orderCode) {
      renderError("Tab Tra cứu chưa có mã đơn hợp lệ.", () => startFlow(flow));
      return;
    }
    if (flow === "calllog") renderCalllog();
    else if (flow === "pod") await renderPod();
    else await renderLost();
  }

  function currentPenalty() {
    return Core.PENALTY_OPTIONS.find((option) => option.key === state.selectedPenaltyKey) || Core.PENALTY_OPTIONS[1];
  }

  function failureChoices() {
    const operation = currentPenalty().operation;
    return state.order.failures.filter((row) => row.operation === operation);
  }

  function currentResponsibleWarehouse() {
    return Core.warehouseForOperation(state.order.warehouses, currentPenalty().operation);
  }

  function currentWarehouseLabel() {
    const operation = currentPenalty().operation;
    if (operation === "pickup") return "Kho lấy";
    if (operation === "return") return "Kho trả";
    return "Kho giao";
  }

  function calllogBlockedReason() {
    if (state.order.isAhamove) {
      return "Đơn hàng được giao bởi Ahamove.";
    }
    const operation = currentPenalty().operation;
    const completed = state.order.completedOperations || [];
    if (operation === "delivery" && completed.includes("delivery")) {
      return "Đơn đã giao hàng thành công. Không thực hiện note phạt Calllog bưu tá cho nghiệp vụ Giao.";
    }
    if (operation === "pickup" && completed.includes("pickup")) {
      return "Đơn đã lấy hàng thành công. Không thực hiện note phạt Calllog bưu tá cho nghiệp vụ Lấy.";
    }
    return "";
  }

  function renderCalllog() {
    setStep(2);
    const rows = failureChoices();
    const blockedReason = calllogBlockedReason();
    body.innerHTML = `
      <h2 class="section-title">Chọn loại phạt và ca vi phạm</h2>
      <p class="lead">Tên nhân viên được hiển thị để bạn đối chiếu.</p>
      <div class="order-strip"><strong>${escapeHtml(state.order.orderCode)}</strong><span class="ok">● Đã đọc ${state.order.rowCount} thao tác</span></div>
      <div class="field"><label for="ghn-penalty-type">Loại phạt</label><select id="ghn-penalty-type">${Core.PENALTY_OPTIONS.map((option) => `<option value="${option.key}" ${option.key === state.selectedPenaltyKey ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></div>
      ${blockedReason ? `<div class="alert error"><strong>Không được note phạt Calllog</strong><br>${escapeHtml(blockedReason)}</div>` : ""}
      <div class="choice-list">${!blockedReason && rows.length ? rows.map((row, index) => `
        <label class="choice"><input type="radio" name="ghn-failure" value="${index}"><span><span class="choice-top"><span class="choice-name">${escapeHtml(row.action)}</span><span class="choice-time">${escapeHtml(row.date)} ${escapeHtml(row.time)}</span></span><span class="person">${escapeHtml(row.employeeName || "Không rõ tên")} · <strong>#${escapeHtml(row.employeeId)}</strong></span><span class="reason">${escapeHtml(row.reason || row.detail)}</span></span></label>
      `).join("") : !blockedReason ? `<div class="alert error">Không tìm thấy ca ${escapeHtml(currentPenalty().operation === "delivery" ? "giao" : currentPenalty().operation === "pickup" ? "lấy" : "trả")} thất bại trong lịch sử.</div>` : ""}</div>
      <p class="note">Mã bưu cục dùng trong form: ${escapeHtml(currentWarehouseLabel())} ${escapeHtml(currentResponsibleWarehouse().id || "chưa xác định")}.</p>
    `;
    const select = $("#ghn-penalty-type");
    select.addEventListener("change", () => {
      state.selectedPenaltyKey = select.value;
      state.selectedFailure = null;
      renderCalllog();
    });
    shadow.querySelectorAll('input[name="ghn-failure"]').forEach((input) => input.addEventListener("change", () => {
      state.selectedFailure = rows[Number(input.value)];
      nextButton.disabled = !state.selectedFailure;
    }));
    showFooter({ disabled: Boolean(blockedReason) || !state.selectedFailure, nextLabel: "Kiểm tra thông tin", onBack: renderHome, onNext: renderCalllogReview });
  }

  function initials(name) {
    return Core.clean(name).split(" ").slice(-2).map((part) => part[0] || "").join("").toUpperCase();
  }

  function renderCalllogReview() {
    if (!state.selectedFailure) return;
    setStep(3);
    const row = state.selectedFailure;
    const warehouse = currentResponsibleWarehouse();
    const penalty = currentPenalty();
    body.innerHTML = `
      <h2 class="section-title">Kiểm tra trước khi mở form</h2>
      <p class="lead">Google Form chỉ nhận MSNV; tên nhân viên dùng để xác minh.</p>
      <div class="person-card"><span class="avatar">${escapeHtml(initials(row.employeeName))}</span><span><strong>${escapeHtml(row.employeeName)}</strong><br><span class="muted">MSNV ${escapeHtml(row.employeeId)}</span></span></div>
      ${!warehouse.id ? `<div class="alert error">Không đọc được mã Kho giao.</div>` : ""}
      <dl class="review">
        <div class="review-row"><dt>Mã đơn</dt><dd>${escapeHtml(state.order.orderCode)}</dd></div>
        <div class="review-row"><dt>Loại phạt</dt><dd>${escapeHtml(penalty.label)}</dd></div>
        <div class="review-row"><dt>${escapeHtml(currentWarehouseLabel())}</dt><dd>${escapeHtml(warehouse.id)}${warehouse.label ? ` — ${escapeHtml(warehouse.label)}` : ""}</dd></div>
        <div class="review-row"><dt>Lượt vi phạm</dt><dd>${escapeHtml(row.attempt)}</dd></div>
        <div class="review-row"><dt>Thời gian</dt><dd>${escapeHtml(row.date)} ${escapeHtml(row.time)}</dd></div>
        <div class="review-row"><dt>NV CS note</dt><dd>${escapeHtml(state.profile.name)}</dd></div>
      </dl>
      <p class="note">Form sẽ mở ở tab mới và chưa được gửi.</p>
    `;
    showFooter({ disabled: !warehouse.id, nextLabel: "Mở form đã điền", onBack: renderCalllog, onNext: openCalllogForm });
  }

  async function openCalllogForm() {
    const row = state.selectedFailure;
    const url = Core.buildCalllogUrl({
      orderCode: state.order.orderCode,
      penaltyType: currentPenalty().formValue,
      postOffice: currentResponsibleWarehouse().id,
      employeeId: row.employeeId,
      attempt: row.attempt,
      noteEmployee: state.profile.name,
    });
    await send({ type: `${PREFIX}OPEN_FORM`, url });
    renderDone();
  }

  async function findPodTask(success) {
    const expectedText = success.problemType === "Giao"
      ? "người nhận khiếu nại chưa nhận được hàng"
      : "người gửi khiếu nại chưa nhận được hàng trả";
    const response = await send({ type: `${PREFIX}FIND_TASK`, orderCode: state.order.orderCode, expectedText });
    return response && response.ok ? response.url : "";
  }

  async function renderPod() {
    setStep(2);
    const rows = state.order.successes;
    state.selectedSuccess = state.selectedSuccess || rows[0] || null;
    state.taskLink = state.selectedSuccess ? await findPodTask(state.selectedSuccess) : "";
    body.innerHTML = `
      <h2 class="section-title">Kiểm tra thao tác POD</h2>
      <p class="lead">Chọn đúng thao tác giao hoặc trả thành công.</p>
      <div class="order-strip"><strong>${escapeHtml(state.order.orderCode)}</strong><span class="ok">● Đã đọc lịch sử</span></div>
      ${rows.length ? `<div class="choice-list">${rows.map((row, index) => `<label class="choice"><input type="radio" name="ghn-success" value="${index}" ${row === state.selectedSuccess ? "checked" : ""}><span><span class="choice-top"><span class="choice-name">${escapeHtml(row.action)}</span><span class="choice-time">${escapeHtml(row.date)} ${escapeHtml(row.time)}</span></span><span class="person">${escapeHtml(row.employeeName)} · <strong>#${escapeHtml(row.employeeId)}</strong></span><span class="reason">${escapeHtml(row.warehouse)}</span></span></label>`).join("")}</div>` : `<div class="alert error">Không tìm thấy thao tác giao hoặc trả hàng thành công.</div>`}
      <div class="field" style="margin-top:14px"><label for="ghn-task-link">Link Task khiếu nại</label><input id="ghn-task-link" type="url" value="${escapeHtml(state.taskLink)}" placeholder="Dán link Task Người nhận/Người gửi khiếu nại"></div>
      ${!state.taskLink ? `<div class="alert">Chưa tự tìm thấy Task phù hợp. Hãy mở Task chi tiết hoặc dán link vào ô trên.</div>` : ""}
    `;
    const taskInput = $("#ghn-task-link");
    taskInput.addEventListener("input", () => {
      state.taskLink = taskInput.value.trim();
      nextButton.disabled = !state.selectedSuccess || !/^https:\/\/noibo\.ghn\.vn\//i.test(state.taskLink);
    });
    shadow.querySelectorAll('input[name="ghn-success"]').forEach((input) => input.addEventListener("change", async () => {
      state.selectedSuccess = rows[Number(input.value)];
      state.taskLink = await findPodTask(state.selectedSuccess);
      renderPod();
    }));
    showFooter({ disabled: !state.selectedSuccess || !/^https:\/\/noibo\.ghn\.vn\//i.test(state.taskLink), nextLabel: "Kiểm tra thông tin", onBack: renderHome, onNext: renderPodReview });
  }

  function renderPodReview() {
    const row = state.selectedSuccess;
    if (!row) return;
    const warehouse = state.order.warehouses.current;
    setStep(3);
    body.innerHTML = `
      <h2 class="section-title">Kiểm tra trước khi mở form</h2>
      <p class="lead">Thông tin lấy từ thao tác thành công đã chọn.</p>
      <div class="person-card"><span class="avatar">${escapeHtml(initials(row.employeeName))}</span><span><strong>${escapeHtml(row.employeeName)}</strong><br><span class="muted">MSNV ${escapeHtml(row.employeeId)}</span></span></div>
      ${!warehouse.id ? `<div class="alert error">Không đọc được mã Kho hiện tại.</div>` : ""}
      ${!state.taskLink ? `<div class="alert error">Chưa có link Task khiếu nại. Hãy quay lại và dán link Task để tiếp tục.</div>` : ""}
      <dl class="review">
        <div class="review-row"><dt>Mã đơn</dt><dd>${escapeHtml(state.order.orderCode)}</dd></div>
        <div class="review-row"><dt>Loại vấn đề</dt><dd>${escapeHtml(row.problemType)}</dd></div>
        <div class="review-row"><dt>Bưu cục</dt><dd>${escapeHtml(warehouse.id)}${warehouse.label ? ` — ${escapeHtml(warehouse.label)}` : ""}</dd></div>
        <div class="review-row"><dt>Ngày vi phạm</dt><dd>${escapeHtml(row.date)}</dd></div>
        <div class="review-row"><dt>Chi tiết POD</dt><dd>${state.taskLink ? `<a href="${escapeHtml(state.taskLink)}" target="_blank" rel="noreferrer">${escapeHtml(state.taskLink)}</a>` : "Để trống"}</dd></div>
        <div class="review-row"><dt>NV ghi nhận</dt><dd>${escapeHtml(state.profile.name)}</dd></div>
      </dl>
      <p class="note">Form sẽ mở ở tab mới và chưa được gửi.</p>
    `;
    showFooter({ disabled: !warehouse.id || !row.date || !/^https:\/\/noibo\.ghn\.vn\//i.test(state.taskLink), nextLabel: "Mở form đã điền", onBack: renderPod, onNext: openPodForm });
  }

  async function openPodForm() {
    const row = state.selectedSuccess;
    const url = Core.buildPodUrl({
      orderCode: state.order.orderCode,
      problemType: row.problemType,
      postOffice: state.order.warehouses.current.id,
      employeeId: row.employeeId,
      violationDate: row.date,
      detail: state.taskLink,
      noteEmployee: state.profile.name,
    });
    await send({ type: `${PREFIX}OPEN_FORM`, url });
    renderDone();
  }

  async function findLostTask() {
    const response = await send({
      type: `${PREFIX}FIND_TASK`,
      orderCode: state.order.orderCode,
      expectedText: "đơn hàng bị quá hạn toàn trình",
    });
    return response && response.ok ? response.url : "";
  }

  async function renderLost() {
    setStep(2);
    state.taskLink = await findLostTask();
    const warehouse = state.order.warehouses.current;
    const warehouseName = Core.warehouseNameOnly(warehouse);
    body.innerHTML = `
      <h2 class="section-title">Kiểm tra thông tin Tick mất hàng</h2>
      <p class="lead">Loại yêu cầu sẽ để trống để bạn tự chọn trên form.</p>
      <div class="order-strip"><strong>${escapeHtml(state.order.orderCode)}</strong><span class="ok">● Đã đọc Tra cứu</span></div>
      ${!warehouseName ? `<div class="alert error">Không đọc được tên Kho hiện tại.</div>` : ""}
      <dl class="review">
        <div class="review-row"><dt>Nhóm</dt><dd>B2C_VÙNG 3</dd></div>
        <div class="review-row"><dt>Mã đơn</dt><dd>${escapeHtml(state.order.orderCode)}</dd></div>
        <div class="review-row"><dt>Kho hiện tại</dt><dd>${escapeHtml(warehouseName || "Để trống")}</dd></div>
        <div class="review-row"><dt>Task quá hạn</dt><dd>${state.taskLink ? `<a href="${escapeHtml(state.taskLink)}" target="_blank" rel="noreferrer">${escapeHtml(state.taskLink)}</a>` : "Để trống"}</dd></div>
        <div class="review-row"><dt>Email</dt><dd>Tự tick “Lưu lại”</dd></div>
      </dl>
      ${!state.taskLink ? `<div class="alert" style="margin-top:13px">Chưa có Task “Đơn hàng bị quá hạn toàn trình” trong bộ nhớ. Trường Task sẽ để trống.</div>` : ""}
      <p class="note">Form sẽ mở ở tab mới và chưa được gửi.</p>
    `;
    showFooter({ disabled: !warehouseName, nextLabel: "Mở form đã điền", onBack: renderHome, onNext: openLostForm });
  }

  async function openLostForm() {
    const url = Core.buildLostUrl({
      orderCode: state.order.orderCode,
      currentWarehouse: Core.warehouseNameOnly(state.order.warehouses.current),
      task: state.taskLink,
    });
    await send({ type: `${PREFIX}OPEN_FORM`, url });
    renderDone();
  }

  function renderDone() {
    setStep(3);
    body.innerHTML = `<div class="success"><div class="success-mark">✓</div><h2 class="section-title">Form đã được mở</h2><p class="lead">Hãy kiểm tra lại dữ liệu trên Google Form rồi tự bấm Gửi.</p></div>`;
    showFooter({ backLabel: "Đóng", nextLabel: "Note đơn khác", onBack: closePanel, onNext: async () => { await loadLookups(); renderHome(); } });
  }

  async function openPanel() {
    panel.classList.add("open");
    scrim.classList.add("open");
    renderLoading("Đang tìm tab Tra cứu…");
    await loadProfile();
    await loadLookups();
    renderHome();
  }

  function closePanel() {
    panel.classList.remove("open");
    scrim.classList.remove("open");
  }

  installLauncherDrag();
  restoreLauncherPosition();
  launcher.addEventListener("click", () => { if (!suppressLauncherClick) openPanel(); });
  $(".close").addEventListener("click", closePanel);
  scrim.addEventListener("click", closePanel);
})();
