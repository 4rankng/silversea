import { QA_FIXTURE_REGISTRY } from '../seed/qa-fixture-registry.js';
import { censusSurface, censusVisible } from '../seed/purge-qa-fixtures.js';
import { client } from '../db/index.js';

const docs = QA_FIXTURE_REGISTRY.find((s) => s.table === 'billing_documents')!;
const zone = QA_FIXTURE_REGISTRY.find((s) => s.table === 'dispatch_zones')!;
console.log('docs predicate:', docs.predicate);
console.log('censusSurface(docs) =', await censusSurface(docs));
console.log('censusVisible(docs) =', await censusVisible(docs));
console.log('censusSurface(zone) =', await censusSurface(zone));
console.log('censusVisible(zone) =', await censusVisible(zone));
await client.end({ timeout: 5 });
