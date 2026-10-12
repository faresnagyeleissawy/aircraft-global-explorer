// Builds data/airports.json from the OurAirports list (public domain):
//
//   curl -o airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   node tools/airports.mjs airports.csv
//
// Keeps large and medium airports that have an IATA code and scheduled
// flights. Each row is [code, name, city, country, lat, lon].

import { readFileSync, writeFileSync } from "node:fs";

// One CSV line into fields; quoted fields may hold commas and doubled quotes.
function parseLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(field);
      field = "";
    } else field += ch;
  }
  fields.push(field);
  return fields;
}

const [header, ...lines] = readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean);
const column = Object.fromEntries(parseLine(header).map((name, i) => [name, i]));
const round = (text) => Math.round(Number(text) * 10000) / 10000;

const rows = lines
  .map(parseLine)
  .filter(
    (f) =>
      (f[column.type] === "large_airport" || f[column.type] === "medium_airport") &&
      /^[A-Z]{3}$/.test(f[column.iata_code]) &&
      f[column.scheduled_service] === "yes"
  )
  .map((f) => [
    f[column.iata_code],
    f[column.name],
    f[column.municipality],
    f[column.iso_country],
    round(f[column.latitude_deg]),
    round(f[column.longitude_deg]),
  ])
  .sort((a, b) => a[0].localeCompare(b[0]));

writeFileSync("data/airports.json", "[\n" + rows.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n");
console.log(rows.length + " airports written to data/airports.json");
