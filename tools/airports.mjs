// Builds data/airports.json and data/runways.json from the OurAirports lists
// (public domain):
//
//   curl -O https://davidmegginson.github.io/ourairports-data/airports.csv
//   curl -O https://davidmegginson.github.io/ourairports-data/runways.csv
//   node tools/airports.mjs airports.csv runways.csv
//
// Airports: large and medium ones that have an IATA code and scheduled
// flights, as rows of [code, name, city, country, lat, lon].
// Runways: the longest open runway of each of those airports, as
// { code: [lat, lon, lat, lon] } for its two ends.

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

// A CSV file as its column positions and its rows of fields.
function table(path) {
  const [header, ...lines] = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return { column: Object.fromEntries(parseLine(header).map((name, i) => [name, i])), rows: lines.map(parseLine) };
}

const round = (text, places = 10000) => Math.round(Number(text) * places) / places;
const lines = (rows) => rows.join(",\n");

const { column, rows: all } = table(process.argv[2]);
const kept = all.filter(
  (f) =>
    (f[column.type] === "large_airport" || f[column.type] === "medium_airport") &&
    /^[A-Z]{3}$/.test(f[column.iata_code]) &&
    f[column.scheduled_service] === "yes"
);
const airports = kept
  .map((f) => [
    f[column.iata_code],
    f[column.name],
    f[column.municipality],
    f[column.iso_country],
    round(f[column.latitude_deg]),
    round(f[column.longitude_deg]),
  ])
  .sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync("data/airports.json", "[\n" + lines(airports.map((row) => JSON.stringify(row))) + "\n]\n");
console.log(airports.length + " airports written to data/airports.json");

const codeOf = new Map(kept.map((f) => [f[column.ident], f[column.iata_code]]));
const runways = table(process.argv[3]);
const r = runways.column;
const ends = [r.le_latitude_deg, r.le_longitude_deg, r.he_latitude_deg, r.he_longitude_deg];
const longest = new Map(); // airport code -> its longest usable runway
for (const f of runways.rows) {
  const code = codeOf.get(f[r.airport_ident]);
  if (!code || f[r.closed] === "1" || ends.some((i) => f[i] === "")) continue;
  const length = Number(f[r.length_ft]) || 0;
  if (!longest.has(code) || length > longest.get(code).length) {
    longest.set(code, { length, ends: ends.map((i) => round(f[i], 100000)) });
  }
}
const byCode = [...longest].sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(
  "data/runways.json",
  "{\n" + lines(byCode.map(([code, runway]) => JSON.stringify(code) + ":" + JSON.stringify(runway.ends))) + "\n}\n"
);
console.log(byCode.length + " runways written to data/runways.json");
