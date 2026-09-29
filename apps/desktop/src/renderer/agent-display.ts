import { createContext } from 'react';
import type { AgentDisplayMode } from './app-preferences';

// Presentation only. Never pass this preference to Core or model requests.
export const AgentDisplayContext = createContext<AgentDisplayMode>('COMPACT');
