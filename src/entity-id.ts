import { randomUUID } from '#entity-id-entropy';

export type EntityPrefix = 'evt' | 'rtn' | 'rem' | 'usr' | 'ses' | 'acc' | 'ver' | 'rlm' | 'prv';

// UUID v4 supplies 122 random bits; its encoding is only an entropy primitive.
export const entityId = (prefix: EntityPrefix): string => `${prefix}_${randomUUID().replaceAll('-', '').toLowerCase()}`;
