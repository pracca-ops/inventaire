// Import d'un ancien inventaire (Excel, CSV ou sauvegarde .zip) avec ses photos,
// et association de photos en lot.
import { SITES, CATEGORIES, SLOTS, esc, norm, newId, plural, frError } from "./utils.js";
import { loadScript, loadJSZip, openXlsxZip, readSheetImages, makeMatcher, planSlots, attachPhotos, slotFromName, imageType } from "./transfert.js";

const FIELDS = [
  { k: "designation", label: "Désignation", req: true, kw: ["designation", "désignation", "libelle", "libellé", "nom", "appareil", "materiel", "matériel", "equipement", "équipement", "article", "description", "intitule"] },
  { k: "id", label: "Identifiant GC-…", kw: ["identifiant", "id gc", "code gc"] },
  { k: "categorie", label: "Catégorie", kw: ["categorie", "catégorie", "famille", "type", "rubrique"] },
  { k: "marque", label: "Marque", kw: ["marque", "fabricant", "constructeur"] },
  { k: "modele", label: "Modèle", kw: ["modele", "modèle", "reference", "référence"] },
  { k: "numero_serie", label: "N° de série", kw: ["numero de serie", "n° de serie", "n° serie", "no serie", "serie", "série", "s/n", "serial", "code", "matricule"] },
  { k: "quantite", label: "Quantité", kw: ["quantite", "quantité", "qte", "qté", "nombre", "effectif"] },
  { k: "etat", label: "État / observation", kw: ["etat", "état", "observation", "observations", "statut", "condition", "fonctionnement"] },
  { k: "site", label: "Site / lieu", kw: ["site", "lieu", "localisation", "localite", "ville", "implantation", "affectation"] },
  { k: "emplacement", label: "Emplacement précis", kw: ["emplacement", "salle", "local", "rangement", "magasin", "armoire"] },
  { k: "etalonnage_dernier", label: "Dernier étalonnage", kw: ["dernier etalonnage", "date etalonnage", "date d'etalonnage", "etalonne le", "etalonnage"] },
  { k: "etalonnage_prochain", label: "Prochain étalonnage", kw: ["prochain etalonnage", "prochain", "echeance", "validite", "expiration", "date limite"] },
  { k: "accessoires", label: "Accessoires", kw: ["accessoire", "accessoires", "contenu", "kit", "composition"] },
  { k: "remarques", label: "Remarques", kw: ["remarque", "remarques", "commentaire", "commentaires", "note", "notes", "details"] },
  { k: "a_confirmer", label: "À confirmer (oui / non)", kw: ["a confirmer"] },
];

const loadXLSX = () => loadScript("xlsx.full.min.js", "XLSX");
// Colonnes de l'export de l'application, à ne pas recopier dans les remarques
const IGNORED_HEADERS = /^(photo|image|cree|modifie|nombre de photos|a confirmer)/;
const EMPTY_IMGS = { byRow: new Map(), total: 0, unsupported: 0, cols: new Set() };
const isErrorValue = (v) => typeof v === "string" && /^#(VALUE|REF|NAME|N\/A|DIV\/0|NUM|NULL|SPILL|CALC|BLOCKED|UNKNOWN|FIELD|CONNECT|BUSY)[!?]?$/i.test(v.trim());

const str = (v) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, " ").trim();

function toISO(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    const mo = Number(m[2]), da = Number(m[1]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  }
  return null;
}

function mapEtat(v) {
  const n = norm(v);
  if (!n) return { etat: "À vérifier", note: "" };
  if (/\b(bon|ras|r\.a\.s|fonctionnel|ok|tres bon|bon etat|neuf)\b/.test(n) && !/panne|hs|repar/.test(n)) return { etat: "Fonctionnel", note: "" };
  if (/\b(hs|h\.s|panne|en panne|hors service|casse|defectueux)\b/.test(n)) return { etat: "En panne", note: "" };
  if (/repar/.test(n)) return { etat: "En réparation", note: "" };
  return { etat: "À vérifier", note: str(v) };
}

function mapSite(v) {
  const n = norm(v);
  if (!n) return { site: "", emp: "" };
  if (n.includes("niamey")) return { site: "Niamey – Laboratoire", emp: /siege/.test(n) ? "Siège" : "" };
  if (n.includes("doutchi")) return { site: "Doutchi", emp: "" };
  if (n.includes("chantier")) return { site: "Chantier", emp: str(v) };
  if (/pret|partenaire/.test(n)) return { site: "Prêté à un partenaire", emp: str(v) };
  const exact = SITES.find((s) => norm(s) === n);
  if (exact) return { site: exact, emp: "" };
  return { site: "Autre", emp: str(v) };
}

// Noms de feuilles ou d'essais courants au laboratoire → catégorie
const CAT_HINTS = [
  [/tamis|sedimentation|atterberg|\be\.?\s?s\b|equivalent de sable|cbr|proctor|dcp|penetrometre|masse volumique|densit|oedom|cisaillement|sol/, "Essais de sols"],
  [/beton|affaissement|abrams|sclerometre|ecrasement|granulat|eprouvette|cone/, "Granulats / béton"],
  [/bitume|enrobe|marshall|deflexion|benkelman|carott/, "Bitume / enrobés"],
  [/balance|pesage|peson/, "Pesage / balances"],
  [/etuve|four\b|fours/, "Étuves / fours"],
  [/gps|topo|niveau|theodolite|station totale|mire/, "Topographie / GPS"],
  [/geophys|resistivi|sismique/, "Géophysique"],
  [/ordinateur|imprimante|informatique|laptop|pc\b/, "Informatique"],
  [/vehicule|voiture|moto|groupe electrogene/, "Véhicule / terrain"],
  [/epi|casque|gilet|gants|securite/, "EPI / sécurité"],
  [/mobilier|bureau|chaise|armoire|table/, "Mobilier / bureau"],
];

function mapCat(v) {
  const n = norm(v);
  if (!n) return "";
  const exact = CATEGORIES.find((c) => norm(c) === n);
  if (exact) return exact;
  const stem = (s) => s.replace(/s$/, "");
  const part = CATEGORIES.find((c) => norm(c).split(/\s*\/\s*/).some((p) => p.length >= 4 && (n.includes(stem(p)) || stem(p).includes(n) && n.length >= 4)));
  if (part) return part;
  const hint = CAT_HINTS.find(([re]) => re.test(n));
  return hint ? hint[1] : "";
}

function detectHeader(rows) {
  let best = -1, bestScore = 0;
  const all = FIELDS.flatMap((f) => f.kw.map(norm)).filter((k) => k.length >= 3);
  const lim = Math.min(rows.length, 25);
  for (let i = 0; i < lim; i++) {
    const score = rows[i].filter((c) => { const n = norm(str(c)); return n && n.length < 60 && all.some((k) => n.includes(k)); }).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best >= 0) return best;
  const i = rows.findIndex((r) => r.filter((c) => str(c)).length >= 2);
  return Math.max(0, i);
}

function autoMap(headers) {
  const pairs = [];
  headers.forEach((h, col) => {
    const n = norm(str(h));
    if (!n) return;
    for (const f of FIELDS) {
      let s = 0;
      for (const k of f.kw.map(norm)) {
        if (n === k) s = Math.max(s, 100 + k.length);
        else if (k.length >= 3 && n.includes(k)) s = Math.max(s, 10 + k.length);
      }
      if (s) pairs.push({ col, k: f.k, s });
    }
  });
  pairs.sort((a, b) => b.s - a.s);
  const map = {}, used = new Set();
  for (const p of pairs) {
    if (p.k in map || used.has(p.col)) continue;
    map[p.k] = p.col; used.add(p.col);
  }
  return map;
}

export function renderImport(ctx) {
  const { app, be, icon, toast } = ctx;
  const st = { step: 1, wb: null, xzip: null, zipPhotos: [], file: "", sheet: "", rows: [], header: 0, base: 1, map: {}, imgs: EMPTY_IMGS, fill: true, skip: true, extra: true, cat: "" };

  let lastStep = 0;
  const shell = (inner, bar = "") => {
    const anim = lastStep !== st.step;
    lastStep = st.step;
    app.innerHTML = `
    <div class="view view--push page-pad ${anim ? "" : "no-anim"}" style="padding-bottom:140px">
      <header class="topbar">
        <button class="icon-btn" id="bk" aria-label="Retour">${icon("back")}</button>
        <h1>Importer un inventaire</h1><span></span>
      </header>
      <div class="wrap-narrow" style="padding-top:18px">
        <div class="steps" aria-hidden="true">
          <div class="${st.step === 1 ? "on" : "done"}">1 · Fichier</div>
          <div class="${st.step === 2 ? "on" : st.step > 2 ? "done" : ""}">2 · Colonnes</div>
          <div class="${st.step === 3 ? "on" : st.step > 3 ? "done" : ""}">3 · Import</div>
        </div>
        ${inner}
      </div>
      ${bar}
    </div>`;
    document.getElementById("bk").onclick = () => (st.step === 2 ? step1() : ctx.back());
  };

  /* ---------- Étape 1 : choisir le fichier ---------- */
  function step1() {
    st.step = 1;
    shell(`
      <div class="page-title" style="padding-top:6px">
        <h1 style="font-size:40px">Importer un<br>inventaire</h1>
        <p>Chaque ligne du fichier devient une fiche marquée « à confirmer », à vérifier ensuite devant l'appareil.</p>
      </div>
      <label class="drop" id="drop" for="file">
        <span class="big">${icon("sheet")}</span>
        <b>Choisir un fichier</b>
        <small>Excel (.xlsx, .xls), CSV ou sauvegarde .zip</small>
      </label>
      <input type="file" id="file" class="sr-only" accept=".xlsx,.xls,.csv,.zip,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv">
      <div class="callout info" style="margin-top:16px">${icon("image")}
        <div><b>Les photos suivent</b><p>Les images placées dans une ligne du fichier Excel sont ajoutées à la fiche de cette ligne (3 au maximum). Une sauvegarde .zip de l'application est restaurée avec toutes ses photos. Rien n'est enregistré avant la dernière étape.</p></div>
      </div>`);
    const input = document.getElementById("file");
    const drop = document.getElementById("drop");
    input.onchange = () => input.files?.[0] && readFile(input.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); };
  }

  async function readFile(file) {
    const drop = document.getElementById("drop");
    drop.querySelector("b").textContent = "Lecture du fichier…";
    try {
      let buf = await file.arrayBuffer();
      let inner = file.name;
      st.zipPhotos = []; st.xzip = null;
      st.file = file.name;
      if (/\.zip$/i.test(file.name)) {
        const JSZip = await loadJSZip();
        const z = await JSZip.loadAsync(buf);
        const entries = Object.values(z.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX\/|\.)/.test(f.name));
        const sheetEntry = entries.find((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
        if (!sheetEntry) throw new Error("Ce fichier .zip ne contient pas de tableau Excel ou CSV.");
        st.zipPhotos = entries.filter((f) => imageType(f.name)).map((f) => ({ name: f.name.split("/").pop(), entry: f }));
        buf = await sheetEntry.async("arraybuffer");
        inner = sheetEntry.name.split("/").pop();
        st.file = `${file.name} › ${inner}`;
      }
      const X = await loadXLSX();
      st.wb = X.read(buf, { type: "array", cellDates: true });
      if (/\.xlsx$/i.test(inner)) { try { st.xzip = await openXlsxZip(buf); } catch (e) { st.xzip = null; } }
      const sheets = st.wb.SheetNames.filter(hasData);
      if (!sheets.length) throw new Error("Ce fichier ne contient aucune donnée lisible.");
      await pickSheet(sheets[0]);
      step2();
    } catch (ex) {
      drop.querySelector("b").textContent = "Choisir un fichier";
      toast(ex?.message && !/fetch/i.test(ex.message) ? ex.message : frError(ex), "err", 5000);
    }
  }

  // Toutes les lignes, vides comprises, pour garder la numérotation d'Excel
  function sheetRows(name) {
    const X = window.XLSX;
    const ws = st.wb.Sheets[name];
    if (!ws || !ws["!ref"]) return [];
    return X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: true });
  }
  const hasData = (name) => sheetRows(name).some((r) => r.some((c) => str(c)));
  function firstRowNumber(name) {
    const ws = st.wb.Sheets[name];
    try { return window.XLSX.utils.decode_range(ws["!ref"]).s.r + 1; } catch (e) { return 1; }
  }

  async function pickSheet(name) {
    st.sheet = name;
    st.rows = sheetRows(name);
    st.base = firstRowNumber(name);
    st.header = detectHeader(st.rows);
    st.map = autoMap(st.rows[st.header] || []);
    st.cat = mapCat(name) || "";
    st.imgs = st.xzip ? await readSheetImages(st.xzip, name).catch(() => EMPTY_IMGS) : EMPTY_IMGS;
  }

  const cell = (v) => (isErrorValue(v) ? "" : v);

  /* ---------- Conversion des lignes en fiches ---------- */
  function convert() {
    const out = [];
    let lastName = "";
    const g = (r, k) => (st.map[k] !== undefined && st.map[k] !== "" ? cell(r[st.map[k]]) : "");
    st.rows.slice(st.header + 1).forEach((r, i) => {
      const index = st.header + 1 + i;           // position dans la feuille
      const line = st.base + index;              // numéro de ligne Excel
      const imgs = st.imgs.byRow.get(line - 1) || [];
      let designation = str(g(r, "designation"));
      const mapped = Object.values(st.map).some((c) => str(cell(r[c])));
      if (!mapped && !imgs.length) return;
      if (!designation && st.fill) designation = lastName;
      if (designation) lastName = designation;
      if (!designation) return;

      const notes = [];
      let serie = str(g(r, "numero_serie"));
      const idRaw = str(g(r, "id")).toUpperCase();
      const srcId = /^GC-[A-Z0-9]{5}$/.test(idRaw) ? idRaw : "";
      if (idRaw && !srcId && !serie) serie = str(g(r, "id"));
      let qRaw = str(g(r, "quantite"));
      let quantite = 1;
      if (qRaw) {
        const n = Number(qRaw.replace(",", "."));
        if (Number.isFinite(n) && n >= 1) quantite = Math.round(n);
        else if (!serie) serie = qRaw; // un texte dans « ID/Nombre » est un identifiant
      }
      const e = mapEtat(g(r, "etat"));
      if (e.note) notes.push(`Observation d'origine : ${e.note}`);
      const s = mapSite(g(r, "site"));
      let emplacement = [s.emp, str(g(r, "emplacement"))].filter(Boolean).join(" · ");
      const catTxt = str(g(r, "categorie"));
      const categorie = mapCat(catTxt) || st.cat || (catTxt ? "Autre" : "");
      if (catTxt && !mapCat(catTxt)) notes.push(`Catégorie d'origine : ${catTxt}`);
      const d1v = g(r, "etalonnage_dernier"), d2v = g(r, "etalonnage_prochain");
      const d1 = toISO(d1v), d2 = toISO(d2v);
      if (str(d1v) && !d1) notes.push(`Dernier étalonnage (texte d'origine) : ${str(d1v)}`);
      if (str(d2v) && !d2) notes.push(`Prochain étalonnage (texte d'origine) : ${str(d2v)}`);
      const rem = str(g(r, "remarques"));
      if (rem) notes.unshift(rem);
      if (st.extra) {
        const used = new Set(Object.values(st.map).map(Number));
        const heads = st.rows[st.header] || [];
        heads.forEach((h, c) => {
          const name = str(h);
          if (used.has(c) || st.imgs.cols.has(c) || !name || IGNORED_HEADERS.test(norm(name)) || /^(n°?|no|num(ero)?|#|ordre)$/i.test(norm(name))) return;
          const v = cell(r[c]);
          const val = v instanceof Date ? toISO(v) : str(v);
          if (val) notes.push(`${name} : ${val}`);
        });
      }
      // Restauration d'une sauvegarde : on garde la trace d'origine de l'application
      if (!srcId) notes.push(`Importé de « ${st.file} », feuille « ${st.sheet} », ligne ${line}.`);
      const conf = norm(str(g(r, "a_confirmer")));
      const a_confirmer = st.map.a_confirmer === undefined ? true : !/^(non|no|0|faux|false)$/.test(conf);

      out.push({
        designation, categorie, marque: str(g(r, "marque")), modele: str(g(r, "modele")), numero_serie: serie,
        accessoires: str(g(r, "accessoires")), etat: e.etat, quantite, site: s.site, emplacement,
        etalonnage_dernier: d1, etalonnage_prochain: d2, remarques: notes.join("\n"), a_confirmer,
        photos: {}, miniature: "", origine: srcId ? `Restauré de ${st.file}` : `${st.file} › ${st.sheet}`,
        _srcId: srcId, _line: line,
        // Dans une sauvegarde .zip, les images du classeur ne sont que des miniatures :
        // seules les photos en taille réelle de l'archive comptent.
        _photos: st.zipPhotos.length ? [] : imgs.slice(0, 3).map((x) => ({ blob: x.blob, slot: null })),
      });
    });

    // Photos d'une archive .zip : rattachées par identifiant ou n° de série
    if (st.zipPhotos.length && out.length) {
      const pseudo = out.map((r, i) => ({ id: r._srcId || `ROW-${i}`, numero_serie: r.numero_serie, _i: i }));
      const match = makeMatcher(pseudo);
      for (const p of st.zipPhotos) {
        const m = match(p.name);
        if (m.item) out[m.item._i]._photos.push({ entry: p.entry, slot: slotFromName(p.name) });
      }
    }
    for (const r of out) r._photos = planSlots({ photos: {} }, r._photos).filter((p) => !p.skip);
    return out;
  }

  /* ---------- Étape 2 : feuille et colonnes ---------- */
  function step2() {
    st.step = 2;
    const headers = st.rows[st.header] || [];
    const colOpts = (sel) => `<option value="">— Ignorer —</option>` +
      headers.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? "selected" : ""}>${esc(str(h) || `Colonne ${i + 1}`)}</option>`).join("");
    const sheets = st.wb.SheetNames.filter(hasData);
    const rows = convert();
    const ids = new Set(ctx.items().map((i) => i.id));
    const existing = new Set(ctx.items().map((i) => norm(i.numero_serie)).filter(Boolean));
    const present = rows.filter((r) => r._srcId && ids.has(r._srcId)).length;
    const dup = rows.filter((r) => !(r._srcId && ids.has(r._srcId)) && r.numero_serie && existing.has(norm(r.numero_serie))).length;
    const willImport = rows.length - present - (st.skip ? dup : 0);
    const nPhotos = rows.reduce((a, r) => a + r._photos.length, 0);
    const photoNote = nPhotos
      ? `<div class="callout info" style="margin:0 0 12px">${icon("image")}<div><b>${plural(nPhotos, "photo trouvée", "photos trouvées")}</b><p>${st.zipPhotos.length ? "Photos de l'archive, rattachées par identifiant ou n° de série." : "Images placées dans les lignes de la feuille : chacune ira sur la fiche de sa ligne."}${st.imgs.unsupported ? ` ${plural(st.imgs.unsupported, "image n'est pas lisible", "images ne sont pas lisibles")} (format ancien) et sera ignorée.` : ""}</p></div></div>`
      : (st.imgs.unsupported ? `<div class="callout" style="margin:0 0 12px">${icon("alert")}<div><b>Images non lisibles</b><p>Les images de cette feuille sont dans un format ancien. Enregistrez-les en JPG ou PNG dans Excel puis réessayez.</p></div></div>` : "");

    shell(`
      ${photoNote}
      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">A</span><h2>Feuille</h2><p>${esc(st.file)}</p></div>
        ${sheets.length > 1 ? `
        <div class="field"><label class="label" for="sheet">Feuille à importer</label>
          <select class="select" id="sheet">${sheets.map((n) => `<option ${n === st.sheet ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
          <span class="hint">${plural(sheets.length, "feuille", "feuilles")} dans ce fichier. Importez-les une par une.</span></div>` : ""}
        <div class="row2" style="margin-top:14px">
          <div class="field"><label class="label" for="hrow">Ligne des titres</label>
            <select class="select" id="hrow">${st.rows.slice(0, 30).map((r, i) => (r.some((c) => str(c)) ? `<option value="${i}" ${i === st.header ? "selected" : ""}>Ligne ${st.base + i} · ${esc(r.map(str).filter(Boolean).slice(0, 2).join(", ").slice(0, 28))}</option>` : "")).join("")}</select></div>
          <div class="field"><label class="label" for="dcat">Catégorie par défaut</label>
            <select class="select" id="dcat"><option value="">Aucune</option>${CATEGORIES.map((c) => `<option ${c === st.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">B</span><h2>Correspondance des colonnes</h2><p>Détectée automatiquement, modifiable</p></div>
        <div id="maps">
          ${FIELDS.map((f) => `
            <div class="map-row ${st.map[f.k] !== undefined ? "set" : ""}">
              <span>${f.label}${f.req ? ' <span style="color:var(--accent)">*</span>' : ""}</span>
              <select class="select" data-map="${f.k}" aria-label="Colonne pour ${f.label}">${colOpts(st.map[f.k])}</select>
            </div>`).join("")}
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">C</span><h2>Options</h2><p>Adaptées aux tableaux du laboratoire</p></div>
        <label class="check-row"><input type="checkbox" id="opt-fill" ${st.fill ? "checked" : ""}>
          <span>Reprendre la désignation de la ligne du dessus si elle est vide<small>Utile quand le nom n'est écrit que sur la première ligne d'une série.</small></span></label>
        <label class="check-row"><input type="checkbox" id="opt-extra" ${st.extra ? "checked" : ""}>
          <span>Copier les autres colonnes dans les remarques<small>Portée, précision, diamètre… : aucune information du fichier n'est perdue.</small></span></label>
        <label class="check-row"><input type="checkbox" id="opt-skip" ${st.skip ? "checked" : ""}>
          <span>Ignorer les numéros de série déjà présents<small>${dup ? `${plural(dup, "ligne sera ignorée", "lignes seront ignorées")}.` : "Aucun doublon trouvé pour l'instant."}</small></span></label>
        ${present ? `<p class="hint" style="margin-top:6px">${plural(present, "fiche existe", "fiches existent")} déjà avec le même identifiant et ${present > 1 ? "seront ignorées" : "sera ignorée"}.</p>` : ""}
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">D</span><h2>Aperçu</h2><p>Les 5 premières fiches telles qu'elles seront créées</p></div>
        ${rows.length ? `
        <div class="table-wrap"><table class="preview">
          <thead><tr><th>Désignation</th><th>Photos</th><th>Catégorie</th><th>Marque</th><th>N° série</th><th>État</th><th>Qté</th><th>Site</th></tr></thead>
          <tbody>${rows.slice(0, 5).map((r) => `<tr><td>${esc(r.designation)}</td><td>${r._photos.length || "—"}</td><td>${esc(r.categorie)}</td><td>${esc(r.marque)}</td><td class="mono">${esc(r.numero_serie)}</td><td>${esc(r.etat)}</td><td>${r.quantite}</td><td>${esc(r.site)}</td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="hint">Aucune ligne exploitable : vérifiez la ligne des titres et la colonne « Désignation ».</p>`}
      </section>`,
      `<div class="actionbar"><div class="actionbar-in">
        <button class="btn btn-ghost" id="other">Autre fichier</button>
        <button class="btn btn-primary" id="go" ${willImport > 0 ? "" : "disabled"}>${icon("upload")}Importer ${plural(Math.max(0, willImport), "fiche", "fiches")}</button>
      </div></div>`);

    const again = () => step2();
    document.getElementById("sheet")?.addEventListener("change", async (e) => { await pickSheet(e.target.value); again(); });
    document.getElementById("hrow").onchange = (e) => { st.header = Number(e.target.value); st.map = autoMap(st.rows[st.header] || []); again(); };
    document.getElementById("dcat").onchange = (e) => { st.cat = e.target.value; again(); };
    document.getElementById("maps").onchange = (e) => {
      const s = e.target.closest("[data-map]"); if (!s) return;
      if (s.value === "") delete st.map[s.dataset.map]; else {
        for (const k of Object.keys(st.map)) if (String(st.map[k]) === s.value && k !== s.dataset.map) delete st.map[k];
        st.map[s.dataset.map] = Number(s.value);
      }
      again();
    };
    document.getElementById("opt-fill").onchange = (e) => { st.fill = e.target.checked; again(); };
    document.getElementById("opt-skip").onchange = (e) => { st.skip = e.target.checked; again(); };
    document.getElementById("opt-extra").onchange = (e) => { st.extra = e.target.checked; again(); };
    document.getElementById("other").onclick = step1;
    document.getElementById("go").onclick = () => {
      if (st.map.designation === undefined) { toast("Choisissez la colonne « Désignation ».", "info"); return; }
      const list = rows.filter((r) => !(r._srcId && ids.has(r._srcId)) && !(st.skip && r.numero_serie && existing.has(norm(r.numero_serie))));
      step3(list, rows.length - list.length);
    };
  }

  /* ---------- Étape 3 : import par paquets, puis photos ---------- */
  async function step3(list, skipped) {
    st.step = 3;
    const totalPhotos = list.reduce((a, r) => a + r._photos.length, 0);
    shell(`
      <section class="fsec" id="prog" style="text-align:center;padding:28px 20px">
        <p class="eyebrow">Import en cours</p>
        <div class="big-num num" id="count" style="margin-top:12px">0</div>
        <p class="hint" style="margin:6px 0 18px">sur ${list.length} fiches</p>
        <div class="progress"><span id="bar" style="width:0%"></span></div>
        <p class="hint" id="ph-line" style="margin-top:12px">${totalPhotos ? `Photos : 0 / ${totalPhotos}` : ""}</p>
        <p class="hint" style="margin-top:8px">Gardez cette page ouverte jusqu'à la fin.</p>
      </section>`);
    document.getElementById("bk").onclick = () => toast("Patientez jusqu'à la fin de l'import.", "info");

    const used = new Set(ctx.items().map((i) => i.id));
    const uid = () => { let id; do { id = newId(); } while (used.has(id)); used.add(id); return id; };
    const pickId = (r) => { if (r._srcId && !used.has(r._srcId)) { used.add(r._srcId); return r._srcId; } return uid(); };
    let done = 0, photosOk = 0, photosKo = 0;
    const B = 25;
    const bump = () => {
      const steps = list.length + totalPhotos;
      document.getElementById("count").textContent = done;
      document.getElementById("bar").style.width = `${Math.round(((done + photosOk + photosKo) / Math.max(1, steps)) * 100)}%`;
      const l = document.getElementById("ph-line");
      if (l && totalPhotos) l.textContent = `Photos : ${photosOk + photosKo} / ${totalPhotos}`;
    };
    try {
      for (let i = 0; i < list.length; i += B) {
        let batch = list.slice(i, i + B).map((r) => ({ ...r, id: pickId(r) }));
        let saved;
        try { saved = await be.insertMany(batch); }
        catch (ex) {
          if (ex?.code !== "23505") throw ex;
          batch = batch.map((r) => ({ ...r, id: uid() }));
          saved = await be.insertMany(batch);
        }
        ctx.onImported(saved);
        done += saved.length;
        bump();
        const byId = new Map(saved.map((x) => [x.id, x]));
        for (const r of batch) {
          if (!r._photos.length || !byId.has(r.id)) continue;
          const blobs = {};
          for (const p of r._photos) {
            try { blobs[p.slot] = p.blob || (await p.entry.async("blob")); } catch (e) { photosKo++; }
          }
          try {
            const row = await attachPhotos(be, byId.get(r.id), blobs);
            ctx.onImported([row]);
            photosOk += Object.keys(blobs).length;
          } catch (e) { photosKo += Object.keys(blobs).length; }
          bump();
        }
      }
    } catch (ex) {
      finish(done, skipped, photosOk, photosKo, frError(ex));
      return;
    }
    finish(done, skipped, photosOk, photosKo, "");
  }

  function finish(done, skipped, photosOk, photosKo, error) {
    st.step = 4;
    shell(`
      <section class="fsec" style="text-align:center;padding:30px 20px">
        <div class="done-mark" style="${error ? "background:var(--bad-soft);color:var(--bad)" : ""}">${icon(error ? "alert" : "check")}</div>
        <h2 class="page-title" style="padding:18px 0 0"><span style="font-family:var(--font-display);font-weight:400;font-size:38px;letter-spacing:-.01em">${error ? "Import interrompu" : "Import terminé"}</span></h2>
        <p style="color:var(--ink-2);margin-top:8px">${plural(done, "fiche créée", "fiches créées")}${photosOk ? ` · ${plural(photosOk, "photo ajoutée", "photos ajoutées")}` : ""}${skipped ? ` · ${plural(skipped, "ligne ignorée", "lignes ignorées")}` : ""}.</p>
        ${photosKo ? `<p class="hint" style="margin-top:6px">${plural(photosKo, "photo n'a pas pu être ajoutée", "photos n'ont pas pu être ajoutées")} (fichier illisible ou connexion).</p>` : ""}
        ${error ? `<div class="form-error" style="text-align:left">${esc(error)}</div>` : ""}
        <p class="hint" style="margin-top:12px">Feuille « ${esc(st.sheet)} » de ${esc(st.file)}</p>
        <div style="display:grid;gap:10px;margin-top:22px">
          <button class="btn btn-primary btn-block" id="see">${icon("flag")}Voir les fiches à vérifier</button>
          <button class="btn btn-ghost btn-block" id="again">${icon("sheet")}Importer une autre feuille</button>
        </div>
      </section>`);
    document.getElementById("bk").onclick = ctx.back;
    document.getElementById("see").onclick = ctx.showToCheck;
    document.getElementById("again").onclick = () => step2();
  }

  app.onclick = null; app.onchange = null; app.oninput = null;
  step1();
}

/* ================================================================== */
/*  Associer des photos en lot (nom du fichier = identifiant ou série) */
/* ================================================================== */
export function renderPhotoBatch(ctx) {
  const { app, be, icon, toast } = ctx;
  const st = { step: 1, plan: [], urls: [] };
  const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.k, s.label]));
  const cleanup = () => { st.urls.forEach((u) => URL.revokeObjectURL(u)); st.urls = []; };

  const shell = (inner, bar = "") => {
    app.innerHTML = `
    <div class="view view--push page-pad" style="padding-bottom:140px">
      <header class="topbar">
        <button class="icon-btn" id="bk" aria-label="Retour">${icon("back")}</button>
        <h1>Photos en lot</h1><span></span>
      </header>
      <div class="wrap-narrow" style="padding-top:18px">${inner}</div>
      ${bar}
    </div>`;
    document.getElementById("bk").onclick = () => { if (st.step === 3) return toast("Patientez jusqu'à la fin.", "info"); cleanup(); st.step === 2 ? step1() : ctx.back(); };
  };

  function step1() {
    st.step = 1;
    shell(`
      <div class="page-title" style="padding-top:6px">
        <h1 style="font-size:40px">Associer des<br>photos en lot</h1>
        <p>Choisissez plusieurs photos : chacune rejoint la fiche indiquée dans son <b>nom de fichier</b>.</p>
      </div>
      <label class="drop" id="drop" for="files">
        <span class="big">${icon("image")}</span>
        <b>Choisir des photos</b>
        <small>JPG ou PNG, plusieurs à la fois</small>
      </label>
      <input type="file" id="files" class="sr-only" accept="image/*" multiple>
      <section class="card" style="margin-top:14px">
        <h2 class="card-title">${icon("info")}Comment nommer les photos</h2>
        <div class="kv"><span>Par identifiant</span><b class="mono">GC-7K3PX.jpg</b></div>
        <div class="kv"><span>Par n° de série</span><b class="mono">B425718362.jpg</b></div>
        <div class="kv"><span>Case « Plaque »</span><b class="mono">GC-7K3PX_plaque.jpg</b></div>
        <div class="kv"><span>Case « Autre vue »</span><b class="mono">GC-7K3PX_autre.jpg</b></div>
        <p class="hint" style="margin-top:10px">Sans précision, la photo prend la première case libre (Appareil, puis Plaque, puis Autre vue).</p>
      </section>`);
    const input = document.getElementById("files");
    const drop = document.getElementById("drop");
    input.onchange = () => input.files?.length && analyse(Array.from(input.files));
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = Array.from(e.dataTransfer.files || []).filter((x) => imageType(x.name) || /^image\//.test(x.type)); if (f.length) analyse(f); };
  }

  function analyse(files) {
    const match = makeMatcher(ctx.items());
    const groups = new Map();
    const lines = files.map((file) => {
      const m = match(file.name);
      const line = { file, item: m.item, how: m.how, ambiguous: m.ambiguous, slot: slotFromName(file.name) };
      if (m.item) { if (!groups.has(m.item.id)) groups.set(m.item.id, []); groups.get(m.item.id).push(line); }
      return line;
    });
    for (const [, list] of groups) {
      const planned = planSlots(list[0].item, list.map((l) => ({ slot: l.slot })));
      planned.forEach((p, i) => { list[i].slot = p.slot; list[i].skip = p.skip; });
    }
    st.plan = lines;
    step2();
  }

  function step2() {
    st.step = 2;
    cleanup();
    const ok = st.plan.filter((l) => l.item && !l.skip);
    const rows = st.plan.map((l) => {
      const u = URL.createObjectURL(l.file); st.urls.push(u);
      const right = l.item && !l.skip
        ? `<b>${esc(l.item.designation)}</b><small><span class="mono">${esc(l.item.id)}</span> · ${SLOT_LABEL[l.slot]} · par ${l.how}</small>`
        : `<b style="color:var(--warn)">${l.skip ? "Déjà 3 photos" : l.ambiguous ? "Plusieurs fiches possibles" : "Aucune fiche trouvée"}</b><small>${l.skip ? esc(l.item.designation) + " — ajoutez « plaque » ou « autre » au nom pour remplacer" : "Vérifiez l'identifiant ou le n° de série dans le nom"}</small>`;
      return `<div class="row-link" style="grid-template-columns:52px 1fr">
        <span class="thumb" style="width:52px;height:52px;border-radius:12px"><img src="${u}" alt=""></span>
        <span style="min-width:0"><small class="mono" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.file.name)}</small>${right}</span>
      </div>`;
    }).join("");
    shell(`
      <div class="callout ${ok.length ? "info" : ""}" style="margin-top:0">${icon(ok.length ? "checkCircle" : "alert")}
        <div><b>${plural(ok.length, "photo reconnue", "photos reconnues")} sur ${st.plan.length}</b><p>${ok.length ? "Vérifiez la liste, puis associez." : "Aucune photo ne correspond à une fiche : vérifiez les noms de fichier."}</p></div>
      </div>
      <section class="card" style="margin-top:12px"><div class="rows">${rows}</div></section>`,
      `<div class="actionbar"><div class="actionbar-in">
        <button class="btn btn-ghost" id="other">Autres photos</button>
        <button class="btn btn-primary" id="go" ${ok.length ? "" : "disabled"}>${icon("image")}Associer ${plural(ok.length, "photo", "photos")}</button>
      </div></div>`);
    document.getElementById("other").onclick = () => { cleanup(); step1(); };
    document.getElementById("go").onclick = () => step3(ok);
  }

  async function step3(ok) {
    st.step = 3;
    const byItem = new Map();
    for (const l of ok) { if (!byItem.has(l.item.id)) byItem.set(l.item.id, { item: l.item, blobs: {} }); byItem.get(l.item.id).blobs[l.slot] = l.file; }
    shell(`
      <section class="fsec" style="text-align:center;padding:28px 20px">
        <p class="eyebrow">Envoi des photos</p>
        <div class="big-num num" id="count" style="margin-top:12px">0</div>
        <p class="hint" style="margin:6px 0 18px">sur ${ok.length} photos</p>
        <div class="progress"><span id="bar" style="width:0%"></span></div>
        <p class="hint" style="margin-top:14px">Gardez cette page ouverte jusqu'à la fin.</p>
      </section>`);
    let n = 0, ko = 0;
    for (const { item, blobs } of byItem.values()) {
      const k = Object.keys(blobs).length;
      try {
        const current = ctx.items().find((i) => i.id === item.id) || item;
        const row = await attachPhotos(be, current, blobs);
        ctx.onImported([row]);
      } catch (e) { ko += k; }
      n += k;
      document.getElementById("count").textContent = n - ko;
      document.getElementById("bar").style.width = `${Math.round((n / ok.length) * 100)}%`;
    }
    cleanup();
    st.step = 4;
    shell(`
      <section class="fsec" style="text-align:center;padding:30px 20px">
        <div class="done-mark">${icon("check")}</div>
        <h2 class="page-title" style="padding:18px 0 0"><span style="font-family:var(--font-display);font-weight:400;font-size:38px">Photos associées</span></h2>
        <p style="color:var(--ink-2);margin-top:8px">${plural(n - ko, "photo ajoutée", "photos ajoutées")} sur ${plural(byItem.size, "fiche", "fiches")}.</p>
        ${ko ? `<p class="hint" style="margin-top:6px">${plural(ko, "photo n'a pas pu être envoyée", "photos n'ont pas pu être envoyées")}. Réessayez avec une meilleure connexion.</p>` : ""}
        <div style="display:grid;gap:10px;margin-top:22px">
          <button class="btn btn-primary btn-block" id="home">${icon("grid")}Voir l'inventaire</button>
          <button class="btn btn-ghost btn-block" id="more">${icon("image")}Associer d'autres photos</button>
        </div>
      </section>`);
    document.getElementById("home").onclick = ctx.home;
    document.getElementById("more").onclick = step1;
  }

  app.onclick = null; app.onchange = null; app.oninput = null;
  step1();
}
