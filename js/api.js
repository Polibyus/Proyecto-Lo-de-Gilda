/* ============================================================
   api.js — Búsqueda de productos por código de barras
   ------------------------------------------------------------
   Fuente: Open Food Facts (gratis, abierta, con muchos
   productos argentinos). Devuelve nombre, marca e imagen.
   Si no hay internet o el código no existe, devuelve null y
   la app deja cargar el producto a mano.
   ============================================================ */
(function () {
  const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';
  const FIELDS = 'product_name,product_name_es,brands,image_front_small_url,image_url,quantity';

  async function lookupBarcode(code) {
    const clean = String(code).trim();
    if (!clean) return null;
    try {
      const url = `${ENDPOINT}${encodeURIComponent(clean)}.json?fields=${FIELDS}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status !== 1 || !data.product) return null;
      const p = data.product;
      const name = (p.product_name_es || p.product_name || '').trim();
      if (!name) return null;
      return {
        code: clean,
        name: p.quantity ? `${name} (${p.quantity})` : name,
        brand: (p.brands || '').split(',')[0].trim(),
        image: p.image_front_small_url || p.image_url || '',
        source: 'Open Food Facts',
      };
    } catch (e) {
      console.warn('Sin conexión o error consultando Open Food Facts:', e.message);
      return null;
    }
  }

  // ¿Parece un código de barras? (sólo dígitos, 8 a 14)
  function looksLikeBarcode(s) {
    return /^\d{8,14}$/.test(String(s).trim());
  }

  window.API = { lookupBarcode, looksLikeBarcode };
})();
