/* Read only inside the caller-owned revision transaction. */
export async function readRevisionCatalog(client) {
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
        -- PostgreSQL 18 duplicates NOT NULL in pg_constraint. Nullability is
        -- already verified via pg_attribute.attnotnull in the column manifest.
        AND constraint_row.contype <> 'n'
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

  return {
    tables: tablesResult.rows.map((row) => row.name),
    columns: columnsResult.rows,
    constraints: constraintsResult.rows,
    indexes: indexesResult.rows,
  };
}

export async function readRevisionSchemaState(client) {
  const result = { catalog: await readRevisionCatalog(client) };
  const queries = {
    relations: `SELECT c.relname,c.relkind,c.relowner::regrole::text AS owner,c.relacl,c.reloptions,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`,
    columns: `SELECT c.relname,a.attnum,a.attname,a.attacl,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
    sequences: `SELECT c.relname,s.seqtypid::regtype::text,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`,
    constraints: `SELECT c.conname,r.relname,c.convalidated,c.condeferrable,c.condeferred,c.connoinherit FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY r.relname,c.conname`,
    triggers: `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,t.tgname`,
    policies: `SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`,
    functions: `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,p.proowner::regrole::text AS owner,p.proacl,p.prosrc,p.proconfig,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,arguments`,
    grants: `SELECT grantee,table_schema,table_name,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema='public' ORDER BY grantee,table_name,privilege_type`,
    defaultGrants: `SELECT d.defaclrole::regrole::text AS role,n.nspname,d.defaclobjtype,d.defaclacl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' OR d.defaclnamespace=0 ORDER BY role,n.nspname,d.defaclobjtype`,
    schemas: `SELECT nspname,nspowner::regrole::text AS owner,nspacl FROM pg_namespace WHERE nspname='public'`,
    views: `SELECT c.relname,pg_get_viewdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname`,
    ownership: `SELECT s.relname AS sequence,t.relname AS table,a.attname AS column,d.deptype FROM pg_depend d JOIN pg_class s ON s.oid=d.objid JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE n.nspname='public' AND s.relkind='S' AND d.deptype IN ('a','i') ORDER BY s.relname`,
    database: `SELECT datname,datdba::regrole::text AS owner,datacl FROM pg_database WHERE datname=current_database()`,
  };
  for (const [key, query] of Object.entries(queries))
    result[key] = (await client.query(query)).rows;
  return result;
}
