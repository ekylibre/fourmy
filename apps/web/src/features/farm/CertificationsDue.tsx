import { Alert, Anchor, List } from "@mantine/core";
import { Link } from "react-router";
import { FARM_CERTIFICATION_LABELS } from "@fourmy/contracts";
import { certificationAlerts } from "@fourmy/domain";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useFarmProfile } from "../../app/queries";

/** Certificats de l'exploitation expirés ou à renouveler dans moins de 60 jours (E8), sur le tableau de bord. */
export function CertificationsDue({ day }: { day: string }) {
  const farm = useFarm();
  const profile = useFarmProfile(farm.id);
  const due = certificationAlerts(profile.data?.certifications ?? [], day);
  if (!due.length) return null;
  return (
    <Alert color="paille" title="Certificats à renouveler">
      <List size="sm">
        {due.map((c) => (
          <List.Item key={c.id}>
            {FARM_CERTIFICATION_LABELS[c.kind]}
            {c.number ? ` (${c.number})` : ""} : {c.daysLeft < 0 ? `expiré depuis le ${formatDate(c.expiresOn)}` : `expire le ${formatDate(c.expiresOn)}`}
          </List.Item>
        ))}
      </List>
      <Anchor component={Link} to={`/f/${farm.id}/farm`} size="sm">
        Voir dans Ma ferme
      </Anchor>
    </Alert>
  );
}
