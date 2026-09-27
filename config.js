// =====================================================================
//  CONFIGURATION — le seul fichier à modifier après l'installation.
//  Les deux valeurs se trouvent dans Supabase :
//  Project Settings > API Keys (ou Data API) > Project URL et clé publique.
//  Tant que ces champs sont vides, l'application s'ouvre en MODE DÉMO
//  (les fiches restent uniquement sur le téléphone).
// =====================================================================
window.INVENTAIRE_CONFIG = {
  // Exemple : "https://abcdefghijkl.supabase.co"
  SUPABASE_URL: "https://ueevauamgibjmocryprw.supabase.co",

  // Clé publique : « anon public » ou « publishable » (commence par eyJ… ou sb_publishable_…)
  // Ne mettez JAMAIS ici la clé « service_role » ou « secret ».
  SUPABASE_ANON_KEY: "sb_publishable_C2OZejl6n-0TLe5HgT5MJA_NS0fxChV",

  // Mettre true seulement après avoir installé la fonction « lire-plaque »
  // et ajouté la clé ANTHROPIC_API_KEY dans Supabase (voir le guide, étape 7).
  IA_ACTIVE: false,
};
