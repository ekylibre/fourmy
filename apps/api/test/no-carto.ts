import { API_CARTO } from "@fourmy/geo-ign";

/**
 * Pas d'API Carto (IGN) dans les tests : un import crée des parcelles et
 * rafraîchit ensuite leurs références (issue #165). Sans ce garde-fou, chaque
 * test d'import interrogerait le vrai service. Réponse vide par défaut ; un
 * test qui veut des références remplace `fetch` (vi.stubGlobal).
 */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith(API_CARTO))
    return Response.json({ type: "FeatureCollection", features: [] });
  return realFetch(input, init);
}) as typeof fetch;
