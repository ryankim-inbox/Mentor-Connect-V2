// Operator-only policy: call inside the reviewed migration transaction, never at startup.
const insertColumns = ['email','name','password_hash','role','district_id','is_verified','subjects'];
const updateColumns = ['name','bio','role','subjects','email_verified_at','is_verified'];
const check = condition => { if (!condition) throw new Error('account trust role precondition'); };
const identifier = value => '"' + value.replaceAll('"','""') + '"';

export async function assertAccountTrustRoleSafe(client, role) {
  check(/^[a-z][a-z0-9_]*$/.test(role ?? ''));
  const rows = (await client.query(`SELECT r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
    EXISTS(SELECT 1 FROM pg_roles p WHERE p.oid<>r.oid AND pg_has_role(r.oid,p.oid,'MEMBER')) AS membership,
    EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid) AS database_owner,
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public' AND nspowner=r.oid) AS schema_owner,
    EXISTS(SELECT 1 FROM pg_class WHERE oid='public.users'::regclass AND relowner=r.oid) AS table_owner,
    has_schema_privilege(r.oid,'public','CREATE') AS schema_create,
    has_table_privilege(r.oid,'public.users','TRIGGER') AS can_trigger,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.prosecdef AND has_schema_privilege(r.oid,n.oid,'USAGE')
        AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS definer_access
    FROM pg_roles r WHERE r.rolname=$1`,[role])).rows;
  check(rows.length===1 && Object.values(rows[0]).every(value=>value===false));
  const publicWrites = (await client.query(`SELECT EXISTS(
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid='public.users'::regclass AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE')
    UNION ALL
    SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
      WHERE c.attrelid='public.users'::regclass AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE')
    ) AS present`)).rows[0].present;
  check(publicWrites===false);
}

export async function restrictAccountTrustUserWrites(client, role) {
  await assertAccountTrustRoleSafe(client,role);
  const quotedRole=identifier(role);
  await client.query(`REVOKE INSERT,UPDATE ON TABLE public.users FROM ${quotedRole} RESTRICT;
    GRANT INSERT (${insertColumns.join(',')}) ON TABLE public.users TO ${quotedRole};
    GRANT UPDATE (${updateColumns.join(',')}) ON TABLE public.users TO ${quotedRole}`);
  const rights=(await client.query(`SELECT
    has_table_privilege($1,'public.users','INSERT') AS table_insert,
    has_table_privilege($1,'public.users','UPDATE') AS table_update,
    has_table_privilege($1,'public.users','SELECT') AS can_select,
    has_schema_privilege($1,'public','USAGE') AS schema_usage,
    has_sequence_privilege($1,'public.users_id_seq','USAGE') AS sequence_usage`,[role])).rows[0];
  check(!rights.table_insert && !rights.table_update && rights.can_select && rights.schema_usage && rights.sequence_usage);
  const columns=(await client.query(`SELECT a.attname,
    has_column_privilege($1,a.attrelid,a.attnum,'INSERT') AS can_insert,
    has_column_privilege($1,a.attrelid,a.attnum,'UPDATE') AS can_update,
    has_column_privilege($1,a.attrelid,a.attnum,'INSERT WITH GRANT OPTION') AS grant_insert,
    has_column_privilege($1,a.attrelid,a.attnum,'UPDATE WITH GRANT OPTION') AS grant_update
    FROM pg_attribute a WHERE a.attrelid='public.users'::regclass AND a.attnum>0 AND NOT a.attisdropped`,[role])).rows;
  check([...insertColumns,...updateColumns,'is_admin'].every(name=>columns.some(column=>column.attname===name)));
  for(const column of columns) check(column.can_insert===insertColumns.includes(column.attname)
    && column.can_update===updateColumns.includes(column.attname) && !column.grant_insert && !column.grant_update);
  await assertAccountTrustRoleSafe(client,role);
}
