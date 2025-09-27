// Basic regex-driven section extractor.
// Splits the raw text into known sections; anything unmatched goes to 'uncategorized'.

const SECTION_HEADERS = [
  'Goals', 'BMPs', 'Implementation', 'Monitoring', 'Outreach', 'Geography'
];

const headerRegex = new RegExp(`^(?:${SECTION_HEADERS.join('|')})[:\\s]*$`, 'i');

export function extractSections(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim());
  let current = 'uncategorized';
  const sections = { Goals: [], BMPs: [], Implementation: [], Monitoring: [], Outreach: [], Geography: [], uncategorized: [] };

  for (const line of lines) {
    if (!line) continue;
    if (SECTION_HEADERS.some(h => new RegExp(`^${h}[:]?$`, 'i').test(line))) {
      current = SECTION_HEADERS.find(h => new RegExp(`^${h}[:]?$`, 'i').test(line));
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}
