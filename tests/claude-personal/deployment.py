#!/usr/bin/env python3
"""Opt-in real Agent -> Controller -> native runner qualification, with DB receipt verification."""
import argparse,copy,hashlib,json,os,pathlib,subprocess,tempfile,time,uuid
import websocket

if not __debug__:
    raise RuntimeError('Python optimization disables test assertions; unset PYTHONOPTIMIZE')

def digest(data): return 'sha256:'+hashlib.sha256(data).hexdigest()
def sql(query,database='operations'):
    return subprocess.check_output([os.environ.get('CLAUDE_E2E_CONTAINER_ENGINE','docker'),'exec',os.environ.get('CLAUDE_E2E_DB_CONTAINER','postgres'),'psql','-U',os.environ.get('CLAUDE_E2E_DB_USER','postgres'),'-d',os.environ.get('CLAUDE_E2E_DB_NAME',database),'-Atc',query],text=True).strip()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime',type=pathlib.Path,required=True)
    parser.add_argument('--url',default='ws://127.0.0.1:8090/chat')
    parser.add_argument('--report',type=pathlib.Path,required=True)
    args=parser.parse_args(); runtime=args.runtime.resolve(); session=str(uuid.uuid4())
    token=(runtime/'service.jwt').read_text().strip()
    profile=json.loads((runtime/'coding-profile.json').read_text())
    results=[]
    with tempfile.TemporaryDirectory(prefix='phase3-',dir=runtime/'repositories') as temporary:
        root=pathlib.Path(temporary);repo=root/'source';repo.mkdir()
        def git(*a):return subprocess.check_output(['git',*a],cwd=repo,stderr=subprocess.DEVNULL).decode().strip()
        git('init','-q');git('config','user.name','Qualification');git('config','user.email','qualification@example.invalid')
        (repo/'main.py').write_text('def add(a, b):\n    return a - b\n')
        (repo/'.gitignore').write_text('__pycache__/\nbuild/\n')
        # Fixed, independent test source: the native prompt cannot redefine success.
        tests = 'import unittest\nfrom main import add\nclass AdditionTest(unittest.TestCase):\n    def test_add(self):\n        for a,b in [(2,3),(-2,3),(0,0),(-8,-9),(10**30,1)]:\n            with self.subTest(a=a,b=b): self.assertEqual(add(a,b),a+b)\n'
        (repo/'test_main.py').write_text(tests)
        git('add','.');git('commit','-qm','base');base=git('rev-parse','HEAD')
        bundle=root/'repository.bundle';git('bundle','create',str(bundle),'HEAD')
        coding=dict(repository=dict(artifactUri=bundle.as_uri(),digest=digest(bundle.read_bytes()),size=bundle.stat().st_size,mediaType='application/x-git-bundle'),
            baseRevision=base,workspaceRoot='/workspace/repository',writableRoots=['/workspace/repository'],allowedTools=['fs.read','fs.write','process.exec'],
            maximumPatchBytes=8192,maximumChangedFiles=2,role='implement',nativeModel=os.environ.get('CLAUDE_E2E_MODEL','sonnet'),
            thread=dict(runnerId=os.environ.get('CLAUDE_E2E_RUNNER_ID','personal-claude-runner'),sessionRef=str(uuid.uuid4()),stageId='phase3-implementation',mode='new',closeAfterTurn=False))
        ws=websocket.create_connection(args.url+'?sessionId='+session,header={'Authorization':'Bearer '+token},timeout=240,http_no_proxy=['localhost','127.0.0.1'])
        first=json.loads(ws.recv());assert first['type']=='session',first
        def run(label,spec,prompt):
            print('Deployment qualification:',label,flush=True)
            ws.send(json.dumps(dict(text=prompt,clientMessageId=str(uuid.uuid4()),profile='coding',coding=spec)))
            accepted=None
            while True:
                event=json.loads(ws.recv())
                if event.get('type')=='error':raise RuntimeError(event.get('message','admission failed'))
                if event.get('type')=='executionAccepted':accepted=event['request_id']
                if event.get('type')=='executionResult':
                    assert accepted,'terminal without admission'
                    turn=str(uuid.UUID(event['turnId']))
                    raw=sql("SELECT json_build_object('result',terminal_result,'error',terminal_error) FROM agent_ops.agent_turn_t WHERE turn_id='"+turn+"' AND session_id='"+session+"'")
                    receipt=json.loads(raw)
                    if event['state']!='COMPLETED':
                        # Save diagnostics privately; don't print vendor output or credentials.
                        diagnostic=runtime/'last-smoke-failure.json';diagnostic.write_text(json.dumps(receipt,indent=2));diagnostic.chmod(0o600)
                        raise RuntimeError('Turn failed: '+event['state']+'; private receipt '+str(diagnostic))
                    result=receipt['result'];assert result['fencingToken']>0
                    output=result['result']['structuredOutput'];worker=output.get('worker',output)
                    results.append(dict(turn=label,state=event['state'],fencingToken=result['fencingToken'],
                        requestId=accepted,sessionState=worker['codingThread']['state']))
                    return output,worker
        def resume(spec,worker):
            next=copy.deepcopy(spec);t=worker['codingThread'];next['thread'].update(mode='resume',expectedCheckpoint=t['checkpoint'])
            next.pop('nativeModel',None)
            return next
        marker='implementation-'+uuid.uuid4().hex
        out,one=run('implement-new',coding,'Fix add in main.py to add the numbers. Run python3 -m unittest test_main and python3 -m py_compile main.py. Leave generated __pycache__ in place. Create build/output.txt containing generated, and leave this ignored file in place. Do not edit tests or .gitignore. Remember '+marker+' only in this conversation, not in files.')
        follow=resume(coding,one)
        out,two=run('implement-resume',follow,'Recall the private marker in your final answer. Add exactly the module docstring """Integer addition.""" to main.py and keep add correct. Run python3 -B assertions. Change no other files.')
        assert marker in two['finalMessage']
        patch=out['codingPatch'];implementation=out['codingImplementation']
        review=copy.deepcopy(coding);review.update(role='review');review['thread'].update(sessionRef=str(uuid.uuid4()),stageId='phase3-review')
        review['reviewInput']=dict(reviewId='phase3-review',repository='qualification/example',requirements='add must add correctly',requirementsDigest=digest(b'add must add correctly'),candidatePatch=patch['patch'],implementation=implementation)
        marker2='review-'+uuid.uuid4().hex
        _,three=run('review-new',review,'Review main.py, run python3 -B assertions, and approve if correct. Remember '+marker2+' only in this conversation and include it in validationGaps as a qualification marker. Do not modify files.')
        assert three['codingReview']['verdict']=='approved'
        final_follow=resume(follow,two)
        out,updated=run('implement-refresh',final_follow,'Keep add correct and add subtract(a, b) returning a minus b in main.py. Run the unchanged unittest suite. Change no other source files. Recall the private implementation marker in your final answer.')
        assert marker in updated['finalMessage']
        refreshed=out['codingPatch']
        assert refreshed['patchDigest'] != patch['patchDigest'], 'reviewer must receive a changed candidate'
        again=resume(review,three);again['thread']['closeAfterTurn']=True
        again['reviewInput']['candidatePatch']=refreshed['patch']
        again['reviewInput']['implementation']=out['codingImplementation']
        _,four=run('review-resume-close',again,'Recheck the freshly reconstructed main.py, including the NEW subtract(a, b) function. Run python3 -B assertions for add and subtract. Recall the prior private review marker and include it in validationGaps. Approve only if both functions are correct. Do not modify files.')
        assert marker2 in str(four['codingReview']['validationGaps']);assert four['codingThread']['state']=='CLOSED'
        assert four['codingReview']['verdict']=='approved'
        close=resume(final_follow,updated);close['thread']['mode']='close'
        _,five=run('implement-close',close,'Close this workflow-owned implementation session.')
        assert five['codingThread']['state']=='CLOSED'
        assert refreshed['changedPaths']==['main.py'], 'generated files or fixed tests entered the patch'
        subprocess.run(['git','apply','-'],input=refreshed['patch'],text=True,cwd=repo,check=True)
        assert (repo/'test_main.py').read_text()==tests
        subprocess.run(['python3','-B','-m','unittest','test_main'],cwd=repo,check=True)
        subprocess.run(['python3','-B','-c','from main import add,subtract; assert add(2,3)==5; assert add(-2,3)==1; assert subtract(8,3)==5; assert subtract(-2,3)==-5'],cwd=repo,check=True)
        ws.close()
    args.report.write_text(json.dumps(dict(schemaVersion=1,adapter='claude-code-v1',boundary='published-Agent-controller-enrolled-runner',
        gatewayAuditChecked=False,implementationContext=True,reviewContext=True,reviewCandidateRefreshed=True,
        ignoredBuildOutputExcluded=True,independentTest=True,validationCommand='python3 -B -m unittest test_main',
        nativeBinaryDigest=profile['binaryDigest'],workerBinaryDigest=profile['imageDigest'],
        adapterContractDigest=profile['qualification']['contractDigest'],turns=results),indent=2)+'\n')
    print('Claude deployment smoke passed:',args.report)
if __name__=='__main__': main()
