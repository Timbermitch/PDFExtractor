// Simple node upload test bypassing shell multipart issues.
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';

async function main() {
  const pdfPath = process.argv[2] || path.join(process.cwd(), 'test.pdf');
  if (!fs.existsSync(pdfPath)) {
    fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
    console.log('Created dummy PDF at', pdfPath);
  }
  const form = new FormData();
  form.append('file', fs.createReadStream(pdfPath));
  // Align with new default backend port (5200). Override with API_BASE if needed.
  const base = process.env.API_BASE || 'http://localhost:5200';
  console.log('Uploading to', base + '/upload');
  try {
    const { data } = await axios.post(base + '/upload', form, { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 60000 });
    console.log('Upload response:', data);
  } catch (err) {
    const anyErr = err;
    if (anyErr.response) {
      console.error('Error status', anyErr.response.status, anyErr.response.data);
    } else {
      console.error('Network/other error', anyErr.message);
      if (anyErr.code) console.error(' code:', anyErr.code);
      if (anyErr.errno) console.error(' errno:', anyErr.errno);
      if (typeof anyErr.toJSON === 'function') {
        try { console.error(' toJSON:', anyErr.toJSON()); } catch {}
      }
      if (anyErr.stack) console.error(anyErr.stack.split('\n').slice(0,6).join('\n'));
    }
    process.exit(1);
  }
}
main();
