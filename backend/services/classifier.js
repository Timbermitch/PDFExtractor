import OpenAI from 'openai';

let openaiClient;
if (process.env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// For demo, only attempt classification for 'uncategorized'.
export async function classifyAmbiguous(sections) {
  if (!openaiClient) return sections; // Skip if no key.
  const uncategorized = sections.uncategorized || [];
  if (!uncategorized.length) return sections;

  const prompt = `You are a classifier. Categorize each line into one of: Goals, BMPs, Implementation, Monitoring, Outreach, Geography. Respond as JSON array objects {line, category}. Lines: \n` + uncategorized.map(l => `- ${l}`).join('\n');

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    });
    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);
    for (const item of parsed) {
      const { line, category } = item;
      if (sections[category]) {
        sections[category].push(line);
      }
    }
    sections.uncategorized = [];
  } catch (e) {
    // Fallback: leave as uncategorized
    console.warn('Classification failed, leaving uncategorized.', e.message);
  }
  return sections;
}
