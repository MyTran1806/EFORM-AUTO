// ==UserScript==
// @name         GHN - eForm đền bù & Task sự cố
// @namespace    codex.ghn.internal
// @version      2.0.0
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
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'ghn_compensation_draft_v1';
  const PENDING_FILL_KEY = 'ghn_compensation_pending_fill_v1';
  const TASK_TEMPLATE_CACHE_KEY = 'ghn_task_templates_cache_v1';
  const PENDING_TASK_KEY = 'ghn_pending_task_v1';
  const TASK_TEMPLATE_URL = 'https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/task-templates.json';
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
    const account = valueBeside('Tài khoản:');
    const accountMatch = account.match(/(\d+)\s*[-–]\s*(.+)/);
    return {
      clientId: accountMatch?.[1] || draft().clientId || '',
      customerName: clean(accountMatch?.[2] || ''),
      cod: money(valueBeside('Tiền thu hộ (COD):')),
      declaredValue: money(valueBeside('Giá trị đơn hàng:')),
      serviceFee: money(valueBeside('Tổng phí dịch vụ:')),
      pickupHub: valueAfterLabel('Kho lấy') || valueBeside('Kho lấy:') || valueBeside('Bưu cục lấy:') || nearbyValue(/^(Kho|Bưu cục) lấy/i),
      deliveryHub: valueAfterLabel('Kho giao') || valueBeside('Kho giao:') || valueBeside('Bưu cục giao:') || nearbyValue(/^(Kho|Bưu cục) giao/i),
      currentHub: valueAfterLabel('Kho hiện tại') || valueBeside('Kho hiện tại:') || valueBeside('Bưu cục hiện tại:') || nearbyValue(/^(Kho|Bưu cục) hiện tại/i),
      trackingUrl: location.href
    };
  }

  async function captureTrackingData({ wait = true, showFailure = true } = {}) {
    const maxAttempts = wait ? 80 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const data = trackingData();
      const ready = data.clientId && data.customerName && data.cod !== '' && data.declaredValue !== '' && data.serviceFee !== '';
      if (ready) {
        save(data);
        toast(`Đã lưu đơn tra cứu: KH ${data.customerName}; COD ${data.cod}; khai giá ${data.declaredValue}; phí ${data.serviceFee}.`);
        return true;
      }
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
    const data = draft();
    const currentFlowId = new URLSearchParams(location.search).get('flowId') || '';
    const isCashFlow = currentFlowId === CASH_FLOW_ID;
    const filled = new Set();
    const set = (command, label, value) => {
      const control = valueControl(command);
      if (control?.getClientRects().length && nativeSet(control, value) && control.value === String(value)) filled.add(label);
    };
    const defaultsOk = await applyFixedDefaults();
    await waitForCommand('ma_don_hang');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const fillTicketFields = () => {
      set('ma_don_hang', 'Mã đơn hàng', data.orderCode);
      set('id_khach_hang', 'ID Khách Hàng', data.clientId);
      set('ten_khach_hang', 'Tên Khách Hàng', data.customerName);
      set('cod', 'COD', data.cod);
      set('khai_gia', 'Khai giá', data.declaredValue);
      set('gia_cuoc_don_hang', 'Giá cước đơn hàng', data.serviceFee);
      set('ma_phieu_fd', 'Mã phiếu FD', data.fdCode);
      const taskLinkControl = firstControl(
        ['link_fd_hrw_task', 'link_task', 'link_fd_hrw'],
        [/link\s*fd\s*\/\s*hrw\s*\/\s*task/i, /link\s*task/i]
      );
      if (taskLinkControl?.getClientRects().length && nativeSet(taskLinkControl, data.taskUrl || '')) {
        filled.add('Link FD/HRW/TASK');
      }
    };
    fillTicketFields();
    const complaintChosen = await choose('loai_khieu_nai', data.complaintReason || '');
    const recoveryChosen = await choose('thu_hoi', FIXED.recovery);
    const partnerChosen = await choose('doi_tac', FIXED.partner);
    const bankChosen = !isCashFlow || await ensureChoice('tai_khoan_ngan_hang_cua_khach_hang', FIXED.bankAccount);
    // Các dropdown có thể khiến React dựng lại form; điền lại lần cuối sau khi giao diện ổn định.
    await new Promise((resolve) => setTimeout(resolve, 400));
    fillTicketFields();
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
    toast(`Mặc định eForm ${isCashFlow ? 'TIỀN MẶT' : 'XU'}: ${defaultsOk ? 'OK' : 'cần kiểm tra'}; đã điền ${filled.size} ô${missing.length ? `; thiếu dữ liệu nguồn: ${missing.join(', ')}` : ''}; Loại khiếu nại: ${complaintChosen ? 'OK' : 'cần kiểm tra'}; Thu hồi: ${recoveryChosen ? 'OK' : 'cần kiểm tra'}; Đối tác: ${partnerChosen ? 'OK' : 'cần kiểm tra'}${isCashFlow ? `; Tài khoản ngân hàng: ${bankChosen ? 'OK' : 'cần kiểm tra'}` : ''}. Nhập Nguyên nhân khiếu nại và Giá trị đền bù để tự ghép Nội dung đền bù. Không tự gửi phiếu.`);
  }

  function gmJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
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

  async function loadTaskTemplates(force = false) {
    const cached = GM_getValue(TASK_TEMPLATE_CACHE_KEY, null);
    if (!force && validTaskTemplatePayload(cached)) return cached;
    try {
      const separator = TASK_TEMPLATE_URL.includes('?') ? '&' : '?';
      const payload = await gmJson(`${TASK_TEMPLATE_URL}${separator}v=${Date.now()}`);
      if (!validTaskTemplatePayload(payload)) throw new Error('Dữ liệu task không đúng cấu trúc');
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
    return String(template || '')
      .replace(/#ma_don_hang/gi, data.orderCode || '')
      .replace(/#ticket_id/gi, data.ticketId || '')
      .replace(/#ten_nhan_vien/gi, data.ticketOwnerName || '')
      .replace(/#ma_nhan_vien/gi, data.ticketOwnerId || '');
  }

  function taskHubForRule(rule, data) {
    const normalized = normalizeChoice(rule || '');
    if (!normalized) return '';
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
    meta.textContent = `Ticket ${sourceData.ticketId || '(không xác định)'} · Đơn ${sourceData.orderCode || '(chưa có mã đơn)'} · dữ liệu ${payload.version || payload.publishedAt || 'hiện tại'}`;
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
      hubLine.textContent = item.responsibleRule ? `Quy tắc bộ phận: ${item.responsibleRule}` : 'Form này không có Bộ phận chịu trách nhiệm';
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
        responsibleHub: taskHubForRule(item.responsibleRule, draft()),
        preparedAt: new Date().toISOString()
      };
      GM_setValue(PENDING_TASK_KEY, pending);
      save(sourceData);
      location.href = `${location.origin}/ghn-ticket/create-ticket?type=${encodeURIComponent(item.incidentType)}`;
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
    const container = fieldContainer(labelPattern);
    const select = container?.querySelector('.ant-select') || container?.querySelector('[role="combobox"]')?.closest('.ant-select');
    const input = select?.querySelector('input[role="combobox"], input');
    mouseActivate(select?.querySelector('.ant-select-selector') || select || input);
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (input) nativeSet(input, target);
    const targetCode = clean(target).match(/[A-Z0-9]{4,}/i)?.[0] || '';
    const started = Date.now();
    while (Date.now() - started < 4500) {
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

    const detectedOk = await chooseTaskCombobox(/Bộ phận phát hiện/i, FIXED_DETECTED_HUB);
    let responsibleOk = true;
    if (pending.templateItem.responsibleRule) {
      const hub = pending.responsibleHub || taskHubForRule(pending.templateItem.responsibleRule, draft());
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
    const amountValue = pending.templateItem.incidentType === 'qua_han_toan_trinh'
      ? (draft().declaredValue || '')
      : (draft().declaredValue || draft().serviceFee || '');
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
    const changeButton = [...document.querySelectorAll('button')]
      .find((button) => clean(button.textContent) === 'Đổi người xử lý');
    if (!changeButton) return false;
    mouseActivate(changeButton);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const dialog = document.querySelector('[role="dialog"]');
    const input = dialog?.querySelector('input[role="combobox"], input');
    if (!input) return false;
    mouseActivate(input);
    nativeSet(input, ownerId || ownerName);
    const started = Date.now();
    while (Date.now() - started < 5000) {
      const option = visibleOptions().find((node) => clean(node.textContent).includes(ownerId)
        || (ownerName && clean(node.textContent).includes(ownerName)));
      if (option) {
        mouseActivate(option, false);
        await new Promise((resolve) => setTimeout(resolve, 180));
        const confirm = [...dialog.querySelectorAll('button')]
          .find((button) => clean(button.textContent) === 'Xác nhận đổi' && !button.disabled);
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
    if (!pending?.submittedAt) return;
    const submittedAt = new Date(pending.submittedAt).getTime();
    if (!Number.isFinite(submittedAt) || Date.now() - submittedAt > 60 * 60 * 1000) return;
    const taskId = location.pathname.match(/\/ghn-ticket\/detail\/(\d+)/)?.[1] || '';
    if (!taskId) return;
    const taskUrl = location.href;
    save({ taskId, taskUrl });
    let ownerAssigned = false;
    if (pending.ticketOwnerId || pending.ticketOwnerName) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      ownerAssigned = await chooseOwnerInDialog(pending.ticketOwnerId, pending.ticketOwnerName);
    }
    GM_setValue(PENDING_TASK_KEY, { ...pending, taskId, taskUrl, ownerAssigned, completedAt: new Date().toISOString() });
    toast(`Đã lưu link task cho eForm${ownerAssigned ? ' và đã gán người phụ trách ticket làm người xử lý' : '; chưa tự gán được người xử lý, vui lòng kiểm tra thủ công'}.`);
  }

  async function writeTaskLinkToSourceTicket() {
    const data = draft();
    if (!data.taskUrl) return toast('Chưa có link task trong dữ liệu nháp.');
    const currentTicketId = location.pathname.match(/\/cs\/detail\/(\d+)/)?.[1] || '';
    if (data.ticketId && currentTicketId && data.ticketId !== currentTicketId) {
      return toast(`Link task đang thuộc ticket ${data.ticketId}, không phải ticket ${currentTicketId}.`);
    }
    const noteButton = [...document.querySelectorAll('button')]
      .find((button) => clean(button.textContent) === 'Ghi chú nội bộ');
    if (!noteButton) return toast('Không tìm thấy nút Ghi chú nội bộ.');
    mouseActivate(noteButton);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const editor = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .find((element) => element.getClientRects().length > 0);
    if (!editor) return toast('Không tìm thấy ô nhập ghi chú nội bộ.');
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      nativeSet(editor, `Task ${data.taskUrl}`);
    } else {
      editor.focus();
      editor.textContent = `Task ${data.taskUrl}`;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: `Task ${data.taskUrl}` }));
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
    const saveNote = [...document.querySelectorAll('button')]
      .find((button) => clean(button.textContent) === 'Lưu ghi chú' && !button.disabled);
    if (!saveNote) return toast('Đã điền link nhưng nút Lưu ghi chú chưa sẵn sàng; vui lòng kiểm tra và bấm lưu.');
    mouseActivate(saveNote);
    toast('Đã gửi link task vào ghi chú nội bộ của ticket.');
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
    addButton('💾 Lưu ticket', () => {
      const data = ticketData();
      save(data);
      toast(`Đã lưu ticket ${data.fdCode || ''} / đơn ${data.orderCode || ''}. Mở trang tra cứu đơn để lấy tiếp thông tin tiền.`);
    }, 58);
    addButton('🧾 Tạo task sự cố', openTaskPicker, 12);
    const savedDraft = draft();
    const currentTicketId = location.pathname.match(/\/cs\/detail\/(\d+)/)?.[1] || '';
    if (savedDraft.taskUrl && (!savedDraft.ticketId || savedDraft.ticketId === currentTicketId)) {
      addButton('🔗 Ghi link task', writeTaskLinkToSourceTicket, 104);
    }
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
