# Printer Compatibility

## What works from the phone

| Printer type | Protocol | PDF | Raster | JPEG | Duplex | Notes |
|-------------|----------|-----|--------|------|--------|-------|
| IPP Everywhere (modern) | ipp:// or ipps:// | ✅ | ✅ | ✅ | ✅ | Best experience |
| AirPrint (Apple-certified) | ipps:// | ✅ | ✅ (URF) | ✅ | ✅ | Same as IPP Everywhere |
| Mopria-certified | ipp:// | ✅ | ✅ (PWG) | ✅ | ✅ | Same as IPP Everywhere |
| Older network printer (IPP) | ipp:// | ✅ if listed | Maybe | Maybe | Maybe | Check attributes |
| Raw port 9100 only | port 9100 | ❌ | ❌ | ❌ | ❌ | Advanced mode only (if PCL/PS supported) |
| USB only | — | ❌ | ❌ | ❌ | ❌ | Not printable from phone. Use "Send to shop PC" |
| Windows-driver-only | — | ❌ | ❌ | ❌ | ❌ | Not printable from phone. Use "Send to shop PC" |

## What to do when a printer doesn't work from the phone

1. **Check Wi-Fi**: Phone and printer must be on the same network. Guest Wi-Fi with client isolation won't work.
2. **Check discovery**: If mDNS is blocked, try "Add by IP address".
3. **Check document-format-supported**: Query the printer's attributes. If PDF isn't listed, the app falls back to raster or JPEG.
4. **"Send to shop PC"**: If the printer is USB-only or Windows-driver-only, the task goes back to the PC agent's queue.
5. **Share compatibility report**: The app exports the printer's reported capabilities for support.

## Network requirements

- Phone and printer on the **same Wi-Fi** (not mobile data, not guest Wi-Fi with client isolation)
- The app detects when the phone is on mobile data or a guest network and shows: "This phone is not on the same Wi-Fi as the printer"
- mDNS/DNS-SD discovery requires `CHANGE_WIFI_MULTICAST_STATE` permission on Android
- Manual IP entry works when mDNS is blocked (corporate networks, AP isolation)

## Printer merging

When the PC and phone report the same physical printer:
- If both report the same `printer-uuid` (IPP attribute) → server merges automatically
- If UUIDs don't match → shopkeeper merges manually from the Printers tab
- Each agent keeps its own PrinterPath (Windows queue vs LAN IPP)
