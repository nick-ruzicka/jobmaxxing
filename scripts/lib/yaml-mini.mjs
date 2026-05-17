// Minimal YAML reader for archetypes.yaml and similar Task-G config files.
// Supports: nested mappings, block + inline lists, quoted/bare scalars,
// integers, booleans, null, comments. Does NOT support: multi-line strings,
// anchors/aliases, tag types, flow-style mappings ({a: 1}).
//
// We hand-roll because the project has a no-new-deps constraint and the only
// pre-existing parser (lib/companies-load.mjs) handles flat YAML only.

export function parseYaml(text) {
  const lines = preprocess(text);
  if (lines.length === 0) return {};
  const [value] = parseValue(lines, 0, 0);
  return value ?? {};
}

function preprocess(text) {
  const out = [];
  const split = text.split("\n");
  for (let i = 0; i < split.length; i++) {
    const raw = split[i];
    const stripped = stripInlineComment(raw);
    if (stripped.trim() === "") continue;
    out.push({
      raw,
      indent: countIndent(raw),
      content: stripped.trimEnd().replace(/^\s+/, ""),
      lineNo: i + 1,
    });
  }
  return out;
}

function countIndent(line) {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

function stripInlineComment(line) {
  let inQuote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === "\\" && i + 1 < line.length) { i++; continue; }
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseValue(lines, idx, expectedIndent) {
  if (idx >= lines.length) return [null, idx];
  const line = lines[idx];
  if (line.indent < expectedIndent) return [null, idx];
  if (line.content.startsWith("- ") || line.content === "-") {
    return parseList(lines, idx, line.indent);
  }
  return parseMapping(lines, idx, line.indent);
}

function parseMapping(lines, idx, blockIndent) {
  const result = {};
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.indent < blockIndent) break;
    if (line.indent > blockIndent) {
      throw new Error(`yaml: unexpected indent on line ${line.lineNo}: ${line.raw}`);
    }
    if (line.content.startsWith("- ")) break;

    const colon = findKeyColon(line.content);
    if (colon < 0) {
      throw new Error(`yaml: expected key:value on line ${line.lineNo}: ${line.raw}`);
    }
    const key = line.content.slice(0, colon).trim();
    const valPart = line.content.slice(colon + 1).trim();

    if (valPart !== "") {
      result[key] = parseScalar(valPart);
      idx++;
    } else {
      idx++;
      if (idx >= lines.length || lines[idx].indent <= blockIndent) {
        result[key] = null;
      } else {
        const [val, nextIdx] = parseValue(lines, idx, lines[idx].indent);
        result[key] = val;
        idx = nextIdx;
      }
    }
  }
  return [result, idx];
}

function parseList(lines, idx, listIndent) {
  const result = [];
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.indent < listIndent) break;
    if (line.indent > listIndent) {
      throw new Error(`yaml: unexpected indent on line ${line.lineNo}: ${line.raw}`);
    }
    if (!(line.content.startsWith("- ") || line.content === "-")) break;

    const itemBody = line.content === "-" ? "" : line.content.slice(2);
    const itemContentIndent = listIndent + 2;

    const colon = findKeyColon(itemBody);

    if (colon < 0) {
      result.push(itemBody === "" ? null : parseScalar(itemBody));
      idx++;
      continue;
    }

    // Mapping item: first KV on this line, more KVs may follow at itemContentIndent.
    const item = {};
    const firstKey = itemBody.slice(0, colon).trim();
    const firstVal = itemBody.slice(colon + 1).trim();
    idx++;

    if (firstVal !== "") {
      item[firstKey] = parseScalar(firstVal);
    } else {
      if (idx < lines.length && lines[idx].indent > itemContentIndent) {
        const [nested, nextIdx] = parseValue(lines, idx, lines[idx].indent);
        item[firstKey] = nested;
        idx = nextIdx;
      } else if (idx < lines.length && lines[idx].indent === itemContentIndent && lines[idx].content.startsWith("- ")) {
        const [nested, nextIdx] = parseList(lines, idx, itemContentIndent);
        item[firstKey] = nested;
        idx = nextIdx;
      } else {
        item[firstKey] = null;
      }
    }

    // Subsequent keys at itemContentIndent
    while (idx < lines.length && lines[idx].indent === itemContentIndent && !lines[idx].content.startsWith("- ")) {
      const sub = lines[idx];
      const subColon = findKeyColon(sub.content);
      if (subColon < 0) {
        throw new Error(`yaml: expected key:value on line ${sub.lineNo}: ${sub.raw}`);
      }
      const subKey = sub.content.slice(0, subColon).trim();
      const subVal = sub.content.slice(subColon + 1).trim();
      idx++;
      if (subVal !== "") {
        item[subKey] = parseScalar(subVal);
      } else {
        if (idx < lines.length && lines[idx].indent > itemContentIndent) {
          const [nested, nextIdx] = parseValue(lines, idx, lines[idx].indent);
          item[subKey] = nested;
          idx = nextIdx;
        } else if (idx < lines.length && lines[idx].indent === itemContentIndent + 2 && lines[idx].content.startsWith("- ")) {
          const [nested, nextIdx] = parseList(lines, idx, itemContentIndent + 2);
          item[subKey] = nested;
          idx = nextIdx;
        } else {
          item[subKey] = null;
        }
      }
    }

    result.push(item);
  }
  return [result, idx];
}

function findKeyColon(s) {
  let inQuote = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === "\\" && i + 1 < s.length) { i++; continue; }
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === "[" || c === "{") {
      depth++;
    } else if (c === "]" || c === "}") {
      depth--;
    } else if (c === ":" && depth === 0) {
      if (i + 1 === s.length || /\s/.test(s[i + 1])) return i;
    }
  }
  return -1;
}

function parseScalar(s) {
  s = s.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    return parseInlineList(s);
  }
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  if (/^[+-]?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function parseInlineList(s) {
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  const items = [];
  let depth = 0;
  let inQuote = null;
  let buf = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inQuote) {
      if (c === "\\" && i + 1 < inner.length) { buf += c + inner[i + 1]; i++; continue; }
      if (c === inQuote) inQuote = null;
      buf += c;
    } else if (c === '"' || c === "'") {
      inQuote = c;
      buf += c;
    } else if (c === "[" || c === "{") { depth++; buf += c; }
    else if (c === "]" || c === "}") { depth--; buf += c; }
    else if (c === "," && depth === 0) {
      items.push(parseScalar(buf));
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim() !== "") items.push(parseScalar(buf));
  return items;
}
