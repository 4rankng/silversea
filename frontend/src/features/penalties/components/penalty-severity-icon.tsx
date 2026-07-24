import { AlertTriangle, Clock, Shield, Zap } from 'lucide-react';
import type { Severity } from '../utils';

export function PenaltySeverityIcon({ severity }: { severity: Severity }) {
  switch (severity) {
    case 'light': return <Clock size={18} />;
    case 'med': return <AlertTriangle size={18} />;
    case 'heavy': return <Zap size={18} />;
    case 'critical': return <Shield size={18} />;
  }
}
