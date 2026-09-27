// Accès aux données : Supabase (production) ou mode démo (stockage local du téléphone)

const COLONNES = [
  "id", "designation", "categorie", "marque", "modele", "numero_serie", "accessoires", "etat",
  "quantite", "site", "emplacement", "etalonnage_dernier", "etalonnage_prochain", "remarques",
  "a_confirmer", "photos", "miniature", "origine", "cree_par", "modifie_par", "cree_le", "modifie_le",
];

function nettoie(item) {
  const o = {};
  for (const k of COLONNES) if (k in item) o[k] = item[k];
  if (o.etalonnage_dernier === "") o.etalonnage_dernier = null;
  if (o.etalonnage_prochain === "") o.etalonnage_prochain = null;
  return o;
}

/* ------------------------------------------------------------------ */
/*  Supabase                                                           */
/* ------------------------------------------------------------------ */
class SupabaseBackend {
  constructor(cfg) {
    this.mode = "supabase";
    this.sb = window.supabase.createClient(cfg.SUPABASE_URL.trim(), cfg.SUPABASE_ANON_KEY.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    this.aiEnabled = !!cfg.IA_ACTIVE;
  }

  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user ?? null;
  }
  onAuthChange(cb) {
    this.sb.auth.onAuthStateChange((evt, session) => cb(evt, session?.user ?? null));
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    return data.user;
  }
  async signOut() { await this.sb.auth.signOut(); }

  async listItems() {
    const out = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from("materiel").select("*")
        .order("modifie_le", { ascending: false }).range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  subscribe(onChange, onStatus) {
    const ch = this.sb.channel("materiel-en-direct")
      .on("postgres_changes", { event: "*", schema: "public", table: "materiel" }, (p) => {
        onChange(p.eventType, p.new, p.old);
      })
      .subscribe((status) => onStatus && onStatus(status));
    return () => this.sb.removeChannel(ch);
  }

  async exists(id) {
    const { data, error } = await this.sb.from("materiel").select("id").eq("id", id).maybeSingle();
    if (error) throw error;
    return !!data;
  }
  async insertItem(item) {
    const { data, error } = await this.sb.from("materiel").insert(nettoie(item)).select().single();
    if (error) throw error;
    return data;
  }
  async insertMany(items) {
    const { data, error } = await this.sb.from("materiel").insert(items.map(nettoie)).select();
    if (error) throw error;
    return data;
  }
  async updateItem(id, patch) {
    const p = nettoie(patch); delete p.id; delete p.cree_le; delete p.cree_par;
    const { data, error } = await this.sb.from("materiel").update(p).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  async deleteItem(id) {
    const { error } = await this.sb.from("materiel").delete().eq("id", id);
    if (error) throw error;
  }

  async uploadPhoto(path, blob) {
    const { error } = await this.sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    return path;
  }
  async removePhotos(paths) {
    const p = paths.filter(Boolean);
    if (!p.length) return;
    await this.sb.storage.from("photos").remove(p);
  }
  async photoUrls(paths) {
    const p = paths.filter(Boolean);
    if (!p.length) return {};
    const { data, error } = await this.sb.storage.from("photos").createSignedUrls(p, 3600);
    if (error) throw error;
    const map = {};
    for (const r of data) if (r.signedUrl) map[r.path] = r.signedUrl;
    return map;
  }

  async profiles() {
    const { data, error } = await this.sb.from("profils").select("id, nom");
    if (error) throw error;
    return Object.fromEntries(data.map((p) => [p.id, p.nom]));
  }
  async updateMyName(uid, nom) {
    const { error } = await this.sb.from("profils").update({ nom }).eq("id", uid);
    if (error) throw error;
  }

  async suggest(images) {
    const { data, error } = await this.sb.functions.invoke("lire-plaque", { body: { images } });
    if (error) {
      let detail = "";
      try { detail = (await error.context?.json())?.erreur || ""; } catch (e) { /* rien */ }
      throw new Error(detail || "La lecture par IA n'a pas fonctionné.");
    }
    if (data?.erreur) throw new Error(data.erreur);
    return data;
  }
}

/* ------------------------------------------------------------------ */
/*  Mode démo : IndexedDB, uniquement sur cet appareil                 */
/* ------------------------------------------------------------------ */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("gc-inventaire-demo", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("materiel", { keyPath: "id" });
      r.result.createObjectStore("photos");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let res;
    Promise.resolve(fn(s)).then((v) => { res = v; });
    t.oncomplete = () => resolve(res);
    t.onerror = () => reject(t.error);
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

class DemoBackend {
  constructor(cfg) {
    this.mode = "demo";
    this.aiEnabled = false;
    this.user = { id: "demo", email: "" };
    this.listeners = [];
    this.urls = {};
    try { this.nom = localStorage.getItem("gc-demo-nom") || ""; } catch (e) { this.nom = ""; }
  }
  async db() { return (this._db ||= await idb()); }
  async currentUser() { return this.user; }
  onAuthChange() {}
  async signIn() { return this.user; }
  async signOut() {}

  async listItems() {
    const db = await this.db();
    const all = await tx(db, "materiel", "readonly", (s) => req(s.getAll()));
    return all.sort((a, b) => String(b.modifie_le).localeCompare(String(a.modifie_le)));
  }
  subscribe(onChange, onStatus) {
    this.listeners.push(onChange);
    onStatus && onStatus("DEMO");
    return () => { this.listeners = this.listeners.filter((l) => l !== onChange); };
  }
  emit(type, n, o) { for (const l of this.listeners) setTimeout(() => l(type, n, o), 0); }

  async exists(id) {
    const db = await this.db();
    return !!(await tx(db, "materiel", "readonly", (s) => req(s.get(id))));
  }
  async insertItem(item) {
    const db = await this.db();
    const now = new Date().toISOString();
    const row = { ...nettoie(item), cree_le: now, modifie_le: now, cree_par: "demo", modifie_par: "demo" };
    if (await this.exists(row.id)) { const e = new Error("duplicate key"); e.code = "23505"; throw e; }
    await tx(db, "materiel", "readwrite", (s) => req(s.put(row)));
    this.emit("INSERT", row, {});
    return row;
  }
  async insertMany(items) {
    const out = [];
    for (const it of items) out.push(await this.insertItem(it));
    return out;
  }
  async updateItem(id, patch) {
    const db = await this.db();
    const old = await tx(db, "materiel", "readonly", (s) => req(s.get(id)));
    if (!old) throw new Error("Fiche introuvable.");
    const row = { ...old, ...nettoie(patch), id, cree_le: old.cree_le, cree_par: old.cree_par, modifie_le: new Date().toISOString(), modifie_par: "demo" };
    await tx(db, "materiel", "readwrite", (s) => req(s.put(row)));
    this.emit("UPDATE", row, old);
    return row;
  }
  async deleteItem(id) {
    const db = await this.db();
    await tx(db, "materiel", "readwrite", (s) => req(s.delete(id)));
    this.emit("DELETE", {}, { id });
  }
  async uploadPhoto(path, blob) {
    const db = await this.db();
    await tx(db, "photos", "readwrite", (s) => req(s.put(blob, path)));
    return path;
  }
  async removePhotos(paths) {
    const db = await this.db();
    for (const p of paths.filter(Boolean)) {
      await tx(db, "photos", "readwrite", (s) => req(s.delete(p)));
      if (this.urls[p]) { URL.revokeObjectURL(this.urls[p]); delete this.urls[p]; }
    }
  }
  async photoUrls(paths) {
    const db = await this.db();
    const map = {};
    for (const p of paths.filter(Boolean)) {
      if (!this.urls[p]) {
        const b = await tx(db, "photos", "readonly", (s) => req(s.get(p)));
        if (b) this.urls[p] = URL.createObjectURL(b);
      }
      if (this.urls[p]) map[p] = this.urls[p];
    }
    return map;
  }
  async profiles() { return { demo: this.nom }; }
  async updateMyName(uid, nom) {
    this.nom = nom;
    try { localStorage.setItem("gc-demo-nom", nom); } catch (e) { /* rien */ }
  }
  async suggest() { throw new Error("La lecture par IA n'est pas disponible en mode démo."); }
}

export function createBackend() {
  const cfg = window.INVENTAIRE_CONFIG || {};
  const ok = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && /^https?:\/\//.test(cfg.SUPABASE_URL.trim());
  if (ok && window.supabase?.createClient) return new SupabaseBackend(cfg);
  return new DemoBackend(cfg);
}
