import { createBackend } from "./data.js";
import {
  SITES, CATEGORIES, ETATS, SLOTS, etatClass, esc, norm, keyOf, newId, fmtDate, fmtDateTime, fmtDateFR, relTime,
  calibration, daysUntil, parseISODate, isToCheck, isBroken, isCalibDue, initials, plural, debounce, frError,
  todayISO,
} from "./utils.js";
import { compressPhoto, makeThumb, toBase64ForAI } from "./images.js";
import { icon, catIcon, CONTOUR_ART } from "./icons.js";
import { renderImport, renderPhotoBatch } from "./importer.js";
import { exportInventory, downloadBlob } from "./transfert.js";

const VERSION = "1.3.0";
const app = document.getElementById("app");
const dock = document.getElementById("dock");

const S = {
  be: null,
  user: null,
  profiles: {},
  items: [],
  byId: new Map(),
  loaded: false,
  filters: { q: "", site: "", etat: "", cat: "", tile: "" },
  live: "connecting",
  nav: 0,
  form: null,
  installPrompt: null,
  unsub: null,
  prev: "",
  listY: 0,
};

/* ================================================================== */
/*  Outils généraux                                                    */
/* ================================================================== */
function toast(msg, type = "ok", ms = 3200) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "err" ? "alert" : "status");
  el.innerHTML = `${icon(type === "err" ? "alert" : type === "info" ? "info" : "checkCircle")}<span></span>`;
  el.querySelector("span").textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, ms);
}

function go(hash, { replace = false } = {}) {
  if (replace) location.replace(hash);
  else { S.nav++; location.hash = hash; }
}
function back(fallback = "#/") {
  if (S.nav > 0) { S.nav--; history.back(); } else go(fallback, { replace: true });
}

const myName = () => (S.user && (S.profiles[S.user.id] || (S.user.email || "").split("@")[0])) || "";
const nameOf = (id) => (id && S.profiles[id]) || (id && S.user && id === S.user.id ? "Vous" : id ? "Un membre de l'équipe" : "—");
const safeImg = (src) => (typeof src === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(src) ? src : "");

// Valeurs saisies librement avec l'option « Autre » (catégorie, site), triées
function customValues(field, std) {
  const set = new Set();
  for (const it of S.items) if (it[field] && !std.includes(it[field])) set.add(it[field]);
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}
const customCategories = () => customValues("categorie", CATEGORIES);
const customSites = () => customValues("site", SITES);
// Liste complète pour les filtres : valeurs standard, valeurs libres, puis « Autre »
const optionsFor = (field, std) => [...std.filter((c) => c !== "Autre"), ...customValues(field, std), "Autre"];
// Nettoie une valeur saisie : reprend l'orthographe d'une valeur existante si elle correspond
function cleanFree(text, field, std) {
  const s = String(text || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!s) return "";
  const known = [...std, ...customValues(field, std)].find((c) => keyOf(c) === keyOf(s));
  if (known) return known;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function setItems(list) {
  S.items = list.slice().sort((a, b) => String(b.modifie_le).localeCompare(String(a.modifie_le)));
  S.byId = new Map(S.items.map((i) => [i.id, i]));
}
function upsertLocal(row) {
  const others = S.items.filter((i) => i.id !== row.id);
  setItems([row, ...others]);
}
function removeLocal(id) { setItems(S.items.filter((i) => i.id !== id)); }

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [a, b] = h.split("/");
  const id = b ? decodeURIComponent(b) : "";
  if (a === "fiche" && id) return { name: "detail", id };
  if (a === "nouveau") return { name: "form" };
  if (a === "modifier" && id) return { name: "form", id };
  if (a === "outils") return { name: "tools" };
  if (a === "import") return { name: "import" };
  if (a === "photos") return { name: "photos" };
  return { name: "list" };
}

function renderDock(active) {
  const show = active === "list" || active === "tools";
  dock.hidden = !show;
  if (!show) return;
  dock.innerHTML = `
    <a href="#/" ${active === "list" ? 'aria-current="page"' : ""}>${icon("grid")}<span>Inventaire</span></a>
    <a href="#/nouveau" class="dock-add" data-nav>${icon("plus")}<span>Ajouter</span></a>
    <a href="#/outils" ${active === "tools" ? 'aria-current="page"' : ""}>${icon("sliders")}<span>Outils</span></a>`;
}
dock.addEventListener("click", (e) => { if (e.target.closest("a")) S.nav++; });

/* ================================================================== */
/*  Rendu principal                                                    */
/* ================================================================== */
function render() {
  if (S.be.mode === "supabase" && !S.user) { dock.hidden = true; return viewLogin(); }
  if (!S.loaded) return;
  const r = route();
  if (S.form && !(r.name === "form")) cleanupForm();
  if (S.prev === "list" && r.name !== "list") S.listY = window.scrollY;
  const restore = r.name === "list" && S.prev && S.prev !== "list" ? S.listY || 0 : 0;
  S.prev = r.name;
  window.scrollTo(0, 0);
  if (restore) requestAnimationFrame(() => window.scrollTo(0, restore));
  renderDock(r.name);
  if (r.name === "detail") return viewDetail(r.id);
  if (r.name === "form") return viewForm(r.id);
  if (r.name === "tools") return viewTools();
  if (r.name === "import") {
    return renderImport({
      app, be: S.be, items: () => S.items, toast, icon, back: () => back("#/outils"),
      onImported: (rows) => { for (const r of rows) upsertLocal(r); },
      showToCheck: () => { S.filters = { q: "", site: "", etat: "", cat: "", tile: "check" }; S.listY = 0; go("#/", { replace: true }); },
    });
  }
  if (r.name === "photos") {
    return renderPhotoBatch({
      app, be: S.be, items: () => S.items, toast, icon, back: () => back("#/outils"),
      onImported: (rows) => { for (const r of rows) upsertLocal(r); },
      home: () => { S.listY = 0; go("#/", { replace: true }); },
    });
  }
  return viewList();
}
window.addEventListener("hashchange", render);

/* ================================================================== */
/*  Connexion                                                          */
/* ================================================================== */
function viewLogin() {
  app.innerHTML = `
  <main class="login view">
    <div class="login-inner">
      <div class="brand"><img src="icon.svg" alt="" width="34" height="34"><div>GéoConsulting<small>Génie civil · Géotechnique</small></div></div>
      <h1 class="display">Inventaire <em>du matériel</em></h1>
      <p class="login-lead">Le registre partagé des équipements du laboratoire de Niamey et de l'antenne de Doutchi.</p>
      <form class="login-card" id="login" novalidate>
        <div class="field">
          <label class="label" for="email">Adresse email</label>
          <input class="input" id="email" type="email" autocomplete="username" inputmode="email" placeholder="prenom@geoconsulting.ne" required>
        </div>
        <div class="field">
          <label class="label" for="pw">Mot de passe</label>
          <div class="pw">
            <input class="input" id="pw" type="password" autocomplete="current-password" placeholder="Votre mot de passe" required>
            <button type="button" id="pw-eye" aria-label="Afficher le mot de passe">${icon("eye")}</button>
          </div>
        </div>
        <div class="form-error" id="login-err" hidden></div>
        <button class="btn btn-primary btn-block" style="margin-top:18px" id="login-btn">Se connecter ${icon("arrow")}</button>
      </form>
    </div>
    <p class="login-foot">Mot de passe oublié ? Demandez à l'administrateur de le réinitialiser dans Supabase.</p>
  </main>`;
  const f = document.getElementById("login");
  const err = document.getElementById("login-err");
  document.getElementById("pw-eye").onclick = (e) => {
    const pw = document.getElementById("pw");
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    e.currentTarget.innerHTML = icon(show ? "eyeOff" : "eye");
    e.currentTarget.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const pw = document.getElementById("pw").value;
    err.hidden = true;
    if (!email || !pw) { err.textContent = "Saisissez votre email et votre mot de passe."; err.hidden = false; return; }
    const btn = document.getElementById("login-btn");
    btn.classList.add("is-busy");
    try {
      S.user = await S.be.signIn(email, pw);
      await afterLogin();
    } catch (ex) {
      err.textContent = frError(ex); err.hidden = false;
      btn.classList.remove("is-busy");
    }
  };
}

/* ================================================================== */
/*  Liste et tableau de bord                                           */
/* ================================================================== */
function counts() {
  const c = { total: S.items.length, units: 0, check: 0, broken: 0, calib: 0, ok: 0, warn: 0, info: 0, bad: 0, sites: new Set() };
  for (const it of S.items) {
    c.units += Number(it.quantite) || 1;
    if (isToCheck(it)) c.check++;
    if (isBroken(it)) c.broken++;
    if (isCalibDue(it)) c.calib++;
    c[etatClass(it.etat)]++;
    if (it.site) c.sites.add(it.site);
  }
  return c;
}

function filtered() {
  const { q, site, etat, cat, tile } = S.filters;
  const words = norm(q).split(/\s+/).filter(Boolean);
  return S.items.filter((it) => {
    if (site && it.site !== site) return false;
    if (etat && it.etat !== etat) return false;
    if (cat && it.categorie !== cat) return false;
    if (tile === "check" && !isToCheck(it)) return false;
    if (tile === "broken" && !isBroken(it)) return false;
    if (tile === "calib" && !isCalibDue(it)) return false;
    if (words.length) {
      const hay = norm([it.id, it.designation, it.marque, it.modele, it.numero_serie, it.categorie, it.emplacement, it.remarques, it.site, it.accessoires].join(" "));
      return words.every((w) => hay.includes(w));
    }
    return true;
  });
}

function liveHTML() {
  if (S.be.mode === "demo") return `<span class="live demo" id="live"><i></i>Mode démo</span>`;
  const on = S.live === "on";
  return `<span class="live ${on ? "on" : ""}" id="live"><i></i>${on ? "En direct" : S.live === "off" ? "Hors ligne" : "Connexion…"}</span>`;
}

function viewList() {
  const d = new Date();
  const date = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const hello = d.getHours() >= 18 ? "Bonsoir" : "Bonjour";
  const first = (myName().split(/[\s._-]+/)[0] || "").replace(/^./, (c) => c.toUpperCase());
  app.innerHTML = `
  <div class="view">
    <header class="hero">
      <div class="wrap">
        <div class="hero-bar">
          <div class="brand"><img src="icon.svg" alt="" width="34" height="34"><div>GéoConsulting<small>Laboratoire · Niamey</small></div></div>
          <div class="hero-right">${liveHTML()}<a class="avatar" href="#/outils" data-nav aria-label="Compte et outils">${myName() ? esc(initials(myName())) : icon("user")}</a></div>
        </div>
        <div class="hero-head">
          <p class="eyebrow">${esc(date)}</p>
          <h1 class="display">Inventaire <em>du matériel</em></h1>
          <p class="hero-sub" id="hero-sub" data-hello="${esc(hello)}${first ? " " + esc(first) : ""}">${esc(hello)}${first ? " " + esc(first) : ""}.</p>
        </div>
        <div class="kpis" id="kpis" role="group" aria-label="Filtres rapides"></div>
        <div class="spread" id="spread"></div>
      </div>
    </header>
    <div class="wrap">
      <div class="toolbar" id="toolbar">
        <div class="search" role="search">
          ${icon("search")}
          <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Nom, marque, n° de série, GC-…" aria-label="Rechercher dans l'inventaire" value="${esc(S.filters.q)}">
          <button class="clear" id="q-clear" aria-label="Effacer la recherche" ${S.filters.q ? "" : "hidden"}>${icon("x")}</button>
        </div>
        <div class="chips" id="chips"></div>
      </div>
      <div id="results"></div>
    </div>
  </div>`;

  const q = document.getElementById("q");
  const clear = document.getElementById("q-clear");
  const onQ = debounce(() => { S.filters.q = q.value; refreshResults(); refreshChips(); }, 140);
  q.addEventListener("input", () => { clear.hidden = !q.value; onQ(); });
  clear.onclick = () => { q.value = ""; clear.hidden = true; S.filters.q = ""; refreshResults(); refreshChips(); q.focus(); };

  app.onclick = (e) => {
    const k = e.target.closest("[data-tile]");
    if (k) {
      const t = k.dataset.tile;
      S.filters.tile = S.filters.tile === t ? "" : t;
      refreshList();
      document.getElementById("toolbar").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (e.target.closest("[data-reset]")) {
      S.filters = { q: "", site: "", etat: "", cat: "", tile: "" };
      q.value = ""; clear.hidden = true;
      refreshList();
      return;
    }
    if (e.target.closest("a[href^='#/']")) S.nav++;
  };
  app.onchange = (e) => {
    const s = e.target.closest("select[data-filter]");
    if (s) { S.filters[s.dataset.filter] = s.value; refreshList(); }
  };
  app.oninput = null;
  refreshList();
}

function refreshList() {
  if (route().name !== "list" || !document.getElementById("kpis")) return;
  const c = counts();
  const sub = document.getElementById("hero-sub");
  sub.innerHTML = `${esc(sub.dataset.hello)}. ${c.total ? `<b>${plural(c.total, "équipement", "équipements")}</b> suivis sur ${plural(c.sites.size || 0, "site", "sites")}.` : "L'inventaire est vide pour le moment."}`;

  const t = S.filters.tile;
  const tile = (key, tone, ic, label, val, note) => `
    <button class="kpi" data-tile="${key}" data-tone="${tone}" aria-pressed="${t === key}">
      <span class="kpi-label">${icon(ic)}${label}</span>
      <span class="kpi-value num">${val}</span>
      <span class="kpi-note">${note}</span>
    </button>`;
  document.getElementById("kpis").innerHTML =
    tile("", "all", "box", "Total", c.total, plural(c.units, "unité", "unités")) +
    tile("check", "warn", "flag", "À vérifier", c.check, "à confirmer sur place") +
    tile("broken", "bad", "wrench", "Panne · réparation", c.broken, "hors service") +
    tile("calib", "cal", "calendar", "Étalonnages", c.calib, "échus ou sous 30 jours");

  const sp = document.getElementById("spread");
  if (!c.total) sp.innerHTML = "";
  else {
    sp.innerHTML = `
      <div class="spread-bar" role="img" aria-label="Répartition par état : ${c.ok} fonctionnels, ${c.warn} à vérifier, ${c.info} en réparation, ${c.bad} en panne">
        ${c.ok ? `<span class="s-ok" style="flex-grow:${c.ok}"></span>` : ""}
        ${c.warn ? `<span class="s-warn" style="flex-grow:${c.warn}"></span>` : ""}
        ${c.info ? `<span class="s-info" style="flex-grow:${c.info}"></span>` : ""}
        ${c.bad ? `<span class="s-bad" style="flex-grow:${c.bad}"></span>` : ""}
      </div>
      <div class="spread-legend">
        <span><i class="s-ok"></i>Fonctionnel ${c.ok}</span><span><i class="s-warn"></i>À vérifier ${c.warn}</span>
        <span><i class="s-info"></i>En réparation ${c.info}</span><span><i class="s-bad"></i>En panne ${c.bad}</span>
      </div>`;
  }
  refreshChips();
  refreshResults();
}

function refreshChips() {
  const el = document.getElementById("chips");
  if (!el) return;
  const f = S.filters;
  const chip = (key, ic, value, all, options) => `
    <span class="chip ${value ? "on" : ""}">${icon(ic)}<span>${esc(value || all)}</span>${icon("down")}
      <select data-filter="${key}" aria-label="${esc(all)}">
        <option value="">${esc(all)}</option>
        ${options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
    </span>`;
  const any = f.q || f.site || f.etat || f.cat || f.tile;
  el.innerHTML =
    chip("site", "pin", f.site, "Tous les sites", optionsFor("site", SITES)) +
    chip("etat", "checkCircle", f.etat, "Tous les états", ETATS.map((e) => e.v)) +
    chip("cat", "layers", f.cat, "Toutes catégories", optionsFor("categorie", CATEGORIES)) +
    (any ? `<button class="chip chip-reset" data-reset>${icon("x")}Effacer</button>` : "");
}

function itemHTML(it, n) {
  const img = safeImg(it.miniature);
  const cal = calibration(it);
  const sub = [it.marque, it.modele].filter(Boolean).join(" · ") || it.categorie || "Sans marque ni modèle";
  const qty = Number(it.quantite) > 1 ? `<span class="qty">×${Number(it.quantite)}</span>` : "";
  return `
  <a class="item" href="#/fiche/${encodeURIComponent(it.id)}" style="--n:${Math.min(n, 16)}">
    <div class="thumb">${img ? `<img src="${img}" alt="" loading="lazy" decoding="async">` : catIcon(it.categorie)}${qty}</div>
    <div class="item-main">
      <h3 class="item-title">${esc(it.designation)}</h3>
      <p class="item-sub">${esc(sub)}</p>
      <div class="item-tags">
        <span class="pill ${etatClass(it.etat)}">${esc(it.etat)}</span>
        ${it.a_confirmer ? `<span class="pill flag">${icon("flag")}À confirmer</span>` : ""}
        ${cal && cal.level !== "ok" ? `<span class="pill ${cal.level}">${esc(cal.short)}</span>` : ""}
      </div>
      <div class="item-foot">
        <span class="meta-site">${icon("pin")}${esc(it.site || "Site non renseigné")}</span>
        <span class="code">${esc(it.id)}</span>
      </div>
    </div>
  </a>`;
}

function refreshResults() {
  const el = document.getElementById("results");
  if (!el) return;
  if (!S.items.length) {
    el.innerHTML = `
      <div class="empty">
        ${CONTOUR_ART}
        <h2>Votre inventaire<br>commence ici</h2>
        <p>Photographiez un premier appareil, ou reprenez l'ancien fichier Excel du laboratoire.</p>
        <div class="actions">
          <a class="btn btn-primary" href="#/nouveau">${icon("camera")}Ajouter un équipement</a>
          <a class="btn btn-ghost" href="#/import">${icon("sheet")}Importer un fichier</a>
        </div>
      </div>`;
    return;
  }
  const list = filtered();
  if (!list.length) {
    el.innerHTML = `
      <div class="empty">
        ${CONTOUR_ART}
        <h2>Aucun résultat</h2>
        <p>Aucun équipement ne correspond à ces critères.</p>
        <div class="actions"><button class="btn btn-ghost" data-reset>${icon("x")}Effacer les filtres</button></div>
      </div>`;
    return;
  }
  const labels = { check: "À vérifier", broken: "Panne · réparation", calib: "Étalonnages à prévoir" };
  el.innerHTML = `
    <div class="results-head"><h2>${esc(labels[S.filters.tile] || "Équipements")} · ${list.length}</h2><span>Dernières modifications en premier</span></div>
    <div class="list">${list.map(itemHTML).join("")}</div>`;
}

/* ================================================================== */
/*  Fiche détaillée                                                    */
/* ================================================================== */
function notFound() {
  app.onclick = null;
  app.innerHTML = `
    <div class="view">
      <header class="topbar"><button class="icon-btn" id="bk" aria-label="Retour">${icon("back")}</button><h1>Fiche introuvable</h1><span></span></header>
      <div class="empty">${CONTOUR_ART}<h2>Fiche introuvable</h2><p>Elle a peut-être été supprimée par un autre membre de l'équipe.</p>
      <div class="actions"><a class="btn btn-primary" href="#/">Retour à l'inventaire</a></div></div>
    </div>`;
  document.getElementById("bk").onclick = () => back();
}

function viewDetail(id) {
  const it = S.byId.get(id);
  if (!it) return notFound();
  const cal = calibration(it);
  const slots = SLOTS.filter((s) => it.photos && it.photos[s.k]);
  const row = (label, v, mono = false) => `<dt>${label}</dt><dd class="${v ? "" : "muted"} ${mono && v ? "mono" : ""}">${v ? esc(v) : "—"}</dd>`;

  let calHTML = `<p class="hint">Aucune date d'étalonnage renseignée.</p>`;
  if (it.etalonnage_prochain || it.etalonnage_dernier) {
    let track = "";
    if (cal && it.etalonnage_dernier) {
      const a = parseISODate(it.etalonnage_dernier), b = parseISODate(it.etalonnage_prochain);
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const p = b - a > 0 ? Math.max(0, Math.min(1, (t - a) / (b - a))) : 1;
      track = `<div class="track ${cal.level}"><span style="width:${(p * 100).toFixed(1)}%"></span><b style="left:${(p * 100).toFixed(1)}%"></b></div>`;
    }
    calHTML = `
      <div class="calib">
        <div class="calib-top">
          <span class="calib-big ${cal ? cal.level : ""}">${cal ? esc(cal.long) : "Non planifié"}</span>
          ${cal ? `<span class="pill ${cal.level}">${cal.level === "ok" ? "À jour" : cal.level === "warn" ? "Bientôt" : "Échu"}</span>` : ""}
        </div>
        ${track}
        <div class="calib-dates">
          <span>Dernier<b>${esc(fmtDate(it.etalonnage_dernier))}</b></span>
          <span style="text-align:right">Prochain<b>${esc(fmtDate(it.etalonnage_prochain))}</b></span>
        </div>
      </div>`;
  }

  app.innerHTML = `
  <div class="view view--push page-pad">
    <div class="gallery-wrap">
      <div class="gallery" id="gallery">
        ${slots.length ? slots.map((s) => `<div class="slide" data-path="${esc(it.photos[s.k])}"><span class="loading"></span><span class="slide-label">${s.label}</span></div>`).join("")
          : `<div class="slide placeholder"><div class="ph">${catIcon(it.categorie)}<span>Aucune photo pour cette fiche</span></div></div>`}
      </div>
      <div class="gallery-top">
        <button class="icon-btn glass" id="bk" aria-label="Retour à l'inventaire">${icon("back")}</button>
        <a class="icon-btn glass" href="#/modifier/${encodeURIComponent(it.id)}" data-nav aria-label="Modifier la fiche">${icon("edit")}</a>
      </div>
      ${slots.length > 1 ? `<div class="dots" id="dots">${slots.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}
    </div>

    <div class="wrap-narrow">
      <div class="detail-head">
        <p class="eyebrow">${esc(it.categorie || "Sans catégorie")}</p>
        <h1>${esc(it.designation)}</h1>
        ${[it.marque, it.modele].filter(Boolean).length ? `<p class="sub">${esc([it.marque, it.modele].filter(Boolean).join(" · "))}</p>` : ""}
        <div class="detail-tags">
          <button class="id-chip" id="copy-id" aria-label="Copier l'identifiant ${esc(it.id)}">${esc(it.id)}${icon("copy")}</button>
          <span class="pill lg ${etatClass(it.etat)}">${esc(it.etat)}</span>
          ${Number(it.quantite) > 1 ? `<span class="pill lg flag">Quantité ×${Number(it.quantite)}</span>` : ""}
        </div>
      </div>

      ${it.a_confirmer ? `
      <div class="callout">
        ${icon("flag")}
        <div><b>Fiche à confirmer</b><p>Vérifiez ces informations devant l'appareil, puis validez.</p>
        <button class="btn btn-sm btn-dark" id="confirm-ok">${icon("check")}Marquer comme vérifiée</button></div>
      </div>` : ""}

      <div class="stack" style="margin-top:18px">
        <section class="card">
          <h2 class="card-title">${icon("hash")}Identification</h2>
          <dl class="dl">
            ${row("Marque", it.marque)}${row("Modèle", it.modele)}${row("N° de série", it.numero_serie, true)}
            ${row("Quantité", String(Number(it.quantite) || 1))}${row("Accessoires", it.accessoires)}
          </dl>
        </section>
        <section class="card">
          <h2 class="card-title">${icon("pin")}Emplacement</h2>
          <dl class="dl">${row("Site", it.site)}${row("Emplacement", it.emplacement)}</dl>
        </section>
        <section class="card">
          <h2 class="card-title">${icon("calendar")}Étalonnage</h2>
          ${calHTML}
        </section>
        ${it.remarques ? `<section class="card"><h2 class="card-title">${icon("info")}Remarques</h2><p class="notes">${esc(it.remarques)}</p></section>` : ""}
        <p class="foot-meta">
          Enregistrée par <b>${esc(nameOf(it.cree_par))}</b> le ${esc(fmtDateTime(it.cree_le))}<br>
          Modifiée par <b>${esc(nameOf(it.modifie_par))}</b> ${esc(relTime(it.modifie_le))}
          ${it.origine ? `<br>Origine : ${esc(it.origine)}` : ""}
        </p>
      </div>
    </div>

    <div class="actionbar"><div class="actionbar-in">
      <button class="btn btn-danger" id="del">${icon("trash")}<span>Supprimer</span></button>
      <a class="btn btn-primary" href="#/modifier/${encodeURIComponent(it.id)}" data-nav>${icon("edit")}Modifier la fiche</a>
    </div></div>
  </div>`;

  document.getElementById("bk").onclick = () => back();
  app.onclick = (e) => { if (e.target.closest("[data-nav]")) S.nav++; };
  app.onchange = null; app.oninput = null;

  document.getElementById("copy-id").onclick = async () => {
    try { await navigator.clipboard.writeText(it.id); toast("Identifiant copié"); }
    catch (e) { toast(it.id, "info"); }
  };

  const ok = document.getElementById("confirm-ok");
  if (ok) ok.onclick = async () => {
    ok.classList.add("is-busy");
    try {
      const row = await S.be.updateItem(it.id, { a_confirmer: false, etat: it.etat === "À vérifier" ? "Fonctionnel" : it.etat });
      upsertLocal(row); toast("Fiche vérifiée"); viewDetail(it.id);
    } catch (ex) { ok.classList.remove("is-busy"); toast(frError(ex), "err", 5000); }
  };

  // Suppression en deux temps, sans boîte de dialogue
  const del = document.getElementById("del");
  let armed = null;
  del.onclick = async () => {
    if (!armed) {
      del.classList.add("is-armed");
      del.querySelector("span").textContent = "Confirmer la suppression";
      armed = setTimeout(() => { armed = null; del.classList.remove("is-armed"); del.querySelector("span").textContent = "Supprimer"; }, 4000);
      return;
    }
    clearTimeout(armed);
    del.classList.add("is-busy");
    try {
      await S.be.deleteItem(it.id);
      S.be.removePhotos(Object.values(it.photos || {})).catch(() => {});
      removeLocal(it.id);
      toast("Fiche supprimée");
      go("#/", { replace: true });
    } catch (ex) { del.classList.remove("is-busy"); toast(frError(ex), "err", 5000); }
  };

  // Photos : chargées à la demande
  if (slots.length) {
    S.be.photoUrls(slots.map((s) => it.photos[s.k])).then((map) => {
      document.querySelectorAll("#gallery .slide[data-path]").forEach((sl) => {
        const url = map[sl.dataset.path];
        const ld = sl.querySelector(".loading");
        if (!url) { if (ld) ld.outerHTML = `<div class="ph" style="color:#fff;opacity:.7">${icon("image")}</div>`; return; }
        const img = new Image();
        img.alt = sl.querySelector(".slide-label")?.textContent || "Photo";
        img.onload = () => ld && ld.remove();
        img.src = url;
        sl.prepend(img);
      });
    }).catch(() => toast("Impossible de charger les photos.", "err"));
    const g = document.getElementById("gallery"), dots = document.getElementById("dots");
    if (dots) g.addEventListener("scroll", debounce(() => {
      const i = Math.round(g.scrollLeft / g.clientWidth);
      dots.querySelectorAll("i").forEach((d, k) => d.classList.toggle("on", k === i));
    }, 40), { passive: true });
  }
}

/* ================================================================== */
/*  Formulaire (création et modification)                              */
/* ================================================================== */
function cleanupForm() {
  if (!S.form) return;
  for (const s of Object.values(S.form.photos)) if (s.local) URL.revokeObjectURL(s.local);
  S.form = null;
}

function viewForm(id) {
  const editing = id ? S.byId.get(id) : null;
  if (id && !editing) return notFound();
  cleanupForm();
  const d = editing ? { ...editing } : {
    id: newId(), designation: "", categorie: "", marque: "", modele: "", numero_serie: "", accessoires: "",
    etat: "Fonctionnel", quantite: 1, site: SITES[0], emplacement: "", etalonnage_dernier: "", etalonnage_prochain: "",
    remarques: "", a_confirmer: false, photos: {}, miniature: "",
  };
  S.form = {
    editing, id: d.id, dirty: false,
    photos: Object.fromEntries(SLOTS.map((s) => [s.k, { path: (d.photos || {})[s.k] || "", blob: null, local: "", remote: "", removed: false }])),
  };
  // Catégorie libre : une catégorie hors liste s'affiche sous « Autre »
  const catStd = CATEGORIES.includes(d.categorie);
  const catSel = !d.categorie ? "" : catStd ? d.categorie : "Autre";
  const catFree = d.categorie && !catStd ? d.categorie : "";
  // Site libre : un site hors liste s'affiche sous « Autre »
  const siteStd = SITES.includes(d.site);
  const siteSel = !d.site ? "" : siteStd ? d.site : "Autre";
  const siteFree = d.site && !siteStd ? d.site : "";

  const opt = (list, v) => list.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("");
  const fld = (name, label, value, attrs = "", req = false) => `
    <div class="field" data-f="${name}">
      <label class="label" for="f-${name}"><span>${label}${req ? ' <span class="req">*</span>' : ""}</span><span class="tag-sug">suggéré</span></label>
      <input class="input ${name === "numero_serie" ? "mono" : ""}" id="f-${name}" name="${name}" value="${esc(value ?? "")}" ${attrs}>
    </div>`;

  app.innerHTML = `
  <div class="view view--push page-pad">
    <header class="topbar">
      <button class="icon-btn" id="close" aria-label="Fermer sans enregistrer">${icon("x")}</button>
      <h1>${editing ? "Modifier la fiche" : "Nouvel équipement"}</h1>
      <span class="code">${esc(d.id)}</span>
    </header>
    <form class="wrap-narrow" id="form" novalidate style="padding-top:16px">

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">01</span><h2>Photos</h2><p>Appareil, plaque signalétique, autre vue</p></div>
        <div class="photos">
          ${SLOTS.map((s) => `
            <div class="pslot" data-slot="${s.k}">
              <input type="file" accept="image/*" capture="environment" id="ph-${s.k}" data-photo="${s.k}">
              <label for="ph-${s.k}"><span class="cam">${icon("camera")}</span>${s.label}</label>
              <span class="ptag" hidden>${s.label}</span>
              <button type="button" class="premove" data-remove="${s.k}" aria-label="Retirer la photo ${s.label}" hidden>${icon("x")}</button>
            </div>`).join("")}
        </div>
        <p class="hint" style="margin-top:10px">Touchez une case pour ouvrir l'appareil photo, ou
          <label for="ph-gallery" class="link" style="cursor:pointer">choisissez dans la galerie</label>.</p>
        <input type="file" accept="image/*" multiple id="ph-gallery" class="sr-only">
        ${S.be.aiEnabled ? `
        <button type="button" class="ai" id="ai">
          <span class="spark">${icon("sparkles")}</span>
          <span><b>Remplir depuis les photos</b><small>L'IA lit la plaque et propose marque, modèle, n° de série.</small></span>
          ${icon("chevron")}
        </button>` : ""}
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">02</span><h2>Identification</h2><p>Ce qui permet de reconnaître l'appareil</p></div>
        ${fld("designation", "Désignation", d.designation, 'autocomplete="off" placeholder="Balance électronique 30 kg" required', true)}
        <div class="field" data-f="categorie">
          <label class="label" for="f-categorie"><span>Catégorie</span><span class="tag-sug">suggéré</span></label>
          <select class="select" id="f-categorie" name="categorie"><option value="">Choisir une catégorie</option>${opt(CATEGORIES, catSel)}</select>
        </div>
        <div class="field cat-free" id="cat-free" ${catSel === "Autre" ? "" : "hidden"}>
          <label class="label" for="f-categorie_libre"><span>Précisez la catégorie</span><span class="hint">facultatif</span></label>
          <input class="input" id="f-categorie_libre" name="categorie_libre" value="${esc(catFree)}" list="cat-list" autocomplete="off" maxlength="60" placeholder="Ex. : Matériel de forage">
          <datalist id="cat-list">${customCategories().map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
          <span class="hint">Laissée vide, la fiche reste dans « Autre ». Les catégories déjà saisies sont proposées.</span>
        </div>
        <div class="row2" style="margin-top:14px">
          ${fld("marque", "Marque", d.marque, 'autocomplete="off" placeholder="Controls"')}
          ${fld("modele", "Modèle", d.modele, 'autocomplete="off" placeholder="C0000"')}
        </div>
        ${fld("numero_serie", "N° de série", d.numero_serie, 'autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Tel qu\'écrit sur la plaque"')}
        <div class="field" data-f="accessoires">
          <label class="label" for="f-accessoires"><span>Accessoires · contenu du kit</span></label>
          <textarea class="textarea" id="f-accessoires" name="accessoires" rows="2" placeholder="Câble, étui, poids de contrôle…">${esc(d.accessoires)}</textarea>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">03</span><h2>État et emplacement</h2><p>Où il se trouve et dans quel état</p></div>
        <div class="field">
          <span class="label">État</span>
          <div class="seg" role="radiogroup" aria-label="État">
            ${ETATS.map((e, i) => `<div class="${e.cls}"><input type="radio" name="etat" id="etat-${i}" value="${e.v}" ${e.v === d.etat ? "checked" : ""}><label for="etat-${i}">${e.v}</label></div>`).join("")}
          </div>
        </div>
        <div class="field">
          <label class="label" for="f-quantite">Quantité</label>
          <div class="stepper">
            <button type="button" data-step="-1" aria-label="Diminuer">${icon("minus")}</button>
            <input id="f-quantite" name="quantite" type="number" inputmode="numeric" min="1" step="1" value="${Number(d.quantite) || 1}">
            <button type="button" data-step="1" aria-label="Augmenter">${icon("plus")}</button>
          </div>
        </div>
        <div class="field">
          <span class="label">Site</span>
          <div class="choice" role="radiogroup" aria-label="Site">
            ${SITES.map((s, i) => `<span><input type="radio" name="site" id="site-${i}" value="${esc(s)}" ${s === siteSel ? "checked" : ""}><label for="site-${i}">${esc(s)}</label></span>`).join("")}
          </div>
        </div>
        <div class="field cat-free" id="site-free" ${siteSel === "Autre" ? "" : "hidden"}>
          <label class="label" for="f-site_libre"><span>Précisez le site</span><span class="hint">facultatif</span></label>
          <input class="input" id="f-site_libre" name="site_libre" value="${esc(siteFree)}" list="site-list" autocomplete="off" maxlength="60" placeholder="Ex. : Antenne d'Agadez">
          <datalist id="site-list">${customSites().map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
          <span class="hint">Laissé vide, le site reste « Autre ». Les sites déjà saisis sont proposés.</span>
        </div>
        ${fld("emplacement", "Emplacement précis", d.emplacement, 'autocomplete="off" placeholder="Salle des essais, armoire 2…"')}
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">04</span><h2>Étalonnage</h2><p>Laissez vide si l'appareil n'en demande pas</p></div>
        <div class="row2 wrap-sm">
          <div class="field"><label class="label" for="f-etalonnage_dernier">Dernier</label><input class="input" type="date" id="f-etalonnage_dernier" name="etalonnage_dernier" value="${esc(d.etalonnage_dernier || "")}"></div>
          <div class="field"><label class="label" for="f-etalonnage_prochain">Prochain</label><input class="input" type="date" id="f-etalonnage_prochain" name="etalonnage_prochain" value="${esc(d.etalonnage_prochain || "")}"></div>
        </div>
      </section>

      <section class="fsec">
        <div class="fsec-head"><span class="fsec-num">05</span><h2>Remarques</h2><p>Tout ce qu'il faut savoir en plus</p></div>
        <div class="field" data-f="remarques">
          <label class="label" for="f-remarques"><span>Remarques</span><span class="tag-sug">suggéré</span></label>
          <textarea class="textarea" id="f-remarques" name="remarques" rows="3" placeholder="Pièce manquante, historique, prêt…">${esc(d.remarques)}</textarea>
        </div>
        <label class="switch-row" for="f-a_confirmer">
          <span><b>Fiche à confirmer plus tard</b><small>Elle apparaîtra dans « À vérifier ».</small></span>
          <span class="switch"><input type="checkbox" id="f-a_confirmer" name="a_confirmer" ${d.a_confirmer ? "checked" : ""}><span></span></span>
        </label>
        <div class="form-error" id="form-err" hidden></div>
      </section>
    </form>

    <div class="actionbar"><div class="actionbar-in">
      <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
      <button type="button" class="btn btn-primary" id="save">${icon("check")}Enregistrer la fiche</button>
    </div></div>
  </div>`;

  const form = document.getElementById("form");
  const markDirty = () => { if (S.form) S.form.dirty = true; };
  app.oninput = (e) => {
    markDirty();
    const f = e.target.closest(".field");
    if (f) { f.classList.remove("suggested", "invalid"); f.querySelector(".field-error")?.remove(); }
  };
  app.onchange = async (e) => {
    const inp = e.target;
    if (inp.id === "f-categorie") { syncCategoryFree(true); markDirty(); }
    else if (inp.name === "site") { syncSiteFree(true); markDirty(); }
    else if (inp.dataset.photo && inp.files?.[0]) { await setPhoto(inp.dataset.photo, inp.files[0]); inp.value = ""; }
    else if (inp.id === "ph-gallery" && inp.files?.length) {
      const free = SLOTS.map((s) => s.k).filter((k) => !hasPhoto(k));
      const files = Array.from(inp.files).slice(0, free.length || 0);
      if (!free.length) toast("Les trois cases photo sont déjà remplies. Retirez-en une d'abord.", "info");
      for (let i = 0; i < files.length; i++) await setPhoto(free[i], files[i]);
      inp.value = "";
    } else markDirty();
  };
  app.onclick = (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      const st = S.form.photos[rm.dataset.remove];
      if (st.local) URL.revokeObjectURL(st.local);
      Object.assign(st, { blob: null, local: "", remote: "", removed: !!st.path });
      paintSlot(rm.dataset.remove); markDirty();
      return;
    }
    const step = e.target.closest("[data-step]");
    if (step) {
      const q = document.getElementById("f-quantite");
      q.value = Math.max(1, (parseInt(q.value, 10) || 1) + Number(step.dataset.step));
      markDirty();
    }
  };

  // Fermer : double pression si des modifications ne sont pas enregistrées
  const leave = (btn) => {
    if (S.form?.dirty && !btn.dataset.armed) {
      btn.dataset.armed = "1";
      toast("Modifications non enregistrées. Touchez encore pour quitter.", "info", 3000);
      setTimeout(() => delete btn.dataset.armed, 3000);
      return;
    }
    back(editing ? `#/fiche/${encodeURIComponent(editing.id)}` : "#/");
  };
  document.getElementById("close").onclick = (e) => leave(e.currentTarget);
  document.getElementById("cancel").onclick = (e) => leave(e.currentTarget);
  document.getElementById("save").onclick = saveForm;
  form.onsubmit = (e) => { e.preventDefault(); saveForm(); };
  const ai = document.getElementById("ai");
  if (ai) ai.onclick = suggestFromPhotos;

  // Photos déjà enregistrées
  const paths = Object.values(S.form.photos).map((p) => p.path).filter(Boolean);
  SLOTS.forEach((s) => paintSlot(s.k));
  if (paths.length) {
    const formRef = S.form;
    S.be.photoUrls(paths).then((map) => {
      if (S.form !== formRef) return;
      for (const s of SLOTS) {
        const st = S.form.photos[s.k];
        if (st.path && !st.removed && !st.blob) { st.remote = map[st.path] || ""; paintSlot(s.k); }
      }
    }).catch(() => {});
  }
}

// Affiche le champ de saisie libre seulement quand « Autre » est choisi
function syncCategoryFree(focus = false) {
  const sel = document.getElementById("f-categorie");
  const box = document.getElementById("cat-free");
  if (!sel || !box) return;
  const show = sel.value === "Autre";
  const wasHidden = box.hidden;
  box.hidden = !show;
  if (show && wasHidden && focus) document.getElementById("f-categorie_libre").focus();
}

// Même principe pour le site : champ libre quand « Autre » est coché
function syncSiteFree(focus = false) {
  const box = document.getElementById("site-free");
  if (!box) return;
  const show = document.querySelector('#form input[name="site"]:checked')?.value === "Autre";
  const wasHidden = box.hidden;
  box.hidden = !show;
  if (show && wasHidden && focus) document.getElementById("f-site_libre").focus();
}

const hasPhoto = (k) => { const st = S.form?.photos[k]; return !!st && (!!st.blob || (!!st.path && !st.removed)); };

function paintSlot(k) {
  const el = document.querySelector(`.pslot[data-slot="${k}"]`);
  if (!el) return;
  const st = S.form.photos[k];
  const src = st.local || (!st.removed && st.remote) || "";
  const filled = hasPhoto(k);
  el.classList.toggle("filled", filled);
  let img = el.querySelector("img");
  if (src) {
    if (!img) { img = document.createElement("img"); img.alt = ""; el.insertBefore(img, el.querySelector(".ptag")); }
    img.src = src;
  } else if (img) img.remove();
  el.querySelector(".ptag").hidden = !filled;
  el.querySelector(".premove").hidden = !filled;
  el.querySelector("label").setAttribute("aria-label", filled ? `Remplacer la photo ${SLOTS.find((s) => s.k === k).label}` : SLOTS.find((s) => s.k === k).label);
}

async function setPhoto(k, file) {
  const el = document.querySelector(`.pslot[data-slot="${k}"]`);
  el?.classList.add("busy");
  try {
    const blob = await compressPhoto(file);
    const st = S.form.photos[k];
    if (st.local) URL.revokeObjectURL(st.local);
    Object.assign(st, { blob, local: URL.createObjectURL(blob), removed: !!st.path });
    S.form.dirty = true;
    paintSlot(k);
  } catch (ex) {
    toast(ex.message || "Photo illisible. Essayez de la reprendre.", "err", 4500);
  } finally { el?.classList.remove("busy"); }
}

async function slotBlob(k) {
  const st = S.form.photos[k];
  if (st.blob) return st.blob;
  if (st.path && !st.removed) {
    let url = st.remote;
    if (!url) url = (await S.be.photoUrls([st.path]))[st.path];
    if (url) { const r = await fetch(url); if (r.ok) return await r.blob(); }
  }
  return null;
}

function readForm() {
  const f = document.getElementById("form");
  const v = (n) => (f.elements[n]?.value ?? "").trim();
  const cat = v("categorie");
  return {
    designation: v("designation"),
    categorie: cat === "Autre" ? (cleanFree(v("categorie_libre"), "categorie", CATEGORIES) || "Autre") : cat,
    marque: v("marque"), modele: v("modele"),
    numero_serie: v("numero_serie"), accessoires: v("accessoires"),
    etat: f.querySelector('input[name="etat"]:checked')?.value || "À vérifier",
    quantite: Math.max(1, parseInt(v("quantite"), 10) || 1),
    site: (() => {
      const site = f.querySelector('input[name="site"]:checked')?.value || "";
      return site === "Autre" ? (cleanFree(v("site_libre"), "site", SITES) || "Autre") : site;
    })(),
    emplacement: v("emplacement"),
    etalonnage_dernier: v("etalonnage_dernier") || null,
    etalonnage_prochain: v("etalonnage_prochain") || null,
    remarques: v("remarques"),
    a_confirmer: f.elements.a_confirmer.checked,
  };
}

async function suggestFromPhotos() {
  const btn = document.getElementById("ai");
  const images = [];
  btn.classList.add("is-busy"); btn.disabled = true;
  try {
    for (const s of SLOTS) {
      const b = await slotBlob(s.k);
      if (b) images.push({ data: await toBase64ForAI(b), media_type: "image/jpeg" });
    }
    if (!images.length) { toast("Prenez au moins une photo, idéalement la plaque signalétique.", "info", 4000); return; }
    const r = await S.be.suggest(images);
    const map = { designation: "designation", categorie: "categorie", marque: "marque", modele: "modele", serie: "numero_serie", notes: "remarques" };
    let n = 0;
    for (const [src, dst] of Object.entries(map)) {
      const val = (r?.[src] || "").trim();
      const el = document.getElementById(`f-${dst}`);
      if (!val || !el || el.value.trim()) continue;
      if (el.tagName === "SELECT" && !CATEGORIES.includes(val)) continue;
      el.value = dst === "remarques" ? `Lu sur la plaque : ${val}` : val;
      el.closest(".field")?.classList.add("suggested");
      n++;
    }
    syncCategoryFree();
    if (n) {
      document.getElementById("f-a_confirmer").checked = true;
      S.form.dirty = true;
      toast(`${plural(n, "champ proposé", "champs proposés")}. Vérifiez les zones en bleu.`, "ok", 4500);
    } else toast("Rien de lisible à ajouter. Les champs déjà remplis ne sont pas modifiés.", "info", 4500);
  } catch (ex) {
    toast(ex?.message && !/fetch/i.test(ex.message) ? ex.message : frError(ex), "err", 5000);
  } finally { btn.classList.remove("is-busy"); btn.disabled = false; }
}

async function saveForm() {
  const btn = document.getElementById("save");
  const errBox = document.getElementById("form-err");
  errBox.hidden = true;
  const data = readForm();
  if (!data.designation) {
    const f = document.querySelector('[data-f="designation"]');
    f.classList.add("invalid");
    if (!f.querySelector(".field-error")) f.insertAdjacentHTML("beforeend", `<span class="field-error">Indiquez la désignation de l'appareil.</span>`);
    document.getElementById("f-designation").focus();
    f.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (data.etalonnage_dernier && data.etalonnage_prochain && data.etalonnage_prochain < data.etalonnage_dernier) {
    errBox.textContent = "La date du prochain étalonnage doit être après celle du dernier.";
    errBox.hidden = false; errBox.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!navigator.onLine && S.be.mode === "supabase") {
    errBox.textContent = "Pas de connexion Internet. La fiche n'a pas été enregistrée : réessayez une fois le réseau revenu.";
    errBox.hidden = false; return;
  }

  btn.classList.add("is-busy");
  const F = S.form;
  const editing = F.editing;
  try {
    let id = F.id;
    if (!editing) { for (let i = 0; i < 5 && (await S.be.exists(id)); i++) id = newId(); }

    const photos = { ...(editing?.photos || {}) };
    const toRemove = [];
    for (const s of SLOTS) {
      const st = F.photos[s.k];
      if (st.blob) {
        const path = `${id}/${s.k}-${Date.now()}.jpg`;
        await S.be.uploadPhoto(path, st.blob);
        if (photos[s.k]) toRemove.push(photos[s.k]);
        photos[s.k] = path;
      } else if (st.removed && photos[s.k]) {
        toRemove.push(photos[s.k]);
        delete photos[s.k];
      }
    }

    // Miniature : première photo disponible (Appareil, puis Plaque, puis Autre vue)
    let miniature = editing?.miniature || "";
    const first = SLOTS.find((s) => photos[s.k]);
    if (!first) miniature = "";
    else {
      const st = F.photos[first.k];
      const firstChanged = !!st.blob || !editing || editing.photos?.[first.k] !== photos[first.k] || !miniature;
      if (firstChanged) { const b = await slotBlob(first.k); if (b) miniature = await makeThumb(b); }
    }

    const row = { ...data, photos, miniature };
    let saved;
    if (editing) saved = await S.be.updateItem(id, row);
    else {
      try { saved = await S.be.insertItem({ ...row, id }); }
      catch (ex) {
        if (ex?.code !== "23505") throw ex;
        id = newId(); saved = await S.be.insertItem({ ...row, id });
      }
    }
    upsertLocal(saved);
    if (toRemove.length) S.be.removePhotos(toRemove).catch(() => {});
    F.dirty = false;
    toast(editing ? "Modifications enregistrées" : "Fiche enregistrée");
    // Après une modification ouverte depuis la fiche : on revient à cette fiche (sans empiler de page)
    if (editing && S.nav > 0) { S.nav--; history.back(); }
    else go(`#/fiche/${encodeURIComponent(saved.id)}`, { replace: true });
  } catch (ex) {
    btn.classList.remove("is-busy");
    errBox.textContent = frError(ex);
    errBox.hidden = false;
    errBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* ================================================================== */
/*  Outils : compte, import, export, apparence                         */
/* ================================================================== */
function currentTheme() { try { return localStorage.getItem("gc-theme") || "auto"; } catch (e) { return "auto"; } }
function applyTheme(t) {
  try { localStorage.setItem("gc-theme", t); } catch (e) { /* rien */ }
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

// Export Excel (miniatures) ou sauvegarde .zip (Excel + toutes les photos)
async function runExport(btn, withPhotos) {
  if (!S.items.length) { toast("L'inventaire est vide : rien à exporter.", "info"); return; }
  if (btn.classList.contains("is-busy")) return;
  const sub = btn.querySelector("small");
  const before = sub.textContent;
  btn.classList.add("is-busy");
  try {
    const res = await exportInventory({
      items: S.items, be: S.be, nameOf, withPhotos,
      onProgress: (t) => { sub.textContent = t; },
    });
    downloadBlob(res.name, res.blob);
    const mo = (res.blob.size / 1048576).toFixed(1).replace(".", ",");
    toast(withPhotos
      ? `Sauvegarde prête : ${plural(S.items.length, "fiche", "fiches")}, ${plural(res.photos, "photo", "photos")} (${mo} Mo)${res.failed ? ` · ${res.failed} non récupérée(s)` : ""}`
      : `${plural(S.items.length, "fiche exportée", "fiches exportées")} avec les miniatures`, res.failed ? "info" : "ok", 5000);
  } catch (ex) {
    toast(ex?.message && !/fetch/i.test(ex.message) ? ex.message : frError(ex), "err", 5000);
  } finally {
    btn.classList.remove("is-busy");
    sub.textContent = before;
  }
}

function viewTools() {
  const t = currentTheme();
  const demo = S.be.mode === "demo";
  const c = counts();
  app.innerHTML = `
  <div class="view page-pad" style="padding-bottom:140px">
    <div class="wrap-narrow">
      <div class="page-title" style="padding-top:calc(var(--safe-t) + 26px)">
        <p class="eyebrow">Réglages et données</p>
        <h1>Outils</h1>
      </div>
      ${demo ? `
      <div class="demo-banner">${icon("info")}<div><b>Mode démonstration</b>
        <span>Les fiches restent sur ce téléphone et ne sont pas partagées. Renseignez Supabase dans config.js pour passer en mode équipe (voir le guide).</span></div></div>` : ""}
      <div class="stack">
        <section class="card">
          <h2 class="card-title">${icon("user")}Votre compte</h2>
          <div class="profile">
            <span class="avatar lg">${myName() ? esc(initials(myName())) : icon("user")}</span>
            <div><b id="me-name">${esc(myName() || "Votre nom")}</b><small>${esc(S.user?.email || (demo ? "Données enregistrées sur cet appareil" : ""))}</small></div>
          </div>
          <form id="name-form" class="field" style="margin-top:16px">
            <label class="label" for="me-input">Nom affiché dans l'application</label>
            <div style="display:grid;grid-template-columns:1fr auto;gap:8px">
              <input class="input" id="me-input" value="${esc(myName())}" autocomplete="name" maxlength="60" placeholder="Prénom Nom">
              <button class="btn btn-ghost">Enregistrer</button>
            </div>
          </form>
          ${demo ? "" : `<button class="btn btn-ghost btn-block" id="logout" style="margin-top:14px">${icon("logout")}Se déconnecter</button>`}
        </section>

        <section class="card">
          <h2 class="card-title">${icon("sheet")}Données</h2>
          <div class="rows">
            <a class="row-link" href="#/import" data-nav>
              <span class="ic acc">${icon("upload")}</span>
              <span><b>Importer un fichier</b><small>Excel avec ses images, CSV ou sauvegarde .zip</small></span>${icon("chevron")}
            </a>
            <a class="row-link" href="#/photos" data-nav>
              <span class="ic acc">${icon("image")}</span>
              <span><b>Associer des photos en lot</b><small>Nom du fichier = identifiant ou n° de série</small></span>${icon("chevron")}
            </a>
            <button class="row-link" id="export-xlsx">
              <span class="ic">${icon("download")}</span>
              <span><b>Exporter en Excel</b><small>${plural(c.total, "fiche", "fiches")} · une miniature par ligne</small></span>${icon("chevron")}
            </button>
            <button class="row-link" id="export-zip">
              <span class="ic">${icon("box")}</span>
              <span><b>Sauvegarde complète (.zip)</b><small>Excel + toutes les photos en taille réelle</small></span>${icon("chevron")}
            </button>
          </div>
        </section>

        <section class="card">
          <h2 class="card-title">${icon("sun")}Apparence</h2>
          <div class="theme-seg" role="group" aria-label="Thème">
            <button data-theme-set="auto" aria-pressed="${t === "auto"}">${icon("phone")}Auto</button>
            <button data-theme-set="light" aria-pressed="${t === "light"}">${icon("sun")}Clair</button>
            <button data-theme-set="dark" aria-pressed="${t === "dark"}">${icon("moon")}Sombre</button>
          </div>
        </section>

        <section class="card">
          <h2 class="card-title">${icon("phone")}Application</h2>
          <div id="install-zone">${installHTML()}</div>
          <div style="margin-top:14px">
            <div class="kv"><span>Données</span><b>${demo ? "Sur ce téléphone (démo)" : "Supabase · partagées"}</b></div>
            <div class="kv"><span>Temps réel</span><b>${demo ? "—" : S.live === "on" ? "Actif" : "Reconnexion…"}</b></div>
            <div class="kv"><span>Lecture des plaques par IA</span><b>${S.be.aiEnabled ? "Activée" : "Désactivée"}</b></div>
            <div class="kv"><span>Version</span><b class="mono">${VERSION}</b></div>
          </div>
        </section>
      </div>
      <p class="foot-meta" style="text-align:center;margin-top:18px">GéoConsulting Sarl · Niamey</p>
    </div>
  </div>`;

  app.onchange = null; app.oninput = null;
  app.onclick = async (e) => {
    const th = e.target.closest("[data-theme-set]");
    if (th) {
      applyTheme(th.dataset.themeSet);
      document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b === th)));
      return;
    }
    const ex = e.target.closest("#export-xlsx, #export-zip");
    if (ex) return runExport(ex, ex.id === "export-zip");
    if (e.target.closest("#install-btn") && S.installPrompt) {
      S.installPrompt.prompt();
      const r = await S.installPrompt.userChoice.catch(() => null);
      S.installPrompt = null;
      if (r?.outcome === "accepted") toast("Application installée sur l'écran d'accueil");
      document.getElementById("install-zone").innerHTML = installHTML();
      return;
    }
    if (e.target.closest("#logout")) {
      await S.be.signOut();
      S.user = null; S.items = []; S.byId = new Map(); S.loaded = false;
      if (S.unsub) { S.unsub(); S.unsub = null; }
      go("#/", { replace: true });
      render();
      return;
    }
    if (e.target.closest("[data-nav]")) S.nav++;
  };
  document.getElementById("name-form").onsubmit = async (e) => {
    e.preventDefault();
    const v = document.getElementById("me-input").value.trim();
    if (!v) { toast("Indiquez un nom.", "info"); return; }
    const b = e.currentTarget.querySelector("button");
    b.classList.add("is-busy");
    try {
      await S.be.updateMyName(S.user.id, v);
      S.profiles[S.user.id] = v;
      document.getElementById("me-name").textContent = v;
      document.querySelector(".avatar.lg").textContent = initials(v);
      toast("Nom enregistré");
    } catch (ex) { toast(frError(ex), "err"); }
    b.classList.remove("is-busy");
  };
}

function installHTML() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return `<p class="hint">${icon("checkCircle")} L'application est installée sur cet appareil.</p>`;
  if (S.installPrompt) return `<button class="btn btn-primary btn-block" id="install-btn">${icon("install")}Installer sur l'écran d'accueil</button>`;
  return `<p class="hint">Pour l'avoir comme une appli : dans Chrome, menu <b>⋮</b> puis <b>« Ajouter à l'écran d'accueil »</b> (ou « Installer l'application »).</p>`;
}

/* ================================================================== */
/*  Démarrage, temps réel et connexion                                 */
/* ================================================================== */
async function loadAll() {
  const [items, profiles] = await Promise.all([S.be.listItems(), S.be.profiles().catch(() => ({}))]);
  setItems(items);
  S.profiles = profiles;
  S.loaded = true;
}

function setLive(state) {
  S.live = state;
  const el = document.getElementById("live");
  if (el && S.be.mode !== "demo") el.outerHTML = liveHTML();
}

function onRemoteChange(type, nw, old) {
  const r = route();
  if (type === "DELETE") {
    const id = old?.id;
    if (!id || !S.byId.has(id)) return;
    removeLocal(id);
    if (r.name === "detail" && r.id === id) { toast("Cette fiche vient d'être supprimée par un autre utilisateur.", "info", 4500); go("#/", { replace: true }); return; }
  } else if (nw?.id) {
    upsertLocal(nw);
    if ((nw.cree_par && !S.profiles[nw.cree_par]) || (nw.modifie_par && !S.profiles[nw.modifie_par])) {
      S.be.profiles().then((p) => { S.profiles = p; }).catch(() => {});
    }
    if (r.name === "detail" && r.id === nw.id) { viewDetail(nw.id); return; }
  }
  // Jamais de nouveau rendu pendant une saisie
  if (r.name === "list") refreshList();
}

let poll = null;
function startSync() {
  if (S.unsub) S.unsub();
  S.unsub = S.be.subscribe(onRemoteChange, (status) => {
    if (status === "SUBSCRIBED") setLive("on");
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("off");
  });
  clearInterval(poll);
  if (S.be.mode === "supabase") {
    // Filet de sécurité : si le temps réel décroche, on recharge toutes les 30 s
    poll = setInterval(() => { if (S.live !== "on" && S.user && document.visibilityState === "visible") refresh(); }, 30000);
  }
}

async function refresh() {
  if (!S.user || route().name === "form") return;
  try {
    await loadAll();
    const r = route();
    if (r.name === "list") refreshList();
    else if (r.name === "detail" && !S.byId.has(r.id)) notFound();
  } catch (e) { /* réseau absent : on garde l'affichage actuel */ }
}

async function afterLogin() {
  app.innerHTML = `<div class="boot" role="status"><img src="icon.svg" alt="" width="64" height="64"><span>Chargement de l'inventaire…</span></div>`;
  try {
    await loadAll();
  } catch (ex) {
    app.innerHTML = `<div class="empty view" style="min-height:100dvh;align-content:center">${CONTOUR_ART}
      <h2>Connexion impossible</h2><p>${esc(frError(ex))}</p>
      <div class="actions"><button class="btn btn-primary" id="retry">${icon("refresh")}Réessayer</button></div></div>`;
    document.getElementById("retry").onclick = afterLogin;
    return;
  }
  startSync();
  render();
}

function netbar() { document.getElementById("netbar").hidden = navigator.onLine; }
window.addEventListener("online", () => { netbar(); refresh(); });
window.addEventListener("offline", netbar);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); S.installPrompt = e;
  const z = document.getElementById("install-zone"); if (z) z.innerHTML = installHTML();
});

async function boot() {
  netbar();
  S.be = createBackend();
  S.be.onAuthChange((evt, user) => {
    if (evt === "SIGNED_OUT" && S.user) {
      S.user = null; S.loaded = false; if (S.unsub) { S.unsub(); S.unsub = null; }
      render();
    }
  });
  try { S.user = await S.be.currentUser(); } catch (e) { S.user = null; }
  if (!S.user) { render(); return; }
  await afterLogin();
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
