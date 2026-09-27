// =====================================================================
//  Fonction Supabase « lire-plaque » (OPTIONNELLE)
//  À coller dans Supabase > Edge Functions > Deploy a new function > Via Editor
//  Lit les photos d'un appareil (surtout la plaque signalétique) avec
//  l'IA Claude et renvoie des suggestions de champs.
//
//  Secret à définir dans Supabase > Edge Functions > Secrets :
//    ANTHROPIC_API_KEY = votre clé API (console.anthropic.com)
//  Facultatif :
//    CLAUDE_MODEL = modèle à utiliser (par défaut : claude-haiku-4-5-20251001)
// =====================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORIES = [
  "Essais de sols", "Granulats / béton", "Bitume / enrobés", "Topographie / GPS",
  "Pesage / balances", "Étuves / fours", "Géophysique", "Informatique",
  "Véhicule / terrain", "EPI / sécurité", "Mobilier / bureau", "Autre",
];

const CONSIGNE = `Tu aides à inventorier le matériel d'un laboratoire de génie civil et de géotechnique (Niger).
Les photos montrent un même appareil, dans cet ordre : vue de l'appareil, plaque signalétique, autre vue (certaines peuvent manquer).
Lis la plaque signalétique si elle est visible. N'invente rien : si une information n'est pas lisible ou pas certaine, mets une chaîne vide.
Réponds UNIQUEMENT par un objet JSON, sans texte autour, avec exactement ces clés :
{"designation": "", "categorie": "", "marque": "", "modele": "", "serie": "", "notes": ""}
- designation : nom courant de l'appareil en français (ex. « Balance électronique », « Presse CBR »).
- categorie : une valeur EXACTE de cette liste, ou "" : ${CATEGORIES.join(" | ")}.
- serie : numéro de série exactement tel qu'écrit.
- notes : autres informations utiles lues (portée, précision, tension, année…), en une phrase courte.`;

function reponse(corps: unknown, statut = 200) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);

  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return reponse({ erreur: "La clé ANTHROPIC_API_KEY n'est pas configurée." }, 500);
  const modele = Deno.env.get("CLAUDE_MODEL") || "claude-haiku-4-5-20251001";

  let images: { data: string; media_type?: string }[] = [];
  try {
    const corps = await req.json();
    images = Array.isArray(corps?.images) ? corps.images.slice(0, 3) : [];
  } catch {
    return reponse({ erreur: "Requête illisible." }, 400);
  }
  if (!images.length) return reponse({ erreur: "Aucune photo reçue." }, 400);

  const contenu: unknown[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.data },
  }));
  contenu.push({ type: "text", text: CONSIGNE });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cle,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modele,
      max_tokens: 700,
      messages: [{ role: "user", content: contenu }],
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    console.error("Erreur API Claude", r.status, detail);
    return reponse({ erreur: "Le service d'IA n'a pas répondu correctement." }, 502);
  }

  const donnees = await r.json();
  const texte: string = (donnees?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return reponse({ erreur: "Réponse de l'IA illisible." }, 502);

  try {
    const brut = JSON.parse(texte.slice(debut, fin + 1));
    const propre = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
    const categorie = CATEGORIES.includes(propre(brut.categorie)) ? propre(brut.categorie) : "";
    return reponse({
      designation: propre(brut.designation),
      categorie,
      marque: propre(brut.marque),
      modele: propre(brut.modele),
      serie: propre(brut.serie),
      notes: propre(brut.notes),
    });
  } catch {
    return reponse({ erreur: "Réponse de l'IA illisible." }, 502);
  }
});
