import {z} from 'zod';

export const firstLaunchStepSchema=z.enum(['welcome','profile','account','cloud','walkthrough','reminders']);
export type FirstLaunchStep=z.infer<typeof firstLaunchStepSchema>;
export type FirstLaunchProgress={step:FirstLaunchStep;puppyName:string};
