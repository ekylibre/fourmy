/**
 * Erreurs des imports : leur message s'affiche tel quel à l'utilisateur
 * (français, sans détail technique) ; l'API les traduit en 422.
 */
export class ImportFileError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported_format" | "corrupt_file" | "too_large" | "no_reader",
  ) {
    super(message);
    this.name = "ImportFileError";
  }
}

export const unsupportedFormat = (name: string) =>
  new ImportFileError(
    `Format non reconnu pour « ${name} » : Fourmy importe un fichier DAPLOS (.dap), l'export ZIP « Parcelles et Interventions » de Geofolia ou le dossier PAC XML de TelePAC.`,
    "unsupported_format",
  );

export const corruptFile = (name: string, detail: string) => new ImportFileError(`Fichier « ${name} » illisible : ${detail}`, "corrupt_file");
