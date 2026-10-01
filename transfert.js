// Photos dans les échanges de fichiers :
//  - export Excel avec miniatures, sauvegarde .zip avec toutes les photos
//  - lecture des images contenues dans un fichier Excel (.xlsx)
//  - rattachement de photos à une fiche (import, photos en lot)
import { SLOTS, norm, fmtDateFR, todayISO } from "./utils.js";
import { compressPhoto, makeThumb } from "./images.js";

/* ------------------------------------------------------------------ */
/*  Chargement des bibliothèques à la demande                          */
/* ------------------------------------------------------------------ */
const loaded = {};
export function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error("Bibliothèque illisible.")));
      s.onerror = () => { delete loaded[src]; reject(new Error("Impossible de charger un composant de l'application. Vérifiez la connexion.")); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}
export const loadJSZip = () => loadScript("jszip.min.js", "JSZip");
export const loadExcelJS = () => loadScript("exceljs.min.js", "ExcelJS");

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ------------------------------------------------------------------ */
/*  Noms des photos : GC-XXXXX_appareil.jpg, _plaque.jpg, _autre-vue.jpg */
/* ------------------------------------------------------------------ */
export const SLOT_FILE = { main: "appareil", plate: "plaque", other: "autre-vue" };
export const photoFileName = (id, slot) => `${id}_${SLOT_FILE[slot]}.jpg`;

export function slotFromName(name) {
  const n = norm(name);
  if (/plaque|plate|signal|etiquette|serie/.test(n)) return "plate";
  if (/autre|other|arriere|dos\b|cote|vue ?2|vue ?3/.test(n)) return "other";
  if (/appareil|main\b|face|avant|general/.test(n)) return "main";
  return null;
}

const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
export const imageType = (name) => IMG_TYPES[(name.split(".").pop() || "").toLowerCase()] || "";

const alnum = (s) => norm(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const tokens = (s) => norm(s).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

// Trouve la fiche désignée par un nom de fichier (identifiant GC-… ou n° de série)
export function makeMatcher(items) {
  const byId = new Map(items.map((i) => [alnum(i.id), i]));
  const bySerial = new Map();
  for (const it of items) {
    const s = alnum(it.numero_serie);
    if (s.length >= 3) { if (!bySerial.has(s)) bySerial.set(s, []); bySerial.get(s).push(it); }
  }
  return (fileName) => {
    const base = fileName.replace(/\.[^.]+$/, "");
    const m = base.toUpperCase().match(/GC[-_ ]?([A-Z0-9]{5})(?![A-Z0-9])/);
    if (m && byId.has("GC" + m[1])) return { item: byId.get("GC" + m[1]), how: "identifiant" };
    // n° de série : suite de « mots » consécutifs du nom (évite les faux positifs)
    const t = tokens(base);
    let best = null;
    for (let i = 0; i < t.length; i++) {
      let acc = "";
      for (let j = i; j < Math.min(t.length, i + 5); j++) {
        acc += t[j];
        const list = bySerial.get(acc);
        if (list && (!best || acc.length > best.key.length)) best = { key: acc, list };
      }
    }
    if (!best) return { item: null, how: "" };
    if (best.list.length > 1) return { item: null, how: "", ambiguous: best.list.length };
    return { item: best.list[0], how: "n° de série" };
  };
}

// Répartit des photos dans les cases d'une fiche : case demandée, sinon première case libre
export function planSlots(item, wanted /* [{slot|null, ...}] */) {
  const taken = new Set(Object.keys(item?.photos || {}));
  const used = new Set();
  const out = wanted.map((w) => ({ ...w, slot: w.slot && !used.has(w.slot) ? w.slot : null }));
  out.forEach((w) => { if (w.slot) used.add(w.slot); });
  for (const w of out) {
    if (w.slot) continue;
    const free = SLOTS.map((s) => s.k).find((k) => !taken.has(k) && !used.has(k));
    if (free) { w.slot = free; used.add(free); } else w.skip = "Les 3 cases photo sont déjà remplies";
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Ajouter des photos à une fiche existante                           */
/* ------------------------------------------------------------------ */
export async function attachPhotos(be, item, blobsBySlot) {
  const photos = { ...(item.photos || {}) };
  const oldPaths = [];
  const fresh = {};
  for (const s of SLOTS) {
    const blob = blobsBySlot[s.k];
    if (!blob) continue;
    const small = await compressPhoto(blob);
    const path = `${item.id}/${s.k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
    await be.uploadPhoto(path, small);
    if (photos[s.k]) oldPaths.push(photos[s.k]);
    photos[s.k] = path;
    fresh[s.k] = small;
  }
  if (!Object.keys(fresh).length) return item;
  let miniature = item.miniature || "";
  const first = SLOTS.find((s) => photos[s.k]);
  if (first && (fresh[first.k] || !miniature)) miniature = await makeThumb(fresh[first.k] || Object.values(fresh)[0]);
  const row = await be.updateItem(item.id, { photos, miniature });
  if (oldPaths.length) be.removePhotos(oldPaths).catch(() => {});
  return row;
}

/* ------------------------------------------------------------------ */
/*  Lecture des images d'un classeur .xlsx                             */
/*  - images posées sur les cellules (dessins)                         */
/*  - images « dans la cellule » (Excel 365)                           */
/* ------------------------------------------------------------------ */
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const byName = (el, name) => (el ? Array.from(el.getElementsByTagNameNS("*", name)) : []);
const kids = (el, name) => (el ? Array.from(el.children).filter((e) => e.localName === name) : []);
const rid = (el, name = "id") => el.getAttributeNS(R_NS, name) || el.getAttribute("r:" + name) || "";

function resolvePath(base, target) {
  if (!target) return "";
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/"); parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
function cellPos(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || "");
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

export async function openXlsxZip(buf) {
  const JSZip = await loadJSZip();
  return JSZip.loadAsync(buf);
}

// Renvoie { byRow: Map(ligne0 → [{col, blob, name}]), total, unsupported, cols: Set }
export async function readSheetImages(zip, sheetName) {
  const res = { byRow: new Map(), total: 0, unsupported: 0, cols: new Set() };
  if (!zip) return res;
  const xml = async (p) => {
    const f = zip.file(p);
    return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null;
  };
  const rels = async (p) => {
    const i = p.lastIndexOf("/");
    const d = await xml(`${p.slice(0, i)}/_rels/${p.slice(i + 1)}.rels`);
    const map = {};
    for (const r of byName(d, "Relationship")) map[r.getAttribute("Id")] = resolvePath(p, r.getAttribute("Target"));
    return map;
  };

  const wb = await xml("xl/workbook.xml");
  if (!wb) return res;
  const wbRels = await rels("xl/workbook.xml");
  const sheetEl = byName(wb, "sheet").find((s) => s.getAttribute("name") === sheetName);
  const sheetPath = sheetEl && wbRels[rid(sheetEl)];
  if (!sheetPath) return res;
  const sheet = await xml(sheetPath);
  const sheetRels = await rels(sheetPath);
  const found = []; // { row, col, path }

  // 1) Images posées sur les cellules
  for (const d of byName(sheet, "drawing")) {
    const dPath = sheetRels[rid(d)];
    if (!dPath) continue;
    const dd = await xml(dPath);
    const dRels = await rels(dPath);
    const anchors = [...byName(dd, "twoCellAnchor"), ...byName(dd, "oneCellAnchor")];
    for (const a of anchors) {
      const from = kids(a, "from")[0];
      const blip = byName(a, "blip")[0];
      if (!from || !blip) continue;
      const row = Number(byName(from, "row")[0]?.textContent);
      const col = Number(byName(from, "col")[0]?.textContent);
      const media = dRels[rid(blip, "embed")];
      if (media && Number.isFinite(row)) found.push({ row, col, path: media });
    }
  }

  // 2) Images « dans la cellule » (valeurs enrichies d'Excel 365)
  try {
    const meta = await xml("xl/metadata.xml");
    const rv = await xml("xl/richData/rdrichvalue.xml");
    const rvRel = await xml("xl/richData/richValueRel.xml");
    if (meta && rv && rvRel) {
      const rvs = await xml("xl/richData/rdrichvaluestructure.xml");
      const relMap = await rels("xl/richData/richValueRel.xml");
      const future = byName(meta, "futureMetadata").find((f) => f.getAttribute("name") === "XLRICHVALUE");
      const rvbOf = kids(future, "bk").map((b) => { const r = byName(b, "rvb")[0]; return r ? Number(r.getAttribute("i")) : null; });
      const vmToRv = kids(byName(meta, "valueMetadata")[0], "bk").map((b) => {
        const rc = kids(b, "rc")[0];
        return rc ? rvbOf[Number(rc.getAttribute("v"))] : null;
      });
      const structs = kids(byName(rvs, "rvStructures")[0] || rvs?.documentElement, "s").map((s) => kids(s, "k").map((k) => k.getAttribute("n")));
      const rvToRel = kids(rv.documentElement, "rv").map((r) => {
        const keys = structs[Number(r.getAttribute("s"))] || ["_rvRel:LocalImageIdentifier"];
        const k = keys.indexOf("_rvRel:LocalImageIdentifier");
        const vals = kids(r, "v").map((v) => v.textContent);
        return k >= 0 ? Number(vals[k]) : null;
      });
      const relIds = kids(rvRel.documentElement, "rel").map((r) => rid(r));
      for (const c of byName(sheet, "c")) {
        const vm = c.getAttribute("vm");
        if (!vm) continue;
        const rvIndex = vmToRv[Number(vm) - 1];
        const relIndex = rvIndex == null ? null : rvToRel[rvIndex];
        const media = relIndex == null ? null : relMap[relIds[relIndex]];
        const pos = cellPos(c.getAttribute("r"));
        if (media && pos) found.push({ ...pos, path: media });
      }
    }
  } catch (e) { /* format inattendu : on garde les images déjà trouvées */ }

  for (const f of found) {
    res.total++;
    const type = imageType(f.path);
    const file = zip.file(f.path);
    if (!type || !file) { res.unsupported++; continue; }
    const blob = new Blob([await file.async("uint8array")], { type });
    if (!res.byRow.has(f.row)) res.byRow.set(f.row, []);
    res.byRow.get(f.row).push({ col: f.col, blob, name: f.path.split("/").pop() });
    res.cols.add(f.col);
  }
  for (const list of res.byRow.values()) list.sort((a, b) => a.col - b.col);
  return res;
}

/* ------------------------------------------------------------------ */
/*  Export Excel (miniatures) et sauvegarde .zip (toutes les photos)   */
/* ------------------------------------------------------------------ */
const ETAT_FILL = { "Fonctionnel": "FFE0F0E7", "À vérifier": "FFF9EDD5", "En réparation": "FFE1EBF7", "En panne": "FFF8E1DE" };
const ETAT_FONT = { "Fonctionnel": "FF1D7A51", "À vérifier": "FF9E6208", "En réparation": "FF2A5F9E", "En panne": "FFB3302A" };

export async function exportInventory({ items, be, nameOf, withPhotos, onProgress = () => {} }) {
  const ExcelJS = await loadExcelJS();
  const JSZip = withPhotos ? await loadJSZip() : null;
  const date = todayISO();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Inventaire GéoConsulting";
  wb.created = new Date();
  const ws = wb.addWorksheet("Inventaire", { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });

  const cols = [
    ["Photo", 11], ["Identifiant", 13], ["Désignation", 32], ["Catégorie", 20], ["Marque", 16], ["Modèle", 18],
    ["N° de série", 20], ["État", 15], ["Quantité", 10], ["Site", 22], ["Emplacement", 24],
    ["Dernier étalonnage", 14], ["Prochain étalonnage", 14], ["Accessoires", 26], ["Remarques", 44], ["À confirmer", 12],
    ["Photo appareil", 16], ["Photo plaque", 16], ["Photo autre vue", 16],
    ["Créée le", 12], ["Créée par", 18], ["Modifiée le", 12], ["Modifiée par", 18],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.height = 30;
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFF3EDE4" }, name: "Calibri", size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A24" } };
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
  ws.autoFilter = { from: "A1", to: { row: 1, column: cols.length } };

  const toDate = (iso) => { if (!iso) return null; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return y ? new Date(Date.UTC(y, m - 1, d)) : null; };
  const zip = withPhotos ? new JSZip() : null;
  const folder = zip ? zip.folder("photos") : null;

  // Photos en taille réelle (sauvegarde uniquement)
  const tasks = [];
  if (withPhotos) for (const it of items) for (const s of SLOTS) if (it.photos?.[s.k]) tasks.push({ it, slot: s.k, path: it.photos[s.k] });
  const have = new Set();
  let done = 0, failed = 0;
  for (let i = 0; i < tasks.length; i += 60) {
    const chunk = tasks.slice(i, i + 60);
    let urls = {};
    try { urls = await be.photoUrls(chunk.map((t) => t.path)); } catch (e) { urls = {}; }
    let k = 0;
    const worker = async () => {
      while (k < chunk.length) {
        const t = chunk[k++];
        try {
          const r = await fetch(urls[t.path]);
          if (!r.ok) throw new Error(String(r.status));
          folder.file(photoFileName(t.it.id, t.slot), await r.blob(), { binary: true });
          have.add(t.it.id + t.slot);
        } catch (e) { failed++; }
        done++;
        onProgress(`Photos ${done}/${tasks.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  items.forEach((it, i) => {
    const r = i + 2;
    const link = (slot) => {
      if (!it.photos?.[slot]) return "";
      if (withPhotos && have.has(it.id + slot)) return { text: "Voir la photo", hyperlink: `photos/${photoFileName(it.id, slot)}` };
      return withPhotos ? "Non récupérée" : "Oui";
    };
    const row = ws.addRow([
      "", it.id, it.designation, it.categorie, it.marque, it.modele, it.numero_serie, it.etat, Number(it.quantite) || 1,
      it.site, it.emplacement, toDate(it.etalonnage_dernier), toDate(it.etalonnage_prochain), it.accessoires, it.remarques,
      it.a_confirmer ? "Oui" : "Non", link("main"), link("plate"), link("other"),
      toDate((it.cree_le || "").slice(0, 10)), nameOf(it.cree_par), toDate((it.modifie_le || "").slice(0, 10)), nameOf(it.modifie_par),
    ]);
    row.height = 50;
    row.alignment = { vertical: "middle", wrapText: true };
    row.getCell(2).font = { name: "Consolas", size: 10 };
    for (const c of [12, 13, 20, 22]) row.getCell(c).numFmt = "dd/mm/yyyy";
    const etat = row.getCell(8);
    if (ETAT_FILL[it.etat]) { etat.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ETAT_FILL[it.etat] } }; etat.font = { bold: true, color: { argb: ETAT_FONT[it.etat] } }; }
    for (const c of [17, 18, 19]) if (typeof row.getCell(c).value === "object" && row.getCell(c).value) row.getCell(c).font = { color: { argb: "FF2A5F9E" }, underline: true };
    const mini = typeof it.miniature === "string" && /^data:image\/(jpeg|png);base64,/.test(it.miniature) ? it.miniature : "";
    if (mini) {
      const id = wb.addImage({ base64: mini, extension: mini.startsWith("data:image/png") ? "png" : "jpeg" });
      ws.addImage(id, { tl: { col: 0.12, row: r - 1 + 0.08 }, ext: { width: 60, height: 60 }, editAs: "oneCell" });
    }
    if (i % 40 === 0) onProgress(`Fiches ${i + 1}/${items.length}`);
  });

  onProgress("Création du fichier…");
  const xlsx = await wb.xlsx.writeBuffer();
  const xlsxName = `inventaire-geoconsulting-${date}.xlsx`;
  if (!withPhotos) {
    return { blob: new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name: xlsxName, photos: 0, failed: 0 };
  }
  zip.file(xlsxName, xlsx);
  zip.file("LISEZ-MOI.txt",
    "Sauvegarde de l'inventaire GéoConsulting du " + fmtDateFR(date) + "\r\n\r\n" +
    "1. Décompressez ce dossier (clic droit > Extraire tout).\r\n" +
    "2. Ouvrez le fichier Excel : les liens « Voir la photo » ouvrent les photos du dossier « photos ».\r\n" +
    "3. Pour restaurer : dans l'application, Outils > Importer un fichier, puis choisissez ce fichier .zip.\r\n\r\n" +
    "Nom des photos : IDENTIFIANT_appareil.jpg, IDENTIFIANT_plaque.jpg, IDENTIFIANT_autre-vue.jpg\r\n");
  onProgress("Compression…");
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, name: `sauvegarde-inventaire-geoconsulting-${date}.zip`, photos: have.size, failed };
}
