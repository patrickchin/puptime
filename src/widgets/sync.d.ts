import type { PuppyEvent } from '../domain';

export function readPendingWidgetEvents(): Promise<PuppyEvent[]>;
export function acknowledgePendingWidgetEvents(events: PuppyEvent[]): Promise<void>;
export function updateHomeWidget(events: PuppyEvent[]): Promise<void>;
