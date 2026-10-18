import importlib.util
import json
import os
from pathlib import Path
import tempfile
import hashlib
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("launcher", Path(__file__).with_name("launcher.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="refresh-launcher-test-")
        self.addCleanup(self.temp.cleanup)
        os.chmod(self.temp.name, 0o700)
        self.manifest = {"directory":self.temp.name,"releaseSha":"a"*40,"manifestSha256":"b"*64,"revisionId":"revision1","node":"/fake/node","codeRoot":"/fake/root"}

    def test_exclusive_claim_survives_and_has_no_token_or_password(self):
        token = launcher.claim_attempt(self.manifest)
        target = Path(self.temp.name)/"attempt.json"
        text = target.read_text()
        self.assertNotIn(token,text)
        self.assertEqual(target.stat().st_mode & 0o777,0o600)
        with self.assertRaises(FileExistsError):
            launcher.claim_attempt(self.manifest)
        self.assertEqual(target.read_text(),text)

    def test_secret_prompt_only_after_fsynced_claim_and_failed_attempt_stays(self):
        writes=[]
        real_sync=os.fsync
        def sync(fd):
            writes.append(fd)
            return real_sync(fd)
        def prompt(_):
            self.assertEqual(len(writes),2)
            self.assertTrue((Path(self.temp.name)/"attempt.json").exists())
            raise KeyboardInterrupt()
        with patch.object(launcher,"verify_manifest",return_value=self.manifest),patch.object(launcher.subprocess,"run") as run,patch.object(launcher.os,"fsync",side_effect=sync):
            run.return_value.returncode=0
            with self.assertRaises(KeyboardInterrupt):
                launcher.execute("manifest","hash",tty_check=lambda:True,prompt=prompt)
        self.assertTrue((Path(self.temp.name)/"attempt.json").exists())

    def test_non_tty_and_preflight_failure_never_prompt_or_claim(self):
        for tty in [False,True]:
            with patch.object(launcher,"verify_manifest",return_value=self.manifest),patch.object(launcher.subprocess,"run") as run,patch.object(launcher.getpass,"getpass") as prompt:
                run.return_value.returncode=1
                with self.assertRaises(ValueError):
                    launcher.execute("manifest","hash",tty_check=lambda:tty)
                prompt.assert_not_called()
                self.assertFalse((Path(self.temp.name)/"attempt.json").exists())

    def test_secret_passed_to_child_runner_only_not_argv_file_or_env(self):
        with patch.object(launcher,"verify_manifest",return_value=self.manifest),patch.object(launcher.subprocess,"run") as run:
            run.return_value.returncode=0
            actual=launcher.execute("manifest","hash",tty_check=lambda:True,prompt=lambda _:"FAKE_SECRET_SENTINEL",runner=lambda manifest,token,password:password)
            self.assertEqual(actual,"FAKE_SECRET_SENTINEL")
            self.assertNotIn("FAKE_SECRET_SENTINEL",str(run.call_args))
            self.assertNotIn("FAKE_SECRET_SENTINEL",(Path(self.temp.name)/"attempt.json").read_text())
        with patch.dict(os.environ,{"PGPASSWORD":"FAKE_SECRET_SENTINEL","NODE_OPTIONS":"--require evil","PYTHONPATH":"evil"}):
            self.assertEqual(set(launcher.clean_environment()),{"PATH","LANG","LC_ALL"})

    def test_inventory_rejects_writable_scope_and_pins_links(self):
        scope=Path(self.temp.name)/"scope";scope.mkdir()
        file=scope/"data.json";file.write_text("{}")
        with self.assertRaises(ValueError):launcher.inventory([str(scope)])
        os.chmod(file,0o400);os.chmod(scope,0o500)
        try:self.assertEqual(launcher.inventory([str(scope)])[0],{str(file)})
        finally:os.chmod(scope,0o700)

    def test_real_manifest_rejects_transitive_content_addition_link_and_dirty_git_before_prompt(self):
        for corruption in ("content","addition","symlink","dirty_git"):
            with self.subTest(corruption=corruption),tempfile.TemporaryDirectory(prefix="refresh-freeze-test-") as temp:
                root=Path(temp).resolve()/"checkout";root.mkdir()
                directory=Path(temp).resolve()/"handoff";directory.mkdir(mode=0o700)
                scopes=[str(root/name) for name in ("ops","lib/db","database","node_modules")]
                for scope in scopes:Path(scope).mkdir(parents=True)
                script=root/"ops/demo-refresh-handoff/launcher.py";script.parent.mkdir();script.write_text("# fixture")
                taxonomy=root/"database/demo-taxonomy.json";taxonomy.write_text("approved")
                alternate=root/"database/alternate.json";alternate.write_text("alternate")
                link=root/"ops/linked.json";link.symlink_to(taxonomy)
                pg=Path(temp)/"pg";pg.mkdir()
                node=Path(temp)/"node";node.write_text("node fixture")
                external={str(node),str(Path(launcher.sys.executable).resolve()),"/private/etc/ssl/cert.pem"}
                for name in ("initdb","pg_ctl","pg_dump","pg_restore","postgres"):
                    file=pg/name;file.write_text("fixture");external.add(str(file))
                receipt=directory/"receipt.json";receipt.write_text("safe IDs");os.chmod(receipt,0o600)
                receipt_hash=launcher.file_hash(receipt)
                for scope in scopes:
                    for base,dirs,names in os.walk(scope,topdown=False):
                        for name in names:
                            item=Path(base)/name
                            if not item.is_symlink():os.chmod(item,0o400)
                        os.chmod(base,0o500)
                files,links=launcher.inventory(scopes)
                real_hash=launcher.file_hash
                test_hash=lambda name:'c'*64 if str(name)=='/private/etc/ssl/cert.pem' else real_hash(name)
                manifest={**self.manifest,"codeRoot":str(root),"directory":str(directory),"node":str(node),"pgBin":str(pg),"scopes":scopes,"files":{name:test_hash(name) for name in files|external},"links":links,"formatVersion":1,"approval":launcher.APPROVAL,"target":launcher.TARGET,"receiptPath":str(receipt),"receiptSha256":receipt_hash}
                file=directory/"manifest.json";file.write_text(json.dumps(manifest));os.chmod(file,0o600)
                manifest_hash=launcher.file_hash(file)
                dirty=False
                def git(args,**kwargs):
                    return types.SimpleNamespace(returncode=0,stdout=((" M database/demo-taxonomy.json\n" if dirty else "") if "status" in args else manifest["releaseSha"]+"\n").encode())
                try:
                    with patch.object(launcher,"__file__",str(script)),patch.object(launcher,"RECEIPT_SHA256",receipt_hash),patch.object(launcher,"file_hash",side_effect=test_hash),patch.object(launcher.subprocess,"run",side_effect=git),patch.object(launcher.getpass,"getpass") as prompt:
                        launcher.verify_manifest(str(file),manifest_hash)
                        if corruption=="content":
                            os.chmod(taxonomy,0o600);taxonomy.write_text("changed");os.chmod(taxonomy,0o400)
                        elif corruption=="addition":
                            os.chmod(root/"database",0o700);added=root/"database/new.json";added.write_text("new");os.chmod(added,0o400);os.chmod(root/"database",0o500)
                        elif corruption=="symlink":
                            os.chmod(root/"ops",0o700);link.unlink();link.symlink_to(alternate);os.chmod(root/"ops",0o500)
                        else:dirty=True
                        with self.assertRaises(ValueError):launcher.execute(str(file),manifest_hash,tty_check=lambda:True)
                        prompt.assert_not_called();self.assertFalse((directory/"attempt.json").exists())
                finally:
                    for scope in scopes:
                        for base,dirs,names in os.walk(scope):os.chmod(base,0o700)


if __name__ == "__main__":
    unittest.main()
