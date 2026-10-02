import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationalSiteContactsSchema } from './index';
import { operationalSiteContacts } from '../operational-site-contacts';

test('named phone lists reject duplicate numbers and ambiguous defaults', () => {
 const contact = { name: 'Kho', phone: '090 123 4567', isDefault: true };
 assert.equal(operationalSiteContactsSchema.safeParse([contact]).success, true);
 assert.equal(operationalSiteContactsSchema.safeParse([contact, { ...contact, phone: '0901234567', isDefault: false }]).success, false);
 assert.equal(operationalSiteContactsSchema.safeParse([{ ...contact, isDefault: false }]).success, false);
 assert.equal(operationalSiteContactsSchema.safeParse([contact, { ...contact, phone: '0907654321' }]).success, false);
 assert.equal(operationalSiteContactsSchema.safeParse([{ ...contact, phone: 'javascript:alert(1)' }]).success, false);
 assert.equal(operationalSiteContactsSchema.safeParse([]).success, true);
});
test('legacy fallback preserves a single callable contact and sorts default first without mutation', () => {
 assert.deepEqual(operationalSiteContacts({ contactName: 'Anh A', contactPhone: '0901234567' }), [{ name: 'Anh A', phone: '0901234567', isDefault: true }]);
 const contacts = [{ name: 'B', phone: '0907654321', isDefault: false }, { name: 'A', phone: '0901234567', isDefault: true }];
 assert.equal(operationalSiteContacts({ contacts })[0].name, 'A');
 assert.equal(contacts[0].name, 'B');
});
