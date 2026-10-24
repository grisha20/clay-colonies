"""Building-art gate; all run logs remain untracked in tmp/qa, not in Git."""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--qa-port',type=int,required=True)
    args=parser.parse_args()
    if not 8800<=args.qa_port<=8899:raise ValueError('Isolated 88xx QA port required')
    output=ROOT/'tmp/qa/buildings_v2_checks'
    output.mkdir(parents=True,exist_ok=True)
    exe=shutil.which('godot_console')
    scripts=sorted(p for group in ('world','game','net') for p in (ROOT/'godot/tests'/group).glob('*.gd'))
    scripts += [ROOT/'godot/tests/integration/test_build_tools.gd',ROOT/'godot/tests/visual/capture_layout.gd']
    results=[]
    for path in scripts:
        graphical=path.stem=='capture_layout'
        command=[exe]+([] if graphical else ['--headless'])+['--path','godot']
        if graphical:command+=['--resolution','1920x1080']
        command+=['--script','res://'+path.relative_to(ROOT/'godot').as_posix()]
        if 'integration' in path.parts:command+=['--','--server-port',str(args.qa_port)]
        if graphical:command+=['--','--qa-port',str(args.qa_port),'--out-dir','res://tests/visual/buildings_v2']
        run=subprocess.run(command,cwd=ROOT,capture_output=True,encoding='utf-8',errors='replace',timeout=300)
        text=run.stdout+run.stderr
        (output/(path.stem+'.txt')).write_text(text,encoding='utf-8')
        errors=[]
        for line in text.splitlines():
            if re.search(r'SCRIPT ERROR|^\s*FAIL(?:\s|:)|FAILURES=[1-9]',line):errors.append(line)
            if line.startswith('ERROR:'):
                known=(path.stem=='test_packet_decoder' and 'Parse JSON failed' in line) or (path.stem=='test_hud_tooltip' and any(t in line for t in ('leaked','resources still in use')))
                if not known:errors.append(line)
        passed=run.returncode==0 and not errors
        results.append({'script':path.relative_to(ROOT).as_posix(),'pass':passed,'exit':run.returncode,'errors':errors})
        print(('PASS ' if passed else 'FAIL ')+results[-1]['script'],flush=True)
    (output/'summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print('BUILDINGS_CHECKS',sum(r['pass'] for r in results),'/',len(results),'PASS',flush=True)
    raise SystemExit(any(not r['pass'] for r in results))

if __name__=='__main__':main()
