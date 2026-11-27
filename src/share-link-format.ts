// Zod-free so the website's app handoff pages can validate links without bundling Zod.
export const shareIdPattern = /^shr_[a-f0-9]{32}$/;
export const inviteTokenPattern = /^inv_[a-f0-9]{32}$/;
