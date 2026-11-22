/**
 * PrintShop customer i18n — message catalogs for English, Hindi, Telugu.
 *
 * Structure: flat key → { locale: translation }.
 * The `t(key, vars)` function in `use-translate.ts` does `{var}` interpolation.
 *
 * Hindi + Telugu translations are natural (not literal) + kept short.
 */

export type Locale = 'en' | 'hi' | 'te';

export const LOCALES: { value: Locale; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'hi', label: 'हिंदी', short: 'हिं' },
  { value: 'te', label: 'తెలుగు', short: 'తె' },
];

export const messages = {
  'shop.open': { en: 'Open', hi: 'खुला है', te: 'తెరిచి ఉంది' },
  'shop.closed': { en: 'Closed', hi: 'बंद है', te: 'మూసివేయబడింది' },
  'shop.notAccepting': { en: 'This shop is not accepting orders right now.', hi: 'यह दुकान अभी ऑर्डर नहीं ले रही है।', te: 'ఈ దుకాణం ప్రస్తుతం ఆర్డర్‌లను స్వీకరించడం లేదు.' },
  'shop.rateBoard': { en: 'B&W ₹{bw} · Colour ₹{colour} /page', hi: 'बीएंडडब्ल्यू ₹{bw} · कलर ₹{colour} /पृष्ठ', te: 'బిఅండబ్ల్యూ ₹{bw} · కలర్ ₹{colour} /పేజీ' },

  'upload.dropOrTap': { en: 'Drop files or tap to pick', hi: 'फाइलें यहाँ डालें या टैप करें', te: 'ఫైళ్లను ఇక్కడ వేయండి లేదా ట్యాప్ చేయండి' },
  'upload.acceptedFormats': { en: 'PDF · JPG · PNG · DOCX', hi: 'पीडीएफ · जेपीजी · पीएनजी · डीओसीएक्स', te: 'పిడిఎఫ్ · జెపిజి · పిఎన్‌జి · డాక్స్' },
  'upload.preparing': { en: 'Preparing your file', hi: 'आपकी फाइल तैयार हो रही है', te: 'మీ ఫైల్ సిద్ధమవుతోంది' },
  'upload.tooBig': { en: 'File is too large (max 50 MB)', hi: 'फाइल बहुत बड़ी है (अधिकतम 50 एमबी)', te: 'ఫైల్ చాలా పెద్దది (గరిష్ఠం 50 ఎంబి)' },

  'options.choosePreset': { en: 'Choose a preset', hi: 'प्रीसेट चुनें', te: 'ప్రీసెట్‌ను ఎంచుకోండి' },
  'options.moreOptions': { en: 'More options', hi: 'और विकल्प', te: 'మరిన్ని ఎంపికలు' },
  'options.notesBW': { en: 'Notes — B&W, double-sided', hi: 'नोट्स — बीएंडडब्ल्यू, दोहरे पन्ने', te: 'నోట్స్ — బిఅండబ్ల్యూ, రెండు వైపులా' },
  'options.colourAll': { en: 'Colour — all pages', hi: 'कलर — सभी पन्ने', te: 'కలర్ — అన్ని పేజీలు' },
  'options.photo': { en: 'Photo — 1 page, colour', hi: 'फोटो — 1 पन्ना, कलर', te: 'ఫోటో — 1 పేజీ, కలర్' },
  'options.mix': { en: 'Mix — choose colour pages', hi: 'मिक्स — कलर पन्ने चुनें', te: 'మిక్స్ — కలర్ పేజీలను ఎంచుకోండి' },

  'page.bw': { en: 'B&W', hi: 'बीएंडडब्ल्यू', te: 'బిఅండబ్ల్యూ' },
  'page.colour': { en: 'Colour', hi: 'कलर', te: 'కలర్' },
  'page.skip': { en: 'Skip', hi: 'छोड़ें', te: 'వదిలివేయి' },
  'page.allBW': { en: 'All B&W', hi: 'सभी बीएंडडब्ल्यू', te: 'అన్ని బిఅండబ్ల్యూ' },
  'page.allColour': { en: 'All colour', hi: 'सभी कलर', te: 'అన్ని కలర్' },
  'page.useSuggestion': { en: 'Use suggestion', hi: 'सुझाव उपयोग करें', te: 'సూచనను ఉపయోగించండి' },
  'page.suggestionPrompt': { en: '{n} pages look colourful. Print those in colour?', hi: '{n} पन्ने रंगीन लग रहे हैं। उन्हें कलर में प्रिंट करें?', te: '{n} పేజీలు రంగులలో ఉన్నాయి. వాటిని కలర్‌లో ప్రింట్ చేయాలా?' },
  'page.accept': { en: 'Accept', hi: 'स्वीकारें', te: 'అంగీకరించు' },
  'page.customize': { en: 'Customize', hi: 'अनुकूलित करें', te: 'అనుకూలీకరించు' },

  'pay.total': { en: 'Total', hi: 'कुल', te: 'మొత్తం' },
  'pay.payAmount': { en: 'Pay ₹{amount}', hi: '₹{amount} भुगतान करें', te: '₹{amount} చెల్లించండి' },
  'pay.placeOrder': { en: 'Place order', hi: 'ऑर्डर दें', te: 'ఆర్డర్ ఇవ్వండి' },
  'pay.mobileNumber': { en: 'Mobile number', hi: 'मोबाइल नंबर', te: 'మొబైల్ నంబర్' },
  'pay.name': { en: 'Name (optional)', hi: 'नाम (वैकल्पिक)', te: 'పేరు (ఐచ్ఛిక)' },
  'pay.noteToShop': { en: 'Note to shop (optional)', hi: 'दुकान के लिए नोट (वैकल्पिक)', te: 'దుకాణానికి గమనిక (ఐచ్ఛిక)' },
  'pay.enterUtr': { en: 'Enter UTR (12 digits)', hi: 'यूटीआर दर्ज करें (12 अंक)', te: 'యూటీఆర్ నమోదు చేయండి (12 అంకెలు)' },
  'pay.waitingConfirm': { en: 'Waiting for the shop to confirm your payment', hi: 'दुकान द्वारा भुगतान की पुष्टि का इंतजार', te: 'దుకాణం మీ చెల్లింపును నిర్ధారించే వరకు వేచి ఉంది' },
  'pay.payAtCounter': { en: 'Pay at counter instead', hi: 'काउंटर पर भुगतान करें', te: 'కౌంటర్ వద్ద చెల్లించండి' },
  'pay.callShop': { en: 'Call shop', hi: 'दुकान को कॉल करें', te: 'దుకాణానికి కాల్ చేయండి' },
  'pay.ivPaid': { en: "I've paid", hi: 'मैंने भुगतान किया', te: 'నేను చెల్లించాను' },

  'tracking.pickupCode': { en: 'Pickup code', hi: 'पिकअप कोड', te: 'పికప్ కోడ్' },
  'tracking.placed': { en: 'Placed', hi: 'दिया गया', te: 'ఇవ్వబడింది' },
  'tracking.payment': { en: 'Payment', hi: 'भुगतान', te: 'చెల్లింపు' },
  'tracking.printing': { en: 'Printing', hi: 'प्रिंट हो रहा है', te: 'ప్రింట్ అవుతోంది' },
  'tracking.ready': { en: 'Ready', hi: 'तैयार', te: 'సిద్ధం' },
  'tracking.collected': { en: 'Collected', hi: 'ले लिया गया', te: 'తీసుకున్నారు' },
  'tracking.showCodeAtCounter': { en: 'Show this code at the counter', hi: 'काउंटर पर यह कोड दिखाएं', te: 'కౌంటర్ వద్ద ఈ కోడ్ చూపండి' },
  'tracking.shareOrder': { en: 'Share order link', hi: 'ऑर्डर लिंक साझा करें', te: 'ఆర్డర్ లింక్‌ను పంచుకోండి' },
  'tracking.cancelOrder': { en: 'Cancel order', hi: 'ऑर्डर रद्द करें', te: 'ఆర్డర్ రద్దు చేయండి' },

  'orders.noOrders': { en: 'No orders yet. Scan a shop QR code to start.', hi: 'अभी कोई ऑर्डर नहीं। शुरू करने के लिए दुकान का क्यूआर स्कैन करें।', te: 'ఇంకా ఆర్డర్‌లు లేవు. ప్రారంభించడానికి దుకాణం QR స్కాన్ చేయండి.' },
  'orders.recentOrders': { en: 'Recent orders', hi: 'हाल के ऑर्डर', te: 'ఇటీవలి ఆర్డర్‌లు' },
  'orders.trackOrder': { en: 'Track order', hi: 'ऑर्डर ट्रैक करें', te: 'ఆర్డర్ ట్రాక్ చేయండి' },
  'orders.printAgain': { en: 'Print again', hi: 'फिर से प्रिंट करें', te: 'మళ్లీ ప్రింట్ చేయండి' },

  'common.back': { en: 'Back', hi: 'वापस', te: 'వెనుకకు' },
  'common.retry': { en: 'Try again', hi: 'फिर से कोशिश करें', te: 'మళ్లీ ప్రయత్నించండి' },
  'common.cancel': { en: 'Cancel', hi: 'रद्द करें', te: 'రద్దు చేయండి' },
  'common.done': { en: 'Done', hi: 'हो गया', te: 'పూర్తయింది' },
  'common.loading': { en: 'Loading…', hi: 'लोड हो रहा है…', te: 'లోడ్ అవుతోంది…' },
  'common.offline': { en: "You're offline. Your draft is saved.", hi: 'आप ऑफलाइन हैं। आपका ड्राफ्ट सहेजा गया है।', te: 'మీరు ఆఫ్‌లైన్‌లో ఉన్నారు. మీ డ్రాఫ్ట్ సేవ్ చేయబడింది.' },
  'common.error': { en: 'Something went wrong. Try again.', hi: 'कुछ गलत हुआ। फिर से कोशिश करें।', te: 'ఏదో తప్పు జరిగింది. మళ్లీ ప్రయత్నించండి.' },

  'trust.filesDeleted': { en: 'Files deleted 24h after pickup', hi: 'फाइलें पिकअप के 24 घंटे बाद हटा दी जाती हैं', te: 'పికప్ తర్వాత 24 గంటల తర్వాత ఫైళ్లు తొలగించబడతాయి' },
} as const;

export type MessageKey = keyof typeof messages;
