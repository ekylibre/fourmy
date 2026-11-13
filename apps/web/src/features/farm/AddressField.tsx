import { useRef, useState } from "react";
import { Autocomplete, Loader } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import type { GeocodeResult } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";

/**
 * Adresse avec suggestions du géocodage IGN (E4) : à partir de 3 caractères,
 * après 250 ms sans frappe. Le texte saisi reste libre (E5) : une adresse que
 * l'IGN ne connaît pas s'enregistre telle quelle.
 */
export function AddressField({
  value,
  onChange,
  onPick,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (r: GeocodeResult) => void;
  disabled?: boolean;
}) {
  const farm = useFarm();
  const [typed, setTyped] = useState(false);
  const [q] = useDebouncedValue(value.trim(), 250);
  const search = useQuery({
    queryKey: ["geocode", farm.id, q],
    queryFn: () => api.get<GeocodeResult[]>(farmPath(farm.id, `/geocode?q=${encodeURIComponent(q)}&limit=5`)),
    enabled: typed && !disabled && q.length >= 3,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const results = search.data ?? [];
  // Mantine appelle onChange avec le libellé complet juste après le choix :
  // on l'ignore, la rue a déjà été remplie par onPick.
  const picked = useRef<string | null>(null);
  const unavailable = search.error instanceof ApiError && search.error.status === 503;
  return (
    <Autocomplete
      label="Adresse"
      placeholder="N° et voie, lieu-dit"
      value={value}
      disabled={disabled}
      data={results.map((r) => r.label)}
      filter={({ options }) => options}
      rightSection={search.isFetching ? <Loader size={14} /> : null}
      description={unavailable ? "Géocodage indisponible : placez le point sur la carte, l'adresse sera enregistrée telle quelle." : undefined}
      onChange={(v) => {
        if (v === picked.current) return;
        picked.current = null;
        setTyped(true);
        onChange(v);
      }}
      onOptionSubmit={(label) => {
        const r = results.find((x) => x.label === label);
        if (!r) return;
        picked.current = label;
        setTyped(false);
        onPick(r);
      }}
    />
  );
}
