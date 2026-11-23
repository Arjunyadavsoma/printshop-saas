# I18N Native-Speaker Review

**Purpose:** This document lists every customer-facing string in the PrintShop app for native-speaker review. Hindi and Telugu translations were generated programmatically — a native speaker MUST review each one for naturalness, cultural appropriateness, and brevity.

**Instructions for reviewers:**
1. Read each English string + its context
2. Check the Hindi / Telugu translation
3. Mark as ✅ (good), ⚠️ (needs revision), or ❌ (wrong)
4. If revising, write the corrected translation
5. Pay attention to: length (Indic text can be 40% longer), formality (use casual not formal), cultural fit (Indian context)

---

## Shop status

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| shop.open | Open | खुला है | తెరిచి ఉంది | Green dot in AppBar | |
| shop.closed | Closed | बंद है | మూసివేయబడింది | Red dot in AppBar | |
| shop.notAccepting | This shop is not accepting orders right now. | यह दुकान अभी ऑर्डर नहीं ले रही है। | ఈ దుకాణం ప్రస్తుతం ఆర్డర్‌లను స్వీకరించడం లేదు. | Closed shop page | |
| shop.rateBoard | B&W ₹{bw} · Colour ₹{colour} /page | बीएंडडब्ल्यू ₹{bw} · कलर ₹{colour} /पृष्ठ | బిఅండబ్ల్యూ ₹{bw} · కలర్ ₹{colour} /పేజీ | Rate board subtitle | |

## Upload

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| upload.dropOrTap | Drop files or tap to pick | फाइलें यहाँ डालें या टैप करें | ఫైళ్లను ఇక్కడ వేయండి లేదా ట్యాప్ చేయండి | Upload dropzone | |
| upload.acceptedFormats | PDF · JPG · PNG · DOCX | पीडीएफ · जेपीजी · पीएनजी · डीओसीएक्स | పిడిఎఫ్ · జెపిజి · పిఎన్‌జి · డాక్స్ | Below dropzone | |
| upload.preparing | Preparing your file | आपकी फाइल तैयार हो रही है | మీ ఫైల్ సిద్ధమవుతోంది | File processing state | |
| upload.tooBig | File is too large (max 50 MB) | फाइल बहुत बड़ी है (अधिकतम 50 एमबी) | ఫైల్ చాలా పెద్దది (గరిష్ఠం 50 ఎంబి) | Upload error | |

## Options / Presets

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| options.choosePreset | Choose a preset | प्रीसेट चुनें | ప్రీసెట్‌ను ఎంచుకోండి | Section heading | |
| options.moreOptions | More options | और विकल्प | మరిన్ని ఎంపికలు | Progressive disclosure row | |
| options.notesBW | Notes — B&W, double-sided | नोट्स — बीएंडडब्ल्यू, दोहरे पन्ने | నోట్స్ — బిఅండబ్ల్యూ, రెండు వైపులా | Preset card 1 | |
| options.colourAll | Colour — all pages | कलर — सभी पन्ने | కలర్ — అన్ని పేజీలు | Preset card 2 | |
| options.photo | Photo — 1 page, colour | फोटो — 1 पन्ना, कलर | ఫోటో — 1 పేజీ, కలర్ | Preset card 3 | |
| options.mix | Mix — choose colour pages | मिक्स — कलर पन्ने चुनें | మిక్స్ — కలర్ పేజీలను ఎంచుకోండి | Preset card 4 | |

## Page strip

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| page.bw | B&W | बीएंडडब्ल्यू | బిఅండబ్ల్యూ | Page label | |
| page.colour | Colour | कलर | కలర్ | Page label | |
| page.skip | Skip | छोड़ें | వదిలివేయి | Page label | |
| page.allBW | All B&W | सभी बीएंडडब्ल्यू | అన్ని బిఅండబ్ల్యూ | Bulk action | |
| page.allColour | All colour | सभी कलर | అన్ని కలర్ | Bulk action | |
| page.useSuggestion | Use suggestion | सुझाव उपयोग करें | సూచనను ఉపయోగించండి | Suggestion button | |
| page.suggestionPrompt | {n} pages look colourful. Print those in colour? | {n} पन्ने रंगीन लग रहे हैं। उन्हें कलर में प्रिंट करें? | {n} పేజీలు రంగులలో ఉన్నాయి. వాటిని కలర్‌లో ప్రింట్ చేయాలా? | Suggestion prompt | |
| page.accept | Accept | स्वीकारें | అంగీకరించు | Accept button | |
| page.customize | Customize | अनुकूलित करें | అనుకూలీకరించు | Customize button | |

## Pay

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| pay.total | Total | कुल | మొత్తం | Sticky bar label | |
| pay.payAmount | Pay ₹{amount} | ₹{amount} भुगतान करें | ₹{amount} చెల్లించండి | Primary CTA | |
| pay.placeOrder | Place order | ऑर्डर दें | ఆర్డర్ ఇవ్వండి | Primary CTA | |
| pay.mobileNumber | Mobile number | मोबाइल नंबर | మొబైల్ నంబర్ | Form label | |
| pay.name | Name (optional) | नाम (वैकल्पिक) | పేరు (ఐచ్ఛిక) | Form label | |
| pay.noteToShop | Note to shop (optional) | दुकान के लिए नोट (वैकल्पिक) | దుకాణానికి గమనిక (ఐచ్ఛిక) | Form label | |
| pay.enterUtr | Enter UTR (12 digits) | यूटीआर दर्ज करें (12 अंक) | యూటీఆర్ నమోదు చేయండి (12 అంకెలు) | UTR input label | |
| pay.waitingConfirm | Waiting for the shop to confirm your payment | दुकान द्वारा भुगतान की पुष्टि का इंतजार | దుకాణం మీ చెల్లింపును నిర్ధారించే వరకు వేచి ఉంది | Payment waiting state | |
| pay.payAtCounter | Pay at counter instead | काउंटर पर भुगतान करें | కౌంటర్ వద్ద చెల్లించండి | Alternative payment | |
| pay.callShop | Call shop | दुकान को कॉल करें | దుకాణానికి కాల్ చేయండి | Action button | |
| pay.ivPaid | I've paid | मैंने भुगतान किया | నేను చెల్లించాను | Payment confirmation | |

## Tracking

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| tracking.pickupCode | Pickup code | पिकअप कोड | పికప్ కోడ్ | Token slip label | |
| tracking.placed | Placed | दिया गया | ఇవ్వబడింది | Timeline step 1 | |
| tracking.payment | Payment | भुगतान | చెల్లింపు | Timeline step 2 | |
| tracking.printing | Printing | प्रिंट हो रहा है | ప్రింట్ అవుతోంది | Timeline step 3 | |
| tracking.ready | Ready | तैयार | సిద్ధం | Timeline step 4 | |
| tracking.collected | Collected | ले लिया गया | తీసుకున్నారు | Timeline step 5 | |
| tracking.showCodeAtCounter | Show this code at the counter | काउंटर पर यह कोड दिखाएं | కౌంటర్ వద్ద ఈ కోడ్ చూపండి | Token slip instruction | |
| tracking.shareOrder | Share order link | ऑर्डर लिंक साझा करें | ఆర్డర్ లింక్‌ను పంచుకోండి | Action button | |
| tracking.cancelOrder | Cancel order | ऑर्डर रद्द करें | ఆర్డర్ రద్దు చేయండి | Action button | |

## Orders

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| orders.noOrders | No orders yet. Scan a shop QR code to start. | अभी कोई ऑर्डर नहीं। शुरू करने के लिए दुकान का क्यूआर स्कैन करें। | ఇంకా ఆర్డర్‌లు లేవు. ప్రారంభించడానికి దుకాణం QR స్కాన్ చేయండి. | Empty state | |
| orders.recentOrders | Recent orders | हाल के ऑर्डर | ఇటీవలి ఆర్డర్‌లు | Section heading | |
| orders.trackOrder | Track order | ऑर्डर ट्रैक करें | ఆర్డర్ ట్రాక్ చేయండి | Order card action | |
| orders.printAgain | Print again | फिर से प्रिंट करें | మళ్లీ ప్రింట్ చేయండి | Order card action | |

## Common

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| common.back | Back | वापस | వెనుకకు | Back button | |
| common.retry | Try again | फिर से कोशिश करें | మళ్లీ ప్రయత్నించండి | Error retry | |
| common.cancel | Cancel | रद्द करें | రద్దు చేయండి | Cancel button | |
| common.done | Done | हो गया | పూర్తయింది | Done button | |
| common.loading | Loading… | लोड हो रहा है… | లోడ్ అవుతోంది… | Loading text | |
| common.offline | You're offline. Your draft is saved. | आप ऑफलाइन हैं। आपका ड्राफ्ट सहेजा गया है। | మీరు ఆఫ్‌లైన్‌లో ఉన్నారు. మీ డ్రాఫ్ట్ సేవ్ చేయబడింది. | Offline banner | |
| common.error | Something went wrong. Try again. | कुछ गलत हुआ। फिर से कोशिश करें। | ఏదో తప్పు జరిగింది. మళ్లీ ప్రయత్నించండి. | Error state | |

## Trust

| Key | English | Hindi | Telugu | Context | Review |
|-----|---------|-------|--------|---------|--------|
| trust.filesDeleted | Files deleted 24h after pickup | फाइलें पिकअप के 24 घंटे बाद हटा दी जाती हैं | పికప్ తర్వాత 24 గంటల తర్వాత ఫైళ్లు తొలగించబడతాయి | Trust line | |

---

## Reviewer notes

**Known concerns to check:**
1. "B&W" — transliterated as "बीएंडडब्ल्यू" in Hindi and "బిఅండబ్ల్యూ" in Telugu. These are long. Consider whether a shorter term is used colloquially (e.g. "काला-सफेद" in Hindi, "నలుపు-తెలుపు" in Telugu).
2. "UTR" — kept as-is in Hindi/Telugu. Confirm this is understood by customers or if a translation is needed.
3. "Preset" — translated as "प्रीसेट" / "ప్రీసెట్". Consider whether a more natural term exists (e.g. "तैयार विकल्प" / "సిద్ధ ఎంపిక").
4. "Pickup code" — translated literally. Confirm if "पिकअप कोड" / "పికప్ కోడ్" is the natural term or if something else is used.
5. Number formatting: prices use Intl.NumberFormat('en-IN') — verify this renders correctly in Hindi/Telugu contexts.
