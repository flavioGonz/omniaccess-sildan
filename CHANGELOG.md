# Changelog

All notable changes to the OmniAccess project will be documented in this file.

## [1.1.0] - 2026-03-12

### Added
- **Avicam Driver Integration**: Full support for Avicam facial recognition terminals.
- **Webhook Endpoint**: New endpoint at `/api/webhooks/avicam` to handle `VerifyPush` and `FacePicPush` operators.
- **Auto-Discovery**: Support for device matching by MAC (if provided in payload) or IP address.
- **Timezone Correction**: Automatic transformation of device local time (UTC-3) to server time (UTC) for correct history ordering.
- **Live Updates**: Real-time event emission to Dashboard and History via WebSockets.

### Fixed
- **Base64 Decoding**: Improved image buffer processing by cleaning data-URI prefixes from Avicam payloads.
- **S3 Collision Prevention**: Implemented `av-` prefix for filenames to prevent routing conflicts with Hikvision drivers.
- **Dashboard Retention**: Updated history and dashboard logic to include events from the last 24 hours, preventing "disappearing" events due to midnight UTC rollovers.
- **Identity Display**: Fixed issue where some events displayed as "NODO LPR" or "Desconocido" by ensuring full device and user object enrichment in the event stream.

### Improved
- **Dashboard UX**: Optimized real-time cards for facial events, showing similarity percentages and formatted details.
- **Stability**: Added S3 upload timeouts to prevent webhook handler hangs during network congestion.

## [1.0.1] - 2026-02-11
### Added
- Client-side OCR implementation with TensorFlow.js.
- Neural detection engine for face verification.
- Blacklist/Whitelist management UI.

## [1.0.0] - Initial Release
- Core LPR system for Hikvision.
- Resident and Unit management.
- Real-time Dashboard.
