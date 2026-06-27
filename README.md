# 🏪 Lo de Gilda — Almacén

App simple para registrar **stock** y **ventas** de un almacén, identificando productos por **código de barras** (o por nombre). Pensada para usarse en la **PC con lector USB** y en el **celular con cámara**.

---

## ✅ Qué hace (MVP — Fase 1)

- **Vender**: escaneás/escribís el código → se arma una venta (carrito) → *Cobrar* descuenta stock y suma al total del día.
- **Alta automática por código**: si el producto no existe, lo busca en **Open Food Facts** (base abierta con muchos productos argentinos) y completa nombre y marca. Vos sólo ponés el precio.
- **Alta manual**: si no aparece online o no tiene código, lo cargás a mano. Queda guardado para siempre, **aunque tenga stock 0**.
- **Precio con margen**: cargás costo + margen % y el precio de venta se calcula solo (o lo ponés a mano).
- **Stock**: lista de productos, ajuste rápido (+/−), y **alertas de "queda poco" y "sin stock"**.
- **Día**: total vendido en $, cantidad de ventas y **ganancia** (si cargaste el costo).

---

## ▶️ Cómo probarlo (local, sin internet salvo para buscar códigos)

Abrí `index.html` en el navegador. Para que la **cámara** funcione, conviene servirlo por http (no `file://`). La forma más fácil:

```bash
# Opción 1: Python (si lo tenés instalado)
python -m http.server 8080
# luego abrí http://localhost:8080

# Opción 2: Node
npx serve .
```

En la **PC**, un lector de código de barras USB funciona solo: hace clic en el campo de búsqueda y escaneá (el lector "escribe" el código y lo confirma). No hace falta configurar nada.

> ⚠️ En esta Fase 1 los datos se guardan **en cada dispositivo por separado** (la PC tiene los suyos, el celu los suyos). Para compartir stock y ventas entre los dos → Fase 2.

---

## ☁️ Fase 2 — Subirlo a internet y compartir datos

Plan recomendado (todo gratis):

1. **Hosting del sitio** → GitHub Pages, Netlify o Vercel. Como es una web estática (HTML/JS), se sube tal cual.
2. **Base de datos compartida** → **Supabase** (plan gratis: base Postgres + API automática). Reescribimos sólo `js/db.js` para que en vez de `localStorage` lea/escriba en Supabase. **El resto de la app no cambia** (por eso la capa de datos está aislada).
3. Resultado: vos desde la PC y tu mamá desde el celu ven **el mismo stock y las mismas ventas**, en tiempo real.

### Subir a GitHub Pages (cuando estés listo)
```bash
git init
git add .
git commit -m "Lo de Gilda - MVP"
# crear repo en github.com, luego:
git remote add origin https://github.com/USUARIO/lo-de-gilda.git
git push -u origin main
# En GitHub: Settings → Pages → Branch: main / root → Save
```

---

## 🗂️ Estructura

```
index.html      → pantallas (Vender / Stock / Día) + modal de producto
css/styles.css  → estilos (mobile-first)
js/db.js        → CAPA DE DATOS (hoy localStorage; mañana Supabase)
js/api.js       → búsqueda por código en Open Food Facts
js/app.js       → lógica de la interfaz
```

## 📌 Notas sobre precios y APIs
- No existen APIs públicas de Arcor / Coca-Cola / distribuidoras. Open Food Facts cubre **identificación** del producto (nombre/marca), no precios.
- Los **precios se cargan a mano** con tu margen. Es lo realista y confiable para el almacén.
