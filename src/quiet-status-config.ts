import {translate,type AppLanguage} from './localization.ts';

export const QUIET_STATUS_IDENTIFIER='puptime-status';
export const QUIET_STATUS_KIND='quietStatus';
export const QUIET_STATUS_CHANNEL='puptime-status';
export const QUIET_STATUS_CATEGORY='puptimeQuickLog';

export function quietStatusCopy(name:string,language:AppLanguage):{title:string;body:string}{
  return {title:translate(language,'notifications.quickLogTitle',{name}),body:translate(language,'notifications.quickLogExpand')};
}
