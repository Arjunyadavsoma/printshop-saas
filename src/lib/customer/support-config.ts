/**
 * Public support-contact configuration (audit P1-4 / Phase-3).
 *
 * Values come from NEXT_PUBLIC_* env vars so deployments can point
 * customers at a REAL mailbox and WhatsApp number. When a value is not
 * configured, callers must HIDE the control instead of showing a broken
 * one (the old build hardcoded support@printshop.local and a phoneless
 * wa.me link — both undeliverable).
 */
export const SUPPORT_EMAIL = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '').trim();
/** International format digits only, e.g. 919876543210 — used as wa.me/<number>. */
export const SUPPORT_WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');

export function supportMailto(subject: string, body?: string): string {
  const q = [
    subject ? `subject=${encodeURIComponent(subject)}` : '',
    body ? `body=${encodeURIComponent(body)}` : '',
  ]
    .filter(Boolean)
    .join('&');
  return `mailto:${SUPPORT_EMAIL}${q ? `?${q}` : ''}`;
}

export function supportWhatsAppLink(text?: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export const hasSupportEmail = () => SUPPORT_EMAIL.length > 0;
export const hasSupportWhatsApp = () => SUPPORT_WHATSAPP.length > 0;
