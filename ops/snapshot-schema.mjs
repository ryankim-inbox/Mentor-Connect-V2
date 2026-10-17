import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifySchemaAssets } from '../lib/db/tools/schema-assets.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');

// Historical snapshots are explicit and never alter the runtime's current schema.
export async function snapshotSchemaAssets({rootDir,schemaVersion}) {
  const current=await verifySchemaAssets({rootDir});
  if(schemaVersion===undefined || schemaVersion===current.version.schemaVersion)return current;
  if(schemaVersion!=='0005')throw new Error('unsupported snapshot schema version');
  const directory=path.join(rootDir,'database/recovery');
  const version=JSON.parse(await readFile(path.join(directory,'0005-version.json'),'utf8'));
  const catalogContents=await readFile(path.join(directory,'0005-catalog.json'),'utf8');
  const ledger={...current.ledger,migrations:current.ledger.migrations.filter(m=>m.sequence<=5)};
  const canonicalSql=ledger.migrations.map(m=>m.sql).join('');
  const catalog=JSON.parse(catalogContents);
  if(version.formatVersion!==1 || version.schemaVersion!=='0005'
    || version.materialization!=='ordered-migration-concatenation-v1'
    || version.currentMigrationId!==ledger.migrations.at(-1)?.id
    || version.canonicalSha256!==digest(canonicalSql)
    || version.catalogSha256!==digest(catalogContents)
    || version.tableCount!==catalog.tables?.length
    || version.columnCount!==catalog.columns?.length
    || version.constraintCount!==catalog.constraints?.length
    || version.indexCount!==catalog.indexes?.length)
    throw new Error('historical snapshot schema verification failed');
  return {version,catalog,canonicalSql,ledger};
}
