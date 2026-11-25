/**
 * Type declarations for `jsqr` (QR-code decoding, used by /scan).
 *
 * jsQR 1.4.0 ships no bundled TypeScript declarations and `@types/jsqr`
 * is not a dependency, so without this file `tsc` (and therefore
 * `next build`, which type-checks with `ignoreBuildErrors: false`) fails
 * with "Cannot find module 'jsqr'". This minimal declaration mirrors the
 * real jsQR API surface used here — `jsQR(data, width, height, options)`
 * returning the decoded code or null — so the web app compiles without
 * adding a new dependency.
 */

declare module 'jsqr' {
  export interface QRCodePoint {
    x: number;
    y: number;
  }

  export interface QRCode {
    /** The decoded payload text. */
    data: string;
    /** Corner / finder-pattern locations in image coordinates. */
    location: {
      topRightCorner: QRCodePoint;
      topLeftCorner: QRCodePoint;
      bottomRightCorner: QRCodePoint;
      bottomLeftCorner: QRCodePoint;
      topRightFinderPattern: QRCodePoint;
      topLeftFinderPattern: QRCodePoint;
      bottomLeftFinderPattern: QRCodePoint;
    };
  }

  export interface JSQROptions {
    inversionAttempts?: 'attemptBoth' | 'invertFirst' | 'dontInvert';
    greyScaleWeights?: { red: number; green: number; blue: number; useIntegerApproximation?: boolean };
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: JSQROptions,
  ): QRCode | null;
}
