// Central place to refine regex rules for section identification or line enrichment later.
export const goalStatusRegex = /(completed|achieved|in progress|ongoing|planned)/i;
export const numericRegex = /(\d+(?:\.\d+)?)/;
export const yearRegex = /(20\d{2})/;
