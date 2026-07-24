/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any -- intentional fixture: verifies the @tingting/no-any rule fires on these patterns */
// Test: these should all trigger @tingting/no-any
const x = (null as any);
const z: any = null;
function foo(a: any) {}
