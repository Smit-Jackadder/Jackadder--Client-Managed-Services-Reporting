// App-level client settings (not stored on a board).
export interface ClientSetting {
  /** Display name used in reports and the dropdown. */
  name: string;
  /** Minutes allocated per month. null = no allocation set. */
  allocation: number | null;
  /** Contract start month as 'YYYY-MM'. null = not set. */
  contractStart: string | null;
  contractMonths: number;
  /** Client status labels that belong to this client on each board. */
  requestLabels: string[];
  incidentLabels: string[];
  /** Whether this client has a connected EOM Reporting Records board. */
  hasRecordsBoard: boolean;
}

export const CLIENT_SETTINGS: ClientSetting[] = [
  {
    name: 'ISACNT',
    allocation: 1200,
    contractStart: '2026-07',
    contractMonths: 12,
    requestLabels: ['ISACNT'],
    incidentLabels: ['ISACNT'],
    hasRecordsBoard: true,
  },
];

/** Labels on different boards that mean the same client (canonical name → aliases). */
export const CLIENT_ALIASES: Record<string, string[]> = {
  Jackadder: ['Jackadder', 'JI'],
};

export const EXCLUDED_CLIENT_LABELS = ['', 'N/A'];

export function canonicalClient(label: string): string {
  for (const [canon, aliases] of Object.entries(CLIENT_ALIASES)) {
    if (aliases.includes(label)) return canon;
  }
  return label;
}

/** Resolve a client name (setting or discovered label) into a full setting. */
export function resolveClient(name: string): ClientSetting {
  const found = CLIENT_SETTINGS.find((c) => c.name === name);
  if (found) return found;
  const labels = CLIENT_ALIASES[name] ?? [name];
  return {
    name,
    allocation: null,
    contractStart: null,
    contractMonths: 12,
    requestLabels: labels,
    incidentLabels: labels,
    hasRecordsBoard: false,
  };
}
