/* ============================================================
   app.js — Lógica de la interfaz "Lo de Gilda"
   ============================================================ */
(function () {
  'use strict';

  // ---------- estado en memoria ----------
  let cart = [];            // [{code,name,qty,unitPrice,cost,stock}]
  let modalCtx = null;      // contexto del modal (alta/edición)
  let cameraScanner = null;

  // ---------- atajos DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-AR');

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

  async function handleScan(value) {
    $('#searchResults').innerHTML = '';
    // 1) ¿existe ya un producto con ese código?
    let prod = await DB.getProduct(value);
    if (prod) {
      addToCart(prod);
      resetScanInput();
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
        afterSave: (p) => { addToCart(p); },
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
        afterSave: (p) => { addToCart(p); },
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
        if (p) { addToCart(p); $('#searchResults').innerHTML = ''; resetScanInput(); }
      }));
  }

  // ============================================================
  //  CARRITO
  // ============================================================
  function addToCart(p) {
    const existing = cart.find(i => i.code === p.code);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ code: p.code, name: p.name, qty: 1, unitPrice: p.price, cost: p.cost, stock: p.stock });
    }
    renderCart();
    toast(`Agregado: ${p.name}`, 'ok');
  }

  function renderCart() {
    const box = $('#cartItems');
    if (cart.length === 0) {
      box.innerHTML = '<p class="empty">Todavía no agregaste productos.</p>';
      $('#cartFoot').hidden = true;
      $('#clearCartBtn').hidden = true;
      return;
    }
    box.innerHTML = cart.map((it, i) => `
      <div class="cart-item">
        <div class="ci-info">
          <span class="ci-name">${esc(it.name)}</span>
          <span class="ci-price">${money(it.unitPrice)} c/u${it.stock <= 0 ? ' · <b class="warn">sin stock</b>' : ''}</span>
        </div>
        <div class="ci-qty">
          <button class="qty-btn" data-act="dec" data-i="${i}">−</button>
          <span class="qty-num">${it.qty}</span>
          <button class="qty-btn" data-act="inc" data-i="${i}">+</button>
        </div>
        <span class="ci-sub">${money(it.unitPrice * it.qty)}</span>
        <button class="ci-del" data-act="del" data-i="${i}">✕</button>
      </div>`).join('');

    box.querySelectorAll('button[data-act]').forEach(b =>
      b.addEventListener('click', () => {
        const i = +b.dataset.i;
        if (b.dataset.act === 'inc') cart[i].qty++;
        if (b.dataset.act === 'dec') cart[i].qty = Math.max(1, cart[i].qty - 1);
        if (b.dataset.act === 'del') cart.splice(i, 1);
        renderCart();
      }));

    const total = cart.reduce((a, it) => a + it.unitPrice * it.qty, 0);
    $('#cartTotal').textContent = money(total);
    $('#cartFoot').hidden = false;
    $('#clearCartBtn').hidden = false;
  }

  $('#clearCartBtn').addEventListener('click', () => {
    if (confirm('¿Vaciar la venta actual?')) { cart = []; renderCart(); }
  });

  $('#checkoutBtn').addEventListener('click', async () => {
    if (cart.length === 0) return;
    const sale = await DB.recordSale(cart);
    cart = [];
    renderCart();
    await refreshDayPill();
    toast(`Venta cobrada: ${money(sale.total)}`, 'ok');
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
    $('#pCode').readOnly = !!ctx.editing;
    $('#modal').hidden = false;
    setTimeout(() => $('#pName').focus(), 50);
  }

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
      const badge = state === 'out' ? 'Sin stock' : (state === 'low' ? 'Queda poco' : `${p.stock} u.`);
      return `
      <div class="stock-card ${state}" data-code="${p.code}">
        <div class="sc-main">
          <span class="sc-name">${esc(p.name)}</span>
          <span class="sc-sub">${p.brand ? esc(p.brand) + ' · ' : ''}${money(p.price)}</span>
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
      card.querySelector('[data-act="plus"]').addEventListener('click', async (e) => {
        e.stopPropagation(); await DB.adjustStock(code, +1); renderStock();
      });
      card.querySelector('[data-act="minus"]').addEventListener('click', async (e) => {
        e.stopPropagation(); await DB.adjustStock(code, -1); renderStock();
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
  async function renderDay() {
    const s = await DB.getDaySummary();
    $('#kpiTotal').textContent = money(s.total);
    $('#kpiCount').textContent = s.count;
    $('#kpiProfit').textContent = money(s.profit);

    const sales = await DB.getSalesByDay();
    const box = $('#dayHistory');
    if (sales.length === 0) {
      box.innerHTML = '<p class="empty">Todavía no hubo ventas hoy.</p>';
      return;
    }
    box.innerHTML = sales.map(sale => {
      const hora = new Date(sale.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const items = sale.items.map(i => `<li>${i.qty}× ${esc(i.name)} <span>${money(i.unitPrice * i.qty)}</span></li>`).join('');
      return `
      <div class="sale-card">
        <div class="sale-head">
          <span class="sale-time">${hora}</span>
          <strong class="sale-total">${money(sale.total)}</strong>
        </div>
        <ul class="sale-items">${items}</ul>
      </div>`;
    }).join('');
  }

  async function refreshDayPill() {
    const s = await DB.getDaySummary();
    $('#dayPill').textContent = money(s.total);
  }

  // ============================================================
  //  CÁMARA (celular) — usa html5-qrcode si cargó
  // ============================================================
  function setupCamera() {
    if (typeof Html5Qrcode === 'undefined') return; // sin internet/CDN: se queda con lector USB/teclado
    $('#cameraBtn').hidden = false;

    $('#cameraBtn').addEventListener('click', async () => {
      $('#cameraWrap').hidden = false;
      $('#cameraBtn').hidden = true;
      try {
        cameraScanner = new Html5Qrcode('reader');
        await cameraScanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          async (decodedText) => {
            await stopCamera();
            await handleScan(decodedText.trim());
          },
          () => {}
        );
      } catch (err) {
        toast('No se pudo abrir la cámara', 'err');
        await stopCamera();
      }
    });

    $('#cameraCloseBtn').addEventListener('click', stopCamera);
  }

  async function stopCamera() {
    if (cameraScanner) {
      try { await cameraScanner.stop(); cameraScanner.clear(); } catch (e) {}
      cameraScanner = null;
    }
    $('#cameraWrap').hidden = true;
    $('#cameraBtn').hidden = false;
  }

  // ---------- util ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ============================================================
  //  INIT
  // ============================================================
  window.addEventListener('load', () => {
    setupCamera();
    refreshDayPill();
    renderCart();
    $('#scanInput').focus();
  });

})();
