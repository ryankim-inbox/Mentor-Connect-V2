const DIRECT_TRANSACTION_COMMANDS = new Set([
  "ABORT",
  "BEGIN",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
]);

function characterAt(sql, index) {
  const codePoint = sql.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function characterBefore(sql, index) {
  if (index === 0) return undefined;
  const previous = sql.charCodeAt(index - 1);
  const width = previous >= 0xdc00 && previous <= 0xdfff ? 2 : 1;
  return characterAt(sql, index - width);
}

function isNonAscii(character) {
  return character !== undefined && character.codePointAt(0) >= 0x80;
}

function isIdentifierStart(character) {
  return (
    character !== undefined &&
    (/[A-Za-z_]/u.test(character) || isNonAscii(character))
  );
}

function isIdentifierPart(character) {
  return (
    isIdentifierStart(character) ||
    (character !== undefined && /[0-9$]/u.test(character))
  );
}

function isDollarTagPart(character) {
  return (
    isIdentifierStart(character) ||
    (character !== undefined && /[0-9]/u.test(character))
  );
}

function hasTokenBoundaryBefore(sql, index) {
  return index === 0 || !isIdentifierPart(characterBefore(sql, index));
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
  if (sql[index + 1] === "$") return "$$";

  let cursor = index + 1;
  let character = characterAt(sql, cursor);
  if (!isIdentifierStart(character)) return null;

  while (isDollarTagPart(character)) {
    cursor += character.length;
    character = characterAt(sql, cursor);
  }
  if (character !== "$") {
    throw new Error("migration SQL contains a malformed dollar-quote tag");
  }
  return sql.slice(index, cursor + 1);
}

function scanLineComment(sql, openingIndex) {
  let index = openingIndex + 2;
  while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") {
    index += 1;
  }
  if (sql[index] === "\r" && sql[index + 1] === "\n") return index + 2;
  return index < sql.length ? index + 1 : index;
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
    const character = characterAt(sql, index);
    if (/\s/u.test(character)) {
      index += character.length;
      continue;
    }
    if (character === "-" && sql[index + 1] === "-") {
      index = scanLineComment(sql, index);
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
    if (isIdentifierStart(character)) {
      let end = index + character.length;
      let identifierCharacter = characterAt(sql, end);
      while (isIdentifierPart(identifierCharacter)) {
        end += identifierCharacter.length;
        identifierCharacter = characterAt(sql, end);
      }
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
    index += character.length;
  }
}
