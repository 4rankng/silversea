import postgres from 'postgres';
const sql = postgres('postgres://postgres:postgres@localhost:5441/silversea');
const tables = [
  'shipments', 'trips', 'trip_containers', 'expenses', 'drivers', 'trucks', 'trailers',
  'customers', 'suppliers', 'shipment_containers', 'shipment_documents',
  'shipment_declarations', 'shipment_fulfillments', 'shipment_status_history',
  'trip_status_history', 'trip_pod_submissions', 'trip_pod_files',
  'invoices', 'invoice_lines', 'debit_notes', 'debit_note_lines',
  'payments', 'payment_allocations', 'ledger', 'cap_table_history',
  'forwarder_expenses', 'forwarder_money_transactions',
  'business_units', 'user_business_unit_links', 'user_customer_links',
  'operational_sites', 'routes', 'ports', 'container_types',
  'carriers', 'carrier_fleet_vehicles', 'factories',
  'expense_categories', 'penalty_reasons', 'fuel_config',
  'app_settings', 'truck_assignments',
];
for (const t of tables) {
  try {
    const [{ count }] = await sql`SELECT count(*)::int as count FROM ${sql(t)}`;
    console.log(`${count.toString().padStart(6)}  ${t}`);
  } catch (e) {
    console.log(`   ???  ${t}  -- ${e.message?.slice(0, 60)}`);
  }
}
await sql.end();
