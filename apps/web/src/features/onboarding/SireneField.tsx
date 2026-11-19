import { useRef, useState } from "react";
import { Autocomplete, Loader } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../app/api";

/** Entreprise trouvée dans Sirene (INSEE), avec l'adresse de son siège. */
export interface SireneCandidate {
  siren: string;
  siret: string | null;
  name: string;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  headOffice: boolean;
  active: boolean;
}

const optionLabel = (c: SireneCandidate) =>
  [c.name, [c.postalCode, c.city].filter(Boolean).join(" "), c.siret ? `SIRET ${c.siret}` : `SIREN ${c.siren}`, c.active ? null : "fermée"]
    .filter(Boolean)
    .join(" · ");

/**
 * Raison sociale ou SIRET avec autocomplétion Sirene (lot IM6, méthode de
 * Lyvre) : recherche par le serveur (clé de l'INSEE jamais dans le
 * navigateur) après 600 ms sans frappe — à partir de 3 caractères pour un
 * nom, à 9 ou 14 chiffres pour un numéro (quota : 30 recherches par minute
 * pour tout le serveur). Le texte reste libre ; choisir une entreprise
 * remplit l'identité et l'adresse du siège.
 */
export function SireneField({
  label,
  mode,
  value,
  onChange,
  onPick,
  placeholder,
  inputMode,
}: {
  label: string;
  mode: "name" | "number";
  value: string;
  onChange: (v: string) => void;
  onPick: (c: SireneCandidate) => void;
  placeholder?: string;
  inputMode?: "numeric";
}) {
  const [typed, setTyped] = useState(false);
  const [debounced] = useDebouncedValue(value.trim(), 600);
  const q = mode === "number" ? debounced.replace(/[\s.]/g, "") : debounced;
  const ready = mode === "number" ? /^(\d{9}|\d{14})$/.test(q) : q.length >= 3;
  const search = useQuery({
    queryKey: ["sirene", q],
    queryFn: () => api.get<{ items: SireneCandidate[] }>(`/me/sirene/search?q=${encodeURIComponent(q)}`),
    enabled: typed && ready,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const results = search.data?.items ?? [];
  // Mantine rappelle onChange avec le libellé de l'option choisie : ignoré, onPick a rempli les champs.
  const picked = useRef<string | null>(null);
  const err = search.error instanceof ApiError ? search.error : null;
  const description = err
    ? err.status === 429
      ? "Beaucoup de recherches Sirene en ce moment : réessayez dans quelques secondes."
      : "Recherche Sirene indisponible : saisissez les champs à la main."
    : typed && ready && search.isSuccess && !results.length
      ? "Aucune entreprise active trouvée dans Sirene."
      : mode === "name"
        ? "Tapez le nom de la ferme : Fourmy propose les entreprises connues de l'INSEE."
        : undefined;
  return (
    <Autocomplete
      label={label}
      placeholder={placeholder}
      inputMode={inputMode}
      value={value}
      data={results.map(optionLabel)}
      filter={({ options }) => options}
      rightSection={search.isFetching ? <Loader size={14} /> : null}
      description={description}
      comboboxProps={{ withinPortal: true }}
      onChange={(v) => {
        if (v === picked.current) return;
        picked.current = null;
        setTyped(true);
        onChange(v);
      }}
      onOptionSubmit={(label) => {
        const c = results.find((x) => optionLabel(x) === label);
        if (!c) return;
        picked.current = label;
        setTyped(false);
        onPick(c);
      }}
    />
  );
}
