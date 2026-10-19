// Read-only proof queries copied from reviewed backup.mjs at 45741cce.
// No launcher, remote connection, migration runner or revision operator is imported.
import { createHash } from 'node:crypto';
import { readRevisionSchemaState } from '../synthetic-revision-evidence.mjs';
import { validateAppliedMigrations } from '../../lib/db/tools/migration-ledger.mjs';
import { diffCatalog } from '../../lib/db/tools/catalog.mjs';
export const canonical=value=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
const requireThat=condition=>{if(!condition)throw new Error('PROOF_PRECONDITION_REJECTED');};
export async function fullRowProof(client,assets) {
  const schema=await readRevisionSchemaState(client);
  const aclFields=new Set(['relacl','attacl','proacl','nspacl','defaclacl','datacl']);
  const aclStrings=new Set();
  const visit=value=>{if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(aclFields.has(key)&&typeof item==='string')aclStrings.add(item);else visit(item);}};
  visit(schema);
  // pg treats aclitem[] as an unknown type and may return its text encoding.
  // Let PostgreSQL decode that encoding; never parse ACL strings heuristically.
  const decoded=new Map((await client.query('SELECT value AS raw,array_to_json(value::aclitem[]) AS acl FROM unnest($1::text[]) AS value',[[...aclStrings]])).rows.map(row=>[row.raw,row.acl]));
  const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,aclFields.has(key)&&typeof item==='string'?[...decoded.get(item)].sort():normalize(item)])):value;
  const portableSchema=normalize(schema);
  requireThat(diffCatalog(assets.catalog,schema.catalog).length===0);
  const ledger=(await client.query('SELECT ordinal,migration_id AS "migrationId",checksum,applied_at AS "appliedAt",app_sha AS "appSha" FROM public.mentor_connect_schema_migrations ORDER BY ordinal')).rows;
  requireThat(validateAppliedMigrations(assets.ledger.migrations,ledger).length===0&&assets.version.schemaVersion==='0008');
  const rows={};
  for(const table of [...assets.catalog.tables,'mentor_connect_schema_migrations'].sort()) {
    const hashes=(await client.query(`SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM public.${quote(table)} t ORDER BY hash`)).rows.map(row=>row.hash);
    rows[table]={count:hashes.length,digest:digest(hashes)};
  }
  // Includes complete password hashes inside a server-side hash only.
  const passwords=(await client.query("SELECT encode(sha256(convert_to(jsonb_build_array(id,password_hash)::text,'UTF8')),'hex') AS hash FROM public.users ORDER BY hash")).rows.map(row=>row.hash);
  const sequences={};
  for(const name of schema.sequences.map(row=>row.relname))sequences[name]=(await client.query(`SELECT last_value::text,is_called FROM public.${quote(name)}`)).rows[0];
  const settings=(await client.query("SELECT current_setting('server_version_num') AS version,pg_encoding_to_char(d.encoding) AS encoding,d.datlocprovider::text AS provider,d.datcollate AS collate,d.datctype AS ctype,to_jsonb(d)->>'datlocale' AS locale,to_jsonb(d)->>'daticurules' AS rules,to_jsonb(d)->>'datcollversion' AS \"collationVersion\" FROM pg_database d WHERE datname=current_database()")).rows[0];
  const roles=(await client.query("SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname")).rows.map(row=>row.rolname);
  const databaseGrants=(await client.query("SELECT coalesce(r.rolname,'PUBLIC') AS role,a.privilege_type AS privilege,a.is_grantable,pg_get_userbyid(a.grantor) AS grantor FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE d.datname=current_database() ORDER BY role,privilege")).rows;
  // Internal RI trigger names contain cluster-local catalog OIDs. Compare their
  // complete portable structure; retain the original names in source schema.
  const triggerStructure=(await client.query("SELECT r.relname,t.tgisinternal,CASE WHEN t.tgisinternal THEN NULL ELSE t.tgname END AS name,t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred,c.conname,cr.relname AS constraint_table,n.nspname AS function_schema,p.proname,encode(t.tgargs,'hex') AS arguments,t.tgattr::text AS attributes,t.tgoldtable,t.tgnewtable,CASE WHEN NOT t.tgisinternal THEN pg_get_triggerdef(t.oid) END AS user_definition,pg_get_expr(t.tgqual,t.tgrelid) AS condition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace LEFT JOIN pg_constraint c ON c.oid=t.tgconstraint LEFT JOIN pg_class cr ON cr.oid=t.tgconstrrelid WHERE rn.nspname='public' ORDER BY r.relname,c.conname,p.proname,t.tgtype,name")).rows;
  return {schema,portableSchema,ledger,rows,passwordDigest:digest(passwords),sequences,settings,roles,databaseGrants,triggerStructure};
}
