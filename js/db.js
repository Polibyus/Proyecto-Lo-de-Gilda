/* ============================================================
   db.js — Capa de datos (Fase 1: localStorage)
   ------------------------------------------------------------
   Toda la app habla SOLO con este módulo (window.DB).
   Las funciones son async a propósito: cuando pasemos a la nube
   (Supabase, Fase 2) sólo se reescribe este archivo, sin tocar
   el resto de la app.
   ============================================================ */
(function () {
  const KEY_PRODUCTS = 'ldg_products_v1';
  const KEY_SALES    = 'ldg_sales_v1';

  // ---------- helpers de almacenamiento ----------
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Error leyendo', key, e);
      return fallback;
    }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function todayKey() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  // ============================================================
  //  PRODUCTOS
  //  Estructura: { [code]: {code,name,brand,cost,margin,price,
  //                         stock,minStock,image,createdAt,updatedAt} }
  // ============================================================
  async function getProducts() {
    const obj = read(KEY_PRODUCTS, {});
    return Object.values(obj).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async function getProduct(code) {
    const obj = read(KEY_PRODUCTS, {});
    return obj[String(code)] || null;
  }

  async function saveProduct(p) {
    const obj = read(KEY_PRODUCTS, {});
    const code = String(p.code);
    const now = new Date().toISOString();
    const existing = obj[code];
    obj[code] = {
      code,
      name: p.name || '',
      brand: p.brand || '',
      cost: numOrNull(p.cost),
      margin: numOrNull(p.margin),
      price: Number(p.price) || 0,
      stock: Number.isFinite(+p.stock) ? +p.stock : 0,
      minStock: Number.isFinite(+p.minStock) ? +p.minStock : 0,
      image: p.image || (existing ? existing.image : ''),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
    write(KEY_PRODUCTS, obj);
    return obj[code];
  }

  async function deleteProduct(code) {
    const obj = read(KEY_PRODUCTS, {});
    delete obj[String(code)];
    write(KEY_PRODUCTS, obj);
  }

  // Ajusta el stock sumando delta (negativo para vender). No baja de 0.
  async function adjustStock(code, delta) {
    const obj = read(KEY_PRODUCTS, {});
    const p = obj[String(code)];
    if (!p) return null;
    p.stock = Math.max(0, (Number(p.stock) || 0) + delta);
    p.updatedAt = new Date().toISOString();
    write(KEY_PRODUCTS, obj);
    return p;
  }

  async function searchProducts(query) {
    const q = (query || '').trim().toLowerCase();
    const all = await getProducts();
    if (!q) return all;
    return all.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.brand && p.brand.toLowerCase().includes(q)) ||
      p.code.includes(q)
    );
  }

  // Productos con stock bajo (0 o <= minStock)
  async function getLowStock() {
    const all = await getProducts();
    return all.filter(p => p.stock <= (p.minStock || 0));
  }

  // ============================================================
  //  VENTAS
  //  Sale: { id, ts, dateKey, items:[{code,name,qty,unitPrice,cost}],
  //          total, profit }
  // ============================================================
  async function recordSale(items) {
    const sales = read(KEY_SALES, []);
    const ts = new Date().toISOString();
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
    const sale = { id: 's_' + Date.now(), ts, dateKey: todayKey(), items: cleanItems, total, profit };
    sales.push(sale);
    write(KEY_SALES, sales);

    // descontar stock
    for (const it of cleanItems) {
      await adjustStock(it.code, -it.qty);
    }
    return sale;
  }

  async function getSalesByDay(dateKey) {
    const key = dateKey || todayKey();
    const sales = read(KEY_SALES, []);
    return sales.filter(s => s.dateKey === key).sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async function getDaySummary(dateKey) {
    const sales = await getSalesByDay(dateKey);
    const total = sales.reduce((a, s) => a + s.total, 0);
    const profit = sales.reduce((a, s) => a + s.profit, 0);
    const units = sales.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0);
    return { total, profit, count: sales.length, units };
  }

  // ---------- util ----------
  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Genera un código interno para productos sin código de barras
  function newInternalCode() {
    return 'MAN-' + Date.now().toString(36).toUpperCase();
  }

  // Exportar / importar todo (respaldo)
  function exportAll() {
    return { products: read(KEY_PRODUCTS, {}), sales: read(KEY_SALES, []), exportedAt: new Date().toISOString() };
  }
  function importAll(data) {
    if (data.products) write(KEY_PRODUCTS, data.products);
    if (data.sales) write(KEY_SALES, data.sales);
  }

  window.DB = {
    todayKey,
    getProducts, getProduct, saveProduct, deleteProduct, adjustStock,
    searchProducts, getLowStock,
    recordSale, getSalesByDay, getDaySummary,
    newInternalCode, exportAll, importAll,
  };
})();
