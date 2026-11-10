import { shareIdSchema, inviteTokenSchema } from '../sharing.ts';

export function nativeCareLink(href: string): string | null {
 const url = new URL(href), id = url.searchParams.get('invite'), token = url.hash.slice(1);
 if (!id) return token ? null : 'puptime://';
 if (!shareIdSchema.safeParse(id).success || (token && !inviteTokenSchema.safeParse(token).success)) return null;
 return `puptime://care?invite=${id}${token ? '#' + token : ''}`;
}
