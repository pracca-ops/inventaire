// Import d'un ancien inventaire (Excel ou CSV) : fichier → correspondance des colonnes → import
import { SITES, CATEGORIES, esc, norm, newId, plural, frError } from "./utils.js";

const FIELDS = [
  { k: "designation", label: "Désignation", req: true, kw: ["designation", "désignation", "libelle", "libellé", "nom", "appareil", "materiel", "matériel", "equipement", "équipement", "article", "description", "intitule"] },
  { k: "categorie", label: "Catégorie", kw: ["categorie", "catégorie", "famille", "type", "rubrique"] },
  { k: "marque", label: "Marque", kw: ["marque", "fabricant", "constructeur"] },
  { k: "modele", label: "Modèle", kw: ["modele", "modèle", "reference", "référence"] },
  { k: "numero_serie", label: "N° de série / identifiant", kw: ["numero de serie", "n° de serie", "n° serie", "no serie", "serie", "série", "s/n", "serial", "identifiant", "code", "matricule"] },
  { k: "quantite", label: "Quantité", kw: ["quantite", "quantité", "qte", "qté", "nombre", "effectif"] },
  { k: "etat", label: "État / observation", kw: ["etat", "état", "observation", "observations", "statut", "condition", "fonctionnement"] },
  { k: "site", label: "Site / lieu", kw: ["site", "lieu", "localisation", "localite", "ville", "implantation", "affectation"] },
  { k: "emplacement", label: "Emplacement précis", kw: ["emplacement", "salle", "local", "rangement", "magasin", "armoire"] },
  { k: "etalonnage_dernier", label: "Dernier étalonnage", kw: ["dernier etalonnage", "date etalonnage", "date d'etalonnage", "etalonne le", "etalonnage"] },
  { k: "etalonnage_prochain", label: "Prochain étalonnage", kw: ["prochain etalonnage", "prochain", "echeance", "validite", "expiration", "date limite"] },
  { k: "accessoires", label: "Accessoires", kw: ["accessoire", "accessoires", "contenu", "kit", "composition"] },
  { k: "remarques", label: "Remarques", kw: ["remarque", "remarques", "commentaire", "commentaires", "note", "notes", "details"] },
];

let XLSXReady = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!XLSXReady) {
    XLSXReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "xlsx.full.min.js";
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { XLSXReady = null; reject(new Error("Impossible de charger le lecteur Excel. Vérifiez la connexion.")); };
      document.head.appendChild(s);
    });
  }
  return XLSXReady;
}

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
  const st = { step: 1, wb: null, file: "", sheet: "", rows: [], header: 0, map: {}, fill: true, skip: true, extra: true, cat: "" };

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
        <h1 style="font-size:40px">Reprendre l'ancien<br>inventaire</h1>
        <p>Chaque ligne du fichier devient une fiche marquée « à confirmer », à vérifier ensuite devant l'appareil.</p>
      </div>
      <label class="drop" id="drop" for="file">
        <span class="big">${icon("sheet")}</span>
        <b>Choisir un fichier</b>
        <small>Excel (.xlsx, .xls) ou CSV</small>
      </label>
      <input type="file" id="file" class="sr-only" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv">
      <div class="callout info" style="margin-top:16px">${icon("info")}
        <div><b>Bon à savoir</b><p>Les photos ne sont pas importées : ajoutez-les ensuite depuis chaque fiche. Rien n'est enregistré avant la dernière étape.</p></div>
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
      const X = await loadXLSX();
      const buf = await file.arrayBuffer();
      st.wb = X.read(buf, { type: "array", cellDates: true });
      st.file = file.name;
      const sheets = st.wb.SheetNames.filter(hasData);
      if (!sheets.length) throw new Error("Ce fichier ne contient aucune donnée lisible.");
      pickSheet(sheets[0]);
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

  function pickSheet(name) {
    st.sheet = name;
    st.rows = sheetRows(name);
    st.base = firstRowNumber(name);
    st.header = detectHeader(st.rows);
    st.map = autoMap(st.rows[st.header] || []);
    st.cat = mapCat(name) || "";
  }

  /* ---------- Conversion des lignes en fiches ---------- */
  function convert() {
    const out = [];
    let lastName = "";
    const g = (r, k) => (st.map[k] !== undefined && st.map[k] !== "" ? r[st.map[k]] : "");
    st.rows.slice(st.header + 1).forEach((r, i) => {
      const line = st.base + st.header + 1 + i;
      let designation = str(g(r, "designation"));
      const mapped = Object.values(st.map).some((c) => str(r[c]));
      if (!mapped) return;
      if (!designation && st.fill) designation = lastName;
      if (designation) lastName = designation;
      if (!designation) return;

      const notes = [];
      let serie = str(g(r, "numero_serie"));
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
          if (used.has(c) || !name || /^(n°?|no|num(ero)?|#|ordre)$/i.test(norm(name))) return;
          const val = r[c] instanceof Date ? toISO(r[c]) : str(r[c]);
          if (val) notes.splice(notes.length, 0, `${name} : ${val}`);
        });
      }
      notes.push(`Importé de « ${st.file} », feuille « ${st.sheet} », ligne ${line}.`);

      out.push({
        designation, categorie, marque: str(g(r, "marque")), modele: str(g(r, "modele")), numero_serie: serie,
        accessoires: str(g(r, "accessoires")), etat: e.etat, quantite, site: s.site, emplacement,
        etalonnage_dernier: d1, etalonnage_prochain: d2, remarques: notes.join("\n"), a_confirmer: true,
        photos: {}, miniature: "", origine: `${st.file} › ${st.sheet}`,
      });
    });
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
    const existing = new Set(ctx.items().map((i) => norm(i.numero_serie)).filter(Boolean));
    const dup = rows.filter((r) => r.numero_serie && existing.has(norm(r.numero_serie))).length;
    const willImport = st.skip ? rows.length - dup : rows.length;

    shell(`
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
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">D</span><h2>Aperçu</h2><p>Les 5 premières fiches telles qu'elles seront créées</p></div>
        ${rows.length ? `
        <div class="table-wrap"><table class="preview">
          <thead><tr><th>Désignation</th><th>Catégorie</th><th>Marque</th><th>N° série</th><th>État</th><th>Qté</th><th>Site</th></tr></thead>
          <tbody>${rows.slice(0, 5).map((r) => `<tr><td>${esc(r.designation)}</td><td>${esc(r.categorie)}</td><td>${esc(r.marque)}</td><td class="mono">${esc(r.numero_serie)}</td><td>${esc(r.etat)}</td><td>${r.quantite}</td><td>${esc(r.site)}</td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="hint">Aucune ligne exploitable : vérifiez la ligne des titres et la colonne « Désignation ».</p>`}
      </section>`,
      `<div class="actionbar"><div class="actionbar-in">
        <button class="btn btn-ghost" id="other">Autre fichier</button>
        <button class="btn btn-primary" id="go" ${willImport ? "" : "disabled"}>${icon("upload")}Importer ${plural(willImport, "fiche", "fiches")}</button>
      </div></div>`);

    const again = () => step2();
    document.getElementById("sheet")?.addEventListener("change", (e) => { pickSheet(e.target.value); again(); });
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
      const list = st.skip ? rows.filter((r) => !(r.numero_serie && existing.has(norm(r.numero_serie)))) : rows;
      step3(list, rows.length - list.length);
    };
  }

  /* ---------- Étape 3 : import par paquets ---------- */
  async function step3(list, skipped) {
    st.step = 3;
    shell(`
      <section class="fsec" id="prog" style="text-align:center;padding:28px 20px">
        <p class="eyebrow">Import en cours</p>
        <div class="big-num num" id="count" style="margin-top:12px">0</div>
        <p class="hint" style="margin:6px 0 18px">sur ${list.length} fiches</p>
        <div class="progress"><span id="bar" style="width:0%"></span></div>
        <p class="hint" style="margin-top:14px">Gardez cette page ouverte jusqu'à la fin.</p>
      </section>`);
    document.getElementById("bk").onclick = () => toast("Patientez jusqu'à la fin de l'import.", "info");

    const used = new Set(ctx.items().map((i) => i.id));
    const uid = () => { let id; do { id = newId(); } while (used.has(id)); used.add(id); return id; };
    let done = 0;
    const B = 25;
    try {
      for (let i = 0; i < list.length; i += B) {
        const batch = list.slice(i, i + B).map((r) => ({ ...r, id: uid() }));
        let saved;
        try { saved = await be.insertMany(batch); }
        catch (ex) {
          if (ex?.code !== "23505") throw ex;
          saved = await be.insertMany(batch.map((r) => ({ ...r, id: uid() })));
        }
        ctx.onImported(saved);
        done += saved.length;
        document.getElementById("count").textContent = done;
        document.getElementById("bar").style.width = `${Math.round((done / list.length) * 100)}%`;
      }
    } catch (ex) {
      finish(done, skipped, frError(ex));
      return;
    }
    finish(done, skipped, "");
  }

  function finish(done, skipped, error) {
    st.step = 4;
    shell(`
      <section class="fsec" style="text-align:center;padding:30px 20px">
        <div class="done-mark" style="${error ? "background:var(--bad-soft);color:var(--bad)" : ""}">${icon(error ? "alert" : "check")}</div>
        <h2 class="page-title" style="padding:18px 0 0"><span style="font-family:var(--font-display);font-weight:400;font-size:38px;letter-spacing:-.01em">${error ? "Import interrompu" : "Import terminé"}</span></h2>
        <p style="color:var(--ink-2);margin-top:8px">${plural(done, "fiche créée", "fiches créées")}${skipped ? ` · ${plural(skipped, "doublon ignoré", "doublons ignorés")}` : ""}.</p>
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
