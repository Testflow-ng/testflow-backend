/**
 * A small RFC 4180 reader for the question-import CSV.
 *
 * It returns rows of cells, handles quoted fields (including embedded commas, quotes and newlines)
 * and strips a UTF-8 BOM. It deliberately does not guess: a stray quote is an error, so a badly
 * escaped spreadsheet fails loudly instead of shifting every column by one.
 */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let sawAny = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < input.length) {
    const char = input[i];
    sawAny = true;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      if (field.length) throw new Error('A quote may only start a field.');
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      if (input[i] === '\n') i += 1;
      pushRow();
      continue;
    }
    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) throw new Error('A quoted field is never closed.');
  if (sawAny) pushRow();

  // A trailing newline produces one empty row; drop it.
  return rows.filter((cells) => cells.some((cell) => cell !== ''));
};
