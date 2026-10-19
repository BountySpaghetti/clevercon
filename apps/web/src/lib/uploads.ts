import { apiPost } from './api';
import { isDemo } from '../config';

export interface ArtifactRef {
  url: string;
  hash: string | null;
  contentType: string;
  size: number;
}

/** SHA-256 of a file (hex), computed in the browser so the ArtifactRef is verifiable. */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Upload a file straight to R2 via a presigned PUT and return its ArtifactRef.
 * The bytes never touch our API: we ask for a presigned URL, PUT the file to R2,
 * and hand back {url, hash, contentType, size} to attach to a job. Throws a clear
 * error if storage is not configured (the presign call returns 503).
 */
export async function uploadFile(file: File): Promise<ArtifactRef> {
  if (isDemo()) throw new Error('File upload is not available in the demo');
  const sha256 = await sha256Hex(file);
  const presigned = await apiPost<{
    uploadUrl: string;
    headers: Record<string, string>;
    artifact: ArtifactRef;
  }>('/uploads/presign', {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    sha256,
  });
  const put = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: presigned.headers,
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return presigned.artifact;
}
