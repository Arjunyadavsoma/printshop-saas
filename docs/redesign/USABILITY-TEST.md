# Usability Test Kit — PrintShop Customer Mobile

**Purpose:** Test the PrintShop customer mobile experience with 5 real students at a real print shop in under 1 hour.

---

## Setup (5 min)

1. **Find a shop** that's willing to participate (explain it's a 10-min test per student, they get free prints)
2. **Print a QR code** of the shop's `/s/[shopSlug]` URL
3. **Prepare 3 test PDFs** on a phone: a 10-page PDF (notes), a 1-page PDF (photo/ID), and a 20-page PDF (mixed content)
4. **Have UPI apps installed** on the test phone: GPay + PhonePe
5. **Bring a stopwatch** (phone timer works)

## Consent note (read to each participant)

> "I'm testing a print shop app. You'll scan a QR code, upload a file, choose print options, and pay via UPI like you normally would. It takes about 5 minutes. Your phone number is optional. Your files are deleted after you pick them up. You can stop at any time. Is that okay?"

---

## 6 Tasks (observe + time each one)

### Task 1: Scan + land on the shop (1 min)
**Instruction:** "Scan this QR code with your camera."
- [ ] Time to land on the shop page: _____s
- [ ] Did they see the shop name + rate board? Y / N
- [ ] Errors / hesitations: _____

### Task 2: Upload a 10-page PDF (2 min)
**Instruction:** "Upload this PDF file."
- [ ] Time to upload + see page count: _____s
- [ ] Did they find the upload area immediately? Y / N
- [ ] Errors / hesitations: _____

### Task 3: Print pages 1-3 in colour, rest B&W (2 min)
**Instruction:** "Print pages 1, 2, and 3 in colour. The rest in black and white."
- [ ] Time to complete: _____s
- [ ] Did they use the Mix preset? Y / N
- [ ] Did they figure out how to toggle individual pages? Y / N
- [ ] Did they see the running totals? Y / N
- [ ] Errors / hesitations: _____

### Task 4: Pay via UPI (2 min)
**Instruction:** "Pay for this order using GPay."
- [ ] Time from tapping Pay to returning to the app: _____s
- [ ] Did the UPI app open with the correct amount? Y / N
- [ ] Did they enter the UTR after returning? Y / N
- [ ] Errors / hesitations: _____

### Task 5: Find the pickup code (30s)
**Instruction:** "Show me where your pickup code is."
- [ ] Time to find + point to the code: _____s
- [ ] Did they see the token slip? Y / N
- [ ] Errors / hesitations: _____

### Task 6: Switch to Hindi or Telugu (30s)
**Instruction:** "Switch the app to Hindi (or Telugu)."
- [ ] Time to switch: _____s
- [ ] Did they find the language switcher? Y / N
- [ ] Did all text update? Y / N
- [ ] Errors / hesitations: _____

---

## Success thresholds

| Metric | Target | Actual |
|--------|--------|--------|
| Task success rate | ≥ 90% (5/6 tasks completed by ≥ 4/5 users) | _____% |
| Median time: first order (upload → pay) | ≤ 2 minutes | _____s |
| Zero payment confusion | No user is confused about whether they paid | _____ |
| Pickup code found | 5/5 users find it in ≤ 10s | _____/5 |

---

## Observer sheet

For each participant, record:
- **Participant ID:** P1, P2, P3, P4, P5
- **Device:** phone model + OS
- **Language:** English / Hindi / Telugu
- **UPI app used:** GPay / PhonePe / Paytm / Other
- **Quotes:** write down anything they say (frustrations, confusions, suggestions)
- **Time on each task**
- **Errors + hesitations**

### Template
```
P1: [device] [language] [UPI app]
  Task 1: ___s  | Notes:
  Task 2: ___s  | Notes:
  Task 3: ___s  | Notes:
  Task 4: ___s  | Notes:
  Task 5: ___s  | Notes:
  Task 6: ___s  | Notes:
  Quote: "..."
```

---

## Turn findings into fixes

After testing:
1. List every issue found, sorted by frequency (how many of the 5 users hit it)
2. Label each: P0 (blocks the task), P1 (slows down), P2 (polish)
3. Write the fix for each P0 + P1
4. Estimate effort (S/M/L)
5. Ship P0 fixes immediately, P1 in the next sprint, P2 when time allows
