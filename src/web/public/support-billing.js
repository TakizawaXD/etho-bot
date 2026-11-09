// Planes & pagos, tickets de soporte y banner de plan. Se apoya en app.js (state, showToast, openModal, ...).
// Todo texto dinámico pasa por esc() antes de insertarse en el DOM.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHtml(v == null ? '' : String(v));
  const DAY = 86400000;
  const isAdmin = () => state.currentUser?.role === 'admin';
  const loggedIn = () => Boolean(state.token && state.currentUser);

  const money = (cents, cur) => {
    try { return new Intl.NumberFormat('es', { style: 'currency', currency: String(cur || 'usd').toUpperCase() }).format((cents || 0) / 100); }
    catch { return `${((cents || 0) / 100).toFixed(2)} ${String(cur || '').toUpperCase()}`; }
  };
  const fdate = (ms) => (ms ? new Date(Number(ms)).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const daysLeft = (ms) => Math.max(0, Math.ceil((Number(ms) - Date.now()) / DAY));

  async function call(url, { method = 'GET', body } = {}) {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch { /* respuesta sin JSON */ }
      return { ok: res.ok && data.ok !== false, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: 'No se pudo conectar con el servidor. Revisa tu conexión.' } };
    }
  }

  // ==========================================================
  // PLANES & PAGOS
  // ==========================================================
  const ORDER_STATUS = {
    pending: ['Pendiente de pago', 'st-pending'], awaiting_review: ['En revisión', 'st-review'],
    paid: ['Pagada', 'st-paid'], rejected: ['Rechazada', 'st-bad'], cancelled: ['Cancelada', 'st-muted'], expired: ['Vencida', 'st-muted'],
  };
  const chip = (status) => { const [t, c] = ORDER_STATUS[status] || [status, 'st-muted']; return `<span class="chip ${c}">${esc(t)}</span>`; };
  const planName = (key, plans) => (key === 'prueba' ? 'Prueba gratuita' : (plans || []).find((p) => p.key === key)?.name || key);

  const bill = { plans: [], free: { days: 7, maxBots: 3 }, methods: {}, me: null, currentOrder: null };

  async function loadBilling() {
    if (!loggedIn()) return;
    const [plansRes, meRes] = await Promise.all([call('/api/billing/plans'), call('/api/billing/me')]);
    if (plansRes.ok) { bill.plans = plansRes.data.plans || []; bill.free = plansRes.data.free || bill.free; bill.methods = plansRes.data.methods || {}; bill.currency = plansRes.data.currency; }
    if (meRes.ok) bill.me = meRes.data;
    renderBillingStatus(); renderPlans(); renderOrders(); refreshPlanBanner();
    const adminBox = $('billingAdmin');
    if (adminBox) adminBox.style.display = isAdmin() ? 'block' : 'none';
    if (isAdmin()) { loadAdminOrders(); loadAdminUsers(); }
    const sec = $('accountSecurity'); if (sec) sec.style.display = isAdmin() ? 'none' : '';
  }
  window.loadBilling = loadBilling;

  function renderBillingStatus() {
    const box = $('billingStatus'); if (!box) return;
    const sum = bill.me?.summary;
    if (isAdmin() || !sum) { box.innerHTML = `<div class="card billing-status-card ok"><strong><i class="fa-solid fa-crown"></i> Cuenta administradora</strong><span>Sin límites de bots ni vencimientos.</span></div>`; return; }
    const left = daysLeft(sum.expiresAt);
    const pct = sum.maxBots ? Math.min(100, Math.round((sum.botCount / sum.maxBots) * 100)) : 0;
    let cls = 'ok', title, text;
    if (sum.paid) {
      title = `${esc(planName(sum.plan, bill.plans))} activo`;
      text = `Vence el ${esc(fdate(sum.expiresAt))} (${left} día${left === 1 ? '' : 's'}).`;
      if (left <= 5) cls = 'warn';
    } else if (sum.active) {
      title = 'Prueba gratuita'; text = `Te quedan ${left} día${left === 1 ? '' : 's'} (hasta el ${esc(fdate(sum.expiresAt))}).`;
      cls = left <= 2 ? 'warn' : 'ok';
    } else {
      title = 'Tu prueba terminó'; text = 'Tus bots están en pausa. Elige un plan para volver a activarlos.'; cls = 'bad';
    }
    box.innerHTML = `
      <div class="card billing-status-card ${cls}">
        <div><strong>${title}</strong><span>${text}</span></div>
        <div class="billing-usage">
          <span>Bots: <strong>${esc(sum.botCount)} / ${esc(sum.maxBots)}</strong></span>
          <div class="usage-bar"><i style="width:${pct}%"></i></div>
        </div>
      </div>`;
  }

  function renderPlans() {
    const box = $('billingPlans'); if (!box) return;
    const cur = bill.me?.summary?.plan;
    const m = bill.methods || {};
    const anyMethod = m.stripe || m.transfer;
    const free = `
      <div class="plan-card ${cur === 'prueba' ? 'current' : ''}">
        <div class="plan-name">Prueba gratuita</div>
        <div class="plan-price">${esc(money(0, bill.currency))}<span> / ${esc(bill.free.days)} días</span></div>
        <ul><li><i class="fa-solid fa-check"></i> Hasta <strong>${esc(bill.free.maxBots)} bots</strong></li>
            <li><i class="fa-solid fa-check"></i> ${esc(bill.free.days)} días de uso</li>
            <li><i class="fa-solid fa-check"></i> Todas las funciones</li></ul>
        <button class="btn btn-secondary" disabled>${cur === 'prueba' ? 'Plan actual' : 'Incluido al registrarte'}</button>
      </div>`;
    const paid = bill.plans.map((p, i) => {
      const buttons = isAdmin() ? '<button class="btn btn-secondary" disabled>Solo clientes</button>'
        : !anyMethod ? `<button class="btn btn-secondary" onclick="openTicketModal({category:'pago', subject:'Quiero contratar ${esc(p.name)}'})">Contactar a soporte</button>`
        : `${m.stripe ? `<button class="btn btn-primary" onclick="buyPlan('${esc(p.key)}','stripe')"><i class="fa-solid fa-credit-card"></i> Pagar con tarjeta</button>` : ''}
           ${m.transfer ? `<button class="btn btn-secondary" onclick="buyPlan('${esc(p.key)}','transfer')"><i class="fa-solid fa-building-columns"></i> Pagar por transferencia</button>` : ''}`;
      return `
      <div class="plan-card ${i === 0 ? 'featured' : ''} ${cur === p.key ? 'current' : ''}">
        ${i === 0 ? '<div class="plan-ribbon">POPULAR</div>' : ''}
        <div class="plan-name">${esc(p.name)}</div>
        <div class="plan-price">${esc(money(p.priceCents, p.currency))}<span> / ${esc(p.days)} días</span></div>
        <ul><li><i class="fa-solid fa-check"></i> Hasta <strong>${esc(p.maxBots)} bots</strong></li>
            <li><i class="fa-solid fa-check"></i> ${esc(p.days)} días de servicio</li>
            <li><i class="fa-solid fa-check"></i> Renovar suma tiempo a tu plan</li></ul>
        <div class="plan-actions">${buttons}</div>
        ${cur === p.key ? '<div class="plan-current-tag">Plan actual</div>' : ''}
      </div>`;
    }).join('');
    box.innerHTML = free + paid;
  }

  function renderOrders() {
    const box = $('billingOrders'); if (!box) return;
    const orders = bill.me?.orders || [];
    if (!orders.length) { box.innerHTML = '<div class="empty-state-mini"><i class="fa-solid fa-receipt"></i><p>Aún no tienes órdenes de pago.</p></div>'; return; }
    box.innerHTML = `<table class="data-table"><thead><tr><th>Fecha</th><th>Plan</th><th>Monto</th><th>Método</th><th>Estado</th><th>Referencia</th><th></th></tr></thead><tbody>${
      orders.map((o) => {
        const acts = [];
        if (o.method === 'transfer' && ['pending', 'awaiting_review'].includes(o.status)) acts.push(`<button class="btn btn-secondary btn-sm" onclick="openTransferFor('${esc(o.id)}')">${o.status === 'pending' ? 'Informar pago' : 'Ver'}</button>`);
        if (o.status === 'pending') acts.push(`<button class="btn btn-secondary btn-sm" onclick="cancelOrder('${esc(o.id)}')">Cancelar</button>`);
        return `<tr><td>${esc(fdate(o.created_at))}</td><td>${esc(planName(o.plan, bill.plans))}</td><td>${esc(money(o.amount_cents, o.currency))}</td>
          <td>${o.method === 'stripe' ? 'Tarjeta' : 'Transferencia'}</td><td>${chip(o.status)}${o.review_note && o.status === 'rejected' ? `<small class="text-muted"> ${esc(o.review_note)}</small>` : ''}</td>
          <td><code>${esc(o.reference)}</code></td><td class="row-actions">${acts.join(' ')}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  async function buyPlan(planKey, method) {
    const { ok, data } = await call('/api/billing/orders', { method: 'POST', body: { plan: planKey, method } });
    if (!ok) { showToast(data.error || 'No se pudo crear la orden.', 'error'); return; }
    if (method === 'stripe') {
      let host = '';
      try { host = new URL(data.checkoutUrl).hostname; } catch { /* url inválida */ }
      if (!/(^|\.)stripe\.com$/.test(host)) { showToast('Respuesta de pago no válida.', 'error'); return; }
      showToast('Redirigiendo al pago seguro…', 'info');
      window.location.href = data.checkoutUrl;
      return;
    }
    await loadBilling();
    openTransfer(data.order, data.instructions);
  }
  window.buyPlan = buyPlan;

  async function cancelOrder(id) {
    if (!confirm('¿Cancelar esta orden de pago?')) return;
    const { ok, data } = await call(`/api/billing/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    showToast(ok ? 'Orden cancelada.' : (data.error || 'No se pudo cancelar.'), ok ? 'success' : 'error');
    loadBilling();
  }
  window.cancelOrder = cancelOrder;

  // ---------- Transferencia ----------
  function openTransfer(order, instructions) {
    bill.currentOrder = order;
    $('transferSummary').innerHTML = `<strong>${esc(planName(order.plan, bill.plans))}</strong> · ${esc(money(order.amount_cents, order.currency))}`;
    $('transferInstructions').textContent = instructions || bill.me?.transferInstructions || 'Consulta los datos bancarios con soporte.';
    $('transferReference').textContent = order.reference;
    $('transferProofRef').value = order.proof_ref || '';
    $('transferPayer').value = order.payer_name || state.currentUser?.name || '';
    $('transferNote').value = '';
    const err = $('transferError'); err.style.display = 'none';
    const awaiting = order.status === 'awaiting_review';
    $('transferSubmitBtn').innerHTML = awaiting ? '<i class="fa-solid fa-pen"></i> Actualizar datos' : '<i class="fa-solid fa-check"></i> Ya transferí';
    openModal('transferModal');
  }
  window.openTransferFor = (id) => { const o = (bill.me?.orders || []).find((x) => x.id === id); if (o) openTransfer(o, bill.me.transferInstructions); };
  window.copyTransferRef = () => navigator.clipboard?.writeText($('transferReference').textContent).then(() => showToast('Referencia copiada.', 'success')).catch(() => {});

  function bindTransferForm() {
    $('transferForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('transferError'); err.style.display = 'none';
      const btn = $('transferSubmitBtn'); btn.disabled = true;
      const { ok, data } = await call(`/api/billing/orders/${encodeURIComponent(bill.currentOrder.id)}/proof`, {
        method: 'POST', body: { proofRef: $('transferProofRef').value, payerName: $('transferPayer').value, note: $('transferNote').value },
      });
      btn.disabled = false;
      if (!ok) { err.textContent = data.error || 'No se pudo enviar.'; err.style.display = 'block'; return; }
      closeModal('transferModal');
      showToast('¡Recibido! Un administrador verificará tu transferencia y activará tu plan.', 'success');
      loadBilling();
    });
  }

  // ---------- Administración de pagos ----------
  async function loadAdminOrders() {
    if (!isAdmin()) return;
    const f = $('billingAdminFilter')?.value ?? 'awaiting_review';
    const { ok, data } = await call(`/api/admin/billing/orders${f ? `?status=${encodeURIComponent(f)}` : ''}`);
    if (!ok) return;
    $('billingAdminKpis').innerHTML = `<span class="kpi"><b>${esc(data.pendingReview)}</b> por revisar</span><span class="kpi"><b>${esc(money(data.revenue30dCents, data.currency))}</b> últimos 30 días</span>`;
    setBadge('navBillingCount', data.pendingReview);
    const box = $('billingAdminOrders');
    if (!data.orders.length) { box.innerHTML = '<div class="empty-state-mini"><i class="fa-solid fa-inbox"></i><p>No hay órdenes en este filtro.</p></div>'; return; }
    box.innerHTML = `<table class="data-table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Plan</th><th>Monto</th><th>Método</th><th>Estado</th><th>Comprobante</th><th></th></tr></thead><tbody>${
      data.orders.map((o) => `<tr>
        <td>${esc(fdate(o.created_at))}</td><td>${esc(o.user_name || '—')}<br><small class="text-muted">${esc(o.username || '')} ${esc(o.user_email || '')}</small></td>
        <td>${esc(planName(o.plan, bill.plans))}</td><td>${esc(money(o.amount_cents, o.currency))}</td><td>${o.method === 'stripe' ? 'Tarjeta' : 'Transferencia'}</td>
        <td>${chip(o.status)}</td>
        <td>${o.proof_ref ? `<code>${esc(o.proof_ref)}</code><br><small>${esc(o.payer_name || '')}</small><br><small class="text-muted">Concepto: ${esc(o.reference)}</small>` : `<small class="text-muted">${esc(o.reference)}</small>`}</td>
        <td class="row-actions">${o.status === 'awaiting_review' ? `<button class="btn btn-primary btn-sm" onclick="reviewOrder('${esc(o.id)}','approve')">Aprobar</button> <button class="btn btn-secondary btn-sm" onclick="reviewOrder('${esc(o.id)}','reject')">Rechazar</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  window.loadAdminOrders = loadAdminOrders;

  async function reviewOrder(id, action) {
    let note = '';
    if (action === 'approve') {
      if (!confirm('¿Confirmas que ya verificaste este pago en el banco? Se activará el plan del cliente.')) return;
    } else {
      note = prompt('Motivo del rechazo (el cliente lo verá):') ?? null;
      if (note === null) return;
    }
    const { ok, data } = await call(`/api/admin/billing/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { note } });
    showToast(ok ? (action === 'approve' ? 'Pago aprobado y plan activado.' : 'Orden rechazada.') : (data.error || 'No se pudo completar.'), ok ? 'success' : 'error');
    loadAdminOrders();
  }
  window.reviewOrder = reviewOrder;

  // ---------- Seguridad de la cuenta ----------
  window.openPasswordModal = () => {
    $('passwordForm').reset(); $('pwError').style.display = 'none';
    openModal('passwordModal');
  };

  function bindPasswordForm() {
    $('passwordForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('pwError'); err.style.display = 'none';
      const next = $('pwNew').value;
      if (next !== $('pwRepeat').value) { err.textContent = 'Las contraseñas nuevas no coinciden.'; err.style.display = 'block'; return; }
      const btn = $('pwSubmitBtn'); btn.disabled = true;
      const { ok, data } = await call('/api/auth/change-password', { method: 'POST', body: { current: $('pwCurrent').value, next } });
      btn.disabled = false;
      if (!ok) { err.textContent = data.error || 'No se pudo cambiar la contraseña.'; err.style.display = 'block'; return; }
      if (data.token) { state.token = data.token; localStorage.setItem('etho_auth_token', data.token); }   // este dispositivo sigue activo
      $('passwordForm').reset();
      closeModal('passwordModal');
      showToast(data.message || 'Contraseña actualizada.', 'success');
    });
  }

  window.logoutAllDevices = async () => {
    if (!confirm('¿Cerrar la sesión en TODOS tus dispositivos, incluido este? Tendrás que iniciar sesión de nuevo.')) return;
    const { ok, data } = await call('/api/auth/logout-all', { method: 'POST' });
    if (!ok) { showToast(data.error || 'No se pudo completar.', 'error'); return; }
    localStorage.removeItem('etho_auth_token');
    location.reload();
  };

  // ---------- Herramientas del administrador sobre clientes ----------
  async function loadAdminUsers() {
    const { ok, data } = await call('/api/admin/billing/users');
    if (!ok) return;
    const sel = $('adminUserSelect'); if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = data.users.map((u) => {
      const left = u.plan && u.plan !== 'prueba' && u.plan_expires_at > Date.now() ? `${esc(planName(u.plan, bill.plans))} (${daysLeft(u.plan_expires_at)} d)` : 'sin plan de pago';
      return `<option value="${esc(u.id)}">${esc(u.name || u.username)} · @${esc(u.username)} · ${left}${u.status === 'suspended' ? ' · SUSPENDIDO' : ''}</option>`;
    }).join('') || '<option value="">No hay clientes todavía</option>';
    if (prev) sel.value = prev;
    const ps = $('adminPlanSelect');
    if (ps && !ps.options.length) ps.innerHTML = bill.plans.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('');
  }

  window.adminGrantPlan = async () => {
    const id = $('adminUserSelect').value; if (!id) return;
    const days = Number($('adminPlanDays').value) || 30;
    if (!confirm(`¿Conceder ${days} días del plan seleccionado a este cliente?`)) return;
    const { ok, data } = await call(`/api/admin/users/${encodeURIComponent(id)}/plan`, { method: 'PUT', body: { plan: $('adminPlanSelect').value, days } });
    $('adminToolResult').textContent = ok ? `Plan concedido. Vence el ${fdate(data.expiresAt)}.` : (data.error || 'No se pudo conceder el plan.');
    if (ok) loadAdminUsers();
  };

  window.adminResetPassword = async () => {
    const id = $('adminUserSelect').value; if (!id) return;
    if (!confirm('¿Restablecer la contraseña de este cliente? Se cerrarán todas sus sesiones.')) return;
    const { ok, data } = await call(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
    const box = $('adminToolResult');
    if (!ok) { box.textContent = data.error || 'No se pudo restablecer.'; return; }
    box.innerHTML = `Contraseña temporal (se muestra una sola vez): <code id="tempPw">${esc(data.temporaryPassword)}</code> <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard?.writeText(document.getElementById('tempPw').textContent)">Copiar</button><br><small class="text-muted">Compártela por un canal seguro y pídele que la cambie al entrar.</small>`;
  };

  // ---------- Banner de plan (pestaña Bots) ----------
  async function refreshPlanBanner() {
    const el = $('planBanner'); if (!el) return;
    if (!loggedIn() || isAdmin()) { el.style.display = 'none'; return; }
    if (!bill.me) { const r = await call('/api/billing/me'); if (r.ok) bill.me = r.data; }
    const sum = bill.me?.summary;
    if (!sum) { el.style.display = 'none'; return; }
    const left = daysLeft(sum.expiresAt);
    let cls = 'info', msg = '';
    if (!sum.active) { cls = 'bad'; msg = sum.paid ? 'Tu plan venció.' : 'Tu prueba gratuita terminó.'; msg += ' Tus bots están en pausa hasta que elijas un plan.'; }
    else if (!sum.paid) { cls = left <= 2 ? 'warn' : 'info'; msg = `Prueba gratuita: te quedan <strong>${left} día${left === 1 ? '' : 's'}</strong> · usas ${esc(sum.botCount)} de ${esc(sum.maxBots)} bots.`; }
    else if (left <= 5) { cls = 'warn'; msg = `Tu plan vence en <strong>${left} día${left === 1 ? '' : 's'}</strong>. Renuévalo para no perder el servicio.`; }
    else { el.style.display = 'none'; return; }
    el.className = `plan-banner ${cls}`;
    el.innerHTML = `<span>${msg}</span><button class="btn btn-primary btn-sm" onclick="switchTab('billing')">Ver planes</button>`;
    el.style.display = 'flex';
  }

  window.promptUpgrade = (msg) => {
    showToast(msg || 'Mejora tu plan para continuar.', 'warning');
    if (loggedIn()) switchTab('billing');
  };

  // Regreso desde Stripe: se consulta el estado hasta que el webhook confirme el pago.
  function handlePaymentReturn() {
    const params = new URLSearchParams(location.search);
    const result = params.get('payment'); const orderId = params.get('order');
    if (!result) return;
    history.replaceState({}, '', location.pathname);
    let tries = 0;
    const wait = setInterval(async () => {
      if (!loggedIn() && ++tries < 20) return;
      clearInterval(wait);
      if (!loggedIn()) return;
      switchTab('billing');
      if (result === 'cancelled') { showToast('Pago cancelado. No se te cobró nada.', 'info'); return; }
      showToast('Verificando tu pago…', 'info');
      for (let i = 0; i < 12; i++) {
        const r = await call(`/api/billing/orders/${encodeURIComponent(orderId || '')}`);
        if (r.ok && r.data.order?.status === 'paid') { showToast('¡Pago confirmado! Tu plan ya está activo.', 'success'); await loadBilling(); fetchBots?.(); return; }
        await new Promise((res) => setTimeout(res, 3000));
      }
      showToast('Tu pago aún se está procesando. Se activará en unos minutos.', 'info');
      loadBilling();
    }, 500);
  }

  // ==========================================================
  // TICKETS
  // ==========================================================
  const T_STATUS = { open: 'Abierto', in_progress: 'En curso', waiting_user: 'Esperando respuesta', resolved: 'Resuelto', closed: 'Cerrado' };
  const T_CAT = { error: 'Error', pago: 'Pagos', bot: 'Bot', cuenta: 'Cuenta', sugerencia: 'Sugerencia', otro: 'Otro' };
  const tchip = (s) => `<span class="chip t-${esc(s)}">${esc(T_STATUS[s] || s)}</span>`;
  let currentTicketId = null;

  function setBadge(id, n) { const el = $(id); if (!el) return; el.textContent = n; el.style.display = n > 0 ? '' : 'none'; }

  function setTicketTab(tab) {
    const isNew = tab !== 'lookup';
    $('ticketTabNew').classList.toggle('active', isNew);
    $('ticketTabLookup').classList.toggle('active', !isNew);
    $('ticketForm').style.display = isNew && $('ticketSuccess').dataset.done !== '1' ? '' : 'none';
    $('ticketSuccess').style.display = isNew && $('ticketSuccess').dataset.done === '1' ? '' : 'none';
    $('ticketLookupPane').style.display = isNew ? 'none' : '';
  }
  window.setTicketTab = setTicketTab;

  window.openTicketModal = (prefill, tab) => {
    const u = state.currentUser;
    $('ticketSuccess').dataset.done = '0';
    $('ticketForm').reset();
    $('ticketName').value = prefill?.name || u?.name || '';
    $('ticketEmail').value = prefill?.email || u?.email || '';
    $('ticketCategory').value = prefill?.category || 'error';
    $('ticketSubject').value = prefill?.subject || '';
    $('ticketMessage').value = prefill?.message || '';
    $('ticketMessageCount').textContent = `${$('ticketMessage').value.length} / 4000`;
    $('ticketFormError').style.display = 'none';
    $('lookupResult').innerHTML = ''; $('lookupError').style.display = 'none';
    setTicketTab(tab || 'new');
    openModal('ticketModal');
  };

  window.copyTicketCode = () => navigator.clipboard?.writeText($('ticketCodeValue').textContent).then(() => showToast('Código copiado.', 'success')).catch(() => {});

  function threadHtml(messages) {
    return `<div class="thread">${messages.map((m) => `
      <div class="msg ${esc(m.author_type)} ${m.internal ? 'internal' : ''}">
        <div class="msg-meta"><strong>${m.author_type === 'admin' ? 'Soporte' : esc(m.author_name || 'Cliente')}</strong>${m.internal ? ' · <em>nota interna</em>' : ''} · ${esc(fdate(m.created_at))}</div>
        <div class="msg-body">${esc(m.body)}</div>
      </div>`).join('')}</div>`;
  }

  function bindTicketForms() {
    $('ticketMessage')?.addEventListener('input', (e) => { $('ticketMessageCount').textContent = `${e.target.value.length} / 4000`; });

    $('ticketForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('ticketFormError'); err.style.display = 'none';
      const btn = $('ticketSubmitBtn'); btn.disabled = true;
      const { ok, data } = await call('/api/tickets', {
        method: 'POST',
        body: {
          name: $('ticketName').value, email: $('ticketEmail').value, category: $('ticketCategory').value,
          subject: $('ticketSubject').value, message: $('ticketMessage').value, website: $('ticketWebsite').value,
          pageUrl: location.href.split('?')[0].slice(0, 200),
        },
      });
      btn.disabled = false;
      if (!ok) { err.textContent = data.error || 'No se pudo enviar el reporte.'; err.style.display = 'block'; return; }
      $('ticketCodeValue').textContent = data.ticket.id;
      $('ticketSuccess').dataset.done = '1';
      setTicketTab('new');
      if (loggedIn()) loadTickets();
    });

    $('ticketLookupForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('lookupError'); err.style.display = 'none'; $('lookupResult').innerHTML = '';
      const { ok, data } = await call('/api/tickets/lookup', { method: 'POST', body: { code: $('lookupCode').value.trim(), email: $('lookupEmail').value.trim() } });
      if (!ok) { err.textContent = data.error || 'No se pudo consultar.'; err.style.display = 'block'; return; }
      $('lookupResult').innerHTML = `
        <div class="lookup-card"><div class="lookup-head"><strong>${esc(data.ticket.subject)}</strong>${tchip(data.ticket.status)}</div>
        <small class="text-muted">${esc(data.ticket.id)} · ${esc(T_CAT[data.ticket.category] || '')} · ${esc(fdate(data.ticket.created_at))}</small>
        ${threadHtml(data.messages)}</div>`;
    });
  }

  async function loadTickets() {
    if (!loggedIn()) return;
    const status = $('ticketStatusFilter')?.value || '';
    const { ok, data } = await call(`/api/tickets${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    const list = $('ticketList'); if (!list) return;
    if ($('supportSubtitle')) $('supportSubtitle').textContent = isAdmin() ? 'Todos los tickets de la plataforma. Responde y cambia su estado.' : 'Reporta errores o pide ayuda. Te respondemos aquí y por correo.';
    if (!ok) { list.innerHTML = '<div class="empty-state-mini"><p>No se pudieron cargar los tickets.</p></div>'; return; }
    setBadge('navSupportCount', isAdmin() ? (data.counts.open || 0) + (data.counts.in_progress || 0) : (data.counts.waiting_user || 0));
    if (!data.tickets.length) { list.innerHTML = '<div class="empty-state-mini"><i class="fa-regular fa-face-smile"></i><p>No hay tickets aquí.</p></div>'; return; }
    list.innerHTML = data.tickets.map((t) => `
      <button class="ticket-item ${t.id === currentTicketId ? 'active' : ''}" onclick="openTicket('${esc(t.id)}')">
        <div class="ticket-item-top"><strong>${esc(t.subject)}</strong>${tchip(t.status)}</div>
        <div class="ticket-item-meta">${esc(t.id)} · ${esc(T_CAT[t.category] || '')} · ${esc(fdate(t.updated_at))}${isAdmin() ? ` · ${esc(t.name)}` : ''}</div>
      </button>`).join('');
  }
  window.loadTickets = loadTickets;

  async function openTicket(id) {
    currentTicketId = id;
    const { ok, data } = await call(`/api/tickets/${encodeURIComponent(id)}`);
    const box = $('ticketDetail');
    if (!ok) { box.innerHTML = `<div class="empty-state-mini"><p>${esc(data.error || 'No se pudo abrir el ticket.')}</p></div>`; return; }
    const t = data.ticket; const closed = t.status === 'closed';
    const statusCtl = isAdmin()
      ? `<select class="form-input" onchange="setTicketStatus('${esc(t.id)}', this.value)">${Object.entries(T_STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
      : (closed ? '' : `<button class="btn btn-secondary btn-sm" onclick="setTicketStatus('${esc(t.id)}','closed')">Cerrar ticket</button>`);
    box.innerHTML = `
      <div class="ticket-head">
        <div><h3>${esc(t.subject)}</h3>
          <small class="text-muted">${esc(t.id)} · ${esc(T_CAT[t.category] || '')} · ${esc(fdate(t.created_at))}${isAdmin() ? ` · ${esc(t.name)} &lt;${esc(t.email)}&gt;` : ''}</small>
          ${isAdmin() && t.page_url ? `<br><small class="text-muted">Página: ${esc(t.page_url)}</small>` : ''}</div>
        <div class="ticket-head-actions">${tchip(t.status)}${statusCtl}</div>
      </div>
      ${threadHtml(data.messages)}
      ${closed ? '<p class="text-muted">Este ticket está cerrado.</p>' : `
        <form class="reply-form" onsubmit="return sendTicketReply(event, '${esc(t.id)}')">
          <textarea class="form-input" rows="3" maxlength="4000" placeholder="Escribe tu respuesta…" required></textarea>
          <div class="reply-actions">
            ${isAdmin() ? '<label class="inline-check"><input type="checkbox" name="internal"> Nota interna (el cliente no la ve)</label>' : '<span></span>'}
            <button type="submit" class="btn btn-primary btn-sm"><i class="fa-solid fa-paper-plane"></i> Enviar</button>
          </div>
        </form>`}`;
    loadTickets();
  }
  window.openTicket = openTicket;

  window.sendTicketReply = (e, id) => {
    e.preventDefault();
    const form = e.target; const ta = form.querySelector('textarea');
    const internal = Boolean(form.querySelector('[name=internal]')?.checked);
    call(`/api/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body: ta.value, internal } })
      .then(({ ok, data }) => { if (!ok) showToast(data.error || 'No se pudo enviar.', 'error'); else openTicket(id); });
    return false;
  };

  window.setTicketStatus = async (id, status) => {
    const { ok, data } = await call(`/api/tickets/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { status } });
    if (!ok) showToast(data.error || 'No se pudo cambiar el estado.', 'error');
    openTicket(id);
  };

  // ==========================================================
  // Integración con app.js (pestañas, sesión, avisos en vivo)
  // ==========================================================
  const baseSwitchTab = window.switchTab;
  window.switchTab = function (tab) {
    baseSwitchTab(tab);
    const title = $('topbarCurrentTitle');
    if (tab === 'billing') { if (title) title.textContent = 'Planes & Pagos'; loadBilling(); }
    else if (tab === 'support') { if (title) title.textContent = 'Soporte & Tickets'; loadTickets(); }
    else if (tab === 'bots') refreshPlanBanner();
  };

  const baseRenderUserUI = window.renderUserUI;
  window.renderUserUI = function (user) {
    baseRenderUserUI(user);
    bill.me = null;
    if (user) {
      refreshPlanBanner();
      call('/api/tickets').then(({ ok, data }) => { if (ok) setBadge('navSupportCount', user.role === 'admin' ? (data.counts.open || 0) + (data.counts.in_progress || 0) : (data.counts.waiting_user || 0)); });
      if (user.role === 'admin') call('/api/admin/billing/orders?status=awaiting_review').then(({ ok, data }) => { if (ok) setBadge('navBillingCount', data.pendingReview); });
    }
  };

  const baseConnectSSE = window.connectSSE;
  window.connectSSE = function () {
    const r = baseConnectSSE.apply(this, arguments);
    if (typeof sseSource !== 'undefined' && sseSource) {
      sseSource.addEventListener('ticket', (e) => {
        try {
          const d = JSON.parse(e.data);
          showToast(d.type === 'new' ? `Nuevo ticket ${d.id}: ${d.subject}` : `Nueva respuesta en el ticket ${d.id}`, 'info');
        } catch { /* evento mal formado */ }
        if (state.activeTab === 'support') loadTickets();
      });
      sseSource.addEventListener('billing', (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === 'proof') showToast('Hay un pago por transferencia pendiente de revisión.', 'info');
          if (d.type === 'mismatch') showToast('Un pago no coincidió con su orden. Revisa Planes & Pagos.', 'error');
        } catch { /* evento mal formado */ }
        if (state.activeTab === 'billing') loadAdminOrders();
      });
    }
    return r;
  };

  document.addEventListener('DOMContentLoaded', () => { bindTicketForms(); bindTransferForm(); bindPasswordForm(); handlePaymentReturn(); });
  // Si el script se carga después de DOMContentLoaded
  if (document.readyState !== 'loading') { bindTicketForms(); bindTransferForm(); bindPasswordForm(); handlePaymentReturn(); }
})();
