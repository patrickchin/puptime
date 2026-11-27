export type GuideRecording = { source: number; script: string; sourceText: string; duration: number; voice: string; model: string; attribution: boolean };

// Original Free-plan narration remains in assets for provenance, not shipping.
// Keep this registry free of its static imports: hiding a player alone still
// bundles its MP3. GuideListener already omits the player for absent recordings.
// Add recordings only after commercial rights and the actual bundle are checked.
export const guideRecordings: Record<string, GuideRecording> = {};
