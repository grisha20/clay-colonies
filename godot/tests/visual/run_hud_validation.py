"""Run the exact-HUD specification's tests against an explicit isolated QA port."""
import argparse,json,os,re,shutil,subprocess,time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--qa-port',type=int,required=True)
    parser.add_argument('--report-dir',default='godot/tests/visual/hud_validation')
    args=parser.parse_args()
    if not 8800<=args.qa_port<=8899:raise ValueError('Only isolated QA 88xx ports')
    exe=shutil.which('godot_console')
    reports=(ROOT/args.report_dir).resolve()
    if not reports.is_relative_to(ROOT/'godot/tests/visual'):raise ValueError('Reports must remain in visual tests')
    reports.mkdir(parents=True,exist_ok=True)
    scripts=sorted(p for group in ('world','game','net') for p in (ROOT/'godot/tests'/group).glob('*.gd'))
    scripts += [ROOT/'godot/tests/integration'/n for n in ('test_build_tools.gd','test_start_menu.gd')]
    scripts += [ROOT/'godot/tests/visual/capture_pause_menu.gd']
    summary=[]
    for path in scripts:
        graphical=path.name=='capture_pause_menu.gd'
        command=[exe]+([] if graphical else ['--headless'])+['--path','godot']
        if graphical:command+=['--resolution','1920x1080']
        command+=['--script','res://'+path.relative_to(ROOT/'godot').as_posix()]
        if 'integration' in path.parts:command+=['--','--server-port',str(args.qa_port)]
        if graphical:command+=['--','--qa-port',str(args.qa_port)]
        started=time.monotonic()
        try:
            run=subprocess.run(command,cwd=ROOT,capture_output=True,encoding='utf-8',errors='replace',timeout=300)
            output=run.stdout+run.stderr
            errors=[line for line in output.splitlines() if re.search(r'SCRIPT ERROR|^\s*FAIL(?:\s|:)|FAILURES=[1-9]',line)]
            # Preserve engine diagnostics separately: the decoder deliberately
            # parses malformed JSON, and the existing tooltip test leaves an
            # unattached Label alive. Neither is a failed assertion/SCRIPT ERROR.
            diagnostics=[line for line in output.splitlines() if line.startswith(('ERROR:','WARNING:'))]
            for diagnostic in diagnostics:
                expected=(path.stem=='test_packet_decoder' and diagnostic.startswith('ERROR: Parse JSON failed.')) or (path.stem=='test_hud_tooltip' and any(t in diagnostic for t in ('leaked','resources still in use')))
                if diagnostic.startswith('ERROR:') and not expected:errors.append(diagnostic)
            passed=run.returncode==0 and not errors
            passed=run.returncode==0 and not errors
            code=run.returncode
        except subprocess.TimeoutExpired as e:
            output='TIMEOUT 300 seconds\n'+str(e.stdout);passed=False;code=124;errors=['TIMEOUT'];diagnostics=[]
        (reports/(path.stem+'.txt')).write_text(output,encoding='utf-8')
        item={'script':path.relative_to(ROOT).as_posix(),'pass':passed,'exit':code,'seconds':round(time.monotonic()-started,2),'errors':errors,'engine_diagnostics':diagnostics}
        summary.append(item)
        print(('PASS ' if passed else 'FAIL ')+item['script'],flush=True)
    (reports/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f"HUD_VALIDATION {sum(x['pass'] for x in summary)}/{len(summary)} PASS",flush=True)
    raise SystemExit(any(not x['pass'] for x in summary))

if __name__=='__main__':main()
