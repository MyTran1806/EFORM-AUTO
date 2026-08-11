// ==UserScript==
// @name         GHN - eForm đền bù & Task sự cố
// @namespace    codex.ghn.internal
// @version      2.2.2
// @description  Lấy dữ liệu ticket/tracuunoibo, tự điền eForm và form Task sự cố GHN; không tự tạo phiếu.
// @homepageURL  https://github.com/MyTran1806/EFORM-AUTO
// @updateURL    https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/ghn-eform-auto-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/ghn-eform-auto-fill.user.js
// @match        https://noibo.ghn.vn/ghn-ticket/*
// @match        https://tracuunoibo.ghn.vn/internal*
// @match        https://noibo.ghn.vn/eform/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'ghn_compensation_draft_v1';
  const TRACKING_CACHE_KEY = 'ghn_tracking_by_order_v1';
  const TASK_LINK_CACHE_KEY = 'ghn_task_links_by_order_v1';
  const PENDING_FILL_KEY = 'ghn_compensation_pending_fill_v1';
  const TASK_TEMPLATE_CACHE_KEY = 'ghn_task_templates_cache_v1';
  const PENDING_TASK_KEY = 'ghn_pending_task_v1';
  const TASK_TEMPLATE_URL = 'https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/task-templates.json';
  const TASK_TEMPLATE_COMMIT_API = 'https://api.github.com/repos/MyTran1806/EFORM-AUTO/commits/main';
  const FIXED_DETECTED_HUB = 'GPGPG004 - Customer Services B2C Team 03';
  const XU_FLOW_ID = '6859261bb7b131f75c445780';
  const CASH_FLOW_ID = '6853db464368da4033bc2be6';
  const FIXED = {
    processGroup: 'Phòng Trải Nghiệm Khách Hàng (CX)',
    process: 'XU - ĐỀN BÙ ĐƠN HÀNG THEO CHÍNH SÁCH',
    csGroup: 'B2C',
    b2cTeam: 'Vùng 3',
    eformType: 'Cập nhật mới',
    recovery: 'Không thu hồi',
    partner: 'Không',
    bankAccount: '1. Tài khoản mặc định'
  };

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeChoice = (value) => clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const choiceSignature = (value) => [...new Set(normalizeChoice(value).split(' ').filter(Boolean))].sort().join(' ');
  const sameChoice = (left, right) => {
    const normalizedLeft = normalizeChoice(left);
    const normalizedRight = normalizeChoice(right);
    return normalizedLeft === normalizedRight || choiceSignature(left) === choiceSignature(right);
  };
  const money = (value) => {
    const digits = clean(value).replace(/[^0-9]/g, '');
    return digits || '';
  };
  const draft = () => GM_getValue(STORE_KEY, {});
  const save = (patch) => GM_setValue(STORE_KEY, { ...draft(), ...patch, updatedAt: new Date().toISOString() });
  const trackingCache = () => GM_getValue(TRACKING_CACHE_KEY, {});
  function trackingForOrder(orderCode) {
    return trackingCache()[clean(orderCode).toUpperCase()] || {};
  }
  function saveTrackingRecord(data) {
    const orderCode = clean(data.trackingOrderCode).toUpperCase();
    if (!orderCode) return;
    const cache = trackingCache();
    const nonEmpty = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== '' && value != null));
    cache[orderCode] = { ...(cache[orderCode] || {}), ...nonEmpty, trackingOrderCode: orderCode, updatedAt: new Date().toISOString() };
    const recent = Object.entries(cache)
      .sort(([, left], [, right]) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
      .slice(0, 30);
    GM_setValue(TRACKING_CACHE_KEY, Object.fromEntries(recent));
  }
  function cleanTaskLinkCache() {
    const expiresAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = Object.entries(GM_getValue(TASK_LINK_CACHE_KEY, {}))
      .filter(([, item]) => new Date(item.savedAt || 0).getTime() >= expiresAt)
      .sort(([, left], [, right]) => String(right.savedAt || '').localeCompare(String(left.savedAt || '')))
      .slice(0, 100);
    const cleaned = Object.fromEntries(recent);
    GM_setValue(TASK_LINK_CACHE_KEY, cleaned);
    return cleaned;
  }
  function saveTaskLink(orderCode, taskId, taskUrl) {
    const code = clean(orderCode).toUpperCase();
    if (!code || !taskUrl) return;
    const cache = cleanTaskLinkCache();
    cache[code] = { orderCode: code, taskId, taskUrl, savedAt: new Date().toISOString() };
    GM_setValue(TASK_LINK_CACHE_KEY, cache);
    cleanTaskLinkCache();
  }
  function taskLinkForOrder(orderCode) {
    const code = clean(orderCode).toUpperCase();
    const cached = cleanTaskLinkCache()[code];
    if (cached) return cached;
    const pending = GM_getValue(PENDING_TASK_KEY, null);
    const pendingTime = new Date(pending?.completedAt || pending?.preparedAt || 0).getTime();
    if (clean(pending?.orderCode).toUpperCase() === code && pending?.taskUrl
      && pendingTime >= Date.now() - 30 * 24 * 60 * 60 * 1000) {
      saveTaskLink(code, pending.taskId || '', pending.taskUrl);
      return cleanTaskLinkCache()[code] || null;
    }
    return null;
  }

  function exactLeaf(text) {
    return [...document.querySelectorAll('span, div, p, label')]
      .find((el) => el.children.length === 0 && clean(el.textContent).toLowerCase() === text.toLowerCase());
  }

  function valueBeside(labelText) {
    const label = exactLeaf(labelText);
    if (!label) return '';
    const row = label.closest('.table-row, .flex.flex-col') || label.parentElement?.parentElement || label.parentElement;
    if (!row) return '';
    const value = row.querySelector('.value, a, [title], .ds_body_2');
    return clean(value?.getAttribute('title') || value?.textContent || '');
  }

  function valueAfterLabel(labelText) {
    const label = exactLeaf(labelText);
    if (!label) return '';
    if (label.nextElementSibling) return clean(label.nextElementSibling.innerText || label.nextElementSibling.textContent);
    const siblings = label.parentElement ? [...label.parentElement.children] : [];
    const index = siblings.indexOf(label);
    if (index >= 0 && siblings[index + 1]) return clean(siblings[index + 1].innerText || siblings[index + 1].textContent);
    const parentSiblings = label.parentElement?.parentElement ? [...label.parentElement.parentElement.children] : [];
    const parentIndex = parentSiblings.indexOf(label.parentElement);
    return parentIndex >= 0 && parentSiblings[parentIndex + 1]
      ? clean(parentSiblings[parentIndex + 1].innerText || parentSiblings[parentIndex + 1].textContent)
      : '';
  }

  function nearbyValue(labelPattern) {
    const nodes = [...document.querySelectorAll('label, dt, th, div, span, p')];
    const label = nodes.find((el) => labelPattern.test(clean(el.textContent)) && clean(el.textContent).length < 90);
    if (!label) return '';
    const row = label.closest('tr, dl, [class*="row"], [class*="item"], [class*="field"], [class*="form"]') || label.parentElement;
    if (!row) return '';
    const text = clean(row.innerText).replace(labelPattern, '').replace(/^\s*[:：-]\s*/, '');
    if (text) return text;
    const next = label.nextElementSibling;
    return clean(next && next.innerText);
  }

  function pageValue(labelPatterns) {
    const patterns = Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns];
    const nodes = [...document.querySelectorAll('label, dt, th, div, span, p')]
      .filter((el) => el.children.length === 0 && clean(el.textContent).length < 100);
    for (const node of nodes) {
      const labelText = clean(node.textContent).replace(/[:：]\s*$/, '');
      if (!patterns.some((pattern) => pattern.test(labelText))) continue;
      const candidates = [
        node.nextElementSibling,
        node.parentElement?.querySelector('.value, [class*="value"], a, [title]'),
        node.parentElement?.nextElementSibling,
        node.closest('tr, [class*="row"], [class*="item"]')
      ].filter(Boolean);
      for (const candidate of candidates) {
        const raw = clean(candidate.getAttribute?.('title') || candidate.innerText || candidate.textContent);
        const value = clean(raw.replace(new RegExp(`^${labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]?\\s*`, 'i'), ''));
        if (value && value !== labelText && value.length < 300) return value;
      }
    }
    return '';
  }

  function ticketData() {
    const pageText = clean(document.body.innerText);
    const heading = [...document.querySelectorAll('div, span, h1, h2')]
      .map((el) => clean(el.textContent))
      .find((text) => text.includes('KHIẾU NẠI') && /MĐ:\s*[A-Z0-9]+/i.test(text)) || '';
    const orderCode = valueBeside('Mã đơn hàng') || (heading.match(/MĐ:\s*([A-Z0-9]+)/i)?.[1] || '');
    const clientId = valueBeside('Client ID').match(/\d+/)?.[0] || '';
    const complaintReason = valueBeside('Lý do Khiếu nại');
    const fdCode = heading.match(/\|\s*(\d{8,})\b/)?.[1] || pageText.match(/\b(\d{12})\b/)?.[1] || '';
    const ownerText = valueBeside('Nhân viên phụ trách') || nearbyValue(/Nhân viên phụ trách/i)
      || valueBeside('Người xử lý') || nearbyValue(/Người xử lý/i);
    const ownerMatch = ownerText.match(/(?:^|\s)(\d{4,})\s*[-–]?\s*(.+)$/);
    const ownerFallback = pageText.match(/Nhân viên phụ trách\s+(?:[A-Z0-9_]+\s+)?(\d{4,})\s+(.+?)\s+Loại\b/i);
    const ticketId = location.pathname.match(/\/cs\/detail\/(\d+)/)?.[1] || '';
    return {
      orderCode,
      clientId,
      complaintReason,
      fdCode,
      ticketId,
      ticketOwnerId: ownerMatch?.[1] || ownerFallback?.[1] || '',
      ticketOwnerName: clean(ownerMatch?.[2] || ownerFallback?.[2] || ''),
      ticketUrl: location.href
    };
  }

  function trackingData() {
    const pageText = clean(document.body.innerText);
    const query = new URLSearchParams(location.search);
    const trackingOrderCode = valueBeside('Mã đơn hàng')
      || pageValue([/^Mã đơn hàng$/i, /^Mã đơn$/i])
      || query.get('order_code') || query.get('orderCode') || query.get('code')
      || pageText.match(/\b[A-Z][A-Z0-9]{7}\b/)?.[0] || '';
    const account = valueBeside('Tài khoản:') || pageValue([/^Tài khoản$/i, /^Khách hàng$/i]);
    const accountMatch = account.match(/(\d+)\s*[-–]\s*(.+)/);
    return {
      trackingOrderCode: clean(trackingOrderCode).toUpperCase(),
      clientId: accountMatch?.[1] || pageValue([/^Client ID$/i, /^Mã khách hàng$/i]).match(/\d+/)?.[0] || '',
      customerName: clean(accountMatch?.[2] || pageValue([/^Tên khách hàng$/i, /^Tên shop$/i])),
      cod: money(valueBeside('Tiền thu hộ (COD):') || pageValue([/^Tiền thu hộ(?: \(COD\))?$/i, /^COD$/i])),
      declaredValue: money(valueBeside('Giá trị đơn hàng:') || pageValue([/^Giá trị đơn hàng$/i, /^Khai giá$/i, /^Giá trị khai giá$/i])),
      serviceFee: money(valueBeside('Tổng phí dịch vụ:') || pageValue([/^Tổng phí dịch vụ$/i, /^Giá cước(?: đơn hàng)?$/i, /^Phí dịch vụ$/i])),
      pickupHub: valueAfterLabel('Kho lấy') || valueBeside('Kho lấy:') || valueBeside('Bưu cục lấy:') || pageValue([/^(Kho|Bưu cục) lấy$/i]) || nearbyValue(/^(Kho|Bưu cục) lấy/i),
      deliveryHub: valueAfterLabel('Kho giao') || valueBeside('Kho giao:') || valueBeside('Bưu cục giao:') || pageValue([/^(Kho|Bưu cục) giao$/i]) || nearbyValue(/^(Kho|Bưu cục) giao/i),
      currentHub: valueAfterLabel('Kho hiện tại') || valueBeside('Kho hiện tại:') || valueBeside('Bưu cục hiện tại:') || pageValue([/^(Kho|Bưu cục) hiện tại$/i]) || nearbyValue(/^(Kho|Bưu cục) hiện tại/i),
      trackingUrl: location.href
    };
  }

  async function captureTrackingData({ wait = true, showFailure = true } = {}) {
    const maxAttempts = wait ? 80 : 1;
    let taskDataAnnounced = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const data = trackingData();
      const previous = draft();
      if (data.trackingOrderCode && clean(previous.trackingOrderCode).toUpperCase() !== data.trackingOrderCode) {
        GM_setValue(STORE_KEY, {
          ...previous,
          trackingOrderCode: data.trackingOrderCode,
          customerName: '', cod: '', declaredValue: '', serviceFee: '',
          pickupHub: '', deliveryHub: '', currentHub: '',
          trackingUrl: data.trackingUrl,
          updatedAt: new Date().toISOString()
        });
      }
      const ready = data.trackingOrderCode && data.clientId && data.customerName
        && data.cod !== '' && data.declaredValue !== '' && data.serviceFee !== '';
      const taskReady = data.trackingOrderCode && data.pickupHub && data.deliveryHub && data.currentHub;
      saveTrackingRecord(data);
      if (taskReady && !taskDataAnnounced) {
        taskDataAnnounced = true;
        toast(`Đã tự lưu dữ liệu kho của đơn ${data.trackingOrderCode}. Không cần bấm Lưu tra cứu.`);
      }
      if (ready) {
        save(data);
        toast(`Đã tự lưu đầy đủ dữ liệu đơn ${data.trackingOrderCode}. Không cần bấm Lưu tra cứu.`);
        return true;
      }
      const partial = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== '' && value != null));
      if (Object.keys(partial).length > 1) save(partial);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (showFailure) toast('Trang tra cứu chưa tải đủ dữ liệu. Chờ trang tải xong rồi bấm “Lưu dữ liệu tra cứu”.');
    return false;
  }

  function nativeSet(input, value) {
    if (!input || value === '' || value == null) return false;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, String(value)) : (input.value = String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function baseForCommand(command) {
    const commandInputs = [...document.querySelectorAll('input[id$="_command"]')].filter((el) => el.value === command);
    const bases = commandInputs.map((el) => el.id.replace(/_command$/, ''));
    const visibleBase = bases.find((base) => {
      const control = document.getElementById(`${base}_value_0_0`);
      return control && control.getClientRects().length > 0 && !control.disabled;
    });
    return visibleBase || bases[0] || '';
  }

  function valueControl(command) {
    const base = baseForCommand(command);
    return base ? document.getElementById(`${base}_value_0_0`) : null;
  }

  function controlByLabels(labelPatterns) {
    const labels = [...document.querySelectorAll('label, div, span, p')]
      .filter((el) => el.children.length === 0 && clean(el.textContent).length < 80)
      .filter((el) => labelPatterns.some((pattern) => pattern.test(clean(el.textContent))));
    for (const label of labels) {
      let container = label.parentElement;
      for (let level = 0; container && level < 5; level += 1, container = container.parentElement) {
        const controls = [...container.querySelectorAll('input, textarea')]
          .filter((el) => el.getClientRects().length > 0 && !el.disabled && !el.id.endsWith('_command'));
        if (controls.length === 1) return controls[0];
      }
    }
    return null;
  }

  function firstControl(commands, labelPatterns = []) {
    for (const command of commands) {
      let control = valueControl(command);
      if (!control && command.endsWith('*')) {
        const prefix = command.slice(0, -1);
        const dynamicCommand = [...document.querySelectorAll('input[id$="_command"]')]
          .find((el) => {
            if (!String(el.value || '').startsWith(prefix)) return false;
            const dynamicBase = el.id.replace(/_command$/, '');
            const dynamicControl = document.getElementById(`${dynamicBase}_value_0_0`);
            return dynamicControl?.getClientRects().length > 0 && !dynamicControl.disabled;
          });
        const base = dynamicCommand?.id.replace(/_command$/, '');
        control = base ? document.getElementById(`${base}_value_0_0`) : null;
      }
      if (control?.getClientRects().length && !control.disabled) return control;
    }
    return controlByLabels(labelPatterns);
  }

  function choiceTextFor(commands, labelPatterns) {
    const control = firstControl(commands, labelPatterns);
    const select = control?.closest('.ant-select');
    return clean(select?.querySelector('.ant-select-selection-item')?.textContent || control?.value || '');
  }

  function compensationContentValues() {
    const amountControl = firstControl(
      ['gia_tri_den_bu', 'gia_tri_boi_thuong'],
      [/giá trị đền bù/i, /gia tri den bu/i]
    );
    const contentControl = firstControl(
      ['noi_dung_den_bu', 'noi_dung_boi_thuong'],
      [/nội dung đền bù/i, /noi dung den bu/i]
    );
    return {
      amount: clean(amountControl?.value),
      cause: choiceTextFor(
        ['nguyen_nhan_*', 'nguyen_nhan_khieu_nai', 'nguyen_nhan_kn', 'nguyen_nhan'],
        [/nguyên nhân/i, /nguyen nhan/i]
      ),
      complaint: choiceTextFor(['loai_khieu_nai'], [/loại khiếu nại/i, /loai khieu nai/i]),
      recovery: choiceTextFor(['thu_hoi'], [/thu hồi/i, /thu hoi/i]),
      contentControl
    };
  }

  function updateCompensationContent() {
    const { amount, cause, complaint, recovery, contentControl } = compensationContentValues();
    if (!amount || !cause || !complaint || !recovery || !contentControl) return false;
    const amountWithCurrency = /đ$/i.test(amount) ? amount : `${amount}đ`;
    const currentFlowId = new URLSearchParams(location.search).get('flowId') || '';
    const vatText = currentFlowId === CASH_FLOW_ID ? 'Có VAT/ 4l cước phí' : 'không VAT';
    const content = `${recovery} - ${complaint} - ${cause} - ${vatText} - Sản phẩm: - ${amountWithCurrency}`;
    return contentControl.value === content || nativeSet(contentControl, content);
  }

  function watchManualCompensationFields() {
    let lastSignature = '';
    const refresh = () => {
      const values = compensationContentValues();
      const signature = [values.amount, values.cause, values.complaint, values.recovery].join('|');
      if (signature && signature !== lastSignature) {
        lastSignature = signature;
        updateCompensationContent();
      }
    };
    document.addEventListener('input', refresh, true);
    document.addEventListener('change', () => setTimeout(refresh, 150), true);
    setInterval(refresh, 700);
  }

  async function waitForCommand(command, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (valueControl(command)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  function mouseActivate(element, shouldScroll = true) {
    if (!element) return;
    if (shouldScroll) element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const EventClass = type.startsWith('pointer') && pageWindow.PointerEvent ? pageWindow.PointerEvent : pageWindow.MouseEvent;
      element.dispatchEvent(new EventClass(type, { bubbles: true, cancelable: true, view: pageWindow, button: 0 }));
    }
    pageWindow.HTMLElement.prototype.click.call(element);
  }

  function pressSyntheticKey(element, key) {
    element.focus();
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const init = { key, code: key, bubbles: true, cancelable: true };
    element.dispatchEvent(new pageWindow.KeyboardEvent('keydown', init));
    element.dispatchEvent(new pageWindow.KeyboardEvent('keyup', init));
  }

  function visibleOptions() {
    const optionNodes = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')];
    return optionNodes.filter((el) => el.getClientRects().length > 0);
  }

  async function choose(command, optionText) {
    if (!optionText || !(await waitForCommand(command))) return false;
    const input = valueControl(command);
    const select = input?.closest('.ant-select');
    mouseActivate(select?.querySelector('.ant-select-selector') || select || input);
    const started = Date.now();
    while (Date.now() - started < 2500) {
      const dropdown = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      const allOptions = [...(dropdown?.querySelectorAll('.ant-select-item-option') || [])];
      const optionIndex = allOptions.findIndex((el) => sameChoice(el.textContent, optionText));
      const option = allOptions[optionIndex];
      if (option) {
        option.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await new Promise((resolve) => setTimeout(resolve, 120));
        mouseActivate(option, false);
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (sameChoice(selectedText(command), optionText)) return true;

        // Dự phòng cho Ant Design khi sự kiện chuột từ userscript bị bỏ qua.
        if (input.getAttribute('aria-expanded') !== 'true') {
          mouseActivate(select?.querySelector('.ant-select-selector') || select || input);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        for (let index = 0; index < optionIndex; index += 1) pressSyntheticKey(input, 'ArrowDown');
        pressSyntheticKey(input, 'Enter');
        await new Promise((resolve) => setTimeout(resolve, 350));
        return sameChoice(selectedText(command), optionText);
      }
      const holder = dropdown?.querySelector('.rc-virtual-list-holder');
      if (holder && holder.scrollTop + holder.clientHeight < holder.scrollHeight) {
        holder.scrollTop = Math.min(holder.scrollTop + Math.max(holder.clientHeight * 0.8, 120), holder.scrollHeight);
        holder.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  function selectedText(command) {
    const input = valueControl(command);
    const select = input?.closest('.ant-select');
    return clean(select?.querySelector('.ant-select-selection-item')?.textContent || '');
  }

  async function ensureChoice(command, optionText) {
    if (sameChoice(selectedText(command), optionText)) return true;
    return choose(command, optionText);
  }

  async function applyFixedDefaults() {
    const groupOk = await ensureChoice('nhom_cs', FIXED.csGroup);
    const teamOk = groupOk && await ensureChoice('team_b2c', FIXED.b2cTeam);
    const typeOk = teamOk && await ensureChoice('loai_eform', FIXED.eformType);
    return groupOk && teamOk && typeOk;
  }

  async function fillEform() {
    const baseDraft = draft();
    const data = { ...baseDraft, ...trackingForOrder(baseDraft.orderCode) };
    const currentFlowId = new URLSearchParams(location.search).get('flowId') || '';
    const isCashFlow = currentFlowId === CASH_FLOW_ID;
    const filled = new Set();
    const set = (commands, label, value, labelPatterns) => {
      const control = firstControl(Array.isArray(commands) ? commands : [commands], labelPatterns);
      if (control?.getClientRects().length && nativeSet(control, value) && control.value === String(value)) filled.add(label);
    };
    const defaultsOk = await applyFixedDefaults();
    await waitForCommand('ma_don_hang');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const fillTicketFields = () => {
      set(['ma_don_hang', 'ma_don'], 'Mã đơn hàng', data.orderCode, [/mã đơn hàng/i]);
      set(['id_khach_hang', 'client_id', 'ma_khach_hang'], 'ID Khách Hàng', data.clientId, [/id khách hàng/i, /client id/i]);
      set(['ten_khach_hang', 'ten_khach_hang*', 'customer_name', 'ten_khach'], 'Tên Khách Hàng', data.customerName, [/tên khách hàng/i, /tên shop/i]);
      set(['cod', 'cod*', 'tien_cod', 'gia_tri_cod'], 'COD', data.cod, [/^cod$/i, /tiền thu hộ/i]);
      set(['khai_gia', 'khai_gia*', 'gia_tri_khai_gia', 'declared_value'], 'Khai giá', data.declaredValue, [/khai giá/i, /giá trị đơn hàng/i]);
      set(['gia_cuoc_don_hang', 'gia_cuoc_don_hang*', 'gia_cuoc', 'phi_dich_vu', 'service_fee'], 'Giá cước đơn hàng', data.serviceFee, [/giá cước/i, /tổng phí dịch vụ/i]);
      set(['ma_phieu_fd', 'fd_id'], 'Mã phiếu FD', data.fdCode, [/mã phiếu fd/i]);
    };
    const fillTaskLink = async () => {
      const exactTaskUrl = taskLinkForOrder(data.orderCode)?.taskUrl || '';
      if (!exactTaskUrl) return 'missing';
      const started = Date.now();
      while (Date.now() - started < 10000) {
        const taskLinkControl = firstControl(
          ['link_fd_hrw_task', 'link_fd_hrw_task*', 'link_task', 'link_task*', 'link_fd_hrw', 'url_task'],
          [/link\s*fd\s*\/\s*hrw\s*\/\s*task/i, /link\s*(?:fd|hrw|task)/i]
        );
        if (taskLinkControl?.getClientRects().length && !taskLinkControl.disabled) {
          if (taskLinkControl.value !== exactTaskUrl) nativeSet(taskLinkControl, exactTaskUrl);
          await new Promise((resolve) => setTimeout(resolve, 180));
          if (taskLinkControl.value === exactTaskUrl) {
            filled.add('Link FD/HRW/TASK');
            return 'ok';
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return 'field-not-ready';
    };
    fillTicketFields();
    const complaintChosen = await choose('loai_khieu_nai', data.complaintReason || '');
    const recoveryChosen = await choose('thu_hoi', FIXED.recovery);
    const partnerChosen = await choose('doi_tac', FIXED.partner);
    const bankChosen = !isCashFlow || await ensureChoice('tai_khoan_ngan_hang_cua_khach_hang', FIXED.bankAccount);
    // Các dropdown có thể khiến React dựng lại form; điền lại lần cuối sau khi giao diện ổn định.
    await new Promise((resolve) => setTimeout(resolve, 400));
    fillTicketFields();
    const taskLinkStatus = await fillTaskLink();
    updateCompensationContent();
    const missing = [
      ['Mã đơn hàng', data.orderCode],
      ['ID khách hàng', data.clientId],
      ['Tên khách hàng', data.customerName],
      ['COD', data.cod],
      ['Khai giá', data.declaredValue],
      ['Giá cước', data.serviceFee],
      ['Mã phiếu FD', data.fdCode]
    ].filter(([, value]) => value === '' || value == null).map(([name]) => name);
    toast(`Mặc định eForm ${isCashFlow ? 'TIỀN MẶT' : 'XU'}: ${defaultsOk ? 'OK' : 'cần kiểm tra'}; đã điền ${filled.size} ô${missing.length ? `; thiếu dữ liệu nguồn: ${missing.join(', ')}` : ''}; Link TASK: ${taskLinkStatus === 'ok' ? 'OK' : taskLinkStatus === 'missing' ? `không có link đúng mã ${data.orderCode}` : 'không tìm thấy trường để điền'}; Loại khiếu nại: ${complaintChosen ? 'OK' : 'cần kiểm tra'}; Thu hồi: ${recoveryChosen ? 'OK' : 'cần kiểm tra'}; Đối tác: ${partnerChosen ? 'OK' : 'cần kiểm tra'}${isCashFlow ? `; Tài khoản ngân hàng: ${bankChosen ? 'OK' : 'cần kiểm tra'}` : ''}. Nhập Nguyên nhân khiếu nại và Giá trị đền bù để tự ghép Nội dung đền bù. Không tự gửi phiếu.`);
  }

  function gmJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        timeout: 15000,
        onload: (response) => {
          try {
            if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error('Không kết nối được GitHub')),
        ontimeout: () => reject(new Error('GitHub phản hồi quá thời gian'))
      });
    });
  }

  function validTaskTemplatePayload(payload) {
    return payload && payload.schemaVersion === 1 && Array.isArray(payload.items)
      && payload.items.every((item) => item.reason && item.incidentType && item.incidentLabel && item.template);
  }

  async function latestTaskTemplateUrl() {
    try {
      const commit = await gmJson(`${TASK_TEMPLATE_COMMIT_API}?v=${Date.now()}`);
      if (!commit?.sha) throw new Error('GitHub không trả về commit SHA');
      return {
        url: `https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/${commit.sha}/task-templates.json?v=${Date.now()}`,
        commitSha: commit.sha
      };
    } catch (error) {
      const separator = TASK_TEMPLATE_URL.includes('?') ? '&' : '?';
      return { url: `${TASK_TEMPLATE_URL}${separator}v=${Date.now()}`, commitSha: '' };
    }
  }

  async function loadTaskTemplates(force = false) {
    const cached = GM_getValue(TASK_TEMPLATE_CACHE_KEY, null);
    if (!force && validTaskTemplatePayload(cached)) return cached;
    try {
      const latest = await latestTaskTemplateUrl();
      const payload = await gmJson(latest.url);
      if (!validTaskTemplatePayload(payload)) throw new Error('Dữ liệu task không đúng cấu trúc');
      payload.commitSha = latest.commitSha;
      GM_setValue(TASK_TEMPLATE_CACHE_KEY, payload);
      return payload;
    } catch (error) {
      if (validTaskTemplatePayload(cached)) {
        toast(`Không tải được dữ liệu mới (${error.message}); đang dùng bản đã lưu gần nhất.`);
        return cached;
      }
      throw error;
    }
  }

  function replaceTaskTemplate(template, data) {
    let content = String(template || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/#ma_don_hang/gi, data.orderCode || '')
      .replace(/#ticket_id/gi, data.ticketId || '')
      .replace(/#ten_nhan_vien/gi, data.ticketOwnerName || '')
      .replace(/#ma_nhan_vien/gi, data.ticketOwnerId || '');
    // Dữ liệu JSON cũ từng bị dồn thành một dòng: khôi phục bố cục chuẩn của Sheet.
    if (!content.includes('\n')) {
      content = content
        .replace(/\s+(Dear\s+all\s*,?)/i, '\n\n$1\n\n')
        .replace(/\s+(Thanks)\s*$/i, '\n\n$1');
    }
    return content;
  }

  function taskHubForRule(rule, data) {
    const normalized = normalizeChoice(rule || '');
    if (!normalized) return '';
    const ticketOrder = clean(data.orderCode).toUpperCase();
    const trackingOrder = clean(data.trackingOrderCode).toUpperCase();
    if (!ticketOrder || !trackingOrder || ticketOrder !== trackingOrder) return '';
    if (normalized.includes('kho giao')) return data.deliveryHub || '';
    if (normalized.includes('kho lay')) return data.pickupHub || '';
    if (normalized.includes('kho hien tai')) return data.currentHub || '';
    return '';
  }

  function closeTaskPicker() {
    document.getElementById('ghn-task-picker-overlay')?.remove();
  }

  function showTaskPicker(payload, sourceData) {
    closeTaskPicker();
    const overlay = document.createElement('div');
    overlay.id = 'ghn-task-picker-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: 1000000, display: 'grid', placeItems: 'center',
      padding: '20px', background: '#0008', font: '14px/1.45 Arial'
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(720px, 96vw)', maxHeight: '88vh', overflow: 'auto', padding: '20px',
      borderRadius: '12px', background: '#fff', color: '#202124', boxShadow: '0 20px 55px #0006'
    });
    const title = document.createElement('h2');
    title.textContent = 'Tạo task sự cố từ ticket';
    Object.assign(title.style, { margin: '0 0 4px', font: '700 20px Arial' });
    const meta = document.createElement('div');
    meta.textContent = `Ticket ${sourceData.ticketId || '(không xác định)'} · Đơn ${sourceData.orderCode || '(chưa có mã đơn)'} · dữ liệu ${payload.version || payload.publishedAt || 'hiện tại'}${payload.commitSha ? ` · commit ${payload.commitSha.slice(0, 7)}` : ''}`;
    Object.assign(meta.style, { color: '#667085', marginBottom: '14px' });
    const label = document.createElement('label');
    label.textContent = 'Nguyên nhân';
    Object.assign(label.style, { display: 'block', fontWeight: '700', marginBottom: '6px' });
    const select = document.createElement('select');
    Object.assign(select.style, { width: '100%', padding: '10px', border: '1px solid #cfd4dc', borderRadius: '8px', background: '#fff', color: '#202124' });
    const sortedItems = [...payload.items].sort((a, b) => `${a.complaintType}|${a.reason}`.localeCompare(`${b.complaintType}|${b.reason}`, 'vi'));
    for (const [index, item] of sortedItems.entries()) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${item.complaintType ? `${item.complaintType} — ` : ''}${item.reason}`;
      select.appendChild(option);
    }
    const summary = document.createElement('div');
    Object.assign(summary.style, { marginTop: '12px', padding: '12px', borderRadius: '8px', background: '#f5f7fa' });
    const typeLine = document.createElement('div');
    const hubLine = document.createElement('div');
    const preview = document.createElement('textarea');
    preview.readOnly = true;
    Object.assign(preview.style, { width: '100%', minHeight: '150px', boxSizing: 'border-box', marginTop: '10px', padding: '10px', border: '1px solid #d8dde5', borderRadius: '8px', resize: 'vertical', background: '#fff', color: '#202124' });
    summary.append(typeLine, hubLine, preview);
    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '14px', flexWrap: 'wrap' });
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'Đồng bộ lại dữ liệu GitHub';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Hủy';
    const proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.textContent = 'Mở form task GHN';
    for (const button of [refresh, cancel, proceed]) {
      Object.assign(button.style, { padding: '9px 13px', borderRadius: '8px', border: '1px solid #d0d5dd', background: '#fff', color: '#202124', cursor: 'pointer', fontWeight: '700' });
    }
    Object.assign(proceed.style, { marginLeft: 'auto', background: '#ed5b22', borderColor: '#ed5b22', color: '#fff' });
    actions.append(refresh, cancel, proceed);
    panel.append(title, meta, label, select, summary, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const render = () => {
      const item = sortedItems[Number(select.value) || 0];
      typeLine.textContent = `Loại sự cố: ${item.incidentLabel}`;
      const resolvedHub = taskHubForRule(item.responsibleRule, {
        ...trackingForOrder(sourceData.orderCode), orderCode: sourceData.orderCode
      });
      hubLine.textContent = item.responsibleRule
        ? `Bộ phận chịu trách nhiệm (${item.responsibleRule}): ${resolvedHub || 'chưa có dữ liệu tra cứu đúng mã đơn'}`
        : 'Form này không có Bộ phận chịu trách nhiệm';
      preview.value = replaceTaskTemplate(item.template, sourceData);
    };
    select.addEventListener('change', render);
    cancel.addEventListener('click', closeTaskPicker);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeTaskPicker(); });
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try {
        const fresh = await loadTaskTemplates(true);
        closeTaskPicker();
        showTaskPicker(fresh, sourceData);
        toast(`Đã đồng bộ ${fresh.items.length} nguyên nhân từ GitHub.`);
      } catch (error) {
        toast(`Không đồng bộ được dữ liệu task: ${error.message}`);
      } finally {
        refresh.disabled = false;
      }
    });
    proceed.addEventListener('click', () => {
      const item = sortedItems[Number(select.value) || 0];
      const pending = {
        ...sourceData,
        templateItem: item,
        content: replaceTaskTemplate(item.template, sourceData),
        responsibleHub: taskHubForRule(item.responsibleRule, {
          ...trackingForOrder(sourceData.orderCode), orderCode: sourceData.orderCode
        }),
        preparedAt: new Date().toISOString()
      };
      GM_setValue(PENDING_TASK_KEY, pending);
      save(sourceData);
      const taskUrl = `${location.origin}/ghn-ticket/create-ticket?type=${encodeURIComponent(item.incidentType)}`;
      const taskTab = window.open(taskUrl, '_blank');
      if (taskTab) {
        taskTab.focus();
        closeTaskPicker();
      } else {
        toast('Trình duyệt đang chặn tab mới. Hãy cho phép pop-up của noibo.ghn.vn rồi bấm lại.');
      }
    });
    render();
  }

  async function openTaskPicker() {
    const sourceData = ticketData();
    if (!sourceData.orderCode) {
      toast('Không lấy được mã đơn trên ticket. Vui lòng kiểm tra ticket trước khi tạo task.');
      return;
    }
    save(sourceData);
    try {
      const payload = await loadTaskTemplates(true);
      showTaskPicker(payload, sourceData);
    } catch (error) {
      toast(`Không tải được danh sách nguyên nhân: ${error.message}`);
    }
  }

  function fieldContainer(labelPattern) {
    const label = [...document.querySelectorAll('label, div, span, p')]
      .filter((el) => el.children.length === 0 && clean(el.textContent).length < 100)
      .find((el) => labelPattern.test(clean(el.textContent)));
    if (!label) return null;
    const formItem = label.closest('.ant-form-item, [class*="form-item"], [class*="formItem"]');
    if (formItem?.querySelector('input, textarea, [role="combobox"], .ant-select')) return formItem;
    let container = label.parentElement;
    for (let level = 0; container && level < 6; level += 1, container = container.parentElement) {
      if (container.querySelector('input, textarea, [role="combobox"], .ant-select')) return container;
    }
    return null;
  }

  function taskTextControl(labelPattern, placeholderPattern) {
    const container = fieldContainer(labelPattern);
    const inContainer = container && [...container.querySelectorAll('input, textarea')]
      .find((el) => el.getClientRects().length > 0 && !el.disabled);
    if (inContainer) return inContainer;
    return [...document.querySelectorAll('input, textarea')]
      .find((el) => el.getClientRects().length > 0 && placeholderPattern.test(el.placeholder || '')) || null;
  }

  async function chooseTaskCombobox(labelPattern, target) {
    if (!target) return false;
    let container = null;
    const waitStarted = Date.now();
    while (!container && Date.now() - waitStarted < 10000) {
      container = fieldContainer(labelPattern);
      if (!container) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const select = container?.querySelector('.ant-select') || container?.querySelector('[role="combobox"]')?.closest('.ant-select');
    const input = select?.querySelector('input[role="combobox"], input');
    const selected = clean(select?.querySelector('.ant-select-selection-item')?.textContent || '');
    if (sameChoice(selected, target)) return true;
    if (!select && !input) return false;
    // API tìm bưu cục của GHN chỉ nhận mã đứng trước dấu "-", không nhận cả tên.
    const searchCode = clean(target).split(/\s*[-–]\s*/, 1)[0];
    mouseActivate(select?.querySelector('.ant-select-selector') || select || input);
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (input) nativeSet(input, searchCode);
    const targetCode = searchCode || clean(target).match(/[A-Z0-9]{4,}/i)?.[0] || '';
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const options = visibleOptions();
      const option = options.find((node) => sameChoice(node.textContent, target)
        || (targetCode && clean(node.textContent).toLowerCase().includes(targetCode.toLowerCase()))
        || clean(node.textContent).toLowerCase().includes(clean(target).toLowerCase()));
      if (option) {
        mouseActivate(option, false);
        await new Promise((resolve) => setTimeout(resolve, 250));
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    pressSyntheticKey(input, 'Escape');
    return false;
  }

  async function fillTaskForm() {
    const pending = GM_getValue(PENDING_TASK_KEY, null);
    if (!pending?.templateItem) return;
    const pageType = new URLSearchParams(location.search).get('type') || '';
    if (pageType !== pending.templateItem.incidentType) return;
    const manualRadio = [...document.querySelectorAll('input[type="radio"]')]
      .find((radio) => clean(radio.parentElement?.innerText).includes('Tạo thủ công'));
    if (manualRadio && !manualRadio.checked) {
      mouseActivate(manualRadio);
      await new Promise((resolve) => setTimeout(resolve, 350));
    } else if (!manualRadio) {
      const manualText = exactLeaf('Tạo thủ công');
      if (manualText) {
        mouseActivate(manualText);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    const formReadyStarted = Date.now();
    while (!fieldContainer(/Bộ phận phát hiện/i) && Date.now() - formReadyStarted < 15000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const detectedOk = await chooseTaskCombobox(/Bộ phận phát hiện/i, FIXED_DETECTED_HUB);
    let responsibleOk = true;
    if (pending.templateItem.responsibleRule) {
      const hub = pending.responsibleHub || taskHubForRule(pending.templateItem.responsibleRule, {
        ...trackingForOrder(pending.orderCode), orderCode: pending.orderCode
      });
      responsibleOk = hub ? await chooseTaskCombobox(/Bộ phận chịu trách nhiệm/i, hub) : false;
    }

    const orderControl = taskTextControl(/(Mã đơn hàng|Danh sách đơn hàng)/i, /(Nhập mã đơn hàng|Ví dụ:)/i);
    const orderOk = nativeSet(orderControl, pending.orderCode);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const addOrderButton = [...document.querySelectorAll('button')]
      .find((button) => clean(button.textContent).includes('Thêm mã đơn') && !button.disabled);
    if (addOrderButton) {
      mouseActivate(addOrderButton);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const amountControl = taskTextControl(/Nhập số tiền/i, /Nhập số tiền/i);
    const taskTracking = trackingForOrder(pending.orderCode);
    const amountValue = pending.templateItem.incidentType === 'qua_han_toan_trinh'
      ? (taskTracking.declaredValue || '')
      : (taskTracking.declaredValue || taskTracking.serviceFee || '');
    if (amountControl && amountValue) nativeSet(amountControl, amountValue);
    const contentControl = taskTextControl(/Nội dung yêu cầu/i, /Nhập nội dung yêu cầu/i);
    const contentOk = nativeSet(contentControl, pending.content);

    const updateSubmitted = () => {
      const current = GM_getValue(PENDING_TASK_KEY, pending);
      GM_setValue(PENDING_TASK_KEY, { ...current, submittedAt: new Date().toISOString() });
    };
    [...document.querySelectorAll('button')]
      .filter((button) => clean(button.textContent) === 'Tạo phiếu')
      .forEach((button) => button.addEventListener('click', updateSubmitted, { once: true }));
    toast(`Đã điền form task: mã đơn ${orderOk ? 'OK' : 'cần kiểm tra'}; bộ phận phát hiện ${detectedOk ? 'OK' : 'cần kiểm tra'}; bộ phận chịu trách nhiệm ${responsibleOk ? 'OK' : 'cần kiểm tra'}; nội dung ${contentOk ? 'OK' : 'cần kiểm tra'}. Hãy kiểm tra và tự bấm Tạo phiếu.`);
  }

  async function chooseOwnerInDialog(ownerId, ownerName) {
    let changeButton = null;
    const buttonStarted = Date.now();
    while (!changeButton && Date.now() - buttonStarted < 15000) {
      changeButton = [...document.querySelectorAll('button, [role="button"]')]
        .find((button) => clean(button.textContent).includes('Đổi người xử lý'));
      if (!changeButton) {
        const text = [...document.querySelectorAll('span, div')]
          .find((node) => node.children.length === 0 && clean(node.textContent).includes('Đổi người xử lý'));
        changeButton = text?.closest('button, [role="button"]') || null;
      }
      if (!changeButton) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!changeButton) return false;
    mouseActivate(changeButton);
    let dialog = null;
    const dialogStarted = Date.now();
    while (!dialog && Date.now() - dialogStarted < 5000) {
      dialog = document.querySelector('[role="dialog"], .ant-modal:not([style*="display: none"])');
      if (!dialog) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const input = dialog?.querySelector('input[role="combobox"], input');
    if (!input) return false;
    mouseActivate(input);
    const ownerSearch = ownerId || ownerName;
    nativeSet(input, ownerSearch);
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const option = visibleOptions().find((node) => (ownerId && clean(node.textContent).includes(ownerId))
        || (ownerName && clean(node.textContent).includes(ownerName)));
      if (option) {
        mouseActivate(option, false);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const confirm = [...dialog.querySelectorAll('button')]
          .find((button) => /^(Xác nhận đổi|Xác nhận|Cập nhật)$/i.test(clean(button.textContent)) && !button.disabled);
        if (!confirm) return false;
        mouseActivate(confirm);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }

  async function handleCreatedTaskDetail() {
    const pending = GM_getValue(PENDING_TASK_KEY, null);
    if (!pending?.templateItem) return;
    const preparedAt = new Date(pending.submittedAt || pending.preparedAt || '').getTime();
    if (!Number.isFinite(preparedAt) || Date.now() - preparedAt > 60 * 60 * 1000) return;
    const taskId = location.pathname.match(/\/ghn-ticket\/detail\/(\d+)/)?.[1] || '';
    if (!taskId) return;
    const taskUrl = location.href;
    saveTaskLink(pending.orderCode, taskId, taskUrl);
    save({ taskId, taskUrl });
    const current = GM_getValue(PENDING_TASK_KEY, pending);
    GM_setValue(PENDING_TASK_KEY, { ...current, taskId, taskUrl, completedAt: new Date().toISOString() });
    toast(`Đã lưu link Task cho đơn ${pending.orderCode} để dùng cho eForm. Tool không tự đổi Người xử lý và không ghi chú vào ticket.`);
  }

  async function writeTaskLinkToSourceTicket() {
    const data = draft();
    if (!data.taskUrl) {
      toast('Chưa có link task trong dữ liệu nháp.');
      return false;
    }
    const currentTicketId = location.pathname.match(/\/cs\/detail\/(\d+)/)?.[1] || '';
    if (data.ticketId && currentTicketId && data.ticketId !== currentTicketId) {
      toast(`Link task đang thuộc ticket ${data.ticketId}, không phải ticket ${currentTicketId}.`);
      return false;
    }
    const findEditor = () => [...document.querySelectorAll('.ProseMirror[contenteditable="true"], [contenteditable="true"], textarea')]
      .find((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));
    let editor = findEditor();
    if (!editor) {
      const noteButton = [...document.querySelectorAll('button, [role="button"]')]
        .find((button) => clean(button.textContent).includes('Ghi chú nội bộ'));
      const noteText = !noteButton && [...document.querySelectorAll('div, span')]
        .find((node) => node.children.length === 0 && clean(node.textContent) === 'Ghi chú nội bộ');
      const opener = noteButton || noteText?.closest('button, [role="button"]') || noteText;
      if (opener) {
        mouseActivate(opener);
        const editorStarted = Date.now();
        while (!editor && Date.now() - editorStarted < 5000) {
          editor = findEditor();
          if (!editor) await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
    }
    if (!editor) {
      toast('Không tìm thấy trình soạn thảo Ghi chú nội bộ.');
      return false;
    }
    const noteContent = `Task ${data.taskUrl}`;
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      nativeSet(editor, noteContent);
    } else {
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = document.execCommand?.('insertText', false, noteContent);
      if (!inserted) editor.textContent = noteContent;
      editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: noteContent }));
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: noteContent }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }
    let saveNote = null;
    const saveStarted = Date.now();
    while (!saveNote && Date.now() - saveStarted < 5000) {
      saveNote = [...document.querySelectorAll('button')]
        .find((button) => /^(Lưu ghi chú|Gửi)$/i.test(clean(button.textContent)) && !button.disabled);
      if (!saveNote) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!saveNote) {
      toast('Đã điền link nhưng nút Lưu ghi chú chưa sẵn sàng; vui lòng kiểm tra và bấm lưu.');
      return false;
    }
    mouseActivate(saveNote);
    const pending = GM_getValue(PENDING_TASK_KEY, null);
    if (pending?.taskUrl === data.taskUrl) {
      GM_setValue(PENDING_TASK_KEY, { ...pending, noteWrittenAt: new Date().toISOString() });
    }
    toast('Đã gửi link task vào ghi chú nội bộ của ticket.');
    return true;
  }

  function watchTaskCompletionForSourceTicket() {
    const currentTicketId = location.pathname.match(/\/cs\/detail\/(\d+)/)?.[1] || '';
    const watchStartedAt = Date.now();
    let writing = false;
    const check = async () => {
      if (writing) return;
      const pending = GM_getValue(PENDING_TASK_KEY, null);
      if (!pending?.taskUrl || !pending?.completedAt || pending.noteWrittenAt || pending.autoNoteAttemptedAt) return;
      if (pending.ticketId && currentTicketId && pending.ticketId !== currentTicketId) return;
      const completedAt = new Date(pending.completedAt).getTime();
      // Không xử lý lại Task tồn từ phiên/tab ticket trước.
      if (!Number.isFinite(completedAt) || completedAt < watchStartedAt - 10000) return;
      writing = true;
      try {
        GM_setValue(PENDING_TASK_KEY, { ...pending, autoNoteAttemptedAt: new Date().toISOString() });
        save({ taskId: pending.taskId, taskUrl: pending.taskUrl });
        if (await writeTaskLinkToSourceTicket()) {
          const latest = GM_getValue(PENDING_TASK_KEY, pending);
          GM_setValue(PENDING_TASK_KEY, { ...latest, noteWrittenAt: new Date().toISOString() });
        }
      } finally {
        writing = false;
      }
    };
    check();
    setInterval(check, 1500);
  }

  function toast(message) {
    let box = document.getElementById('ghn-auto-fill-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ghn-auto-fill-toast';
      Object.assign(box.style, { position: 'fixed', right: '14px', top: '14px', zIndex: 999999, maxWidth: '320px', padding: '8px 11px', borderRadius: '7px', color: '#fff', background: '#d76632', boxShadow: '0 3px 12px #0003', font: '13px/1.35 Arial', pointerEvents: 'none' });
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.style.display = 'block';
    clearTimeout(toast.hideTimer);
    toast.hideTimer = setTimeout(() => { box.style.display = 'none'; }, 6500);
  }

  function addButton(text, onClick, bottomOffset = 12) {
    const button = document.createElement('button');
    button.textContent = text;
    button.type = 'button';
    button.title = 'Bấm để chạy • Giữ và kéo để di chuyển';
    Object.assign(button.style, {
      position: 'fixed', right: '12px', bottom: `${bottomOffset}px`, zIndex: 999999,
      padding: '9px 13px', border: '1px solid #ffffff33', borderRadius: '10px',
      color: '#fff', background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      font: '700 13px/1.2 Arial', letterSpacing: '.1px', cursor: 'grab',
      boxShadow: '0 6px 18px #1d4ed840', userSelect: 'none', touchAction: 'none',
      whiteSpace: 'nowrap', transition: 'filter .15s ease, box-shadow .15s ease'
    });
    button.addEventListener('mouseenter', () => {
      button.style.filter = 'brightness(1.07)';
      button.style.boxShadow = '0 8px 22px #1d4ed855';
    });
    button.addEventListener('mouseleave', () => {
      button.style.filter = 'none';
      button.style.boxShadow = '0 6px 18px #1d4ed840';
    });

    const positionKey = `ghn_button_position_v1_${location.hostname}_${text}`;
    const saved = GM_getValue(positionKey, null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      button.style.left = `${Math.max(0, Math.min(saved.left, innerWidth - 80))}px`;
      button.style.top = `${Math.max(0, Math.min(saved.top, innerHeight - 40))}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    }

    let drag = null;
    let dragged = false;
    button.addEventListener('pointerdown', (event) => {
      const rect = button.getBoundingClientRect();
      drag = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
      dragged = false;
      button.setPointerCapture?.(event.pointerId);
      button.style.cursor = 'grabbing';
    });
    button.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
      if (!dragged) return;
      const left = Math.max(0, Math.min(drag.left + dx, innerWidth - button.offsetWidth));
      const top = Math.max(0, Math.min(drag.top + dy, innerHeight - button.offsetHeight));
      Object.assign(button.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    });
    button.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (dragged) {
        const rect = button.getBoundingClientRect();
        GM_setValue(positionKey, { left: Math.round(rect.left), top: Math.round(rect.top) });
      }
      drag = null;
      button.style.cursor = 'grab';
      setTimeout(() => { dragged = false; }, 0);
    });
    button.addEventListener('click', (event) => {
      if (dragged) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick(event);
    });
    document.body.appendChild(button);
  }

  function addTicketActionBar(actions) {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 999999,
      display: 'flex', alignItems: 'stretch', gap: '2px', padding: '4px',
      border: '1px solid #dbeafe', borderRadius: '10px', background: '#fff',
      boxShadow: '0 5px 18px #0003', userSelect: 'none', touchAction: 'none'
    });

    const handle = document.createElement('span');
    handle.textContent = '↕';
    handle.title = 'Giữ và kéo để di chuyển cả khối';
    Object.assign(handle.style, {
      display: 'grid', placeItems: 'center', width: '22px', color: '#64748b',
      font: '700 14px Arial', cursor: 'grab', borderRadius: '6px'
    });
    bar.appendChild(handle);

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      Object.assign(button.style, {
        border: 0, borderRadius: '7px', padding: '8px 11px', color: '#fff',
        background: action.background || '#1d4ed8', font: '700 13px/1.2 Arial',
        cursor: 'pointer', whiteSpace: 'nowrap'
      });
      button.addEventListener('click', action.onClick);
      bar.appendChild(button);
    }

    const positionKey = 'ghn_ticket_action_bar_position_v1';
    const saved = GM_getValue(positionKey, null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      Object.assign(bar.style, {
        left: `${Math.max(0, Math.min(saved.left, innerWidth - 160))}px`,
        top: `${Math.max(0, Math.min(saved.top, innerHeight - 44))}px`,
        right: 'auto', bottom: 'auto'
      });
    }

    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      const rect = bar.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      handle.setPointerCapture(event.pointerId);
      handle.style.cursor = 'grabbing';
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const left = Math.max(0, Math.min(drag.left + event.clientX - drag.x, innerWidth - bar.offsetWidth));
      const top = Math.max(0, Math.min(drag.top + event.clientY - drag.y, innerHeight - bar.offsetHeight));
      Object.assign(bar.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    });
    handle.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const rect = bar.getBoundingClientRect();
      GM_setValue(positionKey, { left: Math.round(rect.left), top: Math.round(rect.top) });
      drag = null;
      handle.style.cursor = 'grab';
    });

    document.body.appendChild(bar);
  }

  function addEformModeBar() {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 999999,
      display: 'flex', alignItems: 'stretch', gap: '2px', padding: '4px',
      border: '1px solid #dbeafe', borderRadius: '10px', background: '#fff',
      boxShadow: '0 5px 18px #0003', userSelect: 'none', touchAction: 'none'
    });

    const handle = document.createElement('span');
    handle.textContent = '↕';
    handle.title = 'Giữ và kéo để di chuyển';
    Object.assign(handle.style, {
      display: 'grid', placeItems: 'center', width: '22px', color: '#64748b',
      font: '700 14px Arial', cursor: 'grab', borderRadius: '6px'
    });
    bar.appendChild(handle);

    const addMode = (label, flowId, background) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      Object.assign(button.style, {
        border: 0, borderRadius: '7px', padding: '8px 11px', color: '#fff',
        background, font: '700 13px/1.2 Arial', cursor: 'pointer', whiteSpace: 'nowrap'
      });
      button.addEventListener('click', () => {
        GM_setValue(PENDING_FILL_KEY, flowId);
        location.href = `${location.origin}/eform/form/create?flowId=${flowId}`;
      });
      bar.appendChild(button);
    };

    addMode('💵 TIỀN MẶT', CASH_FLOW_ID, '#2563eb');
    addMode('🟠 XU', XU_FLOW_ID, '#1d4ed8');

    const positionKey = 'ghn_eform_mode_bar_position_v1';
    const saved = GM_getValue(positionKey, null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      Object.assign(bar.style, {
        left: `${Math.max(0, Math.min(saved.left, innerWidth - 120))}px`,
        top: `${Math.max(0, Math.min(saved.top, innerHeight - 44))}px`,
        right: 'auto', bottom: 'auto'
      });
    }

    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      const rect = bar.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      handle.setPointerCapture(event.pointerId);
      handle.style.cursor = 'grabbing';
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const left = Math.max(0, Math.min(drag.left + event.clientX - drag.x, innerWidth - bar.offsetWidth));
      const top = Math.max(0, Math.min(drag.top + event.clientY - drag.y, innerHeight - bar.offsetHeight));
      Object.assign(bar.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    });
    handle.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const rect = bar.getBoundingClientRect();
      GM_setValue(positionKey, { left: Math.round(rect.left), top: Math.round(rect.top) });
      drag = null;
      handle.style.cursor = 'grab';
    });

    document.body.appendChild(bar);
  }

  if (location.hostname === 'tracuunoibo.ghn.vn') {
    addButton('🔎 Lưu tra cứu', () => captureTrackingData({ wait: false, showFailure: true }));
    captureTrackingData({ wait: true, showFailure: false });
  } else if (location.pathname.startsWith('/ghn-ticket/create-ticket')) {
    addButton('⚡ Điền task', fillTaskForm);
    setTimeout(fillTaskForm, 700);
  } else if (/^\/ghn-ticket\/cs\/detail\//.test(location.pathname)) {
    const ticketActions = [
      {
        label: '💾 Lưu ticket',
        onClick: () => {
          const data = ticketData();
          save(data);
          toast(`Đã lưu ticket ${data.fdCode || ''} / đơn ${data.orderCode || ''}. Mở trang tra cứu đơn để lấy tiếp thông tin tiền.`);
        },
        background: '#2563eb'
      },
      { label: '🧾 Tạo task sự cố', onClick: openTaskPicker, background: '#1d4ed8' }
    ];
    addTicketActionBar(ticketActions);
  } else if (/^\/ghn-ticket\/detail\//.test(location.pathname)) {
    handleCreatedTaskDetail();
  } else if (location.pathname === '/eform/form/create') {
    if (location.pathname === '/eform/form/create' && !new URLSearchParams(location.search).get('flowId')) {
      addEformModeBar();
      toast('Chọn nhanh 💵 TIỀN MẶT hoặc 🟠 XU trên thanh eForm. Dùng ký hiệu ↕ để di chuyển.');
    } else {
      const currentFlowId = new URLSearchParams(location.search).get('flowId') || '';
      const isCashFlow = currentFlowId === CASH_FLOW_ID;
      addButton(`⚡ Tự điền ${isCashFlow ? 'TIỀN MẶT' : 'XU'}`, fillEform);
      watchManualCompensationFields();
      const pendingFlow = GM_getValue(PENDING_FILL_KEY, false);
      if (pendingFlow === true || pendingFlow === currentFlowId) {
        GM_setValue(PENDING_FILL_KEY, false);
        fillEform();
      } else {
        applyFixedDefaults().then((ok) => {
          if (ok) {
            if (isCashFlow) ensureChoice('tai_khoan_ngan_hang_cua_khach_hang', FIXED.bankAccount);
            toast(`Đã chọn sẵn eForm ${isCashFlow ? 'TIỀN MẶT' : 'XU'}: B2C → Vùng 3 → Cập nhật mới${isCashFlow ? ' → 1. Tài khoản mặc định' : ''}.`);
          }
        });
      }
    }
  }
})();
