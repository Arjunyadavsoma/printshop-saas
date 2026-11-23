/**
 * Compatibility layer — re-exports Clear components with old CMYK names.
 *
 * This allows customer routes to import from '@/components/clear/' using the
 * old component names (SecondaryButton, TextField, etc.) while the Clear
 * components have different export names (TintedButton, Input, etc.).
 *
 * As each route is properly migrated to use Clear component names directly,
 * these aliases can be removed.
 */

export { PrimaryButton, TintedButton as SecondaryButton, TextButton } from './button';
export { Input as TextField } from './input';
export { PhoneInput as PhoneField } from './phone-input';
export { PriceBar as StickyActionBar } from './price-bar';
export { Sheet as BottomSheet } from './sheet';
export { SkeletonBox, SkeletonLabel as SkeletonText, SkeletonCard } from './skeleton';
export { Banner as OfflineBanner } from './banner';
export { PageTile as PageThumb } from './page-tile';
export { PageStrip } from './page-strip';
