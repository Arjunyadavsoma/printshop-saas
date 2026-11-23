/**
 * Printelyx "Clear" design system — component barrel.
 *
 * Single import surface for the Clear component library:
 *   import { PrimaryButton, Input, Group, Sheet } from '@/components/clear';
 *
 * All components use the CSS variable tokens defined in
 * `src/app/globals.css` (--ground, --surface, --label, --accent, etc.).
 * No hardcoded hex values. Radii come from the role-specific tokens
 * (--radius-input, --radius-group, --radius-sheet, --radius-card;
 * buttons and chips are fully rounded).
 *
 * Font: Instrument Sans (loaded via the root layout, mapped to
 * --font-sans in globals.css).
 *
 * Touch targets: 48px default, 44px compact (WCAG 2.5.5). Input text is
 * 16px to prevent iOS Safari zoom-on-focus. Keyboard focus is a 2px
 * accent ring applied globally via `*:focus-visible` in globals.css.
 */

// ── Buttons ──
export {
  ClearButton,
  PrimaryButton,
  TintedButton,
  DestructiveButton,
  TextButton,
  type ClearButtonProps,
  type ClearButtonVariant,
  type ClearButtonSize,
} from './button';

export { IconButton, type IconButtonProps, type IconButtonVariant } from './icon-button';

// ── Inputs ──
export { Input, ClearInput, type ClearInputProps } from './input';
export { PhoneInput, ClearPhoneInput, type PhoneInputProps } from './phone-input';
export { UTRInput, ClearUTRInput, type UTRInputProps } from './utr-input';

// ── Selection controls ──
export { Chip, ChipGroup, ClearChip, ClearChipGroup, type ChipProps, type ChipGroupProps } from './chip';
export { Badge, ClearBadge, type BadgeProps } from './badge';
export {
  StatusPill,
  ClearStatusPill,
  STATUS_LABELS,
  type StatusPillProps,
  type OrderStatus,
} from './status-pill';
export { Switch, ClearSwitch, type SwitchProps } from './switch';
export {
  SegmentedControl,
  ClearSegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './segmented-control';
export {
  RadioRowGroup,
  ClearRadioRowGroup,
  type RadioRowGroupProps,
  type RadioOption,
} from './radio-row';
export { Checkbox, ClearCheckbox, type CheckboxProps } from './checkbox';

// ── Skeletons ──
export {
  SkeletonBox,
  SkeletonLabel,
  SkeletonSecondary,
  SkeletonCard,
  SkeletonPageStrip,
  ClearSkeletonBox,
  ClearSkeletonLabel,
  ClearSkeletonSecondary,
  ClearSkeletonCard,
  ClearSkeletonPageStrip,
  type SkeletonBoxProps,
  type SkeletonLabelProps,
  type SkeletonSecondaryProps,
  type SkeletonCardProps,
  type SkeletonPageStripProps,
} from './skeleton';

// ── Containers ──
export { Group, ClearGroup, type GroupProps } from './group';
export {
  InsetList,
  InsetRow,
  ChevronRow,
  ValueRow,
  SwitchRow,
  ClearInsetList,
  ClearInsetRow,
  ClearChevronRow,
  ClearValueRow,
  ClearSwitchRow,
  type InsetListProps,
  type InsetRowProps,
} from './inset-list';
export { Sheet, ClearSheet, type SheetProps } from './sheet';
export { PriceBar, ClearPriceBar, type PriceBarProps } from './price-bar';
export {
  PriceBreakdown,
  ClearPriceBreakdown,
  formatRupees,
  formatRupees as clearFormatRupees,
  type PriceBreakdownProps,
  type PriceLine,
} from './price-breakdown';
// ── Print-flow domain components ──
export { UploadDropzone, ClearUploadDropzone, type UploadDropzoneProps } from './upload-dropzone';
export { PageStrip } from './page-strip';
export { FileCard, ClearFileCard, type FileCardProps, type FileCardFile, type FileCardStatus } from './file-card';
export { NumberStepper, ClearNumberStepper } from './number-stepper';
export { PaymentSheet, ClearPaymentSheet } from './payment-sheet';
export {
  ColorSuggestionPrompt,
  ClearColorSuggestionPrompt,
  type ColorSuggestion,
} from './color-suggestion';
export { TokenSlip, ClearTokenSlip } from './token-slip';
export {
  StatusTimeline,
  ClearStatusTimeline,
  type TimelineStep,
  type StepStatus,
} from './status-timeline';

// ── Shells ──
export { CustomerShell } from './customer-shell';
export { ShopShellMobile, type ShopShellMobileProps } from './shop-shell-mobile';
export { ShopShellDesktop, type ShopShellDesktopProps } from './shop-shell-desktop';
export { ShopShellTablet, type ShopShellTabletProps } from './shop-shell-tablet';

export { EmptyState, ClearEmptyState, type EmptyStateProps } from './empty-state';
export { ErrorState, ClearErrorState, type ErrorStateProps } from './error-state';
export { Toast, ClearToast, type ToastProps } from './toast';
export { Banner, ClearBanner, type BannerProps, type BannerVariant } from './banner';
export { Stepper, ClearStepper, type StepperProps } from './stepper';
export {
  Accordion,
  AccordionGroup,
  ClearAccordion,
  ClearAccordionGroup,
  type AccordionProps,
  type AccordionGroupProps,
} from './accordion';
