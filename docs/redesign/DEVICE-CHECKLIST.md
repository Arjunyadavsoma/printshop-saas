# Manual Real-Device Testing Checklist

Test the PrintShop customer mobile experience on real devices before shipping. The dev server + Playwright can't catch everything — real devices reveal touch precision, UPI app handoffs, font rendering, and network edge cases that simulators miss.

## Devices to test

| Device | Screen | OS | Browser | Priority |
|--------|--------|----|---------|----------|
| Low-end Android (Redmi/Realme, ≤4GB RAM) | 360×800 | Android 10+ | Chrome | P0 |
| Mid Android (Samsung A series, 6GB RAM) | 390×844 | Android 12+ | Chrome | P0 |
| Mid Android (same) | 390×844 | Android 12+ | Samsung Internet | P1 |
| iPhone SE (small screen) | 375×667 | iOS 16+ | Safari | P0 |
| iPhone 14/15 (standard) | 390×844 | iOS 17+ | Safari | P1 |
| Desktop (Chrome dev tools mobile) | 390×844 | macOS/Win | Chrome | P2 |

## UPI apps to install (for payment testing)

- Google Pay (GPay)
- PhonePe
- Paytm
- BHIM

## Test matrix

### 1. Full order journey (each device + browser)

- [ ] Scan a shop QR code → lands on `/s/[shop]`
- [ ] Shop name, open/closed dot, rate board visible
- [ ] Upload a PDF → progress bar shows → "Preparing your file" → page count appears
- [ ] Choose "Notes — B&W, double-sided" preset → price updates
- [ ] Choose "Mix" preset → page strip appears → tap a page → flips to colour
- [ ] Running totals update ("12 B&W · 3 Colour")
- [ ] Enter phone number (10-digit) → green checkmark appears
- [ ] Tap "Pay ₹X" → order placed → tracking page loads
- [ ] UPI app button tapped → correct UPI app opens with right amount + shop UPI ID
- [ ] After paying in UPI app → return to browser → "Did you pay?" shows
- [ ] Enter UTR (12 digits) → submit → "Waiting for shop to confirm"
- [ ] Shop confirms (shopkeeper dashboard) → tracking shows "Printing" → "Ready"
- [ ] Pickup code visible on token slip
- [ ] "Show this code at the counter" message visible

### 2. Edge cases

- [ ] **Refresh mid-upload:** upload starts → refresh page → draft restores (IndexedDB)
- [ ] **Back gesture during payment:** tap UPI app → back gesture → returns to "Did you pay?" state
- [ ] **Payment rejected:** shop rejects → tracking shows reason → "Enter UTR again" + "Pay at counter" available
- [ ] **Shop closed:** navigate to a closed shop → "not accepting orders" + hours shown
- [ ] **Offline during order:** turn off WiFi mid-flow → OfflineBanner appears → draft saved → turn on WiFi → flow resumes
- [ ] **Slow network:** throttle to 2G → "Preparing your file" shows → eventually completes (no timeout for 8s)
- [ ] **500-page PDF:** upload a large PDF → page strip scrolls smoothly (virtualization)
- [ ] **Hindi UI:** switch to हिंदी → all strings update → no layout breakage at 360px
- [ ] **Telugu UI:** switch to తెలుగు → all strings update → no layout breakage at 360px

### 3. Touch + accessibility

- [ ] All buttons ≥ 48px (measure with dev tools)
- [ ] Page strip tiles tappable with thumb (no mis-taps)
- [ ] Bottom sheet opens/closes with swipe + back gesture
- [ ] Screen reader (TalkBack/VoiceOver) reads: shop name, price, status changes, pickup code
- [ ] Keyboard focus visible (cyan-ink outline) when tabbing
- [ ] No horizontal scroll at 360px width
- [ ] Safe area respected (notch/home indicator)
- [ ] Text resizable to 200% (browser zoom) → no overflow

### 4. UPI payment handoff (real apps)

- [ ] **GPay:** tap → GPay opens → correct amount + shop UPI ID → pay → return → UTR entry
- [ ] **PhonePe:** same flow
- [ ] **Paytm:** same flow
- [ ] **BHIM:** same flow
- [ ] **Other UPI apps:** "Other" button → system chooser opens
- [ ] **No UPI app installed:** "No UPI app installed" message → "Pay at counter" available
- [ ] **Desktop:** QR code shown instead of app buttons

### 5. PWA installation

- [ ] After 2nd order → "Add to home screen" prompt appears
- [ ] Chrome: tapping "Install" → native install dialog → app appears on home screen
- [ ] iOS: instructions shown → manual Share → Add to Home Screen works
- [ ] Dismissing the prompt → doesn't appear again
- [ ] Already installed → prompt never shows

## Known limits (honest assessment)

### What was NOT tested in this redesign

1. **Real UPI app handoffs** — the UPI deep-link is wired to the real `shop.upiId` + order amount, but the actual payment completion depends on the shop's UPI ID being valid + the customer having a UPI app installed. This must be tested on a real device with real UPI apps + a real (or test) shop UPI ID.

2. **Real-device performance** — Lighthouse was run on the dev server (Turbopack + in-memory DB), not production. Production numbers (Vercel CDN + minified + gzipped) will be significantly better. The Lighthouse CI gate must be run on the deployed Vercel app to get definitive LCP/INP/CLS.

3. **500-page PDF** — the page strip uses `content-visibility: auto` + `contain-intrinsic-size` for virtualization, but was not tested with a real 500-page PDF. The virtualization should work, but rendering 500 thumbnails (even lazy) may still be slow on a low-end device.

4. **Hindi + Telugu rendering** — the Anek Devanagari + Telugu fonts are loaded via next/font with `display: swap`, but were not visually tested at 360px on a real device. Indic scripts may need more line-height (1.6 is set via CSS `:lang(hi)/:lang(te)`) + may cause text overflow on small screens.

5. **axe automated checks** — `axe-core` was added to devDependencies + the `runAxeCheck` helper exists, but no Playwright tests were written that call it. The accessibility checks are manual until Playwright tests are added.

6. **Socket.IO live updates** — the tracking page polls every 5s (with backoff). Socket.IO realtime was not wired — the polling fallback is the current implementation. Real-time push requires the WebSocket mini-service to be running.

7. **Phone OTP** — the `/orders` page has a "Look up by phone" panel, but no OTP backend was built. It's a UI placeholder.

8. **Resumable chunked upload** — the upload flow uses chunked uploads (`/uploads/init` → `/chunk` → `/complete`), but resume-after-interruption (network drops mid-chunk) was not tested. The draft is saved to IndexedDB, but an interrupted upload would need to resume from the last successful chunk.

9. **Offline order queue** — the OfflineBanner shows when offline, but mutations aren't queued for replay on reconnect. A refresh while offline loses in-memory state (IndexedDB draft survives, but in-progress uploads don't).

10. **Dark mode** — the design system defines light-mode tokens. Dark mode colour mapping was deferred (the brief said "optional dark mode that follows the system"). The CSS variables would need dark-mode counterparts.
