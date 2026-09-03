function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export async function introspectCatalog(client) {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const mode = await client.query("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") {
      throw new Error("catalog introspection requires a read-only transaction");
    }

    const tablesResult = await client.query(`
      SELECT c.relname AS name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> 'mentor_connect_schema_migrations'
      ORDER BY c.relname
    `);
    const columnsResult = await client.query(`
      SELECT
        c.relname AS "table",
        a.attnum::integer AS position,
        a.attname AS name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
        NOT a.attnotnull AS nullable,
        CASE
          WHEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%' THEN 'sequence'
          ELSE pg_catalog.pg_get_expr(d.adbin, d.adrelid)
        END AS "default"
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> 'mentor_connect_schema_migrations'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `);
    const constraintsResult = await client.query(`
      SELECT
        relation.relname AS "table",
        constraint_row.conname AS name,
        constraint_row.contype::text AS type,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class relation ON relation.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname <> 'mentor_connect_schema_migrations'
      ORDER BY relation.relname, constraint_row.conname
    `);
    const indexesResult = await client.query(`
      SELECT
        table_row.relname AS "table",
        index_row.relname AS name,
        pg_catalog.pg_get_indexdef(index_row.oid) AS definition
      FROM pg_catalog.pg_index index_catalog
      JOIN pg_catalog.pg_class table_row ON table_row.oid = index_catalog.indrelid
      JOIN pg_catalog.pg_class index_row ON index_row.oid = index_catalog.indexrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_row.relnamespace
      WHERE namespace.nspname = 'public'
        AND table_row.relname <> 'mentor_connect_schema_migrations'
      ORDER BY table_row.relname, index_row.relname
    `);

    await client.query("COMMIT");
    return {
      tables: tablesResult.rows.map((row) => row.name),
      columns: columnsResult.rows,
      constraints: constraintsResult.rows,
      indexes: indexesResult.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function objectKey(kind, value) {
  if (kind === "tables") return value;
  if (kind === "columns") return `${value.table}.${value.name}`;
  return `${value.table}.${value.name}`;
}

export function diffCatalog(expected, actual) {
  const differences = [];
  for (const kind of ["tables", "columns", "constraints", "indexes"]) {
    const expectedObjects = new Map(
      (expected[kind] ?? []).map((value) => [objectKey(kind, value), value]),
    );
    const actualObjects = new Map(
      (actual[kind] ?? []).map((value) => [objectKey(kind, value), value]),
    );
    for (const [key, expectedValue] of expectedObjects) {
      if (!actualObjects.has(key)) {
        differences.push(`${kind} missing ${key}`);
      } else {
        const actualValue = actualObjects.get(key);
        if (stableJson(expectedValue) !== stableJson(actualValue)) {
          differences.push(
            `${kind} changed ${key}: expected ${stableJson(expectedValue)}, actual ${stableJson(actualValue)}`,
          );
        }
      }
    }
    for (const key of actualObjects.keys()) {
      if (!expectedObjects.has(key))
        differences.push(`${kind} unexpected ${key}`);
    }
  }
  return differences.sort();
}
