import { useState } from "react";
import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search } from "lucide-react";
import type { ArticleCopper, PhytoProduct, PhytoStatus } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate, formatDateTime } from "../../app/labels";
import { useColumns, type ColumnDef } from "../../app/columns";
import { ColumnPicker } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";

const PHYTO_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Produit", required: true },
  { key: "amm", label: "N° AMM" },
  { key: "referential", label: "Référentiel" },
  { key: "copper", label: "Cuivre" },
  { key: "actions", label: "Actions", required: true },
];

interface FarmPhytoArticle {
  id: string;
  name: string;
  unit: string;
  amm: string | null;
  product: { name: string; state: string; stoppedOn: string | null } | null;
  copper?: ArticleCopper;
}

const STATE: Record<string, { label: string; color: string }> = {
  authorized: { label: "Autorisé", color: "lichen" },
  withdrawn: { label: "Retiré", color: "brique" },
  inherited: { label: "Hérité", color: "gray" },
};

/**
 * Produits phyto de la ferme et référentiel E-Phy (exigences PHY-1, PHY-2,
 * GEO-1) : version du référentiel, eau chargée autour de la ferme, articles
 * rattachés à leur n° AMM, ajout d'un produit depuis le référentiel.
 */
export function PhytoProductsPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["phyto-status", farm.id], queryFn: () => api.get<PhytoStatus>(farmPath(farm.id, "/phyto/status")) });
  const list = useQuery({
    queryKey: ["phyto-articles", farm.id],
    queryFn: () => api.get<{ items: FarmPhytoArticle[] }>(farmPath(farm.id, "/phyto/articles")),
  });
  const [linking, setLinking] = useState<FarmPhytoArticle | null>(null);
  const [coppering, setCoppering] = useState<FarmPhytoArticle | null>(null);
  const [adding, setAdding] = useState(false);
  const columns = useColumns("phyto-products", PHYTO_COLUMNS);
  const refresh = () => {
    for (const key of ["phyto-status", "phyto-articles", "articles", "phyto-check", "intervention-compliance"]) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const water = useMutation({
    mutationFn: () => api.post<{ items: number }>(farmPath(farm.id, "/phyto/water/sync"), {}),
    onSuccess: (r) => {
      notifications.show({ color: "lichen", message: `${r.items} cours d'eau et plans d'eau chargés autour de la ferme.` });
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });

  if (status.isLoading || list.isLoading) return <Loading />;
  if (status.error) return <ErrorAlert error={status.error} />;
  const s = status.data!;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Produits phytosanitaires</Title>
        {owner && (
          <Button leftSection={<Plus size={16} />} onClick={() => setAdding(true)} disabled={!s.referential.phytosanitary}>
            Ajouter depuis le référentiel
          </Button>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper p="md" withBorder>
          <Text size="xs" c="dimmed">
            Référentiel E-Phy (ANSES, via Lexicon)
          </Text>
          {s.referential.phytosanitary ? (
            <>
              <Text fw={700}>Version {s.referential.phytosanitary}</Text>
              <Text size="xs" c="dimmed">
                Mis à jour automatiquement ; chargé le {formatDateTime(s.referential.loadedAt)}.
              </Text>
            </>
          ) : (
            <Text c="brique">Non chargé : contrôles impossibles.</Text>
          )}
        </Paper>
        <Paper p="md" withBorder>
          <Text size="xs" c="dimmed">
            Eau autour de la ferme (BD TOPO de l'IGN)
          </Text>
          <Text fw={700}>{s.water.syncedAt ? `${s.water.items} cours d'eau et plans d'eau` : "Pas encore chargée"}</Text>
          <Group justify="space-between" gap="xs">
            <Text size="xs" c={s.water.lastError ? "brique" : "dimmed"}>
              {s.water.lastError ?? (s.water.syncedAt ? `Chargée le ${formatDateTime(s.water.syncedAt)} ; sert au contrôle des ZNT.` : "Sert au contrôle des ZNT.")}
            </Text>
            {owner && (
              <Button size="compact-xs" variant="subtle" leftSection={<RefreshCw size={12} />} loading={water.isPending} onClick={() => water.mutate()}>
                Recharger
              </Button>
            )}
          </Group>
        </Paper>
        <Paper p="md" withBorder>
          <Text size="xs" c="dimmed">
            Produits de la ferme
          </Text>
          <Text fw={700}>
            {s.articles.linked} / {s.articles.phyto} rattachés au référentiel
          </Text>
          <Text size="xs" c={s.articles.withoutAmm + s.articles.unknownAmm ? "paille" : "dimmed"}>
            {s.articles.withoutAmm} sans n° AMM, {s.articles.unknownAmm} avec un n° AMM inconnu.
          </Text>
        </Paper>
      </SimpleGrid>

      <Group justify="flex-end">
        <ColumnPicker columns={columns} />
      </Group>
      <Table striped withTableBorder aria-label="Produits phyto de la ferme">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Produit</Table.Th>
            {columns.visible("amm") && <Table.Th>N° AMM</Table.Th>}
            {columns.visible("referential") && <Table.Th>Référentiel</Table.Th>}
            {columns.visible("copper") && <Table.Th>Cuivre métal</Table.Th>}
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data!.items.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>{a.name}</Table.Td>
              {columns.visible("amm") && <Table.Td className="lv-num">{a.amm ?? "—"}</Table.Td>}
              {columns.visible("referential") && (
                <Table.Td>
                  {a.product ? (
                    <Group gap={6}>
                      <Badge color={STATE[a.product.state]?.color ?? "gray"} variant="light">
                        {STATE[a.product.state]?.label ?? a.product.state}
                        {a.product.stoppedOn ? ` le ${formatDate(a.product.stoppedOn)}` : ""}
                      </Badge>
                      {a.product.name.toLowerCase() !== a.name.toLowerCase() && (
                        <Text size="xs" c="dimmed">
                          {a.product.name}
                        </Text>
                      )}
                    </Group>
                  ) : (
                    <Badge color="paille" variant="light">
                      {a.amm ? "N° AMM inconnu" : "Non rattaché"}
                    </Badge>
                  )}
                </Table.Td>
              )}
              {columns.visible("copper") && (
                <Table.Td>
                  {!a.copper ? (
                    "—"
                  ) : a.copper.from === "unknown" ? (
                    <Badge color="paille" variant="light" title="E-Phy ne permet pas de déduire la teneur en cuivre métal (contrôle AB)">
                      À saisir
                    </Badge>
                  ) : (
                    <Text size="sm">
                      {a.copper.g.toLocaleString("fr-FR")} g/{a.copper.per}{" "}
                      <Text span size="xs" c="dimmed">
                        ({a.copper.from === "ephy" ? "E-Phy" : "saisi"})
                      </Text>
                    </Text>
                  )}
                </Table.Td>
              )}
              <Table.Td ta="right">
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                  {owner && a.copper && (
                    <Button size="xs" variant="subtle" onClick={() => setCoppering(a)}>
                      Teneur en cuivre
                    </Button>
                  )}
                  {owner && !a.product && (
                    <Button size="xs" variant="light" onClick={() => setLinking(a)}>
                      Rattacher
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {coppering && (
        <CopperModal
          farmId={farm.id}
          article={coppering}
          onClose={() => setCoppering(null)}
          onSaved={() => {
            setCoppering(null);
            refresh();
            void queryClient.invalidateQueries({ queryKey: ["certifications"] });
            void queryClient.invalidateQueries({ queryKey: ["certification-check"] });
          }}
        />
      )}

      <ProductSearchModal
        farmId={farm.id}
        opened={adding || linking !== null}
        title={linking ? `Rattacher « ${linking.name} »` : "Ajouter un produit"}
        initial={linking?.name ?? ""}
        mode={linking ? "link" : "create"}
        onClose={() => {
          setAdding(false);
          setLinking(null);
        }}
        onPicked={async (product, unit) => {
          if (linking) await api.patch(farmPath(farm.id, `/articles/${linking.id}/amm`), { amm: product.amm });
          else await api.post(farmPath(farm.id, "/articles/phyto"), { productId: product.id, unit });
          notifications.show({ color: "lichen", message: linking ? `${linking.name} rattaché à ${product.name} (AMM ${product.amm}).` : `${product.name} ajouté aux produits de la ferme.` });
          setAdding(false);
          setLinking(null);
          refresh();
        }}
      />
    </Stack>
  );
}

/** Teneur en cuivre métal d'un produit (contrôle AB : 28 kg/ha sur 7 ans), quand E-Phy ne permet pas de la déduire. */
function CopperModal({ farmId, article, onClose, onSaved }: { farmId: string; article: FarmPhytoArticle; onClose: () => void; onSaved: () => void }) {
  const current = article.copper && article.copper.from !== "unknown" ? article.copper : null;
  const [g, setG] = useState<number | "">(current?.from === "article" ? current.g : "");
  const [per, setPer] = useState<"kg" | "L">(current?.per ?? (/litre|liter|^l$/i.test(article.unit) ? "L" : "kg"));
  const save = useMutation({
    mutationFn: (value: number | null) => api.put(farmPath(farmId, `/articles/${article.id}/copper`), { g: value, per }),
    onSuccess: onSaved,
  });
  return (
    <Modal opened onClose={onClose} title={`Cuivre métal : ${article.name}`}>
      <Stack>
        <Text size="sm">
          {current?.from === "ephy"
            ? `Teneur déduite d'E-Phy : ${current.g.toLocaleString("fr-FR")} g de cuivre métal par ${current.per}. Une teneur saisie la remplace.`
            : "E-Phy ne permet pas de déduire la teneur en cuivre métal de ce produit (sulfate de cuivre, sulfate tribasique ou teneur absente). Reportez celle de l'étiquette."}
        </Text>
        <Group align="flex-end" grow>
          <NumberInput label="Cuivre métal" suffix=" g" min={0} max={1000} decimalSeparator="," decimalScale={1} value={g} onChange={(v) => setG(v === "" ? "" : Number(v))} />
          <SegmentedControl
            aria-label="par"
            value={per}
            onChange={(v) => setPer(v as "kg" | "L")}
            data={[
              { value: "kg", label: "par kg" },
              { value: "L", label: "par litre" },
            ]}
          />
        </Group>
        {save.error && <ErrorAlert error={save.error} />}
        <Group>
          <Button disabled={g === "" || g <= 0} loading={save.isPending} onClick={() => save.mutate(Number(g))}>
            Enregistrer
          </Button>
          {current?.from === "article" && (
            <Button variant="subtle" color="gray" loading={save.isPending} onClick={() => save.mutate(null)}>
              Effacer la teneur saisie
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}

function ProductSearchModal({
  farmId,
  opened,
  title,
  initial,
  mode,
  onClose,
  onPicked,
}: {
  farmId: string;
  opened: boolean;
  title: string;
  initial: string;
  mode: "create" | "link";
  onClose: () => void;
  onPicked: (product: PhytoProduct, unit: "liter" | "kilogram") => Promise<void>;
}) {
  const [query, setQuery] = useState(initial);
  const [unit, setUnit] = useState<"liter" | "kilogram">("liter");
  const [error, setError] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(query, 300);
  const results = useQuery({
    queryKey: ["phyto-products", farmId, debounced],
    enabled: opened && debounced.trim().length >= 2,
    queryFn: () => api.get<{ items: PhytoProduct[] }>(farmPath(farmId, `/phyto/products?q=${encodeURIComponent(debounced.trim())}`)),
  });
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="lg">
      <Stack>
        <TextInput
          leftSection={<Search size={16} />}
          placeholder="Nom commercial ou n° AMM"
          aria-label="Rechercher dans le référentiel"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          data-autofocus
        />
        {mode === "create" && (
          <SegmentedControl
            aria-label="Unité de stock"
            value={unit}
            onChange={(v) => setUnit(v as "liter" | "kilogram")}
            data={[
              { value: "liter", label: "Liquide (L)" },
              { value: "kilogram", label: "Solide (kg)" },
            ]}
          />
        )}
        {error && <Alert color="brique">{error}</Alert>}
        <Stack gap={4} aria-label="Résultats">
          {(results.data?.items ?? []).map((p) => (
            <Paper key={p.id} p="xs" withBorder>
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={0}>
                  <Text size="sm" fw={600}>
                    {p.name}{" "}
                    <Text span size="xs" c="dimmed" className="lv-num">
                      AMM {p.amm}
                    </Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    {[p.natures.join(", "), p.otherNames.length ? `aussi : ${p.otherNames.join(", ")}` : null].filter(Boolean).join(" · ")}
                  </Text>
                </Stack>
                <Group gap={6} wrap="nowrap">
                  <Badge color={STATE[p.state]?.color ?? "gray"} variant="light">
                    {STATE[p.state]?.label ?? p.state}
                  </Badge>
                  <Button
                    size="xs"
                    onClick={() => {
                      setError(null);
                      onPicked(p, unit).catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
                    }}
                  >
                    {mode === "link" ? "Rattacher" : "Ajouter"}
                  </Button>
                </Group>
              </Group>
            </Paper>
          ))}
          {debounced.trim().length >= 2 && results.data?.items.length === 0 && (
            <Text size="sm" c="dimmed">
              Aucun produit trouvé.
            </Text>
          )}
        </Stack>
      </Stack>
    </Modal>
  );
}
