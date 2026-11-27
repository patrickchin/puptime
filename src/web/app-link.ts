import { inviteTokenPattern, shareIdPattern } from '../share-link-format.ts';

export function nativeCareLink(href: string): string | null {
 const url = new URL(href), id = url.searchParams.get('invite'), token = url.hash.slice(1);
 if (!id) return token ? null : 'puptime://';
 if (!shareIdPattern.test(id) || (token && !inviteTokenPattern.test(token))) return null;
 return `puptime://care?invite=${id}${token ? '#' + token : ''}`;
}

export type HandoffDevice = 'android' | 'ios' | 'desktop';

export function handoffDevice(userAgent: string, maxTouchPoints = 0): HandoffDevice {
 if (/android/i.test(userAgent)) return 'android';
 if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
 return 'desktop';
}
