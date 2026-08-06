import { FullConfig } from '@playwright/test';

/**
 * Global setup for E2E tests
 * Exports staging credentials for test use
 */
async function globalSetup(config: FullConfig) {
  // Staging credentials - all users share the same password
  process.env.STAGING_PASSWORD = 'Abc123';

  // User accounts by role
  process.env.STAGING_USERS = JSON.stringify({
    admin: 'admin',
    manager: 'giamdoc',
    accountant: 'ketoan',
    driver: 'laixe',
    forwarder: 'giaonhan',
    customer: 'customer',
    dispatcher: 'dieuvan',
    clerk: 'cus',
  });
}

export default globalSetup;
