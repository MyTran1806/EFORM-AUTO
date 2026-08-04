// ==UserScript==
// @name         GHN - Tự điền eForm đền bù
// @namespace    codex.ghn.internal
// @version      1.6.0
// @description  Lấy dữ liệu từ ticket/tracuunoibo và tự điền eForm đền bù; không tự gửi phiếu.
// @homepageURL  https://github.com/MyTran1806/EFORM-AUTO
// @updateURL    https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/ghn-eform-auto-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/MyTran1806/EFORM-AUTO/main/ghn-eform-auto-fill.user.js
// @match        https://noibo.ghn.vn/ghn-ticket/*
// @match        https://tracuunoibo.ghn.vn/internal*
// @match        https://noibo.ghn.vn/eform/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'ghn_compensation_draft_v1';
  const PENDING_FILL_KEY = 'ghn_compensation_pending_fill_v1';
  const EFORM_FLOW_ID = '6859261bb7b131f75c445780';
  const FIXED = {
    processGroup: 'Phòng Trải Nghiệm Khách Hàng (CX)',
    process: 'XU - ĐỀN BÙ ĐƠN HÀNG THEO CHÍNH SÁCH',
    csGroup: 'B2C',
    b2cTeam: 'Vùng 3',
    eformType: 'Cập nhật mới',
    recovery: 'Không thu hồi'
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
    return { orderCode, clientId, complaintReason, fdCode, ticketUrl: location.href };
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
    };
    fillTicketFields();
    const complaintChosen = await choose('loai_khieu_nai', data.complaintReason || '');
    const recoveryChosen = await choose('thu_hoi', FIXED.recovery);
    // Các dropdown có thể khiến React dựng lại form; điền lại lần cuối sau khi giao diện ổn định.
    await new Promise((resolve) => setTimeout(resolve, 400));
    fillTicketFields();
    const missing = [
      ['Mã đơn hàng', data.orderCode],
      ['ID khách hàng', data.clientId],
      ['Tên khách hàng', data.customerName],
      ['COD', data.cod],
      ['Khai giá', data.declaredValue],
      ['Giá cước', data.serviceFee],
      ['Mã phiếu FD', data.fdCode]
    ].filter(([, value]) => value === '' || value == null).map(([name]) => name);
    toast(`Mặc định eForm: ${defaultsOk ? 'OK' : 'cần kiểm tra'}; đã điền ${filled.size} ô${missing.length ? `; thiếu dữ liệu nguồn: ${missing.join(', ')}` : ''}; Loại khiếu nại: ${complaintChosen ? 'OK' : 'cần kiểm tra'}; Thu hồi: ${recoveryChosen ? 'OK' : 'cần kiểm tra'}. Không tự gửi phiếu.`);
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

  function addButton(text, onClick) {
    const button = document.createElement('button');
    button.textContent = text;
    button.type = 'button';
    button.title = 'Bấm để chạy • Giữ và kéo để di chuyển';
    Object.assign(button.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: 999999, padding: '8px 11px', border: 0, borderRadius: '7px', color: '#fff', background: '#2563eb', font: '700 13px/1.2 Arial', cursor: 'grab', boxShadow: '0 3px 12px #0003', userSelect: 'none', touchAction: 'none', whiteSpace: 'nowrap' });

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

  if (location.hostname === 'tracuunoibo.ghn.vn') {
    addButton('Lưu dữ liệu tra cứu', () => captureTrackingData({ wait: false, showFailure: true }));
    captureTrackingData({ wait: true, showFailure: false });
  } else if (location.pathname.includes('/ghn-ticket/')) {
    addButton('Lưu dữ liệu đền bù', () => {
      const data = ticketData();
      save(data);
      toast(`Đã lưu ticket ${data.fdCode || ''} / đơn ${data.orderCode || ''}. Mở trang tra cứu đơn để lấy tiếp thông tin tiền.`);
    });
  } else if (location.pathname === '/eform/form/create') {
    if (location.pathname === '/eform/form/create' && !new URLSearchParams(location.search).get('flowId')) {
      addButton('Tự điền eForm', () => {
        GM_setValue(PENDING_FILL_KEY, true);
        location.href = `${location.origin}/eform/form/create?flowId=${EFORM_FLOW_ID}`;
      });
      toast('Bấm “Tự điền eForm” để mở đúng quy trình và tự điền dữ liệu.');
    } else {
      addButton('Tự điền eForm', fillEform);
      if (GM_getValue(PENDING_FILL_KEY, false)) {
        GM_setValue(PENDING_FILL_KEY, false);
        fillEform();
      } else {
        applyFixedDefaults().then((ok) => {
          if (ok) toast('Đã chọn sẵn: Phòng Trải Nghiệm Khách Hàng (CX) → XU - ĐỀN BÙ → B2C → Vùng 3 → Cập nhật mới.');
        });
      }
    }
  }
})();
