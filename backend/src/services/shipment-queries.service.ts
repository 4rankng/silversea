// Shipment Queries Service — read-model aggregates for the shipment list and
// dispatch master-plan views.
//
// Split along query domains into ./shipment-queries/* (card 20260927_145);
// this module keeps the historical import path so every consumer keeps
// working unchanged.
export * from './shipment-queries/index';
