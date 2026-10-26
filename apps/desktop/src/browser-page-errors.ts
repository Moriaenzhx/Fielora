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

type ResourceFailure = { url: string; resource_type: string; status_code?: number; network_error?: string };

/** Native request facts only; no response bodies, headers or page-supplied error prose. */
export class BrowserResourceErrors {
  private readonly pending = new Map<number, Pick<ResourceFailure, 'url' | 'resource_type'>>();
  private entries: ResourceFailure[] = [];

  reset(): void { this.pending.clear(); this.entries = []; }

  begin(details: { id: number; url: string; resourceType: string }): void {
    if (['mainFrame', 'subFrame'].includes(details.resourceType)) return;
    try {
      const url = new URL(details.url);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (this.pending.size >= 256) this.pending.delete(this.pending.keys().next().value!);
      this.pending.set(details.id, { url: `${url.origin}${url.pathname}`.slice(0, 512), resource_type: details.resourceType.slice(0, 40) });
    } catch { /* No useful source identity. */ }
  }

  complete(details: { id: number; statusCode?: number; error?: string }): void {
    const request = this.pending.get(details.id);
    this.pending.delete(details.id);
    if (!request) return;
    const failure: ResourceFailure = { ...request };
    if (Number.isInteger(details.statusCode) && details.statusCode! >= 400 && details.statusCode! <= 599) failure.status_code = details.statusCode;
    if (details.error) failure.network_error = /^net::ERR_[A-Z_0-9]{1,80}$/.test(details.error) ? details.error : 'NETWORK_ERROR';
    if (!failure.status_code && !failure.network_error) return;
    if (!this.entries.some(e => JSON.stringify(e) === JSON.stringify(failure))) this.entries.push(failure);
    if (this.entries.length > 8) this.entries.shift();
  }

  snapshot(): ResourceFailure[] { return this.entries.map(e => ({ ...e })); }
}
