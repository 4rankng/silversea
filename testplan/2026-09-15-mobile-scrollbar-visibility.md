# Mobile scrollbar visibility

User requirement: never show a vertical scrollbar on mobile. Preserve scrolling and content access; this is a visual policy, not an overflow lock.

| Case | Steps | Expected |
| --- | --- | --- |
| MOBILE-SCROLL-01 | At390px, scroll CUS detail and dispatcher pages from top to bottom. | No visible vertical scrollbar; touch/wheel scrolling still reaches all content. |
| MOBILE-SCROLL-02 | Open long nested lists, dialogs, sheets and drawers on a phone; scroll and use keyboard navigation. | Nested vertical rails are hidden, content remains scrollable and focused controls can move into view. |
| MOBILE-SCROLL-03 | Open a horizontally overflowing mobile table or list in Chrome/Safari. | The new policy only sets WebKit vertical scrollbar width to zero; horizontal height is untouched. Existing intentionally hidden horizontal strips stay under their own rules. |
| MOBILE-SCROLL-04 | Repeat in Firefox on a phone. | Standard scrollbar-width:none hides the rail while scrolling works. Firefox has no axis-specific standard property, so the fallback hides both orientations. |
| MOBILE-SCROLL-05 | Resize the same pages above640px on a mouse/trackpad desktop, including1440px. | The scrollbar policy stops applying; normal desktop scrollbar styling remains unchanged. |
| MOBILE-SCROLL-06 | Rotate a touch phone into landscape above640px; also inspect a coarse-pointer device with no hover. | Vertical rails remain hidden regardless of orientation. Only scrollbar visibility follows touch capability; compact layout/control rules remain bound to640px. |

Contract checks must pin the separate phone-or-touch scrollbar query,640px-only compact-layout query, root/descendant coverage, standard-property reset needed for WebKit styles, zero width without a horizontal-height override, and absence of overflow/touch/keyboard blocking declarations. Controller owns live Chrome scrolling evidence; Firefox and physical Safari remain separate coverage items.
