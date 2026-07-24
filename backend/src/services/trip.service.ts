// Trip Service — Facade re-exporting from domain sub-modules
// All exports preserved for backward compatibility.
// Every file that imports from '../services/trip.service' continues to work unchanged.

export * from './trip-queries.service';
export * from './trip-status-machine.service';
export * from './trip-attendance-sync.service';
export * from './trip-mutations.service';
export * from './trip-instructions.service';
