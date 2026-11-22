# Customer Component Library

**Location:** `src/components/customer/`
**Design system:** CMYK process colours, Anek font, halftone textures. See `docs/redesign/DESIGN-PLAN.md`.

## Component index (27 files)

### Foundational
| Component | File | Purpose |
|-----------|------|---------|
| `CustomerButton` / `PrimaryButton` / `SecondaryButton` / `TextButton` | `button.tsx` | 48px min height, loading preserves width, 3 variants (cyan-ink fill / surface border / transparent) |
| `AppBar` | `app-bar.tsx` | Shop name + open/closed dot + subtitle. No hamburger. Sticky top. |
| `StickyActionBar` | `sticky-action-bar.tsx` | Bottom bar with live total + CTA. Safe-area aware. `aria-live` on price. |
| `LanguageSwitcher` | `language-switcher.tsx` | EN / हिंदी / తెలుగు segmented control |
| `AddToHomeScreenPrompt` | `add-to-home-screen.tsx` | Shows after 2nd order. Chrome: beforeinstallprompt. iOS: instructions. |

### Flow
| Component | File | Purpose |
|-----------|------|---------|
| `Stepper` | `stepper.tsx` | 3-step (Files → Options → Pay). Numbered (sequence). |
| `SegmentedControl` | `segmented-control.tsx` | One-sided / Double-sided, Portrait / Landscape. Keyboard accessible. |
| `Chip` / `ChipGroup` | `chip.tsx` | Paper size, presets. 36px pills. `aria-pressed`. |
| `NumberStepper` | `number-stepper.tsx` | Copies. Large ± targets, typing allowed, 1–100. |
| `BottomSheet` | `bottom-sheet.tsx` | Portal, focus trap, scroll lock, back-gesture closes. |

### Upload
| Component | File | Purpose |
|-----------|------|---------|
| `UploadDropzone` | `upload-dropzone.tsx` | Tap to choose, camera, gallery, drag/drop. Hidden file input. |
| `FileCard` | `file-card.tsx` | Thumbnail, name, pages, size, progress bar, remove, retry. |

### Signature
| Component | File | Purpose |
|-----------|------|---------|
| `PageThumb` | `page-thumb.tsx` | **The signature element.** Paper sheet that flips between halftone-B&W / process-colour / skip. 200ms Y-axis flip animation. Long-press for multi-select. |
| `PageStrip` | `page-strip.tsx` | Virtualized grid of PageThumbs (3 cols at 360px). Running totals. Bulk actions. Money nudge. `content-visibility: auto` for 500-page PDFs. |

### Price + Payment
| Component | File | Purpose |
|-----------|------|---------|
| `PriceBreakdown` | `price-breakdown.tsx` | Collapsed total → expandable itemised lines. Tabular numerals. `formatRupees()` helper. |
| `PaymentSheet` | `payment-sheet.tsx` | UPI app buttons (GPay/PhonePe/Paytm/BHIM/Other) + copy UPI ID. QR on desktop. |
| `UTRInput` | `utr-input.tsx` | 12-digit, numeric keypad, paste detection, live validation countdown. |

### Status
| Component | File | Purpose |
|-----------|------|---------|
| `StatusTimeline` | `status-timeline.tsx` | Numbered: Placed → Payment → Printing → Ready → Collected. Per-set sub-progress. |
| `TokenSlip` | `token-slip.tsx` | Perforated paper slip. Hero pickup code (32px bold). QR. `shadow-slip`. |
| `StatusPill` | `status-pill.tsx` | pending/printing/ready/collected/error. Colour-coded + text label. |

### Feedback
| Component | File | Purpose |
|-----------|------|---------|
| `SkeletonBox` / `SkeletonText` / `SkeletonCard` / `SkeletonPageStrip` | `skeleton.tsx` | Muted-tinted shimmer. `motion-reduce:animate-none`. |
| `EmptyState` | `empty-state.tsx` | Icon in circle + title + description + optional action. |
| `ErrorState` | `error-state.tsx` | What happened + how to fix. Never sorry, never vague. `role="alert"`. |
| `Toast` | `toast.tsx` | `aria-live="polite"`. Success/error/info. Auto-dismiss 4s. Above sticky bar. |
| `OfflineBanner` | `offline-banner.tsx` | Warning bg, WifiOff icon. Slides down when offline. |

### Forms
| Component | File | Purpose |
|-----------|------|---------|
| `FormField` | `form-field.tsx` | Label-above-input wrapper. `(required)` not asterisk. `aria-describedby`. |
| `TextField` | `text-field.tsx` | 16px text (no iOS zoom). Cyan-ink focus. Error + hint. |
| `PhoneField` | `phone-field.tsx` | +91 prefix, 10-digit, strips non-digits, inline validation. |
| `SensitiveDocumentToggle` | `sensitive-document-toggle.tsx` | Aadhaar/PAN: requires pickup code, deleted after printing. |

### Supporting lib
| Module | File | Purpose |
|--------|------|---------|
| `tokens` | `tokens.ts` | Colour/radius/spacing/type constants + `PageMode` type |
| `I18nProvider` / `useI18n` | `src/lib/i18n/i18n-provider.tsx` | React context, `{var}` interpolation, browser-lang detection |
| `messages` | `src/lib/i18n/messages.ts` | 60+ strings in en/hi/te |
| `analytics` | `src/lib/customer/analytics.ts` | `track()` fire-and-forget, localStorage queue, batch flush |
| `draft-storage` | `src/lib/customer/draft-storage.ts` | IndexedDB draft persistence |
| `last-choices` | `src/lib/customer/last-choices.ts` | localStorage smart defaults |
| `color-suggestion` | `src/lib/customer/color-suggestion.tsx` | Auto-detect prompt (Accept/Customize) |
| `recent-orders` | `src/lib/customer/recent-orders.ts` | localStorage order list |
| `order-status-mapping` | `src/lib/customer/order-status-mapping.ts` | API statuses → 5 timeline steps |
| `use-track-poll` | `src/lib/hooks/use-track-poll.ts` | Visibility-aware backoff poller |
| `use-online` | `src/lib/hooks/use-online.ts` | `navigator.onLine` + share intent |
| `use-draft-recovery` | `src/lib/hooks/use-draft-recovery.ts` | IndexedDB draft load/save/clear |

## Dev gallery
Visit `/dev/ui` to see every component in every state.
Visit `/dev/funnel` to see the analytics funnel view.
