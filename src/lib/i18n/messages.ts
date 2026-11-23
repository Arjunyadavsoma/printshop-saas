/**
 * PrintShop i18n — English only (by decision).
 *
 * Hindi and Telugu have been REMOVED. This file is kept as a thin wrapper
 * so existing components that call `t('key')` continue to work without
 * per-file changes. The catalog is a flat `Record<string, string>` — no
 * locale switching, no browser-language detection, no localStorage locale key.
 *
 * To add a new string: add it to `messages` below + use `t('key')` in the
 * component. No hard-coded user-facing strings in components.
 */

export const messages: Record<string, string> = {
  'shop.open': 'Open',
  'shop.closed': 'Closed',
  'shop.notAccepting': 'This shop is not accepting orders right now.',
  'shop.rateBoard': 'B&W ₹{bw} · Colour ₹{colour} /page',
  'upload.dropOrTap': 'Drop files or tap to pick',
  'upload.acceptedFormats': 'PDF · JPG · PNG · DOCX',
  'upload.preparing': 'Preparing your file',
  'upload.tooBig': 'File is too large (max 50 MB)',
  'options.choosePreset': 'Choose a preset',
  'options.moreOptions': 'More options',
  'options.notesBW': 'Notes — B&W, double-sided',
  'options.colourAll': 'Colour — all pages',
  'options.photo': 'Photo — 1 page, colour',
  'options.mix': 'Mix — choose colour pages',
  'page.bw': 'B&W',
  'page.colour': 'Colour',
  'page.skip': 'Skip',
  'page.allBW': 'All B&W',
  'page.allColour': 'All colour',
  'page.useSuggestion': 'Use suggestion',
  'page.suggestionPrompt': '{n} pages look colourful. Print those in colour?',
  'page.accept': 'Accept',
  'page.customize': 'Customize',
  'pay.total': 'Total',
  'pay.payAmount': 'Pay ₹{amount}',
  'pay.placeOrder': 'Place order',
  'pay.mobileNumber': 'Mobile number',
  'pay.name': 'Name (optional)',
  'pay.noteToShop': 'Note to shop (optional)',
  'pay.enterUtr': 'Enter UTR (12 digits)',
  'pay.waitingConfirm': 'Waiting for the shop to confirm your payment',
  'pay.payAtCounter': 'Pay at counter instead',
  'pay.callShop': 'Call shop',
  'pay.ivPaid': "I've paid",
  'tracking.pickupCode': 'Pickup code',
  'tracking.placed': 'Placed',
  'tracking.payment': 'Payment',
  'tracking.printing': 'Printing',
  'tracking.ready': 'Ready',
  'tracking.collected': 'Collected',
  'tracking.showCodeAtCounter': 'Show this code at the counter',
  'tracking.shareOrder': 'Share order link',
  'tracking.cancelOrder': 'Cancel order',
  'orders.noOrders': 'No orders yet. Scan a shop QR code to start.',
  'orders.recentOrders': 'Recent orders',
  'orders.trackOrder': 'Track order',
  'orders.printAgain': 'Print again',
  'common.back': 'Back',
  'common.retry': 'Try again',
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.loading': 'Loading…',
  'common.offline': "You're offline. Your draft is saved.",
  'common.error': 'Something went wrong. Try again.',
  'trust.filesDeleted': 'Files deleted 24h after pickup',
};

export type MessageKey = keyof typeof messages;
