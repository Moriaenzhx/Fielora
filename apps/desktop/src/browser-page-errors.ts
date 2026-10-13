/** Bounded, untrusted observations from the current Agent-owned document. */
export class BrowserPageErrors {
  private entries: { message: string; source: string; line: number }[] = [];

  reset(): void { this.entries = []; }

  observe(details: { level: string; message: string; sourceId: string; lineNumber: number }): void {
    if (details.level !== 'error') return;
    let source = '';
    try {
      const url = new URL(details.sourceId);
      // Data/blob URLs can contain the whole document. Keep only useful public
      // source identity; no credentials, fragment or query-bearing URL.
      if (['http:', 'https:'].includes(url.protocol)) source = `${url.origin}${url.pathname}`.slice(0, 512);
    } catch { /* An absent source is not an absence of errors. */ }
    const message = Array.from(details.message.slice(0, 800))
      .filter(c => c.charCodeAt(0) >= 32 || ['\n', '\r', '\t'].includes(c)).join('');
    if (!message) return;
    const entry = { message, source, line: Number.isInteger(details.lineNumber) && details.lineNumber > 0 ? details.lineNumber : 0 };
    if (this.entries.some(e => e.message === entry.message && e.source === source && e.line === entry.line)) return;
    this.entries.push(entry);
    if (this.entries.length > 8) this.entries.shift();
  }

  snapshot(): { message: string; source: string; line: number }[] { return this.entries.map(e => ({ ...e })); }
}
