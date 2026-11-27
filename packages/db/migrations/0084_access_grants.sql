-- Lot AM1 (claudedocs/conception_api_mcp.md §3 et §4) : droits par module et
-- par activité. Rôle `guest` (membre restreint, B7) et ses droits dans
-- `access_grant` (`grant` est un mot réservé) ; l'invitation pourra les porter
-- (lot AM3). Format : contrat `accessGrant` (packages/contracts/src/access.ts),
-- vérifié par l'API à l'écriture.

ALTER TABLE memberships ADD COLUMN access_grant jsonb;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'worker', 'reader', 'guest'));
-- Un invité restreint a toujours des droits ; les autres rôles n'en portent pas.
ALTER TABLE memberships ADD CONSTRAINT memberships_grant_check
  CHECK ((role = 'guest') = (access_grant IS NOT NULL));

ALTER TABLE person_invitations ADD COLUMN access_grant jsonb;
ALTER TABLE person_invitations DROP CONSTRAINT IF EXISTS person_invitations_role_check;
ALTER TABLE person_invitations ADD CONSTRAINT person_invitations_role_check CHECK (role IN ('owner', 'worker', 'reader', 'guest'));
ALTER TABLE person_invitations ADD CONSTRAINT person_invitations_grant_check
  CHECK ((role = 'guest') = (access_grant IS NOT NULL));
