// Constantes et petites fonctions partagées

export const SITES = ["Niamey – Laboratoire", "Doutchi", "Chantier", "Prêté à un partenaire", "Autre"];

export const CATEGORIES = [
  "Essais de sols", "Granulats / béton", "Bitume / enrobés", "Topographie / GPS",
  "Pesage / balances", "Étuves / fours", "Géophysique", "Informatique",
  "Véhicule / terrain", "EPI / sécurité", "Mobilier / bureau", "Autre",
];

export const ETATS = [
  { v: "Fonctionnel", cls: "ok" },
  { v: "À vérifier", cls: "warn" },
  { v: "En réparation", cls: "info" },
  { v: "En panne", cls: "bad" },
];

export const SLOTS = [
  { k: "main", label: "Appareil" },
  { k: "plate", label: "Plaque" },
  { k: "other", label: "Autre vue" },
];

export const etatClass = (etat) => (ETATS.find((e) => e.v === etat) || { cls: "warn" }).cls;

// Échappe toute valeur affichée (les données partagées ne sont pas fiables)
export function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Pour la recherche : minuscules, sans accents
export function norm(v) {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newId() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return "GC-" + Array.from(a, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function daysUntil(iso) {
  const d = parseISODate(iso);
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function fmtDate(iso) {
  const d = parseISODate(iso);
  if (!d) return "—";
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return "—";
  const h = String(d.getHours()).padStart(2, "0"), m = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()} à ${h}h${m}`;
}
export function fmtDateFR(iso) {
  const d = parseISODate(iso);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
export function relTime(ts) {
  if (!ts) return "";
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) { const j = Math.floor(s / 86400); return `il y a ${j} jour${j > 1 ? "s" : ""}`; }
  return fmtDate(new Date(ts).toISOString().slice(0, 10));
}

// Statut d'étalonnage : échu, bientôt (< 30 j) ou à jour
export function calibration(item) {
  const j = daysUntil(item.etalonnage_prochain);
  if (j === null) return null;
  if (j < 0) return { level: "bad", j, short: "Étalonnage échu", long: `Échu depuis ${-j} jour${-j > 1 ? "s" : ""}` };
  if (j <= 30) return { level: "warn", j, short: "Étalonnage < 30 j", long: j === 0 ? "Échéance aujourd'hui" : `Dans ${j} jour${j > 1 ? "s" : ""}` };
  return { level: "ok", j, short: "Étalonnage à jour", long: `Dans ${j} jours` };
}

export const isToCheck = (it) => it.a_confirmer || it.etat === "À vérifier";
export const isBroken = (it) => it.etat === "En panne" || it.etat === "En réparation";
export const isCalibDue = (it) => { const c = calibration(it); return !!c && c.level !== "ok"; };

export function initials(name) {
  const p = String(name || "").trim().split(/[\s._-]+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

export function debounce(fn, ms = 180) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Message d'erreur clair en français
export function frError(err) {
  const msg = String(err?.message || err || "");
  const code = err?.code || err?.status;
  if (err?.name === "TypeError" && /fetch|network|load/i.test(msg)) return "Connexion impossible. Vérifiez le réseau puis réessayez.";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Connexion impossible. Vérifiez le réseau puis réessayez.";
  if (/Invalid login credentials/i.test(msg)) return "Email ou mot de passe incorrect.";
  if (/Email not confirmed/i.test(msg)) return "Ce compte n'est pas encore confirmé. Demandez à l'administrateur de le confirmer dans Supabase.";
  if (/JWT expired|invalid JWT|session/i.test(msg)) return "Votre session a expiré. Reconnectez-vous.";
  if (code === "42501" || /row-level security|permission denied|not authorized/i.test(msg)) return "Accès refusé. Votre compte n'a pas le droit de faire cette action.";
  if (/Payload too large|exceeded the maximum/i.test(msg)) return "Photo trop lourde. Réessayez avec une autre photo.";
  if (/rate limit/i.test(msg)) return "Trop de tentatives. Patientez une minute puis réessayez.";
  return msg ? `Une erreur est survenue : ${msg}` : "Une erreur est survenue. Réessayez.";
}

export function download(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function csvCell(v) {
  const s = String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
