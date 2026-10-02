# QA-AUDIT-UI-38 — tire picker Escape owns one layer

On existing truck/trailer tire pages at390/768/1440, enter an unsaved serial,
open the position picker and press Escape. The picker closes, the route stays
on that vehicle and the serial remains. Repeat with supplier picker. Open the
position manager, close it, then use Quay lại đội xe. Capture DOM/screenshot,
driver exit and unchanged tire/position reads. Unit regression must exercise
the real picker alongside useBackShortcut, without a simulated menu result.
