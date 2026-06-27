/* ============================================================
   db.js — Capa de datos (Fase 2: Supabase / nube compartida)
   ------------------------------------------------------------
   Misma interfaz que antes (window.DB), pero ahora los datos
   viven en Supabase y se comparten entre todos los dispositivos.
   El resto de la app (app.js) no necesita cambios.
   ============================================================ */
(function () {
  const cfg = window.LDG_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL) {
    console.error('Falta el cliente de Supabase o la configuración (config.js).');
  }
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

  function todayKey() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

  // ---------- mapeo columnas (snake_case) <-> app (camelCase) ----------
  function fromRow(r) {
    if (!r) return null;
    return {
      code: r.code,
      name: r.name || '',
      brand: r.brand || '',
      cost: r.cost == null ? null : Number(r.cost),
      margin: r.margin == null ? null : Number(r.margin),
      price: Number(r.price) || 0,
      stock: Number(r.stock) || 0,
      minStock: Number(r.min_stock) || 0,
      unit: r.unit === 'kg' ? 'kg' : 'un',
      image: r.image || '',
      updatedAt: r.updated_at,
    };
  }
  function toRow(p) {
    return {
      code: String(p.code),
      name: p.name || '',
      brand: p.brand || null,
      cost: numOrNull(p.cost),
      margin: numOrNull(p.margin),
      price: Number(p.price) || 0,
      stock: Number.isFinite(+p.stock) ? round3(+p.stock) : 0,
      min_stock: Number.isFinite(+p.minStock) ? round3(+p.minStock) : 0,
      unit: p.unit === 'kg' ? 'kg' : 'un',
      image: p.image || null,
      updated_at: new Date().toISOString(),
    };
  }

  // ============================================================
  //  PRODUCTOS
  // ============================================================
  async function getProducts() {
    const { data, error } = await supa.from('productos').select('*').order('name', { ascending: true });
    if (error) { console.error('getProducts', error); return []; }
    return data.map(fromRow);
  }

  async function getProduct(code) {
    const { data, error } = await supa.from('productos').select('*').eq('code', String(code)).maybeSingle();
    if (error) { console.error('getProduct', error); return null; }
    return fromRow(data);
  }

  async function saveProduct(p) {
    const { data, error } = await supa.from('productos').upsert(toRow(p)).select().single();
    if (error) { console.error('saveProduct', error); throw error; }
    return fromRow(data);
  }

  async function deleteProduct(code) {
    const { error } = await supa.from('productos').delete().eq('code', String(code));
    if (error) { console.error('deleteProduct', error); throw error; }
  }

  // Ajusta el stock sumando delta (negativo para vender). No baja de 0.
  async function adjustStock(code, delta) {
    const current = await getProduct(code);
    if (!current) return null;
    const stock = Math.max(0, round3((Number(current.stock) || 0) + delta));
    const { data, error } = await supa.from('productos')
      .update({ stock, updated_at: new Date().toISOString() })
      .eq('code', String(code)).select().single();
    if (error) { console.error('adjustStock', error); throw error; }
    return fromRow(data);
  }

  async function searchProducts(query) {
    const q = (query || '').trim();
    if (!q) return getProducts();
    const safe = q.replace(/[%,()]/g, ' '); // evitar romper el filtro
    const { data, error } = await supa.from('productos').select('*')
      .or(`name.ilike.%${safe}%,brand.ilike.%${safe}%,code.ilike.%${safe}%`)
      .order('name', { ascending: true });
    if (error) { console.error('searchProducts', error); return []; }
    return data.map(fromRow);
  }

  async function getLowStock() {
    const all = await getProducts();
    return all.filter(p => p.stock <= (p.minStock || 0));
  }

  // ============================================================
  //  VENTAS
  // ============================================================
  async function recordSale(items, payment) {
    const pay = payment === 'efectivo' ? 'efectivo' : 'transferencia';
    let total = 0, profit = 0;
    const cleanItems = items.map(it => {
      const sub = (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
      const cost = (it.cost != null ? Number(it.cost) : 0) * (Number(it.qty) || 0);
      total += sub;
      profit += (sub - cost);
      return {
        code: String(it.code),
        name: it.name,
        qty: Number(it.qty) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        cost: it.cost != null ? Number(it.cost) : null,
      };
    });

    const { data, error } = await supa.from('ventas')
      .insert({ date_key: todayKey(), items: cleanItems, total, profit, payment: pay })
      .select().single();
    if (error) { console.error('recordSale', error); throw error; }

    // descontar stock de cada item
    for (const it of cleanItems) {
      try { await adjustStock(it.code, -it.qty); } catch (e) { console.error('stock--', it.code, e); }
    }

    return { id: data.id, ts: data.ts, dateKey: data.date_key, items: cleanItems, total, profit, payment: pay };
  }

  // Elimina una venta (prueba/equivocada) y DEVUELVE el stock de cada item.
  async function deleteSale(id) {
    const { data, error } = await supa.from('ventas').select('*').eq('id', id).maybeSingle();
    if (error) { console.error('deleteSale/get', error); throw error; }
    if (!data) return;
    const { error: delErr } = await supa.from('ventas').delete().eq('id', id);
    if (delErr) { console.error('deleteSale', delErr); throw delErr; }
    // devolver stock
    for (const it of (data.items || [])) {
      try { await adjustStock(it.code, +(Number(it.qty) || 0)); } catch (e) { console.error('stock++', it.code, e); }
    }
  }

  async function getSalesByDay(dateKey) {
    const key = dateKey || todayKey();
    const { data, error } = await supa.from('ventas').select('*')
      .eq('date_key', key).order('ts', { ascending: false });
    if (error) { console.error('getSalesByDay', error); return []; }
    return data.map(s => ({
      id: s.id, ts: s.ts, dateKey: s.date_key,
      items: s.items || [], total: Number(s.total) || 0, profit: Number(s.profit) || 0,
      payment: s.payment === 'efectivo' ? 'efectivo' : 'transferencia',
    }));
  }

  async function getDaySummary(dateKey) {
    const sales = await getSalesByDay(dateKey);
    const total = sales.reduce((a, s) => a + s.total, 0);
    const profit = sales.reduce((a, s) => a + s.profit, 0);
    const units = sales.reduce((a, s) => a + s.items.reduce((x, i) => x + (i.qty || 0), 0), 0);
    const byPayment = { transferencia: 0, efectivo: 0 };
    sales.forEach(s => { byPayment[s.payment] += s.total; });
    return { total, profit, count: sales.length, units, byPayment };
  }

  // ---------- util ----------
  function newInternalCode() {
    return 'MAN-' + Date.now().toString(36).toUpperCase();
  }

  window.DB = {
    todayKey,
    getProducts, getProduct, saveProduct, deleteProduct, adjustStock,
    searchProducts, getLowStock,
    recordSale, deleteSale, getSalesByDay, getDaySummary,
    newInternalCode,
  };
})();
