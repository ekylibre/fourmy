import { ActionIcon, Button, Checkbox, Menu, Stack, Text, Tooltip } from "@mantine/core";
import { Columns3 } from "lucide-react";
import type { DataTableColumn } from "mantine-datatable";
import type { Columns } from "../app/columns";

/** Bouton « Colonnes » : cases à cocher des colonnes facultatives, réinitialisation. */
export function ColumnPicker({ columns }: { columns: Columns }) {
  const choosable = columns.defs.filter((d) => !d.required);
  if (!choosable.length) return null;
  return (
    <Menu position="bottom-end" closeOnItemClick={false} withinPortal>
      <Menu.Target>
        <Tooltip label="Colonnes affichées">
          <ActionIcon variant="default" size="lg" aria-label="Colonnes affichées">
            <Columns3 size={18} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Colonnes affichées</Menu.Label>
        <Stack gap={6} px="xs" py={4} role="group" aria-label="Colonnes">
          {choosable.map((d) => (
            <Checkbox key={d.key} size="xs" label={d.label} checked={columns.visible(d.key)} onChange={() => columns.toggle(d.key)} />
          ))}
        </Stack>
        <Menu.Divider />
        <Button variant="subtle" size="compact-xs" fullWidth onClick={columns.reset}>
          Réinitialiser
        </Button>
        <Text size="xs" c="dimmed" px="xs" pt={4} maw={220}>
          Choix gardé sur ce poste.
        </Text>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Colonnes d'un `DataTable` : masque celles que l'utilisateur a retirées. */
export function pickColumns<T>(defs: DataTableColumn<T>[], columns: Columns): DataTableColumn<T>[] {
  return defs.map((c) => ({ ...c, hidden: !columns.visible(String(c.accessor)) }));
}
