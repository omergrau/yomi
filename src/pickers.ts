// Platforms without a native dialog fall back to typed fields in the task sheet.
export const hasNativePickers = false;
export const pickDate = async (_current: string | null, _min: string): Promise<string | null> => null;
export const pickTime = async (_current: string | null): Promise<string | null> => null;
