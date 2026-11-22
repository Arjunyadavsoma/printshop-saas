/**
 * Camera bridge — native document capture + file picking.
 *
 * Replaces the web's `<input type="file" accept="image/*" capture="camera">`
 * with the Capacitor Camera plugin, which uses Android's CameraX API for
 * better capture quality + native permission UX.
 *
 * The web app calls `window.NativeApp.camera.scan()` when the user taps
 * "Upload" inside the companion app (feature-detected via `window.NativeApp`).
 * The returned base64 is uploaded to the same `/api/v1/orders/[id]/files`
 * endpoint the web upload uses — the backend doesn't know or care whether
 * the file came from a browser file input or the native camera.
 */
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export async function scanDocument(): Promise<{
  base64: string;
  mimeType: string;
  filename: string;
} | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 85, // JPEG quality — 85 is a good balance for document capture
      allowEditing: false, // no crop — the user re-takes if it's wrong
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera, // force the camera (not gallery)
      saveToGallery: false, // scans are temporary — don't pollute the gallery
      correctOrientation: true, // auto-rotate based on EXIF
      presentationStyle: 'fullscreen',
    });
    if (!photo.base64String) return null;
    return {
      base64: photo.base64String,
      mimeType: photo.format === 'png' ? 'image/png' : 'image/jpeg',
      filename: `scan-${Date.now()}.${photo.format ?? 'jpg'}`,
    };
  } catch (err) {
    // User cancelled, or permission denied — return null (no throw) so the
    // web app's "no file selected" path runs naturally.
    return null;
  }
}

export async function pickDocument(): Promise<{
  base64: string;
  mimeType: string;
  filename: string;
} | null> {
  try {
    // Camera.getPhoto with source=Photos opens the gallery for a single image.
    // For PDFs + multi-select, we'd need @capacitor-community/file-picker —
    // but the MVP supports single-image picks via the gallery, and PDFs via
    // the web fallback (the file input still works in the WebView).
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Photos, // open the gallery
      correctOrientation: true,
      presentationStyle: 'popover',
    });
    if (!photo.base64String) return null;
    return {
      base64: photo.base64String,
      mimeType: photo.format === 'png' ? 'image/png' : 'image/jpeg',
      filename: `upload-${Date.now()}.${photo.format ?? 'jpg'}`,
    };
  } catch {
    return null;
  }
}
