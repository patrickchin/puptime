import type { PuppyEvent } from '../domain';

export function readPendingWidgetEvents(): Promise<PuppyEvent[]>;
export function updateHomeWidget(events: PuppyEvent[]): Promise<void>;
