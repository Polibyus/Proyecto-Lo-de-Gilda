/* ============================================================
   app.js — Lógica de la interfaz "Lo de Gilda"
   ============================================================ */
(function () {
  'use strict';

  // ---------- estado en memoria ----------
  let cart = [];            // [{code,name,qty,unitPrice,cost,stock}]
  let modalCtx = null;      // contexto del modal (alta/edición)
  let cameraScanner = null;
  let payMethod = 'transferencia';   // medio de pago seleccionado (default)

  // ---------- portón de entrada (traba suave, no es seguridad real) ----------
  const APP_PASSWORD = 'lodegilda';
  const AUTH_KEY = 'ldg_auth';

  // ---------- atajos DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-AR');
  // Cantidad legible: "5 u.", "250 g" (si <1kg) o "1,5 kg"
  const fmtQty = (q, unit) => {
    if (unit !== 'kg') return (Number(q) || 0) + ' u.';
    const g = Math.round((Number(q) || 0) * 1000);
    return g < 1000 ? g + ' g' : (g / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 }) + ' kg';
  };
  // Etiqueta de precio según unidad
  const priceLabel = (unit) => unit === 'kg' ? '/kg' : 'c/u';

  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; t.className = 'toast'; }, 2600);
  }

  // ============================================================
  //  NAVEGACIÓN ENTRE VISTAS
  // ============================================================
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + name).classList.add('active');
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === name));
    if (name === 'stock') renderStock();
    if (name === 'dia') renderDay();
    if (name === 'vender') $('#scanInput').focus();
  }

  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => showView(tab.dataset.view)));

  // ============================================================
  //  VENDER — buscar / escanear
  // ============================================================
  $('#scanForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = $('#scanInput').value.trim();
    if (!value) return;
    await handleScan(value);
  });

  // Autocompletado en vivo: mientras escribís un nombre, mostrá coincidencias.
  // (Si parece un código de barras, no sugiere: se está escaneando.)
  let suggestTimer = null;
  $('#scanInput').addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const value = $('#scanInput').value.trim();
    if (!value || API.looksLikeBarcode(value)) { $('#searchResults').innerHTML = ''; return; }
    suggestTimer = setTimeout(async () => {
      // evitá pisar resultados si el texto cambió mientras tanto
      if ($('#scanInput').value.trim() !== value) return;
      renderSearchResults(await DB.searchProducts(value));
    }, 120);
  });

  async function handleScan(value) {
    $('#searchResults').innerHTML = '';
    // 1) ¿existe ya un producto con ese código?
    let prod = await DB.getProduct(value);
    if (prod) {
      pickForSale(prod);
      return;
    }
    // 2) Si parece código de barras -> buscar online y ofrecer alta
    if (API.looksLikeBarcode(value)) {
      toast('Buscando código…');
      const found = await API.lookupBarcode(value);
      openProductModal({
        code: value,
        name: found ? found.name : '',
        brand: found ? found.brand : '',
        image: found ? found.image : '',
        afterSave: (p) => { pickForSale(p); },
        hint: found
          ? `Encontrado en ${found.source}. Poné el precio y guardá.`
          : 'No apareció en la base online. Cargalo a mano.',
      });
      resetScanInput();
      return;
    }
    // 3) Si es texto -> buscar por nombre en el stock propio
    const matches = await DB.searchProducts(value);
    if (matches.length === 0) {
      // ofrecer crearlo a mano con ese nombre
      openProductModal({
        code: DB.newInternalCode(),
        name: value,
        afterSave: (p) => { pickForSale(p); },
        hint: 'Producto sin código de barras. Cargalo a mano.',
      });
      resetScanInput();
      return;
    }
    renderSearchResults(matches);
  }

  function resetScanInput() {
    $('#scanInput').value = '';
    $('#scanInput').focus();
  }

  function renderSearchResults(list) {
    const box = $('#searchResults');
    box.innerHTML = list.slice(0, 12).map(p => `
      <button class="result-row" data-code="${p.code}">
        <span class="result-name">${esc(p.name)}${p.brand ? ` <em>${esc(p.brand)}</em>` : ''}</span>
        <span class="result-meta">${money(p.price)} · stock ${p.stock}</span>
      </button>`).join('');
    box.querySelectorAll('.result-row').forEach(b =>
      b.addEventListener('click', async () => {
        const p = await DB.getProduct(b.dataset.code);
        if (p) pickForSale(p);
      }));
  }

  // Cierra el buscador y abre el paso de "cantidad" antes de sumar al total
  function pickForSale(prod) {
    $('#searchResults').innerHTML = '';
    $('#scanInput').value = '';
    openQtyModal(prod);
  }

  // ============================================================
  //  CARRITO
  // ============================================================
  // Agrega al carrito la cantidad indicada (qty en kg si es por peso, en unidades si no).
  function addToCart(p, qty) {
    const unit = p.unit === 'kg' ? 'kg' : 'un';
    const add = Math.max(0, Number(qty) || 0);
    if (add <= 0) return;
    const existing = cart.find(i => i.code === p.code);
    if (existing) {
      existing.qty = Math.round((existing.qty + add) * 1000) / 1000;
    } else {
      cart.push({ code: p.code, name: p.name, qty: add, unitPrice: p.price, cost: p.cost, stock: p.stock, unit });
    }
    renderCart();
    toast(`Agregado: ${fmtQty(add, unit)} de ${p.name}`, 'ok');
  }

  function renderCart() {
    const box = $('#cartItems');
    if (cart.length === 0) {
      box.innerHTML = '<p class="empty">Todavía no agregaste productos.</p>';
      $('#cartFoot').hidden = true;
      $('#clearCartBtn').hidden = true;
      return;
    }
    box.innerHTML = cart.map((it, i) => {
      const qtyControl = it.unit === 'kg'
        ? `<div class="ci-qty kg">
             <input class="kg-input" type="number" min="0" step="10" inputmode="numeric" data-i="${i}" value="${Math.round(it.qty * 1000)}"> g
           </div>`
        : `<div class="ci-qty">
             <button class="qty-btn" data-act="dec" data-i="${i}">−</button>
             <span class="qty-num">${it.qty}</span>
             <button class="qty-btn" data-act="inc" data-i="${i}">+</button>
           </div>`;
      return `
      <div class="cart-item">
        <div class="ci-info">
          <span class="ci-name">${esc(it.name)}</span>
          <span class="ci-price">${money(it.unitPrice)} ${priceLabel(it.unit)}${it.stock <= 0 ? ' · <b class="warn">sin stock</b>' : ''}</span>
        </div>
        ${qtyControl}
        <span class="ci-sub" data-i="${i}">${money(it.unitPrice * it.qty)}</span>
        <button class="ci-del" data-act="del" data-i="${i}">✕</button>
      </div>`;
    }).join('');

    box.querySelectorAll('button[data-act]').forEach(b =>
      b.addEventListener('click', () => {
        const i = +b.dataset.i;
        if (b.dataset.act === 'inc') cart[i].qty++;
        if (b.dataset.act === 'dec') cart[i].qty = Math.max(1, cart[i].qty - 1);
        if (b.dataset.act === 'del') cart.splice(i, 1);
        renderCart();
      }));

    // input de gramos: convierte a kg y actualiza totales sin re-renderizar (no pierde el foco)
    box.querySelectorAll('.kg-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.i;
        const gramos = Math.max(0, Number(inp.value) || 0);
        cart[i].qty = gramos / 1000; // qty siempre en kg internamente
        const subEl = box.querySelector(`.ci-sub[data-i="${i}"]`);
        if (subEl) subEl.textContent = money(cart[i].unitPrice * cart[i].qty);
        $('#cartTotal').textContent = money(cartTotal());
      });
      // al abrir el teclado, dejar el item visible (no tapado)
      inp.addEventListener('focus', () =>
        setTimeout(() => inp.closest('.cart-item').scrollIntoView({ block: 'center', behavior: 'smooth' }), 250));
    });

    $('#cartTotal').textContent = money(cartTotal());
    $('#cartFoot').hidden = false;
    $('#clearCartBtn').hidden = false;
  }

  function cartTotal() {
    return cart.reduce((a, it) => a + it.unitPrice * it.qty, 0);
  }

  $('#clearCartBtn').addEventListener('click', () => {
    if (confirm('¿Vaciar la venta actual?')) { cart = []; renderCart(); }
  });

  // ============================================================
  //  PASO DE CANTIDAD (se elige cuánto antes de sumar al total)
  // ============================================================
  let qtyProduct = null;

  function openQtyModal(p) {
    qtyProduct = p;
    const kg = p.unit === 'kg';
    $('#qtyName').textContent = p.name;
    $('#qtyPrice').textContent = kg ? `${money(p.price)} por kg` : `${money(p.price)} por unidad`;
    $('#qtyUnitLabel').textContent = kg ? 'g' : 'u.';
    $('#qtyChips').hidden = !kg;
    const inp = $('#qtyInput');
    inp.value = kg ? 100 : 1;
    inp.step = kg ? 50 : 1;
    updateQtySubtotal();
    $('#qtyModal').hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  }

  function closeQtyModal() { $('#qtyModal').hidden = true; qtyProduct = null; }

  // Devuelve la cantidad en la unidad interna: kg si es por peso, unidades si no.
  function qtyValueInternal() {
    const v = Math.max(0, Number($('#qtyInput').value) || 0);
    return (qtyProduct && qtyProduct.unit === 'kg') ? v / 1000 : v;
  }

  function updateQtySubtotal() {
    if (!qtyProduct) return;
    $('#qtySubtotal').textContent = money(qtyProduct.price * qtyValueInternal());
  }

  function stepQty(dir) {
    const inp = $('#qtyInput');
    const step = Number(inp.step) || 1;
    inp.value = Math.max(0, Math.round(((Number(inp.value) || 0) + dir * step) * 1000) / 1000);
    updateQtySubtotal();
  }

  $('#qtyInput').addEventListener('input', updateQtySubtotal);
  $('#qtyMinus').addEventListener('click', () => stepQty(-1));
  $('#qtyPlus').addEventListener('click', () => stepQty(1));
  $('#qtyChips').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => { $('#qtyInput').value = b.dataset.g; updateQtySubtotal(); }));
  $('#qtyCancel').addEventListener('click', closeQtyModal);
  $('#qtyModal').addEventListener('click', (e) => { if (e.target.id === 'qtyModal') closeQtyModal(); });
  $('#qtyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#qtyAdd').click(); } });
  $('#qtyAdd').addEventListener('click', () => {
    if (!qtyProduct) return;
    const qty = qtyValueInternal();
    if (qty <= 0) { toast('Poné una cantidad', 'err'); return; }
    const p = qtyProduct;
    closeQtyModal();
    addToCart(p, qty);
    $('#scanInput').focus();
  });

  // Medio de pago (transferencia / efectivo)
  function setPayMethod(m) {
    payMethod = m === 'efectivo' ? 'efectivo' : 'transferencia';
    document.querySelectorAll('.pay-opt').forEach(b =>
      b.classList.toggle('active', b.dataset.pay === payMethod));
    const btn = $('#checkoutBtn');
    btn.classList.toggle('checkout-efectivo', payMethod === 'efectivo');
    btn.classList.toggle('checkout-transferencia', payMethod === 'transferencia');
    btn.textContent = payMethod === 'efectivo' ? 'Cobrar · Efectivo' : 'Cobrar · Transferencia';
  }
  document.querySelectorAll('.pay-opt').forEach(b =>
    b.addEventListener('click', () => setPayMethod(b.dataset.pay)));

  $('#checkoutBtn').addEventListener('click', async () => {
    if (cart.length === 0) return;
    let sale;
    try {
      sale = await DB.recordSale(cart, payMethod);
    } catch (e) {
      toast('No se pudo cobrar (revisá la conexión)', 'err');
      return;
    }
    cart = [];
    renderCart();
    setPayMethod('transferencia'); // vuelve al default para la próxima venta
    await refreshDayPill();
    const etiqueta = sale.payment === 'efectivo' ? 'Efectivo' : 'Transferencia';
    toast(`Cobrado ${money(sale.total)} · ${etiqueta}`, 'ok');
  });

  // ============================================================
  //  MODAL DE PRODUCTO (alta / edición)
  // ============================================================
  function openProductModal(ctx) {
    modalCtx = ctx || {};
    $('#modalTitle').textContent = ctx.editing ? 'Editar producto' : 'Nuevo producto';
    $('#modalHint').textContent = ctx.hint || '';
    $('#modalHint').hidden = !ctx.hint;
    $('#pCode').value  = ctx.code || '';
    $('#pName').value  = ctx.name || '';
    $('#pBrand').value = ctx.brand || '';
    $('#pCost').value  = ctx.cost != null ? ctx.cost : '';
    $('#pMargin').value = ctx.margin != null ? ctx.margin : '';
    $('#pPrice').value = ctx.price != null ? ctx.price : '';
    $('#pStock').value = ctx.stock != null ? ctx.stock : 0;
    $('#pMin').value   = ctx.minStock != null ? ctx.minStock : 3;
    $('#pUnit').value  = ctx.unit === 'kg' ? 'kg' : 'un';
    updateUnitLabels();
    $('#pCode').readOnly = !!ctx.editing;
    $('#modal').hidden = false;
    setTimeout(() => $('#pName').focus(), 50);
  }

  // Cambia las etiquetas del formulario según se venda por unidad o por peso
  function updateUnitLabels() {
    const kg = $('#pUnit').value === 'kg';
    $('#lblPrice').textContent = kg ? 'Precio por kg' : 'Precio de venta';
    $('#lblStock').textContent = kg ? 'Stock (kg)' : 'Stock';
  }
  $('#pUnit').addEventListener('change', updateUnitLabels);

  function closeModal() { $('#modal').hidden = true; modalCtx = null; }
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  // Precio automático: costo + margen
  function recalcPrice() {
    const cost = parseFloat($('#pCost').value);
    const margin = parseFloat($('#pMargin').value);
    if (Number.isFinite(cost) && Number.isFinite(margin)) {
      $('#pPrice').value = Math.round(cost * (1 + margin / 100) * 100) / 100;
    }
  }
  $('#pCost').addEventListener('input', recalcPrice);
  $('#pMargin').addEventListener('input', recalcPrice);

  $('#productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = {
      code: $('#pCode').value.trim() || DB.newInternalCode(),
      name: $('#pName').value.trim(),
      brand: $('#pBrand').value.trim(),
      cost: $('#pCost').value,
      margin: $('#pMargin').value,
      price: $('#pPrice').value,
      stock: $('#pStock').value,
      minStock: $('#pMin').value,
      unit: $('#pUnit').value,
      image: modalCtx ? modalCtx.image : '',
    };
    if (!p.name) { toast('Falta el nombre', 'err'); return; }
    const saved = await DB.saveProduct(p);
    const cb = modalCtx && modalCtx.afterSave;
    closeModal();
    toast('Producto guardado', 'ok');
    if (cb) cb(saved);
    if ($('#view-stock').classList.contains('active')) renderStock();
  });

  // ============================================================
  //  STOCK
  // ============================================================
  $('#newProductBtn').addEventListener('click', () =>
    openProductModal({ code: '', hint: 'Cargá un producto nuevo. El código es opcional.' }));

  $('#stockSearch').addEventListener('input', () => renderStock());

  // Lector USB (PC): si se escanea un código de barras y se confirma con Enter,
  // abre la ficha del producto para cargar/editar stock.
  $('#stockSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = $('#stockSearch').value.trim();
    if (API.looksLikeBarcode(v)) { $('#stockSearch').value = ''; handleStockScan(v); }
  });

  // Escaneo en Stock: existe -> editar; no existe -> buscar online y dar de alta.
  async function handleStockScan(value) {
    const code = String(value).trim();
    if (!code) return;
    const prod = await DB.getProduct(code);
    if (prod) {
      openProductModal({ ...prod, editing: true, hint: 'Ya está cargado. Ajustá stock o precio.' });
      return;
    }
    let found = null;
    if (API.looksLikeBarcode(code)) {
      toast('Buscando código…');
      found = await API.lookupBarcode(code);
    }
    openProductModal({
      code,
      name: found ? found.name : '',
      brand: found ? found.brand : '',
      image: found ? found.image : '',
      hint: found
        ? `Encontrado en ${found.source}. Poné precio y stock.`
        : 'Producto nuevo. Cargá los datos.',
    });
  }

  async function renderStock() {
    const q = $('#stockSearch').value;
    const list = await DB.searchProducts(q);
    const low = await DB.getLowStock();

    // alertas
    const alertBox = $('#stockAlerts');
    if (low.length && !q) {
      const sinStock = low.filter(p => p.stock <= 0).length;
      const poco = low.length - sinStock;
      alertBox.innerHTML = `<div class="alert">⚠️ ${sinStock} sin stock · ${poco} por terminarse</div>`;
    } else {
      alertBox.innerHTML = '';
    }

    const box = $('#stockList');
    if (list.length === 0) {
      box.innerHTML = '<p class="empty">No hay productos. Tocá “+ Nuevo” para empezar.</p>';
      return;
    }
    box.innerHTML = list.map(p => {
      const state = p.stock <= 0 ? 'out' : (p.stock <= (p.minStock || 0) ? 'low' : 'ok');
      const qty = fmtQty(p.stock, p.unit);
      const badge = state === 'out' ? 'Sin stock' : (state === 'low' ? `${qty} ¡poco!` : qty);
      const step = p.unit === 'kg' ? 0.1 : 1;
      const priceTxt = p.unit === 'kg' ? `${money(p.price)} /kg` : money(p.price);
      return `
      <div class="stock-card ${state}" data-code="${p.code}" data-step="${step}">
        <div class="sc-main">
          <span class="sc-name">${esc(p.name)}</span>
          <span class="sc-sub">${p.brand ? esc(p.brand) + ' · ' : ''}${priceTxt}</span>
        </div>
        <div class="sc-stock">
          <button class="qty-btn sm" data-act="minus">−</button>
          <span class="sc-badge ${state}">${badge}</span>
          <button class="qty-btn sm" data-act="plus">+</button>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('.stock-card').forEach(card => {
      const code = card.dataset.code;
      const step = Number(card.dataset.step) || 1;
      card.querySelector('[data-act="plus"]').addEventListener('click', async (e) => {
        e.stopPropagation(); await DB.adjustStock(code, +step); renderStock();
      });
      card.querySelector('[data-act="minus"]').addEventListener('click', async (e) => {
        e.stopPropagation(); await DB.adjustStock(code, -step); renderStock();
      });
      card.querySelector('.sc-main').addEventListener('click', async () => {
        const prod = await DB.getProduct(code);
        if (prod) openProductModal({ ...prod, editing: true });
      });
    });
  }

  // ============================================================
  //  DÍA
  // ============================================================
  function selectedDay() {
    return $('#dayDate').value || DB.todayKey();
  }

  async function renderDay() {
    const day = selectedDay();
    const esHoy = day === DB.todayKey();
    $('#kpiLabel').textContent = esHoy ? 'Vendido hoy' : 'Vendido ese día';

    const s = await DB.getDaySummary(day);
    $('#kpiTotal').textContent = money(s.total);
    $('#kpiCount').textContent = s.count;
    $('#kpiProfit').textContent = money(s.profit);
    $('#kpiTransfer').textContent = money(s.byPayment.transferencia);
    $('#kpiCash').textContent = money(s.byPayment.efectivo);

    const sales = await DB.getSalesByDay(day);
    const box = $('#dayHistory');
    if (sales.length === 0) {
      box.innerHTML = '<p class="empty">No hubo ventas ese día.</p>';
      return;
    }
    box.innerHTML = sales.map(sale => {
      const hora = new Date(sale.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const items = sale.items.map(i =>
        `<li>${fmtQty(i.qty, i.unit)} · ${esc(i.name)} <span>${money(i.unitPrice * i.qty)}</span></li>`).join('');
      const pago = sale.payment === 'efectivo'
        ? '<span class="pay-badge efectivo">💵 Efectivo</span>'
        : '<span class="pay-badge transferencia">🏦 Transferencia</span>';
      return `
      <div class="sale-card">
        <div class="sale-head">
          <span class="sale-time">🕐 ${hora} ${pago}</span>
          <div class="sale-right">
            <strong class="sale-total">${money(sale.total)}</strong>
            <button class="sale-del" data-id="${sale.id}" title="Eliminar venta">🗑</button>
          </div>
        </div>
        <ul class="sale-items">${items}</ul>
      </div>`;
    }).join('');

    box.querySelectorAll('.sale-del').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta venta? El stock de los productos se devuelve.')) return;
        await DB.deleteSale(b.dataset.id);
        await renderDay();
        await refreshDayPill();
        toast('Venta eliminada', 'ok');
      }));
  }

  async function refreshDayPill() {
    const s = await DB.getDaySummary(); // siempre el total de HOY
    $('#dayPill').textContent = money(s.total);
  }

  // ============================================================
  //  CÁMARA (celular) — usa html5-qrcode si cargó
  // ============================================================
  function setupCamera() {
    if (typeof Html5Qrcode === 'undefined') return; // sin internet/CDN: se queda con lector USB/teclado
    $('#cameraBtn').hidden = false;
    $('#stockScanBtn').hidden = false;

    // Vender: el código escaneado va al carrito
    $('#cameraBtn').addEventListener('click', () =>
      startCamera('Escaneá para vender', handleScan));
    // Stock: el código escaneado abre la ficha (editar o alta)
    $('#stockScanBtn').addEventListener('click', () =>
      startCamera('Escaneá para cargar/editar stock', handleStockScan));

    $('#cameraCloseBtn').addEventListener('click', stopCamera);
    $('#cameraOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'cameraOverlay') stopCamera();
    });
  }

  // Formatos de código de barras de almacén (mejora la lectura, sobre todo en iPhone)
  function barcodeFormats() {
    const F = window.Html5QrcodeSupportedFormats;
    if (!F) return undefined;
    return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF];
  }

  // Caja de escaneo ancha (los códigos de barras son anchos y bajos)
  function scanBox(viewW, viewH) {
    const w = Math.floor(Math.min(viewW * 0.92, 340));
    const h = Math.floor(Math.min(viewH * 0.5, 180));
    return { width: w, height: h };
  }

  async function startCamera(title, onDecode) {
    $('#cameraTitle').textContent = title;
    $('#cameraOverlay').hidden = false;
    try {
      cameraScanner = new Html5Qrcode('reader', {
        formatsToSupport: barcodeFormats(),
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
      await cameraScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: scanBox, aspectRatio: 1.0 },
        async (decodedText) => {
          await stopCamera();
          await onDecode(decodedText.trim());
        },
        () => {}
      );
    } catch (err) {
      const msg = (err && (err.message || err.name)) ? (err.message || err.name) : 'error desconocido';
      toast('No se pudo abrir la cámara: ' + msg, 'err');
      console.error('Cámara:', err);
      await stopCamera();
    }
  }

  async function stopCamera() {
    if (cameraScanner) {
      try { await cameraScanner.stop(); cameraScanner.clear(); } catch (e) {}
      cameraScanner = null;
    }
    $('#cameraOverlay').hidden = true;
  }

  // ============================================================
  //  PORTÓN DE ENTRADA
  // ============================================================
  function setupAuth() {
    const gate = $('#loginGate');
    if (localStorage.getItem(AUTH_KEY) === '1') { gate.hidden = true; }

    $('#loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = $('#loginPass').value.trim().toLowerCase();
      if (val === APP_PASSWORD) {
        localStorage.setItem(AUTH_KEY, '1');
        gate.hidden = true;
        $('#loginError').hidden = true;
        $('#scanInput').focus();
      } else {
        $('#loginError').hidden = false;
        $('#loginPass').value = '';
        $('#loginPass').focus();
      }
    });

    $('#logoutBtn').addEventListener('click', () => {
      localStorage.removeItem(AUTH_KEY);
      gate.hidden = false;
      $('#loginPass').value = '';
      $('#loginPass').focus();
    });
  }

  // ============================================================
  //  SELECTOR DE FECHA (vista Día)
  // ============================================================
  function setupDayPicker() {
    $('#dayDate').value = DB.todayKey();
    $('#dayDate').addEventListener('change', renderDay);
    $('#dayPrev').addEventListener('click', () => shiftDay(-1));
    $('#dayNext').addEventListener('click', () => shiftDay(+1));
  }

  function shiftDay(delta) {
    const v = $('#dayDate').value || DB.todayKey();
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    $('#dayDate').value = `${dt.getFullYear()}-${mm}-${dd}`;
    renderDay();
  }

  // ---------- util ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ============================================================
  //  INIT
  // ============================================================
  // El portón se resuelve de inmediato (sin esperar imágenes/CDN) para evitar parpadeo.
  setupAuth();

  window.addEventListener('load', () => {
    setupCamera();
    setupDayPicker();
    refreshDayPill();
    renderCart();
    if ($('#loginGate').hidden) $('#scanInput').focus();
  });

})();
