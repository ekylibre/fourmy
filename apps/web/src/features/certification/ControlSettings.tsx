import { useState } from "react";
import { Button, Group, Modal, NumberInput, Select, Stack, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CertificationSettings } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";

/** Réglages des contrôles (responsable) : HVE (période, méthode, références IFT), AB (repères de rotation). */
export function ControlSettingsModal({ onClose, kind = "hve" }: { onClose: () => void; kind?: "hve" | "ab" }) {
  const farm = useFarm();
  const q = useQuery({ queryKey: ["certification-settings", farm.id], queryFn: () => api.get<CertificationSettings>(farmPath(farm.id, "/settings/certification")) });
  return (
    <Modal opened onClose={onClose} title={kind === "hve" ? "Réglages du contrôle HVE" : "Réglages du contrôle AB"}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorAlert error={q.error} />}
      {q.data && <SettingsForm initial={q.data} onClose={onClose} kind={kind} />}
    </Modal>
  );
}

function SettingsForm({ initial, onClose, kind }: { initial: CertificationSettings; onClose: () => void; kind: "hve" | "ab" }) {
  const farm = useFarm();
  const client = useQueryClient();
  const [s, setS] = useState(initial);
  const save = useMutation({
    mutationFn: (w: CertificationSettings) => api.put(farmPath(farm.id, "/settings/certification"), w),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["certification-settings"] });
      void client.invalidateQueries({ queryKey: ["certifications"] });
      onClose();
    },
  });
  if (kind === "ab") {
    return (
      <Stack>
        <NumberInput
          label="Rotation : légumineuse au moins une fois en N campagnes"
          description="Repère du guide de lecture INAO (5 par défaut), apprécié par l'organisme certificateur"
          min={2}
          max={10}
          value={s.rotationYears}
          onChange={(v) => setS({ ...s, rotationYears: Number(v) || 5 })}
        />
        <NumberInput
          label="Rotation : même espèce au plus K années de suite"
          min={1}
          max={5}
          value={s.rotationSameSpeciesMax}
          onChange={(v) => setS({ ...s, rotationSameSpeciesMax: Number(v) || 2 })}
        />
        {save.error && <ErrorAlert error={save.error} />}
        <Group>
          <Button loading={save.isPending} onClick={() => save.mutate(s)}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    );
  }
  return (
    <Stack>
      <TextInput
        label="Début de la période de 12 mois (JJ/MM)"
        description="Exercice comptable ou campagne culturale ; le 1er janvier par défaut"
        value={`${s.hveCampaignStartMd.slice(3, 5)}/${s.hveCampaignStartMd.slice(0, 2)}`}
        onChange={(e) => {
          const m = /^(\d{2})\/(\d{2})$/.exec(e.currentTarget.value);
          if (m) setS({ ...s, hveCampaignStartMd: `${m[2]}-${m[1]}` });
        }}
      />
      <Select
        label="IFT et bilan azoté"
        data={[
          { value: "campaign", label: "Campagne contrôlée seule" },
          { value: "average", label: "Moyenne des trois dernières campagnes" },
        ]}
        value={s.hveMethod}
        onChange={(v) => v && setS({ ...s, hveMethod: v as CertificationSettings["hveMethod"] })}
        allowDeselect={false}
      />
      <Select
        label="Références IFT des grandes cultures"
        description="L'ancienne notation est admise jusqu'à la campagne 2025 pour les exploitations déjà certifiées V4"
        data={[
          { value: "current", label: "Notation en cours (enquêtes 2014, 2017, 2021)" },
          { value: "old", label: "Ancienne notation" },
        ]}
        value={s.hveIftScale}
        onChange={(v) => v && setS({ ...s, hveIftScale: v as CertificationSettings["hveIftScale"] })}
        allowDeselect={false}
      />
      <Select
        label="Élevage sur l'exploitation"
        description="Bilan azoté : rejets des animaux et pâturage, déclarés dans le questionnaire HVE"
        data={[
          { value: "", label: "Non déclaré" },
          { value: "yes", label: "Oui" },
          { value: "no", label: "Non, aucun animal" },
        ]}
        value={s.hveLivestock === null ? "" : s.hveLivestock ? "yes" : "no"}
        onChange={(v) => setS({ ...s, hveLivestock: v === "yes" ? true : v === "no" ? false : null })}
        allowDeselect={false}
      />
      <Select
        label="Vigne dans le Rhône ou la Saône-et-Loire"
        description="Siège dans le périmètre de l'AOC Beaujolais (bassin viticole des références IFT)"
        data={[
          { value: "", label: "Non concerné" },
          { value: "yes", label: "Dans le périmètre de l'AOC Beaujolais" },
          { value: "no", label: "Hors du périmètre" },
        ]}
        value={s.hveBeaujolais === null ? "" : s.hveBeaujolais ? "yes" : "no"}
        onChange={(v) => setS({ ...s, hveBeaujolais: v === "yes" ? true : v === "no" ? false : null })}
        allowDeselect={false}
      />
      {save.error && <ErrorAlert error={save.error} />}
      <Group>
        <Button loading={save.isPending} onClick={() => save.mutate(s)}>
          Enregistrer
        </Button>
      </Group>
    </Stack>
  );
}
