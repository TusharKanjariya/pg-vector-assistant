const path = require('path');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');

const ALLOWED = ['.txt', '.md', '.pdf', '.docx'];

// Extract plain text from an uploaded file buffer, dispatching by extension.
async function extractText(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.txt':
    case '.md':
      return buffer.toString('utf8');
    case '.pdf':
      return (await pdf(buffer)).text;
    case '.docx':
      return (await mammoth.extractRawText({ buffer })).value;
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

module.exports = { extractText, ALLOWED };
