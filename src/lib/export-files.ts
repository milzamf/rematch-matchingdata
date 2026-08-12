type ExportCell = string | number | boolean | null | undefined;

export type ExportTable = {
  name: string;
  columns: string[];
  rows: Record<string, ExportCell>[];
};

export function downloadCsv(fileName: string, table: ExportTable) {
  const csv = [
    table.columns.map(csvCell).join(","),
    ...table.rows.map((row) => table.columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");

  downloadBlob(fileName, "text/csv;charset=utf-8", new Blob([csv], { type: "text/csv" }));
}

export function downloadXlsx(fileName: string, tables: ExportTable[]) {
  const files = buildXlsxFiles(tables);
  const blob = new Blob([zipFiles(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  downloadBlob(fileName, blob.type, blob);
}

function downloadBlob(fileName: string, _mimeType: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: ExportCell) {
  const text = value === null || value === undefined ? "" : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

function buildXlsxFiles(tables: ExportTable[]) {
  const safeTables = tables.length > 0 ? tables : [{ name: "Export", columns: [], rows: [] }];
  const workbookSheets = safeTables
    .map(
      (table, index) =>
        `<sheet name="${escapeXml(sheetName(table.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const workbookRels = safeTables
    .map(
      (_table, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const overrides = safeTables
    .map(
      (_table, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${safeTables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
  };

  safeTables.forEach((table, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = worksheetXml(table);
  });

  return files;
}

function worksheetXml(table: ExportTable) {
  const rows = [
    table.columns,
    ...table.rows.map((row) => table.columns.map((column) => row[column])),
  ].map((row, rowIndex) => {
    const cells = row
      .map((value, columnIndex) => cellXml(value, columnIndex + 1, rowIndex + 1))
      .join("");

    return `<row r="${rowIndex + 1}">${cells}</row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function cellXml(value: ExportCell, column: number, row: number) {
  const ref = `${columnName(column)}${row}`;

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }

  const text = value === null || value === undefined ? "" : String(value);

  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
}

function columnName(column: number) {
  let name = "";
  let current = column;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function sheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zipFiles(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const localHeader = zipHeader(0x04034b50, nameBytes, data.length, crc, offset);
    const centralHeader = zipHeader(0x02014b50, nameBytes, data.length, crc, offset);

    localParts.push(localHeader, nameBytes, data);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = endRecord(Object.keys(files).length, centralSize, centralOffset);

  return concatBytes([...localParts, ...centralParts, end]);
}

function zipHeader(
  signature: number,
  nameBytes: Uint8Array,
  size: number,
  crc: number,
  localOffset: number,
) {
  const central = signature === 0x02014b50;
  const bytes = new Uint8Array(central ? 46 : 30);
  const view = new DataView(bytes.buffer);
  let cursor = 0;
  const write16 = (value: number) => {
    view.setUint16(cursor, value, true);
    cursor += 2;
  };
  const write32 = (value: number) => {
    view.setUint32(cursor, value >>> 0, true);
    cursor += 4;
  };

  write32(signature);
  if (central) write16(20);
  write16(20);
  write16(0);
  write16(0);
  write16(0);
  write16(0);
  write32(crc);
  write32(size);
  write32(size);
  write16(nameBytes.length);
  write16(0);

  if (central) {
    write16(0);
    write16(0);
    write16(0);
    write32(0);
    write32(localOffset);
  }

  return bytes;
}

function endRecord(entryCount: number, centralSize: number, centralOffset: number) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);

  return bytes;
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
