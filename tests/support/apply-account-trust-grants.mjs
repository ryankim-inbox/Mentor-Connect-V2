// Synthetic integration fixture only; refuses non-loopback/shared databases.
import { classroomConnection } from '../../ops/classroom-snapshot.mjs';
import { restrictAccountTrustUserWrites } from '../../ops/account-trust-grants.mjs';
const url=new URL(process.env.TEST_APP_ROLE_DATABASE_URL);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !/^\/chat_test_[a-f0-9]+$/.test(url.pathname))
  throw new Error('disposable grant fixture required');
const connection=classroomConnection({databaseUrl:url.href,allowedHost:url.hostname,databaseName:url.pathname.slice(1)});
const client=connection.createClient();
try {
  await client.connect();await client.query('BEGIN');
  await restrictAccountTrustUserWrites(client,process.env.TEST_APP_ROLE);
  await client.query('COMMIT');
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
finally{await client.end();}
