/* ============================================================
   api.js — Búsqueda de productos por código de barras
   ------------------------------------------------------------
   Consulta varias bases abiertas y gratuitas de la familia
   Open Food Facts (mismo formato de API):
     · Open Food Facts     → alimentos, bebidas, almacén
     · Open Beauty Facts   → jabones, shampoo, cosmética, higiene
     · Open Products Facts → productos generales (limpieza, varios)
   Devuelve nombre, marca e imagen. Si no aparece en ninguna,
   devuelve null y la app deja cargarlo a mano (y queda guardado
   para siempre en TU base).
   ============================================================ */
(function () {
  const FIELDS = 'product_name,product_name_es,brands,image_front_small_url,image_url,quantity';

  const SOURCES = [
    { url: 'https://world.openfoodfacts.org/api/v2/product/',     name: 'Open Food Facts' },
    { url: 'https://world.openbeautyfacts.org/api/v2/product/',   name: 'Open Beauty Facts' },
    { url: 'https://world.openproductsfacts.org/api/v2/product/', name: 'Open Products Facts' },
  ];

  async function fetchFrom(src, code) {
    try {
      const url = `${src.url}${encodeURIComponent(code)}.json?fields=${FIELDS}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status !== 1 || !data.product) return null;
      const p = data.product;
      const name = (p.product_name_es || p.product_name || '').trim();
      if (!name) return null;
      return {
        code: String(code),
        name: p.quantity ? `${name} (${p.quantity})` : name,
        brand: (p.brands || '').split(',')[0].trim(),
        image: p.image_front_small_url || p.image_url || '',
        source: src.name,
      };
    } catch (e) {
      return null;
    }
  }

  async function lookupBarcode(code) {
    const clean = String(code).trim();
    if (!clean) return null;
    // Consulta las bases en paralelo y toma el primer resultado válido
    // (prioridad: comida → cosmética → productos generales).
    const results = await Promise.all(SOURCES.map(s => fetchFrom(s, clean)));
    return results.find(Boolean) || null;
  }

  // ¿Parece un código de barras? (sólo dígitos, 8 a 14)
  function looksLikeBarcode(s) {
    return /^\d{8,14}$/.test(String(s).trim());
  }

  window.API = { lookupBarcode, looksLikeBarcode };
})();
