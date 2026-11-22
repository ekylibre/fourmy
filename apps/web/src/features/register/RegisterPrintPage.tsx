import { Link, useSearchParams } from "react-router";
import { Alert, Anchor, Button, Group, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { OfficialRegister, OfficialRegisterField, OfficialRegisterLine } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { PrintHeader } from "../../components/PrintHeader";

const num = (v: string) => v.replace(".", ",");

/**
 * Registre phytosanitaire imprimable (issue #8, point 99) : le registre au format
 * réglementaire d'une campagne (arrêté du 24/12/2025, notice du 22/09/2026), avec
 * l'en-tête de la ferme, en A4 paysage. « Imprimer », puis « Enregistrer en PDF ».
 * Une ligne par produit et par parcelle ; un champ obligatoire manquant est écrit
 * « à compléter » dans sa case et compté au-dessus du tableau.
 */
export function RegisterPrintPage() {
  const farm = useFarm();
  const [params] = useSearchParams();
  const campaign = Number(params.get("campaign") ?? new Date().getFullYear());
  const q = useQuery({
    queryKey: ["register-official", farm.id, campaign],
    queryFn: () => api.get<OfficialRegister>(farmPath(farm.id, `/registers/phyto/official?campaign=${campaign}`)),
  });
  return (
    <div className="print-page print-landscape">
      <Group justify="space-between" className="no-print" mb="md">
        <Anchor component={Link} to={`/f/${farm.id}/register`}>
          ← Registre phyto
        </Anchor>
        <Button onClick={() => window.print()}>Imprimer ou enregistrer en PDF</Button>
      </Group>
      {q.isLoading ? <Loading /> : q.error ? <ErrorAlert error={q.error} /> : <RegisterDoc register={q.data!} />}
    </div>
  );
}

function RegisterDoc({ register: r }: { register: OfficialRegister }) {
  const incomplete = r.lines.filter((l) => l.anomalies.length).length;
  const missing = (l: OfficialRegisterLine, field: OfficialRegisterField, value: string) =>
    l.anomalies.includes(field) ? <i>à compléter</i> : value;
  return (
    <>
      <PrintHeader
        title="Registre d'utilisation des produits phytopharmaceutiques"
        detail={
          <>
            {" "}
            · PACAGE {r.holder.pacage ?? "non renseigné"} · Campagne {r.campaign}
          </>
        }
        legal="Format réglementaire : arrêté du 24/12/2025 et notice du ministère de l'Agriculture du 22/09/2026 (intitulés standard, une ligne par produit et par parcelle traitée)."
      />
      {!r.holder.siret && (
        <Alert color="paille" mb="sm">
          SIRET du détenteur non renseigné : il est obligatoire sur chaque ligne (Registre phyto → Format réglementaire → Modifier le détenteur).
        </Alert>
      )}
      <Text size="sm" mb="xs">
        {r.lines.length} traitement(s) enregistré(s)
        {incomplete ? ` · ${incomplete} ligne(s) avec un champ obligatoire à compléter` : " · toutes les lignes sont complètes"}.
      </Text>
      <Table fz="xs" withTableBorder withColumnBorders className="print-table" aria-label={`Registre phytosanitaire ${r.campaign}`}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Heures</Table.Th>
            <Table.Th>Parcelle</Table.Th>
            <Table.Th>Localisation</Table.Th>
            <Table.Th>Culture (OEPP)</Table.Th>
            <Table.Th>Stade BBCH</Table.Th>
            <Table.Th>Produit</Table.Th>
            <Table.Th>N° AMM</Table.Th>
            <Table.Th>Dose</Table.Th>
            <Table.Th>Surface traitée</Table.Th>
            <Table.Th>Cible</Table.Th>
            <Table.Th>Bio</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {r.lines.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={12}>Aucun traitement phytosanitaire sur cette campagne.</Table.Td>
            </Table.Tr>
          ) : (
            r.lines.map((l) => (
              <Table.Tr key={l.idTraitement}>
                <Table.Td className="lv-num">{missing(l, "dateIntervention", l.dateIntervention)}</Table.Td>
                <Table.Td className="lv-num">{l.heureDebut && `${l.heureDebut}–${l.heureFin}`}</Table.Td>
                <Table.Td>{l.links.parcelName}</Table.Td>
                <Table.Td className="lv-num">
                  {missing(l, "coordonneesGps", l.numIlot ? `îlot ${l.numIlot}${l.numParcelle ? `, parcelle ${l.numParcelle}` : ""}` : l.coordonneesGps)}
                </Table.Td>
                <Table.Td className="lv-num">{missing(l, "cultureOepp", l.cultureOepp)}</Table.Td>
                <Table.Td>{l.codeBbch}</Table.Td>
                <Table.Td>{missing(l, "nomProduit", l.nomProduit)}</Table.Td>
                <Table.Td className="lv-num">{missing(l, "numeroAMMProduit", l.numeroAMMProduit)}</Table.Td>
                <Table.Td className="lv-num">
                  {l.anomalies.includes("doseProduitValeur") || l.anomalies.includes("doseProduitUnite") ? (
                    <i>à compléter</i>
                  ) : (
                    `${num(l.doseProduitValeur)} ${l.doseProduitUnite}`
                  )}
                </Table.Td>
                <Table.Td className="lv-num">{l.anomalies.includes("surfaceTraitee") ? <i>à compléter</i> : `${num(l.surfaceTraitee)} ${l.surfaceUnite || "ha"}`}</Table.Td>
                <Table.Td>{l.usageCible}</Table.Td>
                <Table.Td>{l.modeDeConduite}</Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </>
  );
}
