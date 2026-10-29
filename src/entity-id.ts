import { randomUUID } from '#entity-id-entropy';

export type EntityPrefix = 'shr' | 'inv' | 'csr' | 'ano' | 'img' | 'evt' | 'rtn' | 'rem' | 'usr' | 'ses' | 'acc' | 'ver' | 'rlm' | 'prv' | 'bkp' | 'pet' | 'key';

// UUID v4 supplies 122 random bits; its encoding is only an entropy primitive.
export const entityId = (prefix: EntityPrefix): string => `${prefix}_${randomUUID().replaceAll('-', '').toLowerCase()}`;
