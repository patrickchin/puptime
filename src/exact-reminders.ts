// Other platforms do not have Android's separate Alarms & reminders access.
export async function refreshExactReminderScheduling(): Promise<boolean> { return true; }
export async function openExactReminderSettings(): Promise<void> {}
export async function requestExactReminderAccess(): Promise<boolean> { return true; }
