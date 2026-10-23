"""Import image_gen results and their exact prompts, without touching game files."""
import argparse
import json
import re
import sys
sys.dont_write_bytecode=True
from PIL import Image
from build_hud import ROOT,CATALOG,load_catalog,clean_alpha

parser=argparse.ArgumentParser()
parser.add_argument('metadata')
args=parser.parse_args()
data=json.loads((ROOT/'_tools'/args.metadata).read_text(encoding='utf-8'))
catalog=load_catalog()
for name,spec in data['defs'].items():
    if not re.fullmatch('[a-z0-9_]+',name):
        raise ValueError(name)
    target=ROOT/'_source'/f'{name}.png'
    if not target.exists():
        clean_alpha(Image.open(data['paths'][name])).save(target)
    catalog[name]=spec
CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Imported {len(data["defs"])} generated assets.')
