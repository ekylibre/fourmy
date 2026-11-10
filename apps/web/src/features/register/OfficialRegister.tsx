import { useState } from "react";
import { Alert, Badge, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "mantine-datatable";
import { Download } from "lucide-react";
import type { FarmIdentity, OfficialRegister as Register, OfficialRegisterField, OfficialRegisterLine } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useColumns, type ColumnDef } from "../../app/columns";
import { useFarm } from "../../app/farm";
import { ColumnPicker, pickColumns } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";

/**
 * Registre au format réglementaire (lot X) : arrêté du 24/12/2025 et notice
 * du 22/09/2026. Lignes aux intitulés standard, champs obligatoires
 * manquants signalés ligne par ligne ; exports CSV (intitulés standard) et
 * JSON complet (enquêtes). Le détenteur (SIRET, PACAGE) se saisit ici.
 */
export const FIELD_LABELS: Partial<Record<OfficialRegisterField, string>> = {
  siretApplicateur: "SIRET",
  numeroAMMProduit: "N° AMM",
  dateIntervention: "Date",
  doseProduitValeur: "Dose",
  doseProduitUnite: "Unité de dose",
  surfaceTraitee: "Surface traitée",
  cultureOepp: "Culture (OEPP)",
  coordonneesGps: "Localisation",
  nomProduit: "Produit",
};

const COLUMNS: ColumnDef[] = [
  { key: "dateIntervention", label: "Date", required: true },
  { key: "heures", label: "Heures" },
  { key: "parcelle", label: "Parcelle" },
  { key: "nomProduit", label: "Produit" },
  { key: "numeroAMMProduit", label: "N° AMM" },
  { key: "dose", label: "Dose" },
  { key: "surfaceTraitee", label: "Surface traitée" },
  { key: "cultureOepp", label: "Culture (OEPP)" },
  { key: "codeBbch", label: "Stade BBCH" },
  { key: "modeDeConduite", label: "Bio" },
  { key: "usageCible", label: "Cible", defaultHidden: true },
  { key: "coordonneesGps", label: "Coordonnées GPS", defaultHidden: true },
  { key: "anomalies", label: "À compléter" },
];

async function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function OfficialRegister({ campaign }: { campaign: number }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const q = useQuery({
    queryKey: ["register-official", farm.id, campaign],
    queryFn: () => api.get<Register>(farmPath(farm.id, `/registers/phyto/official?campaign=${campaign}`)),
  });
  const columns = useColumns("register-official", COLUMNS);
  const [editing, setEditing] = useState(false);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const r = q.data!;
  const complete = r.lines.filter((l) => !l.anomalies.length).length;
  const missing = new Map<OfficialRegisterField, number>();
  for (const l of r.lines) for (const a of l.anomalies) missing.set(a, (missing.get(a) ?? 0) + 1);

  const download = async (format: "csv" | "export", name: string) => {
    try {
      await save(await api.download(farmPath(farm.id, `/registers/phyto/official?campaign=${campaign}&format=${format}`)), name);
    } catch (e) {
      notifications.show({ color: "brique", title: "Export impossible", message: String(e) });
    }
  };

  return (
    <Stack>
      <Paper p="md" withBorder>
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={600}>Détenteur du registre : {r.holder.name}</Text>
            <Text size="sm" c={r.holder.siret ? undefined : "brique"} className="lv-num">
              SIRET {r.holder.siret ?? "non renseigné"} · PACAGE {r.holder.pacage ?? "non renseigné"}
            </Text>
          </Stack>
          {owner && !editing && (
            <Button size="compact-sm" variant="light" onClick={() => setEditing(true)}>
              Modifier le détenteur
            </Button>
          )}
        </Group>
        {editing && <IdentityForm farmId={farm.id} identity={r.holder} onClose={() => setEditing(false)} />}
        {!r.holder.siret && !editing && (
          <Text size="xs" c="dimmed" mt={4}>
            Le SIRET est obligatoire sur chaque ligne du registre.{owner ? "" : " Le responsable de la ferme peut le renseigner."}
          </Text>
        )}
      </Paper>

      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {r.lines.length} ligne(s) en {campaign} · {complete} complète(s)
          {missing.size > 0 && ` · à compléter : ${[...missing].map(([f, n]) => `${FIELD_LABELS[f] ?? f} (${n})`).join(", ")}`}
        </Text>
        <Group gap="xs">
          <ColumnPicker columns={columns} />
          <Button variant="light" leftSection={<Download size={16} />} disabled={!r.lines.length} onClick={() => download("csv", `registre-phyto-reglementaire-${campaign}.csv`)}>
            CSV réglementaire
          </Button>
          <Button variant="light" leftSection={<Download size={16} />} disabled={!r.lines.length} onClick={() => download("export", `registre-phyto-reglementaire-${campaign}.json`)}>
            JSON complet
          </Button>
        </Group>
      </Group>

      <DataTable
        withTableBorder
        striped
        minHeight={150}
        noRecordsText="Aucun traitement phytosanitaire sur cette campagne"
        records={r.lines}
        idAccessor="idTraitement"
        columns={pickColumns<OfficialRegisterLine>(
          [
            { accessor: "dateIntervention", title: "Date", render: (l) => <span className="lv-num">{l.dateIntervention}</span> },
            { accessor: "heures", title: "Heures", render: (l) => <span className="lv-num">{l.heureDebut && `${l.heureDebut}–${l.heureFin}`}</span> },
            { accessor: "parcelle", title: "Parcelle", render: (l) => l.links.parcelName },
            { accessor: "nomProduit", title: "Produit" },
            { accessor: "numeroAMMProduit", title: "N° AMM", render: (l) => <span className="lv-num">{l.numeroAMMProduit}</span> },
            {
              accessor: "dose",
              title: "Dose",
              textAlign: "right",
              render: (l) => <span className="lv-num">{l.doseProduitValeur && `${l.doseProduitValeur.replace(".", ",")} ${l.doseProduitUnite}`}</span>,
            },
            {
              accessor: "surfaceTraitee",
              title: "Surface traitée",
              textAlign: "right",
              render: (l) => <span className="lv-num">{l.surfaceTraitee && `${l.surfaceTraitee.replace(".", ",")} ha`}</span>,
            },
            { accessor: "cultureOepp", title: "Culture (OEPP)", render: (l) => <span className="lv-num">{l.cultureOepp}</span> },
            { accessor: "codeBbch", title: "Stade BBCH" },
            { accessor: "modeDeConduite", title: "Bio" },
            { accessor: "usageCible", title: "Cible" },
            { accessor: "coordonneesGps", title: "Coordonnées GPS", render: (l) => <span className="lv-num">{l.coordonneesGps}</span> },
            {
              accessor: "anomalies",
              title: "À compléter",
              render: (l) =>
                l.anomalies.length ? (
                  <Group gap={4}>
                    {l.anomalies.map((a) => (
                      <Badge key={a} size="xs" color="paille" variant="light">
                        {FIELD_LABELS[a] ?? a}
                      </Badge>
                    ))}
                  </Group>
                ) : (
                  <Badge size="xs" color="lichen" variant="light">
                    Complète
                  </Badge>
                ),
            },
          ],
          columns,
        )}
      />
      <Text size="xs" c="dimmed">
        Format : arrêté du 24/12/2025 et notice du ministère (intitulés standard, une ligne par produit et par parcelle). Sans
        référence RPG de l'exploitant, la parcelle est localisée par ses coordonnées GPS (WGS84). La culture vient de l'activité
        de la parcelle (Activités), le stade BBCH de l'intervention.
      </Text>
    </Stack>
  );
}

function IdentityForm({ farmId, identity, onClose }: { farmId: string; identity: { siret: string | null; pacage: string | null }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [siret, setSiret] = useState(identity.siret ?? "");
  const [pacage, setPacage] = useState(identity.pacage ?? "");
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: () => api.put<FarmIdentity>(farmPath(farmId, "/settings/identity"), { siret: siret.trim() || null, pacage: pacage.trim() || null }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Détenteur du registre mis à jour." });
      void queryClient.invalidateQueries({ queryKey: ["register-official", farmId] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  const siretOk = !siret.trim() || /^\d{14}$/.test(siret.trim());
  const pacageOk = !pacage.trim() || /^\d{9}$/.test(pacage.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (siretOk && pacageOk) update.mutate();
      }}
    >
      <Group align="flex-end" mt="sm">
        <TextInput label="SIRET" placeholder="14 chiffres" value={siret} onChange={(e) => setSiret(e.currentTarget.value)} error={siretOk ? undefined : "14 chiffres"} w={200} />
        <TextInput label="PACAGE" placeholder="9 chiffres (facultatif)" value={pacage} onChange={(e) => setPacage(e.currentTarget.value)} error={pacageOk ? undefined : "9 chiffres"} w={200} />
        <Button type="submit" loading={update.isPending} disabled={!siretOk || !pacageOk}>
          Valider
        </Button>
        <Button variant="subtle" onClick={onClose}>
          Annuler
        </Button>
      </Group>
      {error && (
        <Alert color="brique" mt="xs">
          {error}
        </Alert>
      )}
    </form>
  );
}
