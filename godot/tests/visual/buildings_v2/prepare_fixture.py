"""Populate a disposable QA snapshot from a placement-checked Godot plan."""
from pathlib import Path
import argparse,json,copy
ROOT=Path(__file__).resolve().parents[4]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    source=(ROOT/args.source).resolve();out=(ROOT/args.output).resolve()
    for path in (source,out):path.relative_to((ROOT/'tmp/qa').resolve())
    assert source!=out
    snapshot=json.loads(source.read_text(encoding='utf-8'))
    plan=json.loads((ROOT/'tmp/qa/buildings_v2_settlement_plan.json').read_text(encoding='utf-8'))
    existing=snapshot['surface']['buildings']
    next_id=max(int(b['id'].split('-')[-1]) for b in existing if b['id'].startswith('bld-'))+100
    for index,b in enumerate(plan):
        b['id']=f'bld-{next_id+index}'
        b['cost']={'clay':0,'wood':0,'stone':0};b['delivered']=copy.deepcopy(b['cost'])
    snapshot['surface']['buildings']=[b for b in existing if b['colonyId']!='colony-1']+plan
    # Keep live residents, terrain, reserves and server schema. Quiet this QA
    # scene only, so the final capture doesn't coincide with a random raid.
    snapshot['session']['dangersEnabled']=False
    snapshot['session']['speed']=1
    snapshot['session']['events']=[]
    # Move this disposable fixture forward to morning, preserving monotonic
    # timer semantics and using the ordinary server-driven day/night cycle.
    snapshot['tick']=(snapshot['tick']//6000+1)*6000+1000
    snapshot['weather']={'state':'clear','until':snapshot['tick']+100000,'bigRainAt':snapshot['tick']+200000}
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(snapshot,ensure_ascii=False),encoding='utf-8')
    print('QA_FIXTURE',out,'models',len(plan),'live residents',len(snapshot['ants']))

if __name__=='__main__':main()
