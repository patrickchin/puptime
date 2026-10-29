import type {ActivityKey,PuppyEvent} from './domain';
import type {ThemePreference} from './theme';
export type NotificationWidgetProps={events:PuppyEvent[];actions:ActivityKey[];customActivities:string[];themePreference:ThemePreference;petId:string;title:string};
export async function renderQuickLogNotification(_props:NotificationWidgetProps):Promise<void>{}
