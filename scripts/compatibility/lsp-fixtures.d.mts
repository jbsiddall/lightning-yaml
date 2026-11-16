export function loadPinnedCorpus(repoRoot: string): Array<{
  id: string;
  localPath: string;
  bytes: number;
  utf16Length: number;
  sha256: string;
  expectedDocuments: number;
  license: string;
  licenseSha256: string;
  source: string;
}>;
export function expandDocumentStream(fixture: { id: string; source: string; sha256: string }, copies: number): {
  id: string;
  bytes: number;
  repeatCount: number;
  source: string;
};
export function enumerateCells(batch: string): Array<{ id: string }>;
export const semanticSources: Readonly<Record<string, string>>;
