// Browser, Node and Worker runtimes provide Web Crypto. Fail closed if absent.
export const randomUUID = () => crypto.randomUUID();
