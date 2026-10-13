import { createHash, randomUUID } from 'node:crypto';
import type { PrototypePreviewView, WorkspaceFileView } from './workspace-types';

export const PROTOTYPE_SCHEME = 'fielora-prototype';
export const MAX_PROTOTYPE_BYTES = 256 * 1024;
export const MAX_PROTOTYPE_PREVIEWS = 32;
export const PROTOTYPE_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const PREVIEW_URL = /^fielora-prototype:\/\/[0-9a-f]{32}\/index\.html$/;

export function isPrototypeUrl(value: string): boolean {
  return PREVIEW_URL.test(value);
}

export function sameFrameIdentity(
  left: { processId: number; routingId: number } | null | undefined,
  right: { processId: number; routingId: number } | null | undefined,
): boolean {
  return Boolean(left && right && left.processId === right.processId && left.routingId === right.routingId);
}

// Ephemeral immutable document bytes only: no directory mapping, external fetch,
// persistent artifact owner, or channel from generated code back into the app.
export class PrototypePreviewRegistry {
  readonly #documents = new Map<string, Uint8Array>();

  create(file: WorkspaceFileView, expectedSha256: string): PrototypePreviewView {
    if (!/\.html?$/i.test(file.relative_path) || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
      throw new Error('PROTOTYPE_UNAVAILABLE');
    }
    // WorkspaceRuntime's UTF-8 decoder strips an initial BOM. Recover only that
    // exact prefix, then verify the original byte count and SHA before serving.
    const bytes = new TextEncoder().encode(file.size === Buffer.byteLength(file.content, 'utf8') + 3 ? `\uFEFF${file.content}` : file.content);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROTOTYPE_BYTES || file.content.includes('\0')) {
      throw new Error('PROTOTYPE_TOO_LARGE');
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (file.size !== bytes.byteLength || file.sha256 !== sha256 || sha256 !== expectedSha256) {
      throw new Error('PROTOTYPE_CHANGED');
    }
    if (this.#documents.size >= MAX_PROTOTYPE_PREVIEWS) throw new Error('PROTOTYPE_TOO_MANY');
    const url = `${PROTOTYPE_SCHEME}://${randomUUID().replaceAll('-', '')}/index.html`;
    this.#documents.set(url, bytes);
    return { url, sha256, relative_path: file.relative_path, size: bytes.byteLength };
  }

  has(url: string): boolean { return isPrototypeUrl(url) && this.#documents.has(url); }

  release(url: string): void {
    if (!isPrototypeUrl(url)) throw new Error('PROTOTYPE_UNAVAILABLE');
    this.#documents.delete(url);
  }

  clear(): void { this.#documents.clear(); }

  response(url: string, method: string, trustedOrigin: string): Response {
    const bytes = method === 'GET' && isPrototypeUrl(url) ? this.#documents.get(url) : undefined;
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `${PROTOTYPE_CSP}; frame-ancestors ${trustedOrigin}`,
      // Native per-document policy also rejects WebRTC construction, which
      // otherwise bypasses CSP connect-src and session webRequest interception.
      'Connection-Allowlist': '()',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), fullscreen=(), payment=(), usb=(), serial=(), hid=(), display-capture=()',
    };
    return bytes
      ? new Response(bytes.slice(), { headers })
      : new Response('Preview unavailable', { status: 404, headers });
  }
}

export function allowPrototypeFrameNavigation(
  targetUrl: string, fromMainFrame: boolean, isMainFrame: boolean, registry: PrototypePreviewRegistry,
): boolean {
  return !isMainFrame && fromMainFrame && registry.has(targetUrl);
}
