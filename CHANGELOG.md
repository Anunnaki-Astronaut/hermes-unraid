# Changelog

All notable changes are recorded here.

## 0.4.1

- Added **Anunnaki Light** to Theme Maker: ivory background, pale-bronze cards, and a blue memory chart. The existing Dark preset is unchanged. Apply each palette separately without changing your default appearance.
- Restored the motherboard model on Overview when the hardware query does not supply one but the existing Overview response includes a system model. The header still shows the Unraid version.
- The Docker card now shows the total number of containers reported by Unraid, including stopped containers, while previewing up to three. Missing data no longer looks like an empty list.
- No new queries, polling, or permissions. Automated checks used synthetic Unraid data.

## 0.4.0

- Added **Anunnaki**, an opt-in Dark preset in Theme Maker: Onyx background, burnished-bronze cards, gold controls, and blue memory readings. Existing appearance choices and per-profile palettes are preserved.
- The Overview now separates the server's full Unraid version from the plugin version and shows dedicated Motherboard / Processor and System Memory cards. Inventory is optional; an unavailable hardware query does not block the rest of Overview.
- Updated the Settings gear and Light appearance icon to the shared designs.
- HTTPS requests no longer follow redirects. Enter the final `/graphql` URL directly; HTTPS certificate verification and the read-only `VIEWER` key requirement are unchanged.
- Verified with synthetic data, not against a live Unraid server.

## 0.3.2

- Hardened the opt-in plain HTTP mode: verify the connected peer is private or loopback before sending the Unraid API key. Plain HTTP connects directly, ignores proxy settings, and does not follow redirects.
- HTTPS remains the default with certificate verification. The LAN HTTP switch remains off by default; read-only queries and permissions are unchanged.

## 0.3.1

- Added a dashboard gear that opens native Unraid Settings, with a link to the selected profile’s secure Agent settings.
- Added Theme Maker with five presets, editable Light and Dark palettes, a sample preview, and contrast checks. Appearance stays local to Unraid; saved palettes are separate per Desktop profile.
- Updated the dashboard header with the native stacked-server icon and release version. Appearance controls are icon-only with accessible labels.
- Clarified that Unraid is a read-only monitor, not an analyzer or repair tool. No changes to queries or permissions; the HTTP User-Agent now reports the release version.

## 0.3.0

- Reworked the Desktop page so array, parity, load, notifications, and storage are easier to scan.
- Added Match desktop, System, Light, and Dark appearance choices. The setting changes this plugin, not the rest of Hermes.
- Fixed the empty storage card on Overview. Disk rows now come from the Array response rather than the disk-less overview summary.
- A drive Unraid explicitly marks spun down shows "Zzz · Asleep" when it has no temperature reading. A missing reading on its own still says "Unknown."
- Cards reflow with the pane width. Narrow Array and Alerts views keep their device state and alert text visible.
- Added component tests and replaced the documentation screenshots with synthetic examples of the new layout.
- Unraid access remains limited to the existing read-only GraphQL queries.

## 0.2.0

- Added the Control Deck interface for Overview, Array, Docker, VMs, and Alerts.
- Added semantic status colors for healthy, warning, alert, inactive, and unknown states.
- Grouped repeated warning and alert notifications.
- Separated total unread notifications from the warning-and-alert count.
- Removed raw VM identifiers from the main list and fixed narrow-layout overflow.
- Added plain-language installation, configuration, security, and troubleshooting documentation.
- Added synthetic screenshots for every tab.
- Kept all Unraid access read-only through fixed GraphQL queries.
