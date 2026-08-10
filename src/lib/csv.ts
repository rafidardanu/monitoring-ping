type CsvTable = string[][];

export type ParsedApCsvRow = {
  controller: string;
  name: string;
  model: string;
  mac: string;
  host: string;
};

const headerAliases: Record<keyof ParsedApCsvRow, string[]> = {
  controller: ["controller", "controler", "controllerap"],
  name: ["namaap", "nama", "apname", "name"],
  model: ["modelap", "model", "type"],
  mac: ["mac", "macaddress", "alamatmac"],
  host: ["ipaddress", "ipaddr", "ipadress", "ip", "host"]
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function detectDelimiter(line: string) {
  const commaCount = (line.match(/,/g) ?? []).length;
  const semicolonCount = (line.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseDelimitedText(text: string, delimiter: string): CsvTable {
  const rows: CsvTable = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  const pushValue = () => {
    currentRow.push(currentValue);
    currentValue = "";
  };

  const pushRow = () => {
    if (currentRow.length > 0 || currentValue.length > 0) {
      pushValue();
      rows.push(currentRow);
    }
    currentRow = [];
    currentValue = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      pushValue();
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      pushRow();
      continue;
    }

    currentValue += character;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    pushRow();
  }

  return rows.filter((row) => row.some((value) => value.trim().length > 0));
}

function getColumnIndex(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    const index = headers.findIndex((header) => normalizeHeader(header) === alias);
    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

export function parseApCsv(text: string): ParsedApCsvRow[] {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error("CSV kosong");
  }

  const firstLine = trimmedText.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const table = parseDelimitedText(trimmedText, delimiter);

  if (table.length === 0) {
    throw new Error("CSV tidak valid");
  }

  const [headerRow, ...dataRows] = table;
  const normalizedHeaders = headerRow.map((header) => normalizeHeader(header));
  const hasHeaderMatch = Object.values(headerAliases).some((aliases) =>
    aliases.some((alias) => normalizedHeaders.includes(alias))
  );

  const parseRow = (row: string[], headerMap: Record<keyof ParsedApCsvRow, number>) => {
    const record = {
      controller: row[headerMap.controller] ?? "",
      name: row[headerMap.name] ?? "",
      model: row[headerMap.model] ?? "",
      mac: row[headerMap.mac] ?? "",
      host: row[headerMap.host] ?? ""
    };

    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, value.trim()])
    ) as ParsedApCsvRow;
  };

  const headerMap = hasHeaderMatch
    ? {
        controller: getColumnIndex(headerRow, headerAliases.controller),
        name: getColumnIndex(headerRow, headerAliases.name),
        model: getColumnIndex(headerRow, headerAliases.model),
        mac: getColumnIndex(headerRow, headerAliases.mac),
        host: getColumnIndex(headerRow, headerAliases.host)
      }
    : {
        controller: 0,
        name: 1,
        model: 2,
        mac: 3,
        host: 4
      };

  const rows = hasHeaderMatch ? dataRows : table;
  const parsedRows = rows.map((row, rowIndex) => {
    if (row.length < 5) {
      throw new Error(`Baris ${rowIndex + 1} tidak lengkap`);
    }

    return parseRow(row, headerMap);
  });

  return parsedRows.filter((row) =>
    Boolean(row.controller && row.name && row.model && row.mac && row.host)
  );
}