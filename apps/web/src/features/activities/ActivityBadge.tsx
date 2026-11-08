import { Avatar, Group, Text } from "@mantine/core";
import { Sprout } from "lucide-react";
import type { Activity } from "@fourmy/contracts";

/** Image de l'activité (Lexicon : variété, sinon famille), ronde. */
export function ActivityPicture({ activity, size = 28 }: { activity: Pick<Activity, "name" | "pictureUrl" | "color">; size?: number }) {
  return (
    <Avatar
      src={activity.pictureUrl}
      alt=""
      size={size}
      radius="xl"
      style={{ border: `2px solid ${activity.color ?? "var(--mantine-color-lichen-5)"}`, flex: "none" }}
    >
      <Sprout size={size * 0.55} aria-hidden />
    </Avatar>
  );
}

/** Image et nom de l'activité (fiche d'une intervention, formulaire). */
export function ActivityBadge({ activity, size = 24 }: { activity: Pick<Activity, "name" | "pictureUrl" | "color">; size?: number }) {
  return (
    <Group gap={6} wrap="nowrap" aria-label={`Activité : ${activity.name}`}>
      <ActivityPicture activity={activity} size={size} />
      <Text size="sm" span>
        {activity.name}
      </Text>
    </Group>
  );
}

/** Activité d'une parcelle à une date : sa production de la campagne. */
export function activityOfParcel(
  parcelId: string,
  productions: { landParcelId: string; activityId?: string | null }[],
  activities: Activity[] | undefined,
): Activity | null {
  const p = productions.find((x) => x.landParcelId === parcelId && x.activityId);
  return (p && activities?.find((a) => a.id === p.activityId)) || null;
}
