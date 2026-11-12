import { Avatar } from "@mantine/core";

/** Couleurs des avatars sans photo : stables pour une personne (tirées de son id). */
const COLORS = ["lichen", "ardoise", "paille", "grape", "cyan", "orange"];

export const photoUrl = (farmId: string, personId: string, hash: string) => `/api/v1/farms/${farmId}/people/${personId}/photo?v=${hash}`;

/** Initiales : prénom et nom, sinon les deux premiers mots du nom. */
export function initials(p: { firstName?: string | null; lastName?: string | null; name: string }): string {
  const words = p.firstName || p.lastName ? [p.firstName, p.lastName] : p.name.split(/\s+/);
  return words
    .filter((w): w is string => !!w)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Photo de la personne, sinon ses initiales sur une couleur stable. */
export function PersonAvatar({
  farmId,
  person,
  size = 56,
}: {
  farmId: string;
  person: { id: string; name: string; firstName?: string | null; lastName?: string | null; photo: { hash: string } | null };
  size?: number;
}) {
  const color = COLORS[[...person.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % COLORS.length];
  return (
    <Avatar
      src={person.photo ? photoUrl(farmId, person.id, person.photo.hash) : null}
      alt={person.photo ? `Photo de ${person.name}` : undefined}
      size={size}
      radius="xl"
      color={color}
      variant="light"
    >
      {initials(person)}
    </Avatar>
  );
}
