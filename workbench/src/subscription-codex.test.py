import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

WRAPPER=Path(__file__).with_name('subscription-codex.py')
class BoundaryTest(unittest.TestCase):
 def test_budget_and_append_only_global_history(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp); control=root/'control.json'; global_file=root/'global.json'
   original={'index':1,'pid':123,'kind':'old'}
   global_file.write_text(json.dumps({'enabled':True,'unlimited':True,'maxCalls':None,'attempts':[original]}))
   control.write_text(json.dumps({'id':'test','enabled':True,'model':'gpt-6-astra','provider':'openai','maxRounds':3,'maxPreflightCalls':1,'rounds':[{'jobId':'a','index':1}]}))
   env={**os.environ,'PIPELINE_VALIDATION_CONTROL_FILE':str(control),'PIPELINE_ACCEPTANCE_CONTROL_FILE':str(global_file)}
   code="import runpy;runpy.run_path(%r)['reserve_subscription'](['exec','--model','gpt-6-astra'])"%str(WRAPPER)
   def run(extra):return subprocess.run([sys.executable,'-c',code],env={**env,**extra},capture_output=True,text=True)
   self.assertNotEqual(run({}).returncode,0)
   self.assertEqual(run({'PIPELINE_VALIDATION_PREFLIGHT':'1'}).returncode,0)
   self.assertIn('VALIDATION_PREFLIGHT_LIMIT',run({'PIPELINE_VALIDATION_PREFLIGHT':'1'}).stderr)
   calls=[subprocess.Popen([sys.executable,'-c',code],env={**env,'PIPELINE_VALIDATION_JOB_ID':'a'},stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(4)]
   for proc in calls:
    _,err=proc.communicate();self.assertEqual(proc.returncode,0,err)
   self.assertNotEqual(run({'PIPELINE_VALIDATION_JOB_ID':'unregistered'}).returncode,0)
   records=json.loads(global_file.read_text())['attempts'];self.assertEqual(records[0],original);self.assertEqual(len(records),6)
   self.assertEqual([r['index'] for r in records],list(range(1,7)))
   local=json.loads(control.with_suffix('.calls.json').read_text())['attempts'];self.assertEqual(len(local),5)
   self.assertTrue(all(x['provider']=='openai' for x in local));self.assertEqual(local[0]['kind'],'route-preflight')
   global_file.write_text('{"enabled":false,"attempts":[]}')
   self.assertNotEqual(run({'PIPELINE_VALIDATION_JOB_ID':'a'}).returncode,0)
   self.assertEqual(len(json.loads(control.with_suffix('.calls.json').read_text())['attempts']),5)
if __name__=='__main__':unittest.main()
