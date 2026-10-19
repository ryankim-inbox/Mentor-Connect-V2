// Read-only comparison preparation. Original proof/ACL evidence is never changed.
// The caller must use the same restored PostgreSQL session for both proofs and
// still compare all other proof fields, including server settings and owners.
const fields=['relname','relkind','owner','relacl','reloptions','relrowsecurity','relforcerowsecurity'];
const reject=()=>{throw new Error('RESTORE_RELATION_ACL_COMPARISON_FAILED');};
const requireThat=value=>{if(!value)reject();};

export async function prepareRestoreComparison(client,proof) {
  try {
    const schema=proof?.portableSchema??proof?.schema,rows=schema?.relations;
    requireThat(Array.isArray(rows)&&rows.length<=1024);
    requireThat(new Set(rows.map(row=>row?.relname)).size===rows.length);
    const inputs=[];
    for(const [id,row] of rows.entries()) {
      requireThat(row&&Object.keys(row).sort().join(',')===[...fields].sort().join(','));
      requireThat(['relname','relkind','owner'].every(key=>typeof row[key]==='string'&&row[key].length>0&&row[key].length<=128));
      requireThat(typeof row.relrowsecurity==='boolean'&&typeof row.relforcerowsecurity==='boolean');
      requireThat(['relacl','reloptions'].every(key=>row[key]===null||(Array.isArray(row[key])&&row[key].length<=256&&row[key].every(value=>typeof value==='string'&&value.length<=1024))));
      if(['r','S'].includes(row.relkind))inputs.push({id,kind:row.relkind==='S'?'s':'r',owner:row.owner,acl:row.relacl});
    }
    const normalized=rows.map(row=>({...row}));
    if(inputs.length) {
      // ACL parsing, including quoted role names and grant options, belongs to
      // PostgreSQL. NULL uses built-in defaults; an explicit [] grants nothing.
      // Tagged role names distinguish PUBLIC from an actual role named PUBLIC.
      // Catalog owner names are exact strings, not SQL identifiers to case-fold.
      const result=(await client.query(`
        SELECT input.id,
          CASE WHEN input.acl='[]'::jsonb THEN '[]'::jsonb ELSE (
            SELECT coalesce(jsonb_agg(jsonb_build_array(
              'role:'||pg_get_userbyid(a.grantor),
              CASE WHEN a.grantee=0 THEN 'public:' ELSE 'role:'||pg_get_userbyid(a.grantee) END,
              a.privilege_type,a.is_grantable
            ) ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
            FROM aclexplode(CASE WHEN jsonb_typeof(input.acl)='array'
              THEN ARRAY(SELECT jsonb_array_elements_text(input.acl))::aclitem[]
              ELSE acldefault(input.kind::"char",owner_role.oid) END) a
          ) END AS acl
        FROM jsonb_to_recordset($1::jsonb) AS input(id integer,kind text,owner text,acl jsonb)
        JOIN pg_catalog.pg_roles owner_role ON owner_role.rolname=input.owner
        ORDER BY input.id
      `,[JSON.stringify(inputs)])).rows;
      requireThat(result.length===inputs.length);
      for(const [index,item] of result.entries()) {
        requireThat(item.id===inputs[index].id&&Array.isArray(item.acl));
        requireThat(item.acl.every(tuple=>Array.isArray(tuple)&&tuple.length===4&&tuple.slice(0,3).every(value=>typeof value==='string')&&typeof tuple[3]==='boolean'));
        normalized[item.id].relacl=item.acl;
      }
    }
    return {...proof,portableSchema:{...schema,relations:normalized}};
  }catch{reject();}
}
