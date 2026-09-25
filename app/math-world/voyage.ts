/** Navigation-only bridge for a future, explicitly authored arithmetic interlude. */
export type ArchipelagoVoyage = Readonly<{
  id: string;
  fromDestinationId: string;
  toDestinationId: string;
}>;

export type VoyageActivityProps = Readonly<{
  voyage: ArchipelagoVoyage;
  /** Resume the same boat journey. This does not award XP or alter question history. */
  onContinue: () => void;
  onCancel: () => void;
}>;
