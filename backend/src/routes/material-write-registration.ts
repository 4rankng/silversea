// Side-effect module: imports every route family that self-declares its
// material-write registry rows at import time (card 20260930_230), so tests
// that assert on the registry see the generated rules without importing the
// application entry (which boots the server). Grows as families migrate off
// the hand-written registry; the exhaustive test's independent endpoint
// extraction fails if a migrated family is missing here.
import './config';
import './expense-accounting';
import './expense-accounting-cash';
import './expense';
import './ops';
import './accounting';
import './accounting-deposit';
import './accounting-debit';
import './shipments';
import './trips';
import './financial';
import './upload';
import './ocr';
import './auth';
import './app-settings';
import './ocr-settings';
import './geotag';
import './driver';
import './salary';
import './portal';
import './forwarder';
import './recoverable-costs';
