const DIRECT_TRANSACTION_COMMANDS = new Set([
  "ABORT",
  "BEGIN",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
]);

function isIdentifierPart(character) {
  return (
    character !== undefined && /[A-Za-z0-9_$\u0080-\uFFFF]/u.test(character)
  );
}

function hasTokenBoundaryBefore(sql, index) {
  return index === 0 || !isIdentifierPart(sql[index - 1]);
}

function scanQuoted(sql, quoteIndex, quote, backslashEscapes) {
  let index = quoteIndex + 1;
  while (index < sql.length) {
    if (backslashEscapes && sql[index] === "\\") {
      index += 2;
      continue;
    }
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  throw new Error("migration SQL contains an unterminated quoted value");
}

function scanBlockComment(sql, openingIndex) {
  let depth = 1;
  let index = openingIndex + 2;
  while (index < sql.length) {
    if (sql[index] === "/" && sql[index + 1] === "*") {
      depth += 1;
      index += 2;
    } else if (sql[index] === "*" && sql[index + 1] === "/") {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  throw new Error("migration SQL contains an unterminated block comment");
}

function dollarQuoteDelimiter(sql, index) {
  if (!hasTokenBoundaryBefore(sql, index)) return null;
  const match = /^(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/.exec(sql.slice(index));
  return match?.[0] ?? null;
}

function forbiddenCommand(statementWords) {
  const [first, second] = statementWords;
  if (DIRECT_TRANSACTION_COMMANDS.has(first)) return first;
  if (first === "START") return second ? `START ${second}` : "START";
  if (first === "RELEASE") return second ? `RELEASE ${second}` : "RELEASE";
  if (first === "PREPARE" && second === "TRANSACTION") {
    return "PREPARE TRANSACTION";
  }
  return null;
}

export function assertMigrationSqlIsAtomic(sql) {
  if (typeof sql !== "string")
    throw new Error("migration SQL must be a string");
  let index = 0;
  let statementWords = [];

  while (index < sql.length) {
    const character = sql[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      index = scanBlockComment(sql, index);
      continue;
    }

    const prefixedString =
      hasTokenBoundaryBefore(sql, index) &&
      ((/[Ee]/u.test(character) && sql[index + 1] === "'") ||
        (/[BbXxNn]/u.test(character) && sql[index + 1] === "'") ||
        (/[Uu]/u.test(character) &&
          sql[index + 1] === "&" &&
          sql[index + 2] === "'"));
    if (prefixedString) {
      const quoteIndex =
        character.toUpperCase() === "U" ? index + 2 : index + 1;
      index = scanQuoted(sql, quoteIndex, "'", character.toUpperCase() === "E");
      continue;
    }
    const prefixedIdentifier =
      hasTokenBoundaryBefore(sql, index) &&
      /[Uu]/u.test(character) &&
      sql[index + 1] === "&" &&
      sql[index + 2] === '"';
    if (prefixedIdentifier) {
      index = scanQuoted(sql, index + 2, '"', false);
      continue;
    }
    if (character === "'" || character === '"') {
      index = scanQuoted(sql, index, character, false);
      continue;
    }

    if (character === "$") {
      const delimiter = dollarQuoteDelimiter(sql, index);
      if (delimiter) {
        const closingIndex = sql.indexOf(delimiter, index + delimiter.length);
        if (closingIndex === -1) {
          throw new Error(
            "migration SQL contains an unterminated dollar-quoted value",
          );
        }
        index = closingIndex + delimiter.length;
        continue;
      }
    }
    if (character === ";") {
      statementWords = [];
      index += 1;
      continue;
    }
    if (/[A-Za-z_\u0080-\uFFFF]/u.test(character)) {
      let end = index + 1;
      while (isIdentifierPart(sql[end])) end += 1;
      if (statementWords.length < 2) {
        statementWords.push(sql.slice(index, end).toUpperCase());
        const forbidden = forbiddenCommand(statementWords);
        if (forbidden) {
          throw new Error(
            `migration transaction-control statement is forbidden: ${forbidden}`,
          );
        }
      }
      index = end;
      continue;
    }
    index += 1;
  }
}
