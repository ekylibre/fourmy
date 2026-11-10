import { useState } from "react";
import { Button, Group, Select, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Download } from "lucide-react";
import type { PhytoRegisterEntry } from "@fourmy/contracts";
import { DataTable } from "mantine-datatable";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, formatNumber, unitLabel } from "../../app/labels";
import { usePhytoRegister } from "../../app/queries";
import { useColumns, type ColumnDef } from "../../app/columns";
import { ColumnPicker, pickColumns } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";
import { IftBalance } from "./IftBalance";

const REGISTER_COLUMNS: ColumnDef[] = [
  { key: "doneOn", label: "Date", required: true },
  { key: "parcelName", label: "Parcelle" },
  { key: "areaM2", label: "Surface" },
  { key: "crop", label: "Culture" },
  { key: "productName", label: "Produit" },
  { key: "amm", label: "N° AMM" },
  { key: "quantity", label: "Dose" },
  { key: "applicators", label: "Applicateur" },
];

/** Registre phytosanitaire d'une campagne — calculé, jamais saisi (FR-REG-1). */
export function RegisterPage() {
  const farm = useFarm();
  const { day } = useAt();
  const [campaign, setCampaign] = useState(Number(day.slice(0, 4)));
  const register = usePhytoRegister(farm.id, campaign);
  const columns = useColumns("register-phyto", REGISTER_COLUMNS);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2014 }, (_, i) => String(thisYear - i));

  const exportCsv = async () => {
    try {
      const blob = await api.download(farmPath(farm.id, `/registers/phyto?campaign=${campaign}&format=csv`));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `registre-phyto-${campaign}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notifications.show({ color: "brique", title: "Export impossible", message: String(e) });
    }
  };

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Title order={1}>Registre phytosanitaire</Title>
        <Group>
          <Select
            label="Campagne"
            data={years}
            value={String(campaign)}
            onChange={(v) => v && setCampaign(Number(v))}
            w={120}
            allowDeselect={false}
          />
          <ColumnPicker columns={columns} />
          <Button leftSection={<Download size={16} />} onClick={exportCsv} disabled={!register.data?.items.length}>
            Exporter en CSV
          </Button>
        </Group>
      </Group>
      <IftBalance farmId={farm.id} campaign={campaign} />
      {register.isLoading && <Loading />}
      {register.error && <ErrorAlert error={register.error} />}
      {register.data && (
        <>
          <Text c="dimmed" size="sm">
            {register.data.items.length} application(s) en {campaign}.
          </Text>
          <DataTable
            withTableBorder
            striped
            highlightOnHover
            minHeight={150}
            noRecordsText="Aucun traitement phytosanitaire sur cette campagne"
            records={register.data.items.map((e, i) => ({ ...e, key: `${e.interventionId}-${i}` }))}
            idAccessor="key"
            columns={pickColumns<PhytoRegisterEntry & { key: string }>([
              { accessor: "doneOn", title: "Date", render: (r) => <span className="lv-num">{formatDate(r.doneOn)}</span> },
              { accessor: "parcelName", title: "Parcelle" },
              { accessor: "areaM2", title: "Surface", textAlign: "right", render: (r) => <span className="lv-num">{formatNumber(r.areaM2 / 10_000)} ha</span> },
              { accessor: "crop", title: "Culture" },
              { accessor: "productName", title: "Produit" },
              { accessor: "amm", title: "N° AMM", render: (r) => <span className="lv-num">{r.amm}</span> },
              {
                accessor: "quantity",
                title: "Dose",
                textAlign: "right",
                render: (r) => (
                  <span className="lv-num">
                    {formatNumber(r.quantity, 3)} {unitLabel(r.unit)}
                  </span>
                ),
              },
              {
                accessor: "applicators",
                title: "Applicateur",
                render: (r) =>
                  r.applicators.length ? (
                    r.applicators.join(", ")
                  ) : (
                    <Text span size="sm" c="paille.8">
                      non renseigné
                    </Text>
                  ),
              },
            ], columns)}
          />
        </>
      )}
    </Stack>
  );
}
