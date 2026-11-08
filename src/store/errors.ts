/** An error the user can fix; `details` are shown as a list. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'UserError';
  }
}

/** Another tab or window saved first, so nothing was saved; this tab has loaded the latest data (review R2). */
export class StaleDataError extends UserError {
  constructor() {
    super('Another tab or window saved changes first, so this was not saved. The latest data is now loaded: check it and save again.');
    this.name = 'StaleDataError';
  }
}

export function errorText(e: unknown): { title: string; details: string[] } {
  if (e instanceof UserError) return { title: e.message, details: e.details };
  if (e instanceof Error) {
    const details = (e as { details?: unknown }).details;
    return { title: e.message, details: Array.isArray(details) ? details.map(String) : [] };
  }
  return { title: String(e), details: [] };
}
