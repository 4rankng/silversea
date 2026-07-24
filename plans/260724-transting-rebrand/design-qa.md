# TransTing design QA

- Source visual truth: `/Users/dev/.codex/attachments/15f44052-666d-4104-82b4-ffc823ce7a62/image-1.png`
- Sidebar defect reference: `/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/codex-clipboard-bbb1b410-9c3a-4f38-b167-6664567e05ef.png`
- Logo contrast defect reference: `/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/codex-clipboard-885fc96b-eaff-4d32-9a94-54295b0c57b0.png`
- Source dimensions: 1536 × 1024 px
- Implementation target: `http://localhost:7173/dashboard`
- Implementation screenshot: unavailable
- Intended viewports: 1440 × 900 desktop; 390 × 844 mobile
- CSS size and density normalization: not available because browser capture was blocked
- State: authenticated administrator (`admin`) on `/dashboard`

## Evidence

- The source brand board was opened and inspected.
- The initial navy/blue/green/white road-arrow mark was rejected after the background and foreground competed at small sizes. It was replaced across app, PWA, tab, and sidebar surfaces with one emerald-and-white route-T system.
- After the detailed favicon proved too small in the browser tab, it was replaced with a favicon-specific two-color silhouette: an oversized white route-T on a deep emerald tile. Both 16 px and 32 px outputs were opened at nearest-neighbor scale, and the route-T remains visibly distinct.
- The sidebar-specific mark was regenerated without the nested navy tile, converted to transparent PNG, and checked against an emerald background. The header descriptor was shortened and allowed to wrap within its flex column instead of overflowing the 248 px shell.
- Backend-generated user-facing identity now uses TransTing in the assistant system prompt and fuel-voucher HTML/XLSX footers. A forward-only migration updates existing FAQ answers while preserving question-derived embeddings.
- The expanded brand contract covers the backend assistant/export sources and verifies the FAQ migration’s copy-update contract.
- The running local server returned HTTP 200 for `/dashboard` and `/manifest.json`; the served shell contains the TransTing title, Vietnamese tagline, and new PWA asset references.
- The implementation could not be opened in the in-app browser because enterprise network policy rejected access to `http://localhost:7173`.
- No browser-policy workaround or alternate browser surface was attempted.

## Required fidelity surfaces

- Fonts and typography: Be Vietnam Pro is preserved; rendered hierarchy and wrapping could not be captured.
- Spacing and layout rhythm: existing login/sidebar footprints were preserved; desktop and mobile rendering could not be captured.
- Colors and visual tokens: the user-directed deep emerald sidebar and primary CTA tokens are implemented with an emerald-and-white mark and signal green as an accent; semantic success/info tokens remain unchanged.
- Image quality and asset fidelity: a dedicated high-contrast tab mark exists at 16 and 32 px; generated PWA assets exist at 180, 192, 512, and 1024 px; a separate transparent sidebar mark exists at 192 and 1024 px and remains recognizable against the emerald shell.
- Maskable PWA variants use a 78% inset before centering on the emerald canvas, keeping the route-T within the conservative platform safe zone; installed-device rendering remains part of the pending browser/device QA.
- The mobile launcher preview covers iOS square, Android adaptive square, circle, and squircle treatments at 48–60 px. The white route-T remains clear, centered, and uncropped in every simulated crop.
- The brand contract verifies standalone display metadata, portrait orientation, Vietnamese locale, required Apple touch icon metadata, opaque emerald iOS corners, and a 19% protected inset for maskable-icon foreground pixels.
- Copy and content: approved Vietnamese copy is present; the expanded brand contract guards scoped frontend/backend sources and the forward-only FAQ migration.

## Findings

- [P1] Browser-rendered evidence is unavailable.
  - Location: login, authenticated dashboard, desktop and mobile states.
  - Evidence: localhost navigation was rejected by enterprise browser policy.
  - Impact: responsive layout, primary interactions, and console cleanliness cannot be visually certified.
  - Fix: open the already-running local app in an allowed browser environment and capture the login plus authenticated dashboard at the intended viewports.

## Comparison history

- Pass 1: source image opened; generated logo and favicon inspected.
- Implementation comparison: blocked before capture, so no valid full-view or focused-region comparison exists.

## Primary interactions and console

- Login submission: not browser-tested.
- Sidebar navigation and collapse behavior: not browser-tested.
- Dashboard actions: not browser-tested.
- Console errors: not checked because the page could not be opened.

## Implementation checklist

- [x] Reference-aligned TransTing asset produced and installed.
- [x] Favicon-specific route-T produced, inspected at 16/32 px, and cache-busted in browser metadata.
- [x] Sidebar-specific transparent mark produced and the reported brand-header overflow fixed in source.
- [x] Vietnamese brand copy centralized and applied.
- [x] Static PWA, notification, title, onboarding, assistant system-prompt, workbook, and fuel-voucher HTML/XLSX identities updated.
- [x] Existing FAQ answers covered by a forward-only TransTing copy migration that preserves question-derived embeddings.
- [x] Full frontend tests (36 files / 186 tests), package-wide lint, UI contract, brand contract, production build, backend type-check, full backend tests (730 passed, 1 todo), and diff checks passed.
- [x] Mobile launcher crops and icon safe zones pass static visual and automated contract checks.
- [ ] Capture and compare desktop/mobile browser states in an allowed environment.

final result: blocked
